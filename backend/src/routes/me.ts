/** /v1/me — không gian cá nhân: hồ sơ, 2FA, playlist, yêu thích, theo dõi, lịch sử.
 *  Port 1:1 backend/app/routers/me.py — tên field GIỮ NGUYÊN cho frontend cũ.
 *  Mọi handler ĐỒNG BỘ (better-sqlite3) nên throw HttpError được Express 4 bắt. */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, newId, type Row } from '../db.js';
import {
  HttpError, requireAuth, verifyPassword, hashPassword, createToken,
} from '../security.js';
import { AVATAR_DIR, COVER_DIR } from '../config.js';
import { generateCover } from '../covers.js';
import { stableSeed } from '../utils.js';
import { newSecret, otpauthUri, verifyTotp } from '../totp.js';
import { qrSvg } from '../qr.js';
import { getBrand } from '../branding.js';
import {
  serializeTracks, serializeReleases, serializeArtists, serializePlaylists,
} from '../serializers.js';

const router = Router();

const AVATAR_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const VALID_FAV_TYPES = ['track', 'release', 'playlist'];
const VALID_VISIBILITY = ['public', 'private', 'unlisted'];

// Toàn bộ router yêu cầu đăng nhập (req.user luôn có sau đây).
router.use(requireAuth);

const str = (v: any): string => (v == null ? '' : String(v));

// --------------------------------------------------------------------------
// HỒ SƠ
// --------------------------------------------------------------------------
router.get('/', (req: Request, res: Response) => {
  const u = req.user as Row;
  res.json({
    id: u.id, email: u.email, display_name: u.display_name, role: u.role,
    plan: u.plan, avatar_url: u.avatar_url ?? null, settings: u.settings,
  });
});

router.get('/profile', (req: Request, res: Response) => {
  const u = req.user as Row;
  const uid = u.id;
  const stats = {
    playlists: (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE owner_id=?').get(uid) as Row).n,
    favorites: (db.prepare(
      "SELECT COUNT(*) AS n FROM favorites WHERE user_id=? AND entity_type='track'").get(uid) as Row).n,
    follows: (db.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id=?').get(uid) as Row).n,
    plays: (db.prepare('SELECT COUNT(*) AS n FROM play_history WHERE user_id=?').get(uid) as Row).n,
  };
  res.json({
    id: uid, email: u.email, display_name: u.display_name, role: u.role, plan: u.plan,
    avatar_url: u.avatar_url ?? null,
    created_at: u.created_at ?? null,
    email_verified: Boolean(u.email_verified),
    totp_enabled: Boolean(u.totp_enabled),
    stats,
  });
});

router.patch('/', (req: Request, res: Response) => {
  const u = req.user as Row;
  const body = req.body || {};
  if (body.display_name != null) {
    const name = str(body.display_name).trim();
    if (!name) throw new HttpError(400, 'Tên hiển thị không được để trống');
    db.prepare('UPDATE users SET display_name=? WHERE id=?').run(name, u.id);
  }
  if (body.settings != null) {
    db.prepare('UPDATE users SET settings=? WHERE id=?')
      .run(JSON.stringify(body.settings), u.id);
  }
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// AVATAR + ĐỔI MẬT KHẨU
// --------------------------------------------------------------------------
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
});

function runAvatarUpload(req: Request, res: Response, next: NextFunction): void {
  avatarUpload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'Ảnh tối đa 5MB'));
      return next(new HttpError(400, 'Không đọc được ảnh tải lên'));
    }
    next();
  });
}

router.post('/avatar', runAvatarUpload, (req: Request, res: Response) => {
  const u = req.user as Row;
  const file = req.file;
  if (!file) throw new HttpError(400, 'Thiếu file ảnh');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!AVATAR_EXTS.includes(ext)) {
    throw new HttpError(400, 'Avatar chỉ nhận PNG/JPG/WebP/GIF');
  }
  const fname = `${u.id}_${crypto.randomBytes(5).toString('hex')}${ext}`;
  const dest = path.join(AVATAR_DIR, fname);
  fs.writeFileSync(dest, file.buffer);
  // dọn avatar cũ của chính user
  try {
    for (const name of fs.readdirSync(AVATAR_DIR)) {
      if (name.startsWith(`${u.id}_`) && name !== fname) {
        try { fs.unlinkSync(path.join(AVATAR_DIR, name)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  const url = `/media/avatars/${fname}`;
  db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(url, u.id);
  res.json({ ok: true, avatar_url: url });
});

router.post('/password', (req: Request, res: Response) => {
  const u = req.user as Row;
  const body = req.body || {};
  if (!verifyPassword(str(body.current_password), u.password_hash)) {
    throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
  }
  const newPassword = str(body.new_password);
  if (newPassword.length < 6) throw new HttpError(400, 'Mật khẩu mới tối thiểu 6 ký tự');
  // tăng token_version để vô hiệu mọi phiên KHÁC; cấp token mới cho phiên hiện tại
  const newTv = (u.token_version || 0) + 1;
  db.prepare('UPDATE users SET password_hash=?, token_version=? WHERE id=?')
    .run(hashPassword(newPassword), newTv, u.id);
  const fresh = createToken(u.id, u.role, newTv);
  res.json({ ok: true, message: 'Đã đổi mật khẩu', token: fresh });
});

// --------------------------------------------------------------------------
// 2FA — TOTP (Google Authenticator)
// --------------------------------------------------------------------------
router.post('/2fa/setup', (req: Request, res: Response) => {
  const u = req.user as Row;
  if (u.totp_enabled) throw new HttpError(409, '2FA đang bật — tắt trước khi tạo lại');
  const secret = newSecret();
  db.prepare('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?').run(secret, u.id);
  const brand = getBrand().brand_name;
  const uri = otpauthUri(secret, u.email, brand);
  res.json({
    secret, otpauth: uri, qr_svg: qrSvg(uri),
    issuer_label: `${brand} - ${u.email}`,
  });
});

router.post('/2fa/enable', (req: Request, res: Response) => {
  const u = req.user as Row;
  const body = req.body || {};
  if (u.totp_enabled) throw new HttpError(409, '2FA đã bật rồi');
  if (!u.totp_secret) throw new HttpError(400, 'Chưa tạo secret — bấm Thiết lập 2FA trước');
  if (!verifyTotp(u.totp_secret, str(body.code))) {
    throw new HttpError(400, 'Mã không đúng — kiểm tra lại app Google Authenticator');
  }
  db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(u.id);
  res.json({ ok: true, message: 'Đã bật xác thực 2 lớp' });
});

router.post('/2fa/disable', (req: Request, res: Response) => {
  const u = req.user as Row;
  const body = req.body || {};
  if (!u.totp_enabled) throw new HttpError(400, '2FA chưa bật');
  if (!verifyPassword(str(body.password), u.password_hash)) {
    throw new HttpError(400, 'Mật khẩu không đúng');
  }
  if (!verifyTotp(u.totp_secret, str(body.code))) {
    throw new HttpError(400, 'Mã xác thực không đúng');
  }
  db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?').run(u.id);
  res.json({ ok: true, message: 'Đã tắt xác thực 2 lớp' });
});

// --------------------------------------------------------------------------
// PLAYLIST
// --------------------------------------------------------------------------
function ownPlaylist(playlistId: string, userId: string): Row {
  const row = db.prepare('SELECT * FROM playlists WHERE id=?').get(playlistId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy playlist');
  if (row.owner_id !== userId) throw new HttpError(403, 'Bạn không sở hữu playlist này');
  return row;
}

router.get('/playlists', (req: Request, res: Response) => {
  const u = req.user as Row;
  const rows = db.prepare(
    'SELECT * FROM playlists WHERE owner_id=? ORDER BY created_at DESC').all(u.id) as Row[];
  res.json({ items: serializePlaylists(rows) });
});

router.post('/playlists', (req: Request, res: Response) => {
  const u = req.user as Row;
  const body = req.body || {};
  const title = str(body.title).trim();
  if (!title) throw new HttpError(400, 'Tên playlist không được để trống');
  const visibility = body.visibility ?? 'private';
  if (!VALID_VISIBILITY.includes(visibility)) throw new HttpError(400, 'visibility không hợp lệ');
  const pid = newId();
  const coverPath = path.join(COVER_DIR, `playlist_${pid}.svg`);
  const accent = generateCover(coverPath, {
    seed: stableSeed(pid), title, subtitle: u.display_name || 'Playlist',
  });
  db.prepare(
    'INSERT INTO playlists(id,owner_id,title,description,cover_url,accent,visibility) '
    + 'VALUES(?,?,?,?,?,?,?)',
  ).run(pid, u.id, title, body.description ?? null,
    `/media/covers/playlist_${pid}.svg`, accent, visibility);
  const row = db.prepare('SELECT * FROM playlists WHERE id=?').get(pid) as Row;
  res.status(201).json(serializePlaylists([row])[0]);
});

router.patch('/playlists/:playlist_id', (req: Request, res: Response) => {
  const u = req.user as Row;
  const playlistId = req.params.playlist_id;
  ownPlaylist(playlistId, u.id);
  const body = req.body || {};
  if (body.title != null && str(body.title).trim()) {
    db.prepare("UPDATE playlists SET title=?, updated_at=datetime('now') WHERE id=?")
      .run(str(body.title).trim(), playlistId);
  }
  if (body.description != null) {
    db.prepare('UPDATE playlists SET description=? WHERE id=?').run(body.description, playlistId);
  }
  if (VALID_VISIBILITY.includes(body.visibility)) {
    db.prepare('UPDATE playlists SET visibility=? WHERE id=?').run(body.visibility, playlistId);
  }
  res.json({ ok: true });
});

router.delete('/playlists/:playlist_id', (req: Request, res: Response) => {
  const u = req.user as Row;
  const playlistId = req.params.playlist_id;
  ownPlaylist(playlistId, u.id);
  db.prepare('DELETE FROM playlists WHERE id=?').run(playlistId);
  res.json({ ok: true });
});

router.post('/playlists/:playlist_id/tracks', (req: Request, res: Response) => {
  const u = req.user as Row;
  const playlistId = req.params.playlist_id;
  ownPlaylist(playlistId, u.id);
  const trackId = str((req.body || {}).track_id);
  if (!db.prepare('SELECT 1 FROM tracks WHERE id=?').get(trackId)) {
    throw new HttpError(404, 'Không tìm thấy bài hát');
  }
  const dup = db.prepare(
    'SELECT 1 FROM playlist_tracks WHERE playlist_id=? AND track_id=?').get(playlistId, trackId);
  if (dup) throw new HttpError(409, 'Bài hát đã có trong playlist');
  const pos = (db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM playlist_tracks WHERE playlist_id=?',
  ).get(playlistId) as Row).pos;
  db.prepare('INSERT INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)')
    .run(playlistId, trackId, pos);
  db.prepare("UPDATE playlists SET updated_at=datetime('now') WHERE id=?").run(playlistId);
  res.status(201).json({ ok: true, position: pos });
});

router.delete('/playlists/:playlist_id/tracks/:track_id', (req: Request, res: Response) => {
  const u = req.user as Row;
  const { playlist_id: playlistId, track_id: trackId } = req.params;
  ownPlaylist(playlistId, u.id);
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?')
    .run(playlistId, trackId);
  res.json({ ok: true });
});

router.put('/playlists/:playlist_id/order', (req: Request, res: Response) => {
  const u = req.user as Row;
  const playlistId = req.params.playlist_id;
  ownPlaylist(playlistId, u.id);
  const rows = db.prepare(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id=?').all(playlistId) as Row[];
  const current = new Set(rows.map(r => r.track_id));
  const trackIds: string[] = Array.isArray((req.body || {}).track_ids) ? req.body.track_ids : [];
  const idSet = new Set(trackIds);
  const sameSet = idSet.size === current.size && [...current].every(x => idSet.has(x));
  if (!sameSet || trackIds.length !== current.size) {
    throw new HttpError(400, 'Danh sách sắp xếp phải chứa đúng toàn bộ bài trong playlist');
  }
  trackIds.forEach((tid, pos) => {
    db.prepare('UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?')
      .run(pos, playlistId, tid);
  });
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// YÊU THÍCH
// --------------------------------------------------------------------------
router.get('/favorites', (req: Request, res: Response) => {
  const u = req.user as Row;
  const type = str(req.query.type) || 'track';
  if (!VALID_FAV_TYPES.includes(type)) throw new HttpError(400, 'type phải là track|release|playlist');
  const uid = u.id;
  if (type === 'track') {
    const rows = db.prepare(
      `SELECT t.* FROM tracks t JOIN favorites f ON f.entity_id=t.id
         WHERE f.user_id=? AND f.entity_type='track' ORDER BY f.created_at DESC`).all(uid) as Row[];
    return res.json({ items: serializeTracks(rows, uid) });
  }
  if (type === 'release') {
    const rows = db.prepare(
      `SELECT r.* FROM releases r JOIN favorites f ON f.entity_id=r.id
         WHERE f.user_id=? AND f.entity_type='release' ORDER BY f.created_at DESC`).all(uid) as Row[];
    return res.json({ items: serializeReleases(rows, uid) });
  }
  const rows = db.prepare(
    `SELECT p.* FROM playlists p JOIN favorites f ON f.entity_id=p.id
       WHERE f.user_id=? AND f.entity_type='playlist' ORDER BY f.created_at DESC`).all(uid) as Row[];
  return res.json({ items: serializePlaylists(rows) });
});

const FAV_TABLE: Record<string, string> = {
  track: 'tracks', release: 'releases', playlist: 'playlists',
};

router.put('/favorites/:entity_type/:entity_id', (req: Request, res: Response) => {
  const u = req.user as Row;
  const { entity_type: entityType, entity_id: entityId } = req.params;
  if (!VALID_FAV_TYPES.includes(entityType)) {
    throw new HttpError(400, 'type phải là track|release|playlist');
  }
  const table = FAV_TABLE[entityType];
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(entityId)) {
    throw new HttpError(404, 'Không tìm thấy đối tượng');
  }
  db.prepare('INSERT OR IGNORE INTO favorites(user_id,entity_type,entity_id) VALUES(?,?,?)')
    .run(u.id, entityType, entityId);
  if (entityType === 'track') {
    db.prepare(
      `UPDATE tracks SET like_count = (SELECT COUNT(*) FROM favorites
         WHERE entity_type='track' AND entity_id=?) WHERE id=?`).run(entityId, entityId);
  }
  res.json({ ok: true, liked: true });
});

router.delete('/favorites/:entity_type/:entity_id', (req: Request, res: Response) => {
  const u = req.user as Row;
  const { entity_type: entityType, entity_id: entityId } = req.params;
  db.prepare('DELETE FROM favorites WHERE user_id=? AND entity_type=? AND entity_id=?')
    .run(u.id, entityType, entityId);
  if (entityType === 'track') {
    db.prepare(
      `UPDATE tracks SET like_count = (SELECT COUNT(*) FROM favorites
         WHERE entity_type='track' AND entity_id=?) WHERE id=?`).run(entityId, entityId);
  }
  res.json({ ok: true, liked: false });
});

// --------------------------------------------------------------------------
// THEO DÕI NGHỆ SĨ
// --------------------------------------------------------------------------
router.get('/follows', (req: Request, res: Response) => {
  const u = req.user as Row;
  const rows = db.prepare(
    `SELECT a.* FROM artists a JOIN follows f ON f.artist_id=a.id
       WHERE f.user_id=? ORDER BY f.created_at DESC`).all(u.id) as Row[];
  res.json({ items: serializeArtists(rows, u.id) });
});

router.post('/follows/:artist_id', (req: Request, res: Response) => {
  const u = req.user as Row;
  const artistId = req.params.artist_id;
  if (!db.prepare('SELECT 1 FROM artists WHERE id=?').get(artistId)) {
    throw new HttpError(404, 'Không tìm thấy nghệ sĩ');
  }
  db.prepare('INSERT OR IGNORE INTO follows(user_id,artist_id) VALUES(?,?)').run(u.id, artistId);
  res.status(201).json({ ok: true, following: true });
});

router.delete('/follows/:artist_id', (req: Request, res: Response) => {
  const u = req.user as Row;
  db.prepare('DELETE FROM follows WHERE user_id=? AND artist_id=?').run(u.id, req.params.artist_id);
  res.json({ ok: true, following: false });
});

// --------------------------------------------------------------------------
// LỊCH SỬ NGHE
// --------------------------------------------------------------------------
router.get('/history', (req: Request, res: Response) => {
  const u = req.user as Row;
  let limit = parseInt(str(req.query.limit) || '30', 10);
  if (!Number.isFinite(limit)) limit = 30;
  // clamp cả cận dưới: limit âm → SQLite hiểu LIMIT -1 = KHÔNG giới hạn (đổ hết)
  limit = Math.max(1, Math.min(limit, 100));
  const rows = db.prepare(
    `SELECT t.*, MAX(ph.played_at) AS last_played FROM play_history ph
       JOIN tracks t ON t.id=ph.track_id
       WHERE ph.user_id=? AND t.status='live'
       GROUP BY t.id ORDER BY last_played DESC LIMIT ?`).all(u.id, limit) as Row[];
  const items = serializeTracks(rows, u.id);
  items.forEach((item, i) => { item.last_played = rows[i].last_played; });
  res.json({ items });
});

export default router;
