/** Admin CMS API — port 1:1 backend/app/routers/admin.py.
 *
 *  RBAC v2.0:
 *   - Toàn router yêu cầu tối thiểu MANAGER (admin|manager) — uploader KHÔNG vào
 *     (uploader dùng products.ts cho nhạc của mình).
 *   - QUẢN LÝ TÀI KHOẢN + ĐỐI TÁC/DISTRIBUTION yêu cầu ADMIN (requireAdmin từng route).
 *
 *  MOUNT: đăng ký trong routes/index.ts bằng app.use('/admin/v1', adminRouter).
 *  Router định nghĩa path KHÔNG kèm prefix (prefix nằm ở điểm mount).
 *
 *  better-sqlite3 đồng bộ → handler viết SYNC, ném HttpError (Express 4 tự bắt lỗi
 *  đồng bộ và đẩy về middleware lỗi tập trung). Riêng approve dùng dynamic import
 *  './products.js' (mirror Python: import cục bộ trong hàm tránh circular import) nên
 *  là handler ASYNC (try/catch + next(e)). */
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  ARTIST_IMG_DIR, AUDIO_CONTENT_TYPES, AUDIO_DIR, AVATAR_DIR, COVER_DIR, MASTER_DIR,
  SFTP_ROOT, PUBLIC_HOST, SFTP_ENABLED, SFTP_PORT,
} from '../config.js';
import { db, newId, setSetting, type Row } from '../db.js';
import { hashPassword, requireManager, requireAdmin, HttpError } from '../security.js';
import { serializeArtists, serializeReleases, serializeTracks } from '../serializers.js';
import { cleanIsrc, normalizeText, stableSeed, validateIsrc, validateUpc } from '../utils.js';
import { generateCover, generateAvatar } from '../covers.js';
import { AUTO_KEYS, autoEnabled, poolCounts, markCodeUsed } from '../idpool.js';
import { processAudio, audioDurationMs } from '../transcode.js';
import { invalidateWaveform } from '../waveform.js';
import {
  generateKeypair, fingerprintOf, normalizePublicKey, makeSftpUsername, hostKeyFingerprint,
} from '../distributions.js';
import { importDelivery } from '../ddex.js';

const RELEASE_STATUSES = ['draft', 'pending_review', 'live', 'scheduled', 'taken_down'];
const TRACK_STATUSES = ['draft', 'live', 'taken_down'];
const VALID_ROLES = ['user', 'uploader', 'manager', 'admin'];
const VALID_PLANS = ['free', 'premium'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ACCENT_RE = /^#[0-9A-Fa-f]{6}$/;                      // màu accent #RRGGBB
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];      // ảnh nghệ sĩ (không nhận SVG)
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;                    // 5MB

// ---- helpers dùng chung ----------------------------------------------------
/** SHA256 hex của API key — KHỚP ingestion.hash_api_key (partner auth). */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
/** Ghi nhật ký hành động release (INLINE của products._log_action — insert thuần). */
function logAction(releaseId: string, action: string, actor: string,
                   status = 'success', detail = ''): void {
  db.prepare(
    'INSERT INTO release_actions(id,release_id,action,provider,status,actor_email,detail) '
    + "VALUES(?,?,?,'website',?,?,?)",
  ).run(newId(), releaseId, action, status, actor, detail);
}
const asBool = (v: any): boolean =>
  v === true || ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const qstr = (v: any): string => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));

/** Lấy 1 giá trị scalar (cột đầu tiên) — thay cho Python fetchone()[0]. */
function scalar(sql: string, ...args: any[]): number {
  const r = db.prepare(sql).get(...args) as Row | undefined;
  return r ? Number(Object.values(r)[0] ?? 0) : 0;
}
function exists(sql: string, ...args: any[]): boolean {
  return db.prepare(sql).get(...args) !== undefined;
}
function requireArtistsExist(artistIds: any[] | null | undefined): void {
  for (const aid of artistIds || []) {
    if (!exists('SELECT 1 FROM artists WHERE id=?', aid)) {
      throw new HttpError(400, `Nghệ sĩ không tồn tại: ${aid}`);
    }
  }
}

// ---- multer (memory) + wrapper bắt lỗi kích thước --------------------------
const memUpload = (limitBytes: number) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: limitBytes } });
const uploadImage = memUpload(20 * 1024 * 1024);
const uploadAudio = memUpload(1024 * 1024 * 1024);
const uploadCover = memUpload(30 * 1024 * 1024);
const uploadXml = memUpload(40 * 1024 * 1024);
const uploadTxt = memUpload(8 * 1024 * 1024);

/** Bọc middleware multer → chuyển lỗi LIMIT_FILE_SIZE thành HttpError 413. */
function runUpload(mw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    mw(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return next(new HttpError(413, 'Dữ liệu quá lớn'));
        }
        return next(err);
      }
      next();
    });
  };
}

const router = Router();
// Mặc định cả router: manager trở lên (admin|manager) — nội dung/catalog.
router.use(requireManager);

// ==========================================================================
// DASHBOARD
// ==========================================================================
router.get('/stats', (_req: Request, res: Response) => {
  const top = db.prepare(
    `SELECT t.*, COUNT(ph.id) AS week_plays FROM tracks t
       JOIN play_history ph ON ph.track_id=t.id
         AND ph.played_at >= datetime('now','-7 days')
       GROUP BY t.id ORDER BY week_plays DESC LIMIT 8`,
  ).all() as Row[];
  const topItems = serializeTracks(top);
  topItems.forEach((item, i) => { item.week_plays = top[i].week_plays; });

  const recentDeliveries = db.prepare(
    'SELECT * FROM deliveries ORDER BY received_at DESC LIMIT 6',
  ).all() as Row[];

  res.json({
    tracks: scalar('SELECT COUNT(*) FROM tracks'),
    tracks_live: scalar("SELECT COUNT(*) FROM tracks WHERE status='live'"),
    releases: scalar('SELECT COUNT(*) FROM releases'),
    artists: scalar('SELECT COUNT(*) FROM artists'),
    users: scalar('SELECT COUNT(*) FROM users'),
    plays_7d: scalar("SELECT COUNT(*) FROM play_history WHERE played_at >= datetime('now','-7 days')"),
    plays_total: scalar('SELECT COUNT(*) FROM play_history'),
    pending_review: scalar("SELECT COUNT(*) FROM releases WHERE status='pending_review'"),
    failed_deliveries: scalar("SELECT COUNT(*) FROM deliveries WHERE status='failed'"),
    top_tracks_week: topItems,
    recent_deliveries: recentDeliveries,
  });
});

// ==========================================================================
// NGHỆ SĨ
// ==========================================================================
/** Đếm số track / release gắn với từng nghệ sĩ (batch 1 query mỗi loại). */
function artistCounts(ids: string[]): [Map<string, number>, Map<string, number>] {
  const tc = new Map<string, number>();
  const rc = new Map<string, number>();
  if (!ids.length) return [tc, rc];
  const q = ids.map(() => '?').join(',');
  for (const r of db.prepare(
    `SELECT artist_id, COUNT(DISTINCT track_id) AS n FROM track_artists `
    + `WHERE artist_id IN (${q}) GROUP BY artist_id`,
  ).all(...ids) as Row[]) tc.set(r.artist_id, r.n);
  for (const r of db.prepare(
    `SELECT artist_id, COUNT(DISTINCT release_id) AS n FROM release_artists `
    + `WHERE artist_id IN (${q}) GROUP BY artist_id`,
  ).all(...ids) as Row[]) rc.set(r.artist_id, r.n);
  return [tc, rc];
}

router.get('/artists', (req: Request, res: Response) => {
  const like = `%${normalizeText(qstr(req.query.q))}%`;
  const rows = db.prepare(
    'SELECT * FROM artists WHERE name_norm LIKE ? ORDER BY name LIMIT 200',
  ).all(like) as Row[];
  const items = serializeArtists(rows);
  const [tc, rc] = artistCounts(items.map((a) => a.id));
  for (const a of items) {
    a.track_count = tc.get(a.id) ?? 0;
    a.release_count = rc.get(a.id) ?? 0;
  }
  res.json({ items });
});

router.get('/artists/:artist_id', (req: Request, res: Response) => {
  const artistId = req.params.artist_id;
  const row = db.prepare('SELECT * FROM artists WHERE id=?').get(artistId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy nghệ sĩ');
  const item = serializeArtists([row])[0];
  item.sort_name = row.sort_name ?? null;
  item.created_at = row.created_at ?? null;
  item.updated_at = row.updated_at ?? null;
  const [tc, rc] = artistCounts([artistId]);
  item.track_count = tc.get(artistId) ?? 0;
  item.release_count = rc.get(artistId) ?? 0;
  item.top_tracks = db.prepare(
    `SELECT t.id, t.title, t.isrc, t.play_count FROM tracks t
       JOIN track_artists ta ON ta.track_id = t.id
       WHERE ta.artist_id=? GROUP BY t.id
       ORDER BY t.play_count DESC, t.created_at DESC LIMIT 10`,
  ).all(artistId) as Row[];
  item.releases = db.prepare(
    `SELECT r.id, r.title, r.status FROM releases r
       JOIN release_artists ra ON ra.release_id = r.id
       WHERE ra.artist_id=? GROUP BY r.id
       ORDER BY r.created_at DESC LIMIT 50`,
  ).all(artistId) as Row[];
  res.json(item);
});

router.post('/artists/:artist_id/image', runUpload(uploadImage.single('file')),
  (req: Request, res: Response) => {
    const artistId = req.params.artist_id;
    if (!exists('SELECT 1 FROM artists WHERE id=?', artistId)) {
      throw new HttpError(404, 'Không tìm thấy nghệ sĩ');
    }
    const file = req.file;
    if (!file) throw new HttpError(400, 'Thiếu file');
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) throw new HttpError(400, 'Ảnh nghệ sĩ chỉ nhận PNG/JPG/WebP');
    if (file.buffer.length > IMAGE_MAX_BYTES) throw new HttpError(400, 'Ảnh tối đa 5MB');
    // token ngẫu nhiên trong tên → đổi ảnh là đổi URL, cache cũ không dính lại
    const fname = `${artistId}_${crypto.randomBytes(5).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(ARTIST_IMG_DIR, fname), file.buffer);
    // dọn ảnh cũ của chính nghệ sĩ này
    for (const old of fs.readdirSync(ARTIST_IMG_DIR)) {
      if (old.startsWith(`${artistId}_`) && old !== fname) {
        try { fs.rmSync(path.join(ARTIST_IMG_DIR, old), { force: true }); } catch { /* ignore */ }
      }
    }
    const url = `/media/artists/${fname}`;
    db.prepare("UPDATE artists SET image_url=?, updated_at=datetime('now') WHERE id=?")
      .run(url, artistId);
    res.json({ ok: true, image_url: url });
  });

router.post('/artists', (req: Request, res: Response) => {
  const body = req.body || {};
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Tên nghệ sĩ không được để trống');
  const aid = newId();
  const accent = generateAvatar(path.join(COVER_DIR, `artist_${aid}.svg`),
    { seed: stableSeed(aid), name });
  db.prepare(
    'INSERT INTO artists(id,name,name_norm,sort_name,type,country,isni,ipi,bio,image_url,accent) '
    + 'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  ).run(aid, name, normalizeText(name), name, body.type ?? 'person', body.country ?? null,
    body.isni ?? null, body.ipi ?? null, body.bio ?? null,
    `/media/covers/artist_${aid}.svg`, accent);
  res.status(201).json({ id: aid });
});

router.patch('/artists/:artist_id', (req: Request, res: Response) => {
  const artistId = req.params.artist_id;
  const body = req.body || {};
  if (!exists('SELECT 1 FROM artists WHERE id=?', artistId)) {
    throw new HttpError(404, 'Không tìm thấy nghệ sĩ');
  }
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Tên nghệ sĩ không được để trống');
  const accent = body.accent;
  if (accent !== undefined && accent !== null && accent !== '' && !ACCENT_RE.test(accent)) {
    throw new HttpError(400, 'accent phải là mã màu hex dạng #RRGGBB');
  }
  // đổi tên → cập nhật cả name_norm (tìm kiếm không dấu) + sort_name
  db.prepare(
    'UPDATE artists SET name=?, name_norm=?, sort_name=?, type=?, country=?, '
    + "isni=?, ipi=?, bio=?, updated_at=datetime('now') WHERE id=?",
  ).run(name, normalizeText(name), name, body.type ?? 'person', body.country ?? null,
    body.isni ?? null, body.ipi ?? null, body.bio ?? null, artistId);
  if (accent) { // None/rỗng = giữ màu hiện tại (additive)
    db.prepare('UPDATE artists SET accent=? WHERE id=?').run(accent, artistId);
  }
  res.json({ ok: true });
});

router.delete('/artists/:artist_id', (req: Request, res: Response) => {
  const artistId = req.params.artist_id;
  if (!exists('SELECT 1 FROM artists WHERE id=?', artistId)) {
    throw new HttpError(404, 'Không tìm thấy nghệ sĩ');
  }
  const nTracks = scalar('SELECT COUNT(*) FROM track_artists WHERE artist_id=?', artistId);
  const nReleases = scalar('SELECT COUNT(*) FROM release_artists WHERE artist_id=?', artistId);
  if (nTracks || nReleases) {
    throw new HttpError(409,
      `Nghệ sĩ đang gắn với ${nTracks} bài hát và ${nReleases} release `
      + '— gỡ liên kết trước khi xóa');
  }
  db.prepare('DELETE FROM follows WHERE artist_id=?').run(artistId);
  db.prepare('DELETE FROM artists WHERE id=?').run(artistId);
  // dọn file ảnh: ảnh upload media/artists/{id}_* + avatar SVG tự sinh
  for (const old of fs.readdirSync(ARTIST_IMG_DIR)) {
    if (old.startsWith(`${artistId}_`)) {
      try { fs.rmSync(path.join(ARTIST_IMG_DIR, old), { force: true }); } catch { /* ignore */ }
    }
  }
  try { fs.rmSync(path.join(COVER_DIR, `artist_${artistId}.svg`), { force: true }); } catch { /* ignore */ }
  res.json({ ok: true });
});

// ==========================================================================
// RELEASE (Album/Single/EP)
// ==========================================================================
router.get('/releases', (req: Request, res: Response) => {
  const like = `%${normalizeText(qstr(req.query.q))}%`;
  const status = qstr(req.query.status);
  let sql = 'SELECT * FROM releases WHERE title_norm LIKE ?';
  const args: any[] = [like];
  if (status) { sql += ' AND status=?'; args.push(status); }
  const rows = db.prepare(sql + ' ORDER BY created_at DESC LIMIT 200').all(...args) as Row[];
  res.json({ items: serializeReleases(rows) });
});

function validateReleaseBody(body: Row): void {
  if (!String(body.title ?? '').trim()) throw new HttpError(400, 'Thiếu tiêu đề');
  if (!validateUpc(String(body.upc ?? ''))) {
    throw new HttpError(400, 'UPC không hợp lệ (12–14 số, checksum GTIN)');
  }
  if (!['Album', 'Single', 'EP', 'Compilation'].includes(body.release_type ?? 'Album')) {
    throw new HttpError(400, 'release_type phải là Album|Single|EP|Compilation');
  }
  if (!['Explicit', 'NotExplicit', 'Edited'].includes(body.parental_warning ?? 'NotExplicit')) {
    throw new HttpError(400, 'parental_warning không hợp lệ');
  }
  if (!RELEASE_STATUSES.includes(body.status ?? 'draft')) {
    throw new HttpError(400, `status phải là ${RELEASE_STATUSES.join('|')}`);
  }
}

router.post('/releases', (req: Request, res: Response) => {
  const body = req.body || {};
  validateReleaseBody(body);
  requireArtistsExist(body.artist_ids);
  const upc = String(body.upc);
  if (exists('SELECT 1 FROM releases WHERE upc=?', upc)) {
    throw new HttpError(409, 'UPC đã tồn tại');
  }
  const rid = newId();
  const accent = generateCover(path.join(COVER_DIR, `release_${rid}.svg`),
    { seed: stableSeed(rid), title: String(body.title), subtitle: body.label_name || '' });
  db.prepare(
    'INSERT INTO releases(id,upc,title,title_norm,release_type,label_name,genre,'
    + 'p_line,c_line,parental_warning,original_release_date,platform_release_date,'
    + 'cover_url,accent,status,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(rid, upc, String(body.title).trim(), normalizeText(String(body.title)),
    body.release_type ?? 'Album', body.label_name ?? null, body.genre ?? null,
    body.p_line ?? null, body.c_line ?? null, body.parental_warning ?? 'NotExplicit',
    body.original_release_date ?? null, body.platform_release_date ?? null,
    `/media/covers/release_${rid}.svg`, accent, body.status ?? 'draft', 'admin_upload');
  const artistIds: any[] = body.artist_ids || [];
  artistIds.forEach((aid, i) => {
    db.prepare(
      "INSERT OR IGNORE INTO release_artists(release_id,artist_id,role,sequence) "
      + "VALUES(?,?,'MainArtist',?)",
    ).run(rid, aid, i + 1);
  });
  markCodeUsed('upc', upc, rid);
  res.status(201).json({ id: rid });
});

router.patch('/releases/:release_id', (req: Request, res: Response) => {
  const releaseId = req.params.release_id;
  const body = req.body || {};
  if (!exists('SELECT 1 FROM releases WHERE id=?', releaseId)) {
    throw new HttpError(404, 'Không tìm thấy release');
  }
  validateReleaseBody(body);
  requireArtistsExist(body.artist_ids);
  const upc = String(body.upc);
  if (exists('SELECT id FROM releases WHERE upc=? AND id != ?', upc, releaseId)) {
    throw new HttpError(409, 'UPC đã dùng cho release khác');
  }
  db.prepare(
    'UPDATE releases SET upc=?, title=?, title_norm=?, release_type=?, label_name=?, '
    + 'genre=?, p_line=?, c_line=?, parental_warning=?, original_release_date=?, '
    + 'platform_release_date=?, status=? WHERE id=?',
  ).run(upc, String(body.title).trim(), normalizeText(String(body.title)),
    body.release_type ?? 'Album', body.label_name ?? null, body.genre ?? null,
    body.p_line ?? null, body.c_line ?? null, body.parental_warning ?? 'NotExplicit',
    body.original_release_date ?? null, body.platform_release_date ?? null,
    body.status ?? 'draft', releaseId);
  if (body.artist_ids !== undefined && body.artist_ids !== null) {
    db.prepare('DELETE FROM release_artists WHERE release_id=?').run(releaseId);
    (body.artist_ids as any[]).forEach((aid, i) => {
      db.prepare(
        "INSERT OR IGNORE INTO release_artists(release_id,artist_id,role,sequence) "
        + "VALUES(?,?,'MainArtist',?)",
      ).run(releaseId, aid, i + 1);
    });
  }
  res.json({ ok: true });
});

router.delete('/releases/:release_id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM releases WHERE id=?').run(req.params.release_id);
  res.json({ ok: true });
});

router.post('/releases/:release_id/cover', runUpload(uploadCover.single('file')),
  (req: Request, res: Response) => {
    const releaseId = req.params.release_id;
    if (!exists('SELECT 1 FROM releases WHERE id=?', releaseId)) {
      throw new HttpError(404, 'Không tìm thấy release');
    }
    const file = req.file;
    if (!file) throw new HttpError(400, 'Thiếu file');
    const ext = path.extname(file.originalname || '').toLowerCase();
    // không nhận .svg từ upload — SVG có thể chứa script chạy trên origin của app
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      throw new HttpError(400, 'Chỉ nhận JPG/PNG/WebP');
    }
    fs.writeFileSync(path.join(COVER_DIR, `release_${releaseId}${ext}`), file.buffer);
    const url = `/media/covers/release_${releaseId}${ext}`;
    db.prepare('UPDATE releases SET cover_url=? WHERE id=?').run(url, releaseId);
    res.json({ ok: true, cover_url: url });
  });

router.put('/releases/:release_id/tracks', (req: Request, res: Response) => {
  const releaseId = req.params.release_id;
  const trackIds: string[] = (req.body && req.body.track_ids) || [];
  if (!exists('SELECT 1 FROM releases WHERE id=?', releaseId)) {
    throw new HttpError(404, 'Không tìm thấy release');
  }
  // validate TRƯỚC khi xóa + gói transaction để không mất tracklist cũ
  if (new Set(trackIds).size !== trackIds.length) {
    throw new HttpError(400, 'Danh sách track có phần tử trùng');
  }
  for (const tid of trackIds) {
    if (!exists('SELECT 1 FROM tracks WHERE id=?', tid)) {
      throw new HttpError(400, `Track không tồn tại: ${tid}`);
    }
  }
  const del = db.prepare('DELETE FROM release_tracks WHERE release_id=?');
  const ins = db.prepare(
    'INSERT INTO release_tracks(release_id,track_id,disc_no,track_no) VALUES(?,?,1,?)',
  );
  const tx = db.transaction((ids: string[]) => {
    del.run(releaseId);
    ids.forEach((tid, i) => ins.run(releaseId, tid, i + 1));
  });
  tx(trackIds);
  res.json({ ok: true });
});

// ==========================================================================
// TRACK (SoundRecording)
// ==========================================================================
router.get('/tracks', (req: Request, res: Response) => {
  const q = qstr(req.query.q);
  const status = qstr(req.query.status);
  const like = `%${normalizeText(q)}%`;
  let sql = 'SELECT * FROM tracks WHERE (title_norm LIKE ? OR isrc LIKE ?)';
  const args: any[] = [like, `%${q.toUpperCase()}%`];
  if (status) { sql += ' AND status=?'; args.push(status); }
  const rows = db.prepare(sql + ' ORDER BY created_at DESC LIMIT 300').all(...args) as Row[];
  res.json({ items: serializeTracks(rows) });
});

router.post('/tracks', (req: Request, res: Response) => {
  const body = req.body || {};
  const isrc = cleanIsrc(String(body.isrc ?? ''));
  if (!validateIsrc(isrc)) throw new HttpError(400, 'ISRC sai định dạng (CC-XXX-YY-NNNNN)');
  if (exists('SELECT 1 FROM tracks WHERE isrc=?', isrc)) {
    throw new HttpError(409, 'ISRC đã tồn tại');
  }
  if (!String(body.title ?? '').trim()) throw new HttpError(400, 'Thiếu tiêu đề');
  if (!['Explicit', 'NotExplicit', 'Edited'].includes(body.parental_warning ?? 'NotExplicit')) {
    throw new HttpError(400, 'parental_warning không hợp lệ');
  }
  requireArtistsExist(body.artist_ids);
  if (body.release_id && !exists('SELECT 1 FROM releases WHERE id=?', body.release_id)) {
    throw new HttpError(400, 'Release không tồn tại');
  }
  const tid = newId();
  db.prepare(
    'INSERT INTO tracks(id,isrc,title,title_norm,subtitle,language,genre,'
    + 'parental_warning,p_line,lyrics,lyrics_lrc,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(tid, isrc, String(body.title).trim(), normalizeText(String(body.title)),
    body.subtitle ?? null, body.language ?? 'vi', body.genre ?? null,
    body.parental_warning ?? 'NotExplicit', body.p_line ?? null,
    body.lyrics ?? null, body.lyrics_lrc ?? null, 'draft');
  const artistIds: any[] = body.artist_ids || [];
  artistIds.forEach((aid, i) => {
    const role = i === 0 ? 'MainArtist' : 'FeaturedArtist';
    db.prepare(
      'INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)',
    ).run(tid, aid, role, i + 1);
  });
  if (body.release_id) {
    const no = scalar(
      'SELECT COALESCE(MAX(track_no),0)+1 FROM release_tracks WHERE release_id=?',
      body.release_id);
    db.prepare(
      'INSERT OR IGNORE INTO release_tracks(release_id,track_id,disc_no,track_no) '
      + 'VALUES(?,?,1,?)',
    ).run(body.release_id, tid, no);
  }
  markCodeUsed('isrc', isrc, tid);
  res.status(201).json({ id: tid });
});

router.patch('/tracks/:track_id', (req: Request, res: Response) => {
  const trackId = req.params.track_id;
  const body = req.body || {};
  const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy bài hát');
  const isrc = cleanIsrc(String(body.isrc ?? ''));
  if (!validateIsrc(isrc)) throw new HttpError(400, 'ISRC sai định dạng');
  if (exists('SELECT 1 FROM tracks WHERE isrc=? AND id != ?', isrc, trackId)) {
    throw new HttpError(409, 'ISRC đã dùng cho bài khác');
  }
  if (!TRACK_STATUSES.includes(body.status ?? 'draft')) {
    throw new HttpError(400, `status phải là ${TRACK_STATUSES.join('|')}`);
  }
  if (!['Explicit', 'NotExplicit', 'Edited'].includes(body.parental_warning ?? 'NotExplicit')) {
    throw new HttpError(400, 'parental_warning không hợp lệ');
  }
  requireArtistsExist(body.artist_ids);
  if ((body.status ?? 'draft') === 'live' && !row.audio_path) {
    throw new HttpError(400, 'Chưa có file audio — không thể chuyển sang live');
  }
  db.prepare(
    'UPDATE tracks SET isrc=?, title=?, title_norm=?, subtitle=?, language=?, genre=?, '
    + 'parental_warning=?, p_line=?, lyrics=?, lyrics_lrc=?, status=? WHERE id=?',
  ).run(isrc, String(body.title).trim(), normalizeText(String(body.title)),
    body.subtitle ?? null, body.language ?? 'vi', body.genre ?? null,
    body.parental_warning ?? 'NotExplicit', body.p_line ?? null,
    body.lyrics ?? null, body.lyrics_lrc ?? null, body.status ?? 'draft', trackId);
  if (body.artist_ids !== undefined && body.artist_ids !== null) {
    db.prepare('DELETE FROM track_artists WHERE track_id=?').run(trackId);
    (body.artist_ids as any[]).forEach((aid, i) => {
      const role = i === 0 ? 'MainArtist' : 'FeaturedArtist';
      db.prepare(
        'INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)',
      ).run(trackId, aid, role, i + 1);
    });
  }
  res.json({ ok: true });
});

router.delete('/tracks/:track_id', (req: Request, res: Response) => {
  const trackId = req.params.track_id;
  const row = db.prepare('SELECT audio_path, master_path FROM tracks WHERE id=?')
    .get(trackId) as Row | undefined;
  if (row) {
    if (row.audio_path) {
      try { fs.rmSync(path.join(AUDIO_DIR, row.audio_path), { force: true }); } catch { /* ignore */ }
    }
    // dọn cả bản gốc WAV trong media/masters (file lớn nhất — quên sẽ rò rỉ đĩa)
    if (row.master_path) {
      try { fs.rmSync(path.join(MASTER_DIR, path.basename(row.master_path)), { force: true }); }
      catch { /* ignore */ }
    }
  }
  invalidateWaveform(trackId);
  db.prepare('DELETE FROM tracks WHERE id=?').run(trackId);
  res.json({ ok: true });
});

/** Nạp + chuẩn hóa audio cho 1 track (dùng chung admin.ts & products.ts).
 *  Người gọi tự lo phân quyền TRƯỚC khi gọi. */
export function ingestTrackAudio(trackId: string, file: Express.Multer.File): any {
  const row = db.prepare('SELECT audio_path FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy bài hát');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!(ext in AUDIO_CONTENT_TYPES)) {
    throw new HttpError(400,
      `Định dạng không hỗ trợ (${ext}). Nhận: ${Object.keys(AUDIO_CONTENT_TYPES).join(', ')}`);
  }
  // Ghi file tạm — chỉ thay file thật khi validate xong (upload hỏng không phá audio đang phát).
  const tmp = path.join(AUDIO_DIR, `${trackId}.uploading${ext}`);
  const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const dest = path.join(AUDIO_DIR, `${trackId}${ext}`);
  let duration = 0;
  try {
    fs.writeFileSync(tmp, file.buffer);
    duration = audioDurationMs(tmp);
    if (duration <= 0) {
      throw new HttpError(400, 'File audio không đọc được (hỏng hoặc sai định dạng)');
    }
    try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
    fs.renameSync(tmp, dest);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }

  // chuẩn hóa: bản gốc WAV 44.1kHz (masters/) + bản stream AAC (nếu có ffmpeg)
  let audioName = path.basename(dest);
  let masterName: string | null = null;
  const tr = processAudio(dest, trackId);
  if (tr) {
    audioName = tr.audio_name;
    masterName = tr.master_name;
    if (path.basename(dest) !== audioName) {
      try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
    }
  }

  const dup = db.prepare('SELECT id, title FROM tracks WHERE audio_hash=? AND id != ?')
    .get(digest, trackId) as Row | undefined;

  // đổi định dạng file → dọn file cũ khác tên
  const old = row.audio_path;
  if (old && old !== audioName) {
    try { fs.rmSync(path.join(AUDIO_DIR, old), { force: true }); } catch { /* ignore */ }
  }

  db.prepare(
    'UPDATE tracks SET audio_path=?, master_path=?, audio_hash=?, duration_ms=? WHERE id=?',
  ).run(audioName, masterName, digest, duration, trackId);
  invalidateWaveform(trackId); // audio mới → phân tích lại waveform
  return {
    ok: true, duration_ms: duration, sha256: digest, transcoded: Boolean(tr),
    duplicate_of: dup ? { id: dup.id, title: dup.title } : null,
  };
}

router.post('/tracks/:track_id/audio', runUpload(uploadAudio.single('file')),
  (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Thiếu file');
    res.json(ingestTrackAudio(req.params.track_id, file));
  });

// ==========================================================================
// DDEX INGESTION
// ==========================================================================
router.post('/ddex/import', runUpload(uploadXml.single('file')),
  (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Thiếu file');
    if (file.buffer.length > 20 * 1024 * 1024) throw new HttpError(413, 'File XML quá lớn');
    const report = importDelivery(file.buffer, { autoPublish: asBool(req.query.auto_publish) });
    res.json(report);
  });

router.get('/deliveries', (req: Request, res: Response) => {
  const status = qstr(req.query.status);
  let sql = 'SELECT * FROM deliveries';
  const args: any[] = [];
  if (status) { sql += ' WHERE status=?'; args.push(status); }
  const rows = db.prepare(sql + ' ORDER BY received_at DESC LIMIT 200').all(...args) as Row[];
  res.json({ items: rows });
});

router.get('/deliveries/:delivery_id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM deliveries WHERE id=?')
    .get(req.params.delivery_id) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy delivery');
  res.json(row);
});

// ==========================================================================
// REVIEW QUEUE
// ==========================================================================
router.get('/review-queue', (_req: Request, res: Response) => {
  const rows = db.prepare(
    "SELECT * FROM releases WHERE status='pending_review' ORDER BY created_at",
  ).all() as Row[];
  res.json({ items: serializeReleases(rows) });
});

router.post('/review-queue/:release_id/approve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const releaseId = req.params.release_id;
      const row = db.prepare(
        "SELECT * FROM releases WHERE id=? AND status='pending_review'",
      ).get(releaseId) as Row | undefined;
      if (!row) throw new HttpError(404, 'Release không nằm trong hàng chờ duyệt');
      // Product tạo trong CMS → CHUNG pipeline publish v2.0 (QC + UPC + deal + published_at).
      // (import cục bộ mirror Python — tránh circular import admin<->products)
      if (row.source === 'product') {
        const spec = './products.js';
        const mod: any = await import(spec);
        res.json(mod._doPublish(row, req.user!.email, 'approve'));
        return;
      }
      // release nhập ngoài (DDEX/studio) — flip trạng thái như cũ
      const future = exists(
        "SELECT 1 FROM releases WHERE id=? AND platform_release_date > datetime('now')",
        releaseId);
      const newStatus = future ? 'scheduled' : 'live';
      db.prepare('UPDATE releases SET status=? WHERE id=?').run(newStatus, releaseId);
      if (newStatus === 'live') {
        db.prepare(
          `UPDATE tracks SET status = CASE WHEN audio_path IS NOT NULL THEN 'live' ELSE 'draft' END
             WHERE id IN (SELECT track_id FROM release_tracks WHERE release_id=?)
               AND status IN ('draft','pending_review')`,
        ).run(releaseId);
      }
      res.json({ ok: true, status: newStatus });
    } catch (e) { next(e); }
  });

router.post('/review-queue/:release_id/reject', (req: Request, res: Response) => {
  const releaseId = req.params.release_id;
  const row = db.prepare(
    "SELECT * FROM releases WHERE id=? AND status='pending_review'",
  ).get(releaseId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Release không nằm trong hàng chờ duyệt');
  const note = String((req.body && req.body.note) || '').trim() || 'Bị từ chối duyệt phát hành';
  db.prepare("UPDATE releases SET status='draft', review_note=? WHERE id=?").run(note, releaseId);
  logAction(releaseId, 'reject', req.user!.email, 'success', note);
  res.json({ ok: true, status: 'draft' });
});

// ==========================================================================
// KHO MÃ UPC / ISRC
// ==========================================================================
/** Chuẩn hóa + validate 1 mã. Trả về mã sạch hoặc null nếu sai định dạng. */
function validatePoolCode(kind: string, raw: string): string | null {
  let code = raw.trim().toUpperCase();
  if (kind === 'isrc') {
    code = cleanIsrc(code);
    return validateIsrc(code) ? code : null;
  }
  code = code.replace(/-/g, '').replace(/ /g, '');
  return validateUpc(code) ? code : null;
}

function poolAddCodes(kind: string, rawCodes: any[]): { added: any[]; skipped: any[] } {
  const added: any[] = [];
  const skipped: any[] = [];
  const [table, col] = kind === 'isrc' ? ['tracks', 'isrc'] : ['releases', 'upc'];
  for (const raw of rawCodes) {
    if (!String(raw).trim()) continue;
    const code = validatePoolCode(kind, String(raw));
    if (!code) {
      skipped.push({ code: String(raw).trim(), reason: 'sai định dạng/checksum' });
      continue;
    }
    if (exists('SELECT 1 FROM id_pool WHERE code=?', code)) {
      skipped.push({ code, reason: 'đã có trong kho' });
      continue;
    }
    const inUse = exists(`SELECT 1 FROM ${table} WHERE ${col}=?`, code);
    db.prepare(
      'INSERT INTO id_pool(id,kind,code,status,used_at) '
      + "VALUES(?,?,?,?, CASE WHEN ? THEN datetime('now') END)",
    ).run(newId(), kind, code, inUse ? 'used' : 'available', inUse ? 1 : 0);
    if (inUse) skipped.push({ code, reason: 'catalog đã dùng — lưu trạng thái used' });
    else added.push(code);
  }
  return { added, skipped };
}

router.get('/idpool', (req: Request, res: Response) => {
  const kind = qstr(req.query.kind) || 'isrc';
  if (kind !== 'isrc' && kind !== 'upc') throw new HttpError(400, 'kind phải là isrc|upc');
  const status = qstr(req.query.status);
  let sql = 'SELECT * FROM id_pool WHERE kind=?';
  const args: any[] = [kind];
  if (status === 'available' || status === 'used') { sql += ' AND status=?'; args.push(status); }
  const rows = db.prepare(sql + ' ORDER BY status, added_at DESC, code LIMIT 500')
    .all(...args) as Row[];
  res.json({
    items: rows,
    ...poolCounts(kind),
    auto_generate: autoEnabled(kind),
  });
});

router.post('/idpool', (req: Request, res: Response) => {
  const body = req.body || {};
  if (body.kind !== 'isrc' && body.kind !== 'upc') throw new HttpError(400, 'kind phải là isrc|upc');
  const codes: any[] = body.codes || [];
  if (!codes.length) throw new HttpError(400, 'Chưa có mã nào');
  if (codes.length > 10000) throw new HttpError(400, 'Tối đa 10.000 mã mỗi lần');
  res.status(201).json(poolAddCodes(body.kind, codes));
});

router.post('/idpool/import', runUpload(uploadTxt.single('file')),
  (req: Request, res: Response) => {
    const kind = qstr(req.query.kind);
    if (kind !== 'isrc' && kind !== 'upc') throw new HttpError(400, 'kind phải là isrc|upc');
    const file = req.file;
    if (!file) throw new HttpError(400, 'Thiếu file');
    if (file.buffer.length > 2 * 1024 * 1024) throw new HttpError(413, 'File quá lớn (tối đa 2MB)');
    const text = file.buffer.toString('utf8');
    const codes = text.split(/\r\n|\r|\n/).flatMap((line) => line.split(','));
    if (!codes.some((c) => c.trim())) throw new HttpError(400, 'File không có mã nào');
    res.json(poolAddCodes(kind, codes));
  });

router.delete('/idpool/:pool_id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT status FROM id_pool WHERE id=?')
    .get(req.params.pool_id) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy mã');
  if (row.status !== 'available') throw new HttpError(409, 'Mã đã dùng — không thể xóa khỏi kho');
  db.prepare('DELETE FROM id_pool WHERE id=?').run(req.params.pool_id);
  res.json({ ok: true });
});

router.patch('/idpool/settings', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!(body.kind in AUTO_KEYS)) throw new HttpError(400, 'kind phải là isrc|upc');
  const autoGenerate = asBool(body.auto_generate);
  setSetting(AUTO_KEYS[body.kind], autoGenerate ? '1' : '0');
  res.json({ ok: true, auto_generate: autoGenerate });
});

// ==========================================================================
// ĐỐI TÁC DELIVERY (kênh API) — CHỈ ADMIN
// ==========================================================================
function newApiKey(): string {
  return 'ans_' + crypto.randomBytes(32).toString('base64url');
}

/** Xóa thư mục dropbox SFTP khi xóa distribution/partner. */
function dropSftpDropbox(partnerId: string): void {
  const row = db.prepare('SELECT sftp_username FROM delivery_partners WHERE id=?')
    .get(partnerId) as Row | undefined;
  if (row && row.sftp_username) {
    try { fs.rmSync(path.join(SFTP_ROOT, row.sftp_username), { recursive: true, force: true }); }
    catch { /* ignore */ }
  }
}

router.get('/partners', requireAdmin, (_req: Request, res: Response) => {
  // chỉ đối tác kênh API (SFTP distribution nằm ở màn Distributions riêng)
  const rows = db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM deliveries d WHERE d.partner_id = p.id) AS delivery_count
       FROM delivery_partners p
       WHERE p.delivery_channel IS NULL OR p.delivery_channel='api'
       ORDER BY p.created_at DESC`,
  ).all() as Row[];
  const items = rows.map((r) => {
    const { api_key_hash, ...rest } = r;      // không bao giờ trả hash ra ngoài
    void api_key_hash;
    rest.auto_publish = Boolean(rest.auto_publish);
    return rest;
  });
  res.json({ items });
});

router.post('/partners', requireAdmin, (req: Request, res: Response) => {
  const body = req.body || {};
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Thiếu tên đối tác');
  if (body.dpid && exists('SELECT 1 FROM delivery_partners WHERE dpid=?', body.dpid)) {
    throw new HttpError(409, 'DPID đã tồn tại');
  }
  const pid = newId();
  const apiKey = newApiKey();
  db.prepare(
    'INSERT INTO delivery_partners(id,name,dpid,contact_email,api_key_hash,'
    + "auto_publish,delivery_channel) VALUES(?,?,?,?,?,?,'api')",
  ).run(pid, name, body.dpid || null, body.contact_email ?? null,
    hashApiKey(apiKey), asBool(body.auto_publish) ? 1 : 0);
  // api_key chỉ trả về ĐÚNG MỘT LẦN — server chỉ lưu hash
  res.status(201).json({ id: pid, api_key: apiKey });
});

router.patch('/partners/:partner_id', requireAdmin, (req: Request, res: Response) => {
  const partnerId = req.params.partner_id;
  const body = req.body || {};
  if (!exists('SELECT 1 FROM delivery_partners WHERE id=?', partnerId)) {
    throw new HttpError(404, 'Không tìm thấy đối tác');
  }
  if (!String(body.name ?? '').trim()) throw new HttpError(400, 'Thiếu tên đối tác');
  if (body.dpid && exists('SELECT 1 FROM delivery_partners WHERE dpid=? AND id!=?',
    body.dpid, partnerId)) {
    throw new HttpError(409, 'DPID đã thuộc đối tác/distribution khác');
  }
  db.prepare(
    'UPDATE delivery_partners SET name=?, dpid=?, contact_email=?, auto_publish=? WHERE id=?',
  ).run(String(body.name).trim(), body.dpid || null, body.contact_email ?? null,
    asBool(body.auto_publish) ? 1 : 0, partnerId);
  res.json({ ok: true });
});

router.post('/partners/:partner_id/regenerate-key', requireAdmin, (req: Request, res: Response) => {
  const partnerId = req.params.partner_id;
  if (!exists('SELECT 1 FROM delivery_partners WHERE id=?', partnerId)) {
    throw new HttpError(404, 'Không tìm thấy đối tác');
  }
  const apiKey = newApiKey();
  db.prepare('UPDATE delivery_partners SET api_key_hash=? WHERE id=?')
    .run(hashApiKey(apiKey), partnerId);
  res.json({ api_key: apiKey });
});

router.delete('/partners/:partner_id', requireAdmin, (req: Request, res: Response) => {
  dropSftpDropbox(req.params.partner_id);
  db.prepare('DELETE FROM delivery_partners WHERE id=?').run(req.params.partner_id);
  res.json({ ok: true });
});

// ==========================================================================
// DISTRIBUTION SFTP (DDEX delivery kiểu YouTube) — CHỈ ADMIN
// ==========================================================================
/** IP LAN chính (thay socket UDP-connect của Python) — non-internal IPv4 đầu tiên. */
function primaryLanIp(): string {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const a of iface || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

/** Thông tin kết nối SFTP quảng bá cho đối tác. */
function sftpConnInfo(): any {
  return {
    host: PUBLIC_HOST || primaryLanIp(),
    port: SFTP_PORT,
    enabled: SFTP_ENABLED,
    host_key_fingerprint: hostKeyFingerprint(),
  };
}

router.get('/sftp-info', requireAdmin, (_req: Request, res: Response) => {
  res.json(sftpConnInfo());
});

router.get('/distributions', requireAdmin, (_req: Request, res: Response) => {
  const rows = db.prepare(
    `SELECT p.id, p.name, p.dpid, p.contact_email, p.auto_publish,
            p.sftp_username, p.ssh_fingerprint, p.last_delivery_at, p.created_at,
            (SELECT COUNT(*) FROM deliveries d WHERE d.partner_id=p.id) AS delivery_count
       FROM delivery_partners p WHERE p.delivery_channel='sftp'
       ORDER BY p.created_at DESC`,
  ).all() as Row[];
  const items = rows.map((r) => ({ ...r, auto_publish: Boolean(r.auto_publish) }));
  res.json({ items, sftp: sftpConnInfo() });
});

router.post('/distributions', requireAdmin, (req: Request, res: Response) => {
  const body = req.body || {};
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Thiếu tên distribution');
  if (body.dpid && exists('SELECT 1 FROM delivery_partners WHERE dpid=?', body.dpid)) {
    throw new HttpError(409, 'DPID đã tồn tại');
  }
  // 1) key: đối tác dán public, hoặc server sinh cặp (trả private 1 lần)
  let publicKey: string;
  let privateKey: string | null = null;
  let fp: string;
  if (body.public_key && String(body.public_key).trim()) {
    try {
      publicKey = normalizePublicKey(String(body.public_key));
    } catch (e: any) {
      throw new HttpError(400, String(e?.message ?? e));
    }
    fp = fingerprintOf(publicKey);
  } else {
    const kp = generateKeypair();
    publicKey = kp.public_key;
    privateKey = kp.private_key;
    fp = kp.fingerprint;
  }

  const pid = newId();
  const username = makeSftpUsername(name, crypto.randomBytes(3).toString('hex'));
  // dropbox chroot
  for (const sub of ['incoming', 'processed', 'failed']) {
    fs.mkdirSync(path.join(SFTP_ROOT, username, sub), { recursive: true });
  }
  db.prepare(
    'INSERT INTO delivery_partners(id,name,dpid,contact_email,api_key_hash,'
    + "auto_publish,delivery_channel,sftp_username,ssh_public_key,ssh_fingerprint) "
    + "VALUES(?,?,?,?,?,?,'sftp',?,?,?)",
  ).run(pid, name, body.dpid || null, body.contact_email ?? null,
    hashApiKey('sftp_' + crypto.randomBytes(16).toString('base64url')), // cột NOT NULL, SFTP không dùng
    asBool(body.auto_publish) ? 1 : 0, username, publicKey, fp);
  // private_key chỉ trả 1 LẦN (server KHÔNG lưu)
  res.status(201).json({
    id: pid, sftp_username: username, ssh_public_key: publicKey,
    ssh_fingerprint: fp, private_key: privateKey, sftp: sftpConnInfo(),
  });
});

router.post('/distributions/:dist_id/rotate-key', requireAdmin, (req: Request, res: Response) => {
  const distId = req.params.dist_id;
  const body = req.body || {};
  if (!exists("SELECT 1 FROM delivery_partners WHERE id=? AND delivery_channel='sftp'", distId)) {
    throw new HttpError(404, 'Không tìm thấy distribution');
  }
  let publicKey: string;
  let privateKey: string | null = null;
  let fp: string;
  if (body.public_key && String(body.public_key).trim()) {
    try {
      publicKey = normalizePublicKey(String(body.public_key));
    } catch (e: any) {
      throw new HttpError(400, String(e?.message ?? e));
    }
    fp = fingerprintOf(publicKey);
  } else {
    const kp = generateKeypair();
    publicKey = kp.public_key;
    privateKey = kp.private_key;
    fp = kp.fingerprint;
  }
  db.prepare('UPDATE delivery_partners SET ssh_public_key=?, ssh_fingerprint=? WHERE id=?')
    .run(publicKey, fp, distId);
  res.json({ ssh_public_key: publicKey, ssh_fingerprint: fp, private_key: privateKey });
});

router.patch('/distributions/:dist_id', requireAdmin, (req: Request, res: Response) => {
  const distId = req.params.dist_id;
  const body = req.body || {};
  if (!exists("SELECT 1 FROM delivery_partners WHERE id=? AND delivery_channel='sftp'", distId)) {
    throw new HttpError(404, 'Không tìm thấy distribution');
  }
  if (!String(body.name ?? '').trim()) throw new HttpError(400, 'Thiếu tên');
  if (body.dpid && exists('SELECT 1 FROM delivery_partners WHERE dpid=? AND id!=?',
    body.dpid, distId)) {
    throw new HttpError(409, 'DPID đã thuộc đối tác/distribution khác');
  }
  db.prepare(
    'UPDATE delivery_partners SET name=?, dpid=?, contact_email=?, auto_publish=? WHERE id=?',
  ).run(String(body.name).trim(), body.dpid || null, body.contact_email ?? null,
    asBool(body.auto_publish) ? 1 : 0, distId);
  res.json({ ok: true });
});

router.get('/distributions/:dist_id/deliveries', requireAdmin, (req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT id, message_id, message_type, ern_version, status, received_at, '
    + 'processed_at FROM deliveries WHERE partner_id=? ORDER BY received_at DESC LIMIT 50',
  ).all(req.params.dist_id) as Row[];
  res.json({ items: rows });
});

router.delete('/distributions/:dist_id', requireAdmin, (req: Request, res: Response) => {
  dropSftpDropbox(req.params.dist_id);
  db.prepare('DELETE FROM delivery_partners WHERE id=?').run(req.params.dist_id);
  res.json({ ok: true });
});

// ==========================================================================
// QUẢN LÝ TÀI KHOẢN — CHỈ ADMIN
// ==========================================================================
function getUserOr404(userId: string): Row {
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy người dùng');
  return row;
}
function adminCount(): number {
  return scalar("SELECT COUNT(*) FROM users WHERE role='admin'");
}

router.get('/users', requireAdmin, (req: Request, res: Response) => {
  const q = qstr(req.query.q);
  const role = qstr(req.query.role);
  if (role && !VALID_ROLES.includes(role)) {
    throw new HttpError(400, `role phải là ${VALID_ROLES.join('|')}`);
  }
  let sql = `SELECT u.id, u.email, u.display_name, u.role, u.plan, u.created_at,
                    u.avatar_url, u.email_verified, u.totp_enabled,
                    (SELECT COUNT(*) FROM playlists p WHERE p.owner_id=u.id) AS playlists,
                    (SELECT COUNT(*) FROM play_history ph WHERE ph.user_id=u.id) AS plays
             FROM users u WHERE 1=1`;
  const args: any[] = [];
  if (q.trim()) {
    const like = `%${q.trim()}%`;
    sql += " AND (u.email LIKE ? OR COALESCE(u.display_name,'') LIKE ?)";
    args.push(like, like);
  }
  if (role) { sql += ' AND u.role=?'; args.push(role); }
  const rows = db.prepare(sql + ' ORDER BY u.created_at DESC LIMIT 500').all(...args) as Row[];
  const items = rows.map((r) => ({
    ...r,
    email_verified: Boolean(r.email_verified),
    totp_enabled: Boolean(r.totp_enabled),
  }));
  res.json({ items });
});

router.post('/users', requireAdmin, (req: Request, res: Response) => {
  const body = req.body || {};
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  if (String(body.password ?? '').length < 6) throw new HttpError(400, 'Mật khẩu tối thiểu 6 ký tự');
  const role = body.role ?? 'user';
  const plan = body.plan ?? 'free';
  if (!VALID_ROLES.includes(role)) throw new HttpError(400, `role phải là ${VALID_ROLES.join('|')}`);
  if (!VALID_PLANS.includes(plan)) throw new HttpError(400, `plan phải là ${VALID_PLANS.join('|')}`);
  if (exists('SELECT 1 FROM users WHERE email=?', email)) {
    throw new HttpError(409, 'Email đã được đăng ký');
  }
  const uid = newId();
  const name = String(body.display_name ?? '').trim() || email.split('@')[0];
  db.prepare(
    'INSERT INTO users(id,email,password_hash,display_name,role,plan,email_verified) '
    + 'VALUES(?,?,?,?,?,?,1)',
  ).run(uid, email, hashPassword(String(body.password)), name, role, plan);
  res.status(201).json({ id: uid, email, display_name: name, role, plan });
});

router.patch('/users/:user_id', requireAdmin, (req: Request, res: Response) => {
  const userId = req.params.user_id;
  const body = req.body || {};
  const admin = req.user!;
  const target = getUserOr404(userId);
  if (body.role !== undefined && body.role !== null) {
    if (!VALID_ROLES.includes(body.role)) {
      throw new HttpError(400, `role phải là ${VALID_ROLES.join('|')}`);
    }
    if (body.role !== target.role) {
      // tự đổi role chính mình = khóa nhầm cửa — chặn tuyệt đối
      if (userId === admin.id) throw new HttpError(400, 'Không thể tự đổi vai trò của chính mình');
      // BEGIN IMMEDIATE serialize kiểm tra + ghi (chống mất admin cuối do race)
      db.exec('BEGIN IMMEDIATE');
      try {
        if (target.role === 'admin' && adminCount() <= 1) {
          throw new HttpError(400, 'Phải còn ít nhất 1 admin');
        }
        db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role, userId);
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* txn đã đóng */ }
        throw e;
      }
    }
  }
  if (body.plan !== undefined && body.plan !== null) {
    if (!VALID_PLANS.includes(body.plan)) {
      throw new HttpError(400, `plan phải là ${VALID_PLANS.join('|')}`);
    }
    db.prepare('UPDATE users SET plan=? WHERE id=?').run(body.plan, userId);
  }
  if (body.display_name !== undefined && body.display_name !== null) {
    const name = String(body.display_name).trim();
    if (!name) throw new HttpError(400, 'Tên hiển thị không được để trống');
    db.prepare('UPDATE users SET display_name=? WHERE id=?').run(name, userId);
  }
  res.json({ ok: true });
});

router.post('/users/:user_id/reset-password', requireAdmin, (req: Request, res: Response) => {
  const userId = req.params.user_id;
  const body = req.body || {};
  getUserOr404(userId);
  if (String(body.new_password ?? '').length < 6) {
    throw new HttpError(400, 'Mật khẩu tối thiểu 6 ký tự');
  }
  // tăng token_version → token cũ của tài khoản đó hết hiệu lực ngay
  db.prepare(
    'UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?',
  ).run(hashPassword(String(body.new_password)), userId);
  res.json({ ok: true, message: 'Đã đặt mật khẩu mới' });
});

router.post('/users/:user_id/disable-2fa', requireAdmin, (req: Request, res: Response) => {
  const userId = req.params.user_id;
  getUserOr404(userId);
  db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?').run(userId);
  res.json({ ok: true, message: 'Đã tắt xác thực 2 lớp của tài khoản' });
});

router.delete('/users/:user_id', requireAdmin, (req: Request, res: Response) => {
  const userId = req.params.user_id;
  const admin = req.user!;
  const target = getUserOr404(userId);
  if (userId === admin.id) throw new HttpError(400, 'Không thể tự xóa tài khoản của chính mình');
  // Cascade sạch trong 1 transaction — dữ liệu cá nhân xóa hết, NỘI DUNG (releases
  // uploader đã tạo) giữ lại (created_by=NULL). BEGIN IMMEDIATE + đếm admin trong khóa.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (target.role === 'admin' && adminCount() <= 1) {
      throw new HttpError(400, 'Phải còn ít nhất 1 admin');
    }
    db.prepare(
      'DELETE FROM playlist_tracks WHERE playlist_id IN '
      + '(SELECT id FROM playlists WHERE owner_id=?)',
    ).run(userId);
    db.prepare('DELETE FROM playlists WHERE owner_id=?').run(userId);
    db.prepare('DELETE FROM favorites WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM follows WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM play_history WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM email_codes WHERE email=?').run(target.email);
    db.prepare('UPDATE releases SET created_by=NULL WHERE created_by=?').run(userId);
    db.prepare('DELETE FROM users WHERE id=?').run(userId);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* txn đã đóng */ }
    throw e;
  }
  // DB xong mới dọn file avatar (lỗi file không làm hỏng transaction)
  for (const old of fs.readdirSync(AVATAR_DIR)) {
    if (old.startsWith(`${userId}_`)) {
      try { fs.rmSync(path.join(AVATAR_DIR, old), { force: true }); } catch { /* ignore */ }
    }
  }
  res.json({ ok: true });
});

export default router;
