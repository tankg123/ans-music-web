/** Module Product — đơn vị phát hành chuyên nghiệp (port từ backend/app/routers/products.py).
 *
 *  Product = 1 dòng trong bảng `releases` → Publish là nhạc hiện ngay trên website.
 *  Gồm: labels/genres, CRUD product, tracks trong product, contributors theo role,
 *  QC Check, Publish/Takedown + lịch sử phát hành.
 *
 *  Phân quyền: router-level requireStaff (admin/manager/uploader); các endpoint PHÁT HÀNH
 *  (approve/reject/publish/update-release/takedown + labels/genres CUD) nâng lên requireManager.
 *
 *  Mount ở index.ts: app.use('/admin/v1/products', productsRouter). Ném HttpError để báo lỗi
 *  (middleware lỗi trung tâm bắt — Express 4 tự bắt throw đồng bộ trong handler). */
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

import { AUDIO_DIR, COVER_DIR, MASTER_DIR, ISRC_PREFIX, AUDIO_CONTENT_TYPES } from '../config.js';
import { db, newId, type Row } from '../db.js';
import { HttpError, requireStaff, requireManager } from '../security.js';
import {
  normalizeText, validateIsrc, cleanIsrc, validateUpc, gtinCheckDigit, stableSeed,
} from '../utils.js';
import { autoEnabled, poolTake, markCodeUsed, poolExhaustedError } from '../idpool.js';
import { processAudio, audioDurationMs } from '../transcode.js';
import { invalidateWaveform } from '../waveform.js';
import { generateCover, generateAvatar } from '../covers.js';

const router = Router();
// v2.0: mặc định require_staff cho toàn bộ router; publish nâng require_manager ở từng route.
router.use(requireStaff);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 600 * 1024 * 1024 } });

const REQUIRED_ROLES = ['MainArtist', 'Composer', 'Lyricist', 'MusicPublisher', 'Producer', 'Mixer'];
const OPTIONAL_ROLES = ['FeaturedArtist', 'Remixer', 'Performer'];
const ALL_ROLES = [...REQUIRED_ROLES, ...OPTIONAL_ROLES];
const RELEASE_TYPES = ['Single', 'EP', 'Album', 'Compilation'];
const ADVISORY = ['NotExplicit', 'Explicit', 'Edited'];

// ==========================================================================
// Helpers chung
// ==========================================================================
function nowUtc(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function tryUnlink(p: string): void {
  try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
}

function getRelease(productId: string): Row {
  const row = db.prepare('SELECT * FROM releases WHERE id=?').get(productId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy product');
  return row;
}

function logAction(releaseId: string, action: string, actor: string, status = 'success', detail = ''): void {
  db.prepare(
    'INSERT INTO release_actions(id,release_id,action,provider,status,actor_email,detail) VALUES(?,?,?,?,?,?,?)',
  ).run(newId(), releaseId, action, 'website', status, actor, detail);
}

/** Lấy product + kiểm tra quyền theo role. uploader chỉ thấy/sửa product của mình (draft). */
function ensureProductAccess(user: Row, productId: string, write = false): Row {
  const row = getRelease(productId);
  if (user.role === 'uploader') {
    if (row.created_by !== user.id) throw new HttpError(404, 'Không tìm thấy product');
    if (write && row.status !== 'draft') {
      throw new HttpError(409, 'Product đã gửi duyệt/phát hành — chỉ sửa được khi ở trạng thái Draft');
    }
  }
  return row;
}

/** Scoping uploader cho endpoint thao tác thẳng track_id (không qua product). */
function ensureTrackAccess(user: Row, trackId: string, write = false): void {
  if (user.role !== 'uploader') return;
  const rows = db.prepare(
    `SELECT r.status FROM release_tracks rt JOIN releases r ON r.id=rt.release_id
       WHERE rt.track_id=? AND r.created_by=?`,
  ).all(trackId, user.id) as Row[];
  if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy track');
  if (write && !rows.some(r => r.status === 'draft')) {
    throw new HttpError(409, 'Product đã gửi duyệt/phát hành — chỉ sửa được khi ở trạng thái Draft');
  }
}

// ==========================================================================
// LABELS
// ==========================================================================
function labelCountsSql(scope = ''): string {
  return `
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id${scope}) AS product_count,
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id AND r.status='live'${scope}) AS live_count,
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id AND r.status='draft'${scope}) AS draft_count,
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id AND r.status='pending_review'${scope}) AS pending_count,
    (SELECT COUNT(*) FROM release_tracks rt JOIN releases r ON r.id=rt.release_id
     WHERE r.label_id=l.id${scope}) AS track_count`;
}

function validatePrefix(prefix: string | null | undefined): string | null {
  if (!prefix) return null;
  const p = String(prefix).trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(p)) {
    throw new HttpError(400, 'ISRC prefix phải 5 ký tự: 2 chữ quốc gia + 3 mã registrant (VD: VNA0D)');
  }
  return p;
}

router.get('/labels', (req: Request, res: Response) => {
  const user = req.user!;
  const q = String(req.query.q ?? '');
  let scope = '';
  const scopeArgs: any[] = [];
  if (user.role === 'uploader') {
    scope = ' AND r.created_by=?';
    for (let i = 0; i < 5; i++) scopeArgs.push(user.id);
  }
  let sql = `SELECT l.*, ${labelCountsSql(scope)} FROM labels l`;
  const args: any[] = [...scopeArgs];
  if (q.trim()) { sql += ' WHERE l.name LIKE ?'; args.push(`%${q.trim()}%`); }
  const rows = db.prepare(sql + ' ORDER BY l.name').all(...args) as Row[];
  res.json({ items: rows });
});

router.get('/labels/:label_id', (req: Request, res: Response) => {
  const user = req.user!;
  const labelId = req.params.label_id;
  const label = db.prepare('SELECT * FROM labels WHERE id=?').get(labelId) as Row | undefined;
  if (!label) throw new HttpError(404, 'Không tìm thấy label');
  let sql = `SELECT r.id, r.title, r.status, r.upc, r.release_type,
             (SELECT COUNT(*) FROM release_tracks rt WHERE rt.release_id=r.id) AS track_count
             FROM releases r WHERE r.label_id=?`;
  const args: any[] = [labelId];
  if (user.role === 'uploader') { sql += ' AND r.created_by=?'; args.push(user.id); }
  const products = db.prepare(sql + ' ORDER BY r.created_at DESC').all(...args) as Row[];
  const d: Row = { ...label };
  d.products = products;
  d.stats = {
    product_count: products.length,
    live_count: products.filter(p => p.status === 'live').length,
    draft_count: products.filter(p => p.status === 'draft').length,
    pending_count: products.filter(p => p.status === 'pending_review').length,
    track_count: products.reduce((s, p) => s + (p.track_count || 0), 0),
  };
  res.json(d);
});

router.post('/labels', requireManager, (req: Request, res: Response) => {
  const body = req.body || {};
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Thiếu tên label');
  const lid = newId();
  db.prepare(
    'INSERT INTO labels(id,name,dpid,isrc_prefix,c_line,p_line,right_holder,contact_email,website,notes) '
    + 'VALUES(?,?,?,?,?,?,?,?,?,?)',
  ).run(
    lid, name, body.dpid ?? null, validatePrefix(body.isrc_prefix ?? null),
    body.c_line ?? null, body.p_line ?? null, body.right_holder ?? null,
    body.contact_email ?? null, body.website ?? null, body.notes ?? null,
  );
  res.status(201).json({ id: lid });
});

router.patch('/labels/:label_id', requireManager, (req: Request, res: Response) => {
  const labelId = req.params.label_id;
  if (!db.prepare('SELECT 1 FROM labels WHERE id=?').get(labelId)) throw new HttpError(404, 'Không tìm thấy label');
  const body = req.body || {};
  const allowed = ['name', 'dpid', 'isrc_prefix', 'c_line', 'p_line', 'right_holder', 'contact_email', 'website', 'notes'];
  const data: Record<string, any> = {};
  for (const k of allowed) if (k in body) data[k] = body[k];
  if ('name' in data) {
    if (!String(data.name ?? '').trim()) throw new HttpError(400, 'Tên label không được để trống');
    data.name = String(data.name).trim();
  }
  if ('isrc_prefix' in data) data.isrc_prefix = validatePrefix(data.isrc_prefix);
  const keys = Object.keys(data);
  if (keys.length === 0) return res.json({ ok: true });
  const sets = keys.map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE labels SET ${sets} WHERE id=?`).run(...keys.map(k => data[k]), labelId);
  // đồng bộ tên label đã denormalize sang releases.label_name
  if ('name' in data) db.prepare('UPDATE releases SET label_name=? WHERE label_id=?').run(data.name, labelId);
  res.json({ ok: true });
});

router.delete('/labels/:label_id', requireManager, (req: Request, res: Response) => {
  const labelId = req.params.label_id;
  if (!db.prepare('SELECT 1 FROM labels WHERE id=?').get(labelId)) throw new HttpError(404, 'Không tìm thấy label');
  const cnt = (db.prepare('SELECT COUNT(*) AS n FROM releases WHERE label_id=?').get(labelId) as Row).n;
  if (cnt) throw new HttpError(409, `Label còn ${cnt} product — chuyển product sang label khác trước khi xóa`);
  db.prepare('DELETE FROM labels WHERE id=?').run(labelId);
  res.json({ ok: true });
});

// ==========================================================================
// GENRES
// ==========================================================================
const DEFAULT_GENRES = ['Pop', 'V-Pop', 'Ballad', 'Rock', 'R&B', 'Rap / Hip-Hop',
  'EDM', 'Dance', 'Lo-fi', 'Acoustic', 'Indie', 'Jazz',
  'Classical', 'Country', 'Bolero', 'Nhạc Trẻ', 'Instrumental'];

function ensureDefaultGenres(): void {
  if (db.prepare('SELECT 1 FROM genres LIMIT 1').get()) return;
  const ins = db.prepare('INSERT OR IGNORE INTO genres(id,name,name_norm) VALUES(?,?,?)');
  for (const name of DEFAULT_GENRES) ins.run(newId(), name, normalizeText(name));
}

router.get('/genres', (_req: Request, res: Response) => {
  ensureDefaultGenres();
  const rows = db.prepare(
    `SELECT g.*, (SELECT COUNT(*) FROM releases r WHERE r.genre=g.name) AS product_count
       FROM genres g ORDER BY g.name`,
  ).all() as Row[];
  res.json({ items: rows });
});

router.post('/genres', requireManager, (req: Request, res: Response) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Thiếu tên thể loại');
  const norm = normalizeText(name);
  // trả về TÊN CHUẨN HÓA đã lưu (để 'pop' khớp đúng 'Pop' trong danh mục)
  const existing = db.prepare('SELECT id, name FROM genres WHERE name_norm=?').get(norm) as Row | undefined;
  if (existing) return res.status(201).json({ id: existing.id, name: existing.name, existed: true });
  const gid = newId();
  try {
    db.prepare('INSERT INTO genres(id,name,name_norm) VALUES(?,?,?)').run(gid, name, norm);
  } catch (e) {
    // race: request khác vừa tạo cùng tên → trả bản đã có
    const row = db.prepare('SELECT id, name FROM genres WHERE name_norm=? OR name=?').get(norm, name) as Row | undefined;
    if (row) return res.status(201).json({ id: row.id, name: row.name, existed: true });
    throw e;
  }
  res.status(201).json({ id: gid, name });
});

router.delete('/genres/:genre_id', requireManager, (req: Request, res: Response) => {
  db.prepare('DELETE FROM genres WHERE id=?').run(req.params.genre_id);
  res.json({ ok: true });
});

// ==========================================================================
// ARTIST OPTIONS (picker contributors — mức staff)
// ==========================================================================
router.get('/artist-options', (req: Request, res: Response) => {
  const q = String(req.query.q ?? '');
  let sql = 'SELECT id, name, type, image_url FROM artists';
  const args: any[] = [];
  if (q.trim()) { sql += ' WHERE name_norm LIKE ?'; args.push(`%${normalizeText(q)}%`); }
  const rows = db.prepare(sql + ' ORDER BY name LIMIT 30').all(...args) as Row[];
  res.json({ items: rows });
});

router.post('/artist-options', (req: Request, res: Response) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Tên nghệ sĩ không được để trống');
  const type = String(req.body?.type ?? 'person');
  const norm = normalizeText(name);
  const row = db.prepare('SELECT id, name FROM artists WHERE name_norm=?').get(norm) as Row | undefined;
  if (row) return res.status(201).json({ id: row.id, name: row.name, existed: true });
  const aid = newId();
  const imgPath = path.join(COVER_DIR, `artist_${aid}.svg`);
  const accent = generateAvatar(imgPath, { seed: stableSeed(aid), name });
  db.prepare(
    'INSERT INTO artists(id,name,name_norm,sort_name,type,image_url,accent) VALUES(?,?,?,?,?,?,?)',
  ).run(aid, name, norm, name, type, `/media/covers/artist_${aid}.svg`, accent);
  res.status(201).json({ id: aid, name });
});

// ==========================================================================
// CONTRIBUTORS helpers
// ==========================================================================
function contributorsOf(owner: 'release' | 'track', ownerId: string): Record<string, any[]> {
  const table = owner === 'release' ? 'release_artists' : 'track_artists';
  const col = owner === 'release' ? 'release_id' : 'track_id';
  const rows = db.prepare(
    `SELECT x.role, x.sequence, a.id AS artist_id, a.name, a.image_url
       FROM ${table} x JOIN artists a ON a.id=x.artist_id
       WHERE x.${col}=? ORDER BY x.role, x.sequence`,
  ).all(ownerId) as Row[];
  const out: Record<string, any[]> = {};
  for (const role of ALL_ROLES) out[role] = [];
  for (const r of rows) {
    if (!out[r.role]) out[r.role] = [];
    out[r.role].push({ artist_id: r.artist_id, name: r.name, image_url: r.image_url });
  }
  return out;
}

function putContributors(owner: 'release' | 'track', ownerId: string, payload: Record<string, string[]>): void {
  const table = owner === 'release' ? 'release_artists' : 'track_artists';
  const col = owner === 'release' ? 'release_id' : 'track_id';
  for (const role of Object.keys(payload)) {
    if (!ALL_ROLES.includes(role)) throw new HttpError(400, `Role không hợp lệ: ${role}`);
  }
  for (const [role, artistIds] of Object.entries(payload)) {
    for (const aid of artistIds) {
      if (!db.prepare('SELECT 1 FROM artists WHERE id=?').get(aid)) {
        throw new HttpError(400, `Nghệ sĩ không tồn tại: ${aid}`);
      }
    }
    if (new Set(artistIds).size !== artistIds.length) throw new HttpError(400, `Role ${role}: nghệ sĩ trùng lặp`);
  }
  for (const [role, artistIds] of Object.entries(payload)) {
    db.prepare(`DELETE FROM ${table} WHERE ${col}=? AND role=?`).run(ownerId, role);
    let seq = 1;
    for (const aid of artistIds) {
      db.prepare(`INSERT INTO ${table}(${col},artist_id,role,sequence) VALUES(?,?,?,?)`).run(ownerId, aid, role, seq);
      seq++;
    }
  }
}

/** Sao chép TOÀN BỘ contributors của product → track (thay thế hoàn toàn). */
function copyContributorsToTrack(productId: string, trackId: string): void {
  db.prepare('DELETE FROM track_artists WHERE track_id=?').run(trackId);
  const rows = db.prepare('SELECT artist_id, role, sequence FROM release_artists WHERE release_id=?').all(productId) as Row[];
  const ins = db.prepare('INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)');
  for (const r of rows) ins.run(trackId, r.artist_id, r.role, r.sequence);
}

/** Single: đồng bộ MỌI track; Album/EP/Compilation: chỉ track chưa tự chỉnh (customized=0). */
function propagateContributors(productId: string, releaseType: string): void {
  const rows = db.prepare(
    'SELECT track_id, contributors_customized FROM release_tracks rt JOIN tracks t ON t.id = rt.track_id WHERE rt.release_id=?',
  ).all(productId) as Row[];
  for (const r of rows) {
    if (releaseType === 'Single' || !r.contributors_customized) copyContributorsToTrack(productId, r.track_id);
  }
}

function payloadContributors(req: Request): Record<string, string[]> {
  const payload = req.body?.contributors;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'Thiếu contributors');
  return payload;
}

router.put('/tracks/:track_id/contributors', (req: Request, res: Response) => {
  const user = req.user!;
  const trackId = req.params.track_id;
  if (!db.prepare('SELECT 1 FROM release_tracks WHERE track_id=?').get(trackId)) {
    throw new HttpError(404, 'Không tìm thấy track');
  }
  ensureTrackAccess(user, trackId, true);
  // track thuộc BẤT KỲ Single nào → khóa (dùng chung với product ở tab Metadata)
  const locked = db.prepare(
    `SELECT 1 FROM release_tracks rt JOIN releases r ON r.id=rt.release_id
       WHERE rt.track_id=? AND r.release_type='Single' LIMIT 1`,
  ).get(trackId);
  if (locked) {
    throw new HttpError(409, 'Single dùng chung Contributors với product — sửa ở tab Metadata, không chỉnh riêng cho track.');
  }
  const payload = payloadContributors(req);
  putContributors('track', trackId, payload);
  // đánh dấu track đã tự chỉnh → không bị ghi đè khi product đổi contributors
  db.prepare('UPDATE tracks SET contributors_customized=1 WHERE id=?').run(trackId);
  res.json({ ok: true, contributors: contributorsOf('track', trackId) });
});

// ==========================================================================
// TRACKS — patch trực tiếp theo track_id
// ==========================================================================
router.patch('/tracks/:track_id', (req: Request, res: Response) => {
  const user = req.user!;
  const trackId = req.params.track_id;
  const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy track');
  ensureTrackAccess(user, trackId, true);
  const body = req.body || {};
  const allowed = ['title', 'subtitle', 'isrc', 'secondary_isrc', 'genre', 'secondary_genre', 'language',
    'parental_warning', 'clip_start_seconds', 'c_line', 'c_line_year', 'p_line', 'p_line_year', 'right_holder',
    'instant_grat_stream_date', 'instant_grat_download_date', 'lyrics', 'lyrics_lrc'];
  const data: Record<string, any> = {};
  for (const k of allowed) if (k in body) data[k] = body[k];
  if ('title' in data) {
    if (!String(data.title ?? '').trim()) throw new HttpError(400, 'Tiêu đề không được để trống');
    data.title = String(data.title).trim();
    data.title_norm = normalizeText(data.title);
  }
  if ('isrc' in data && data.isrc) {
    const isrc = cleanIsrc(String(data.isrc));
    if (!validateIsrc(isrc)) throw new HttpError(400, 'ISRC sai định dạng');
    if (db.prepare('SELECT 1 FROM tracks WHERE isrc=? AND id!=?').get(isrc, trackId)) {
      throw new HttpError(409, 'ISRC đã dùng cho track khác');
    }
    data.isrc = isrc;
  }
  if ('parental_warning' in data && !ADVISORY.includes(data.parental_warning)) {
    throw new HttpError(400, 'parental_advisory không hợp lệ');
  }
  if (data.clip_start_seconds != null && data.clip_start_seconds < 0) throw new HttpError(400, 'Clip start phải ≥ 0');
  const keys = Object.keys(data);
  if (keys.length === 0) return res.json({ ok: true });
  const sets = keys.map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE tracks SET ${sets} WHERE id=?`).run(...keys.map(k => data[k]), trackId);
  if ('isrc' in data && data.isrc) markCodeUsed('isrc', data.isrc, trackId);
  res.json({ ok: true });
});

// ==========================================================================
// PRODUCTS — list / create
// ==========================================================================
router.get('/', (req: Request, res: Response) => {
  const user = req.user!;
  const state = String(req.query.state ?? '');
  const q = String(req.query.q ?? '');
  let sql = `SELECT r.*, l.name AS label_display, u.email AS creator_email,
             (SELECT COUNT(*) FROM release_tracks rt WHERE rt.release_id=r.id) AS track_count,
             (SELECT GROUP_CONCAT(a.name, ', ') FROM release_artists ra
                JOIN artists a ON a.id=ra.artist_id
                WHERE ra.release_id=r.id AND ra.role='MainArtist') AS main_artists
             FROM releases r LEFT JOIN labels l ON l.id=r.label_id
             LEFT JOIN users u ON u.id=r.created_by WHERE 1=1`;
  const args: any[] = [];
  if (user.role === 'uploader') { sql += ' AND r.created_by=?'; args.push(user.id); }
  if (state) { sql += ' AND r.status=?'; args.push(state); }
  if (q) { sql += ' AND r.title_norm LIKE ?'; args.push(`%${normalizeText(q)}%`); }
  const rows = db.prepare(sql + ' ORDER BY r.created_at DESC LIMIT 300').all(...args) as Row[];
  res.json({ items: rows });
});

router.post('/', (req: Request, res: Response) => {
  const user = req.user!;
  const body = req.body || {};
  const title = String(body.title ?? '');
  if (!title.trim()) throw new HttpError(400, 'Thiếu tiêu đề product');
  const releaseType = body.release_type ?? 'Single';
  if (!RELEASE_TYPES.includes(releaseType)) throw new HttpError(400, `release_type phải là ${RELEASE_TYPES.join('|')}`);
  const labelId = body.label_id;
  const label = db.prepare('SELECT * FROM labels WHERE id=?').get(labelId) as Row | undefined;
  if (!label) throw new HttpError(400, 'Label không tồn tại');
  const rid = newId();
  const svgPath = path.join(COVER_DIR, `release_${rid}.svg`);
  const accent = generateCover(svgPath, { seed: stableSeed(rid), title, subtitle: label.name });
  // Mặc định: copyright kế thừa label; năm = năm hiện tại; các ngày = lúc tạo; genre = 'Pop'.
  const now = nowUtc();
  const year = new Date().getFullYear();
  db.prepare(
    'INSERT INTO releases(id,title,title_norm,title_version,release_type,label_id,'
    + 'label_name,cover_url,accent,status,source,is_migrated,is_compilation,'
    + 'metadata_language,audio_language,parental_warning,genre,'
    + 'c_line,c_line_year,p_line,p_line_year,right_holder,'
    + 'platform_release_date,original_release_date,preorder_date,created_by) '
    + 'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    rid, title.trim(), normalizeText(title), body.title_version ?? null, releaseType, labelId, label.name,
    `/media/covers/release_${rid}.svg`, accent, 'draft', 'product',
    body.is_migrated ? 1 : 0, releaseType === 'Compilation' ? 1 : 0,
    'vi', 'vi', 'NotExplicit', 'Pop',
    label.c_line, year, label.p_line, year, label.right_holder,
    now, now, now, user.id,
  );
  res.status(201).json({ id: rid });
});

// ==========================================================================
// TRACKS trong product — list / add
// ==========================================================================
/** 1 mã ISRC: ưu tiên kho → auto theo prefix label (nếu có) hoặc prefix hệ thống. */
function nextIsrcForLabel(labelPrefix: string | null, exclude?: Set<string>): string {
  const ex = exclude || new Set<string>();
  const pooled = poolTake('isrc', 1, ex);
  if (pooled.length) return pooled[0];
  if (!autoEnabled('isrc')) throw poolExhaustedError('isrc');
  const prefix = (labelPrefix || ISRC_PREFIX).toUpperCase();
  const yy = String(new Date().getFullYear()).slice(-2);
  const base = `${prefix}${yy}`;
  const rows = db.prepare('SELECT isrc FROM tracks WHERE isrc LIKE ?').all(`${base}%`) as Row[];
  let maxSeq = 0;
  for (const val of [...rows.map(x => x.isrc), ...Array.from(ex)]) {
    const tail = (val && String(val).startsWith(base)) ? String(val).slice(base.length) : '';
    if (tail && /^\d+$/.test(tail)) maxSeq = Math.max(maxSeq, parseInt(tail, 10));
  }
  let seq = maxSeq;
  for (;;) {
    seq += 1;
    const isrc = `${base}${String(seq).padStart(5, '0')}`;
    if (ex.has(isrc)) continue;
    if (!validateIsrc(isrc)) throw new HttpError(500, `ISRC tự sinh không hợp lệ (${isrc}) — kiểm tra prefix label`);
    if (!db.prepare('SELECT 1 FROM tracks WHERE isrc=?').get(isrc)) return isrc;
  }
}

router.get('/:product_id/tracks', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  ensureProductAccess(user, productId);
  const rows = db.prepare(
    `SELECT t.*, rt.track_no FROM tracks t
       JOIN release_tracks rt ON rt.track_id=t.id
       WHERE rt.release_id=? ORDER BY rt.disc_no, rt.track_no`,
  ).all(productId) as Row[];
  const items = rows.map(r => {
    const d: Row = { ...r };
    d.artists = db.prepare(
      `SELECT a.id, a.name FROM track_artists ta JOIN artists a ON a.id=ta.artist_id
         WHERE ta.track_id=? AND ta.role='MainArtist' ORDER BY ta.sequence`,
    ).all(r.id) as Row[];
    d.file_format = r.audio_path ? path.extname(r.audio_path).slice(1).toUpperCase() : null;
    d.file_size = 0;
    d.upload_state = 'missing';
    if (r.audio_path) {
      const p = path.join(AUDIO_DIR, r.audio_path);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) { d.file_size = st.size; d.upload_state = 'uploaded'; }
      } catch { /* file thiếu → giữ missing */ }
    }
    d.has_master = Boolean(r.master_path);
    d.contributors = contributorsOf('track', r.id);
    d.contributors_customized = Boolean(r.contributors_customized);
    return d;
  });
  res.json({ items });
});

router.post('/:product_id/tracks', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const row = ensureProductAccess(user, productId, true);
  const title = String(req.body?.title ?? '');
  if (!title.trim()) throw new HttpError(400, 'Thiếu tiêu đề track');

  // Single chỉ chứa đúng 1 track
  if (row.release_type === 'Single') {
    const cnt = (db.prepare('SELECT COUNT(*) AS n FROM release_tracks WHERE release_id=?').get(productId) as Row).n;
    if (cnt >= 1) throw new HttpError(409, 'Single chỉ có 1 track. Đổi Release Type sang EP/Album để thêm track.');
  }

  const label = db.prepare('SELECT isrc_prefix FROM labels WHERE id=?').get(row.label_id) as Row | undefined;
  const rawIsrc = req.body?.isrc;
  const manual = (rawIsrc && String(rawIsrc).trim()) ? cleanIsrc(String(rawIsrc)) : '';
  if (row.is_migrated && !manual) throw new HttpError(400, 'Product ở chế độ Migrated network — phải nhập ISRC thủ công');
  let isrc: string;
  if (manual) {
    if (!validateIsrc(manual)) throw new HttpError(400, 'ISRC sai định dạng (CC-XXX-YY-NNNNN)');
    if (db.prepare('SELECT 1 FROM tracks WHERE isrc=?').get(manual)) throw new HttpError(409, `ISRC ${manual} đã tồn tại`);
    isrc = manual;
  } else {
    isrc = nextIsrcForLabel(label ? label.isrc_prefix : null);
  }

  const tid = newId();
  db.prepare(
    'INSERT INTO tracks(id,isrc,title,title_norm,language,genre,parental_warning,'
    + 'p_line,p_line_year,c_line,c_line_year,right_holder,status) '
    + 'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    tid, isrc, title.trim(), normalizeText(title), row.audio_language || 'vi', row.genre, row.parental_warning,
    row.p_line, row.p_line_year, row.c_line, row.c_line_year, row.right_holder, 'draft',
  );
  const no = (db.prepare('SELECT COALESCE(MAX(track_no),0)+1 AS n FROM release_tracks WHERE release_id=?').get(productId) as Row).n;
  db.prepare('INSERT INTO release_tracks(release_id,track_id,disc_no,track_no) VALUES(?,?,1,?)').run(productId, tid, no);
  // track mới kế thừa contributors từ product (customized=0 mặc định)
  copyContributorsToTrack(productId, tid);
  markCodeUsed('isrc', isrc, tid);
  res.status(201).json({ id: tid, isrc, track_no: no });
});

router.put('/:product_id/tracks/reorder', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  ensureProductAccess(user, productId, true);
  const trackIds: string[] = Array.isArray(req.body?.track_ids) ? req.body.track_ids : [];
  const currentRows = db.prepare('SELECT track_id FROM release_tracks WHERE release_id=?').all(productId) as Row[];
  const current = new Set(currentRows.map(r => r.track_id));
  const provided = new Set(trackIds);
  const sameSet = provided.size === current.size && [...provided].every(id => current.has(id));
  if (!sameSet || trackIds.length !== current.size) {
    throw new HttpError(400, 'Danh sách reorder phải chứa đúng toàn bộ track của product');
  }
  const upd = db.prepare('UPDATE release_tracks SET track_no=? WHERE release_id=? AND track_id=?');
  let no = 1;
  for (const tid of trackIds) { upd.run(no, productId, tid); no++; }
  res.json({ ok: true });
});

router.delete('/:product_id/tracks/:track_id', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const trackId = req.params.track_id;
  ensureProductAccess(user, productId, true);
  db.prepare('DELETE FROM release_tracks WHERE release_id=? AND track_id=?').run(productId, trackId);
  // track mồ côi (không thuộc release nào khác) → xóa hẳn kèm file
  if (!db.prepare('SELECT 1 FROM release_tracks WHERE track_id=?').get(trackId)) {
    const trow = db.prepare('SELECT audio_path, master_path FROM tracks WHERE id=?').get(trackId) as Row | undefined;
    if (trow) {
      if (trow.audio_path) tryUnlink(path.join(AUDIO_DIR, trow.audio_path));
      if (trow.master_path) tryUnlink(path.join(MASTER_DIR, trow.master_path));
      invalidateWaveform(trackId);
    }
    db.prepare('DELETE FROM tracks WHERE id=?').run(trackId);
  }
  res.json({ ok: true });
});

// ==========================================================================
// CONTRIBUTORS (product) — PUT full-replace theo role
// ==========================================================================
router.put('/:product_id/contributors', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const row = ensureProductAccess(user, productId, true);
  const payload = payloadContributors(req);
  putContributors('release', productId, payload);
  // kế thừa xuống track theo loại release
  propagateContributors(productId, row.release_type);
  res.json({ ok: true, contributors: contributorsOf('release', productId) });
});

// ==========================================================================
// COVER + AUDIO upload
// ==========================================================================
router.post('/:product_id/cover', upload.single('file'), (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  ensureProductAccess(user, productId, true);
  const file = req.file;
  if (!file) throw new HttpError(400, 'Thiếu file ảnh bìa');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    throw new HttpError(400, 'Ảnh bìa chỉ nhận JPG/PNG/WebP (khuyến nghị 3000×3000)');
  }
  const dest = path.join(COVER_DIR, `release_${productId}${ext}`);
  fs.writeFileSync(dest, file.buffer);
  const url = `/media/covers/release_${productId}${ext}`;
  db.prepare('UPDATE releases SET cover_url=? WHERE id=?').run(url, productId);
  res.json({ ok: true, cover_url: url });
});

/** Nạp + chuẩn hóa audio cho 1 track (port ingest_track_audio của admin.py, dùng buffer multer). */
function ingestTrackAudio(trackId: string, file: Express.Multer.File): Row {
  const row = db.prepare('SELECT audio_path FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy bài hát');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!(ext in AUDIO_CONTENT_TYPES)) {
    throw new HttpError(400, `Định dạng không hỗ trợ (${ext}). Nhận: ${Object.keys(AUDIO_CONTENT_TYPES).join(', ')}`);
  }
  // Ghi vào file tạm — chỉ thay file thật khi validate xong.
  const tmp = path.join(AUDIO_DIR, `${trackId}.uploading${ext}`);
  const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const dest = path.join(AUDIO_DIR, `${trackId}${ext}`);
  let duration = 0;
  try {
    fs.writeFileSync(tmp, file.buffer);
    duration = audioDurationMs(tmp);
    if (duration <= 0) throw new HttpError(400, 'File audio không đọc được (hỏng hoặc sai định dạng)');
    tryUnlink(dest);
    fs.renameSync(tmp, dest);
  } finally {
    tryUnlink(tmp);
  }

  // chuẩn hóa: bản gốc WAV 44.1kHz (masters/) + bản stream AAC (nếu có ffmpeg)
  let audioName = path.basename(dest);
  let masterName: string | null = null;
  const tr = processAudio(dest, trackId);
  if (tr) {
    audioName = tr.audio_name;
    masterName = tr.master_name;
    if (path.basename(dest) !== audioName) tryUnlink(dest); // file upload gốc đã chuẩn hóa xong
  }

  const dup = db.prepare('SELECT id, title FROM tracks WHERE audio_hash=? AND id != ?').get(digest, trackId) as Row | undefined;

  // đổi định dạng file → dọn file cũ khác tên
  const old = row.audio_path;
  if (old && old !== audioName) tryUnlink(path.join(AUDIO_DIR, old));

  db.prepare('UPDATE tracks SET audio_path=?, master_path=?, audio_hash=?, duration_ms=? WHERE id=?')
    .run(audioName, masterName, digest, duration, trackId);
  invalidateWaveform(trackId); // audio mới → phân tích lại waveform
  return {
    ok: true, duration_ms: duration, sha256: digest,
    transcoded: Boolean(tr), duplicate_of: dup ? { ...dup } : null,
  };
}

router.post('/:product_id/tracks/:track_id/audio', upload.single('file'), (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const trackId = req.params.track_id;
  ensureProductAccess(user, productId, true);
  const belongs = db.prepare('SELECT 1 FROM release_tracks WHERE release_id=? AND track_id=?').get(productId, trackId);
  if (!belongs) throw new HttpError(404, 'Track không thuộc product này');
  const file = req.file;
  if (!file) throw new HttpError(400, 'Thiếu file audio');
  res.json(ingestTrackAudio(trackId, file));
});

// ==========================================================================
// QC CHECK
// ==========================================================================
function runQc(release: Row): { groups: any[]; errors: number; warnings: number; can_publish: boolean } {
  const rid = release.id;
  const groups: any[] = [];
  const group = (name: string) => { const g = { name, rules: [] as any[] }; groups.push(g); return g; };
  const rule = (g: any, label: string, ok: boolean, level = 'error', detail = '') => {
    g.rules.push({ label, level: ok ? 'pass' : level, detail: ok ? '' : detail });
  };

  // ---- Metadata ----
  const gm = group('Metadata');
  rule(gm, 'Tiêu đề', Boolean(release.title));
  rule(gm, 'Label', Boolean(release.label_id), 'error', 'Chọn label trong tab Metadata');
  rule(gm, 'Primary genre', Boolean(release.genre), 'error', 'Chọn thể loại chính');
  rule(gm, 'Release date', Boolean(release.platform_release_date), 'error', 'Đặt ngày phát hành');
  rule(gm, 'Original release date', Boolean(release.original_release_date), 'error', 'Đặt ngày phát hành gốc');
  rule(gm, 'C-Line (©) + năm', Boolean(release.c_line && release.c_line_year), 'error', 'Điền Copyrights');
  rule(gm, 'P-Line (℗) + năm', Boolean(release.p_line && release.p_line_year), 'error', 'Điền Copyrights');
  rule(gm, 'Right holder', Boolean(release.right_holder), 'error', 'Điền chủ sở hữu quyền');
  const preOk = (!release.preorder_date || !release.platform_release_date
    || release.preorder_date <= release.platform_release_date);
  rule(gm, 'Pre-order ≤ Release date', preOk, 'error', 'Pre-order date không được sau Release date');

  // ---- Cover art ----
  const gc = group('Cover art');
  const coverOk = Boolean(release.cover_url);
  rule(gc, 'Có ảnh bìa', coverOk, 'error', 'Upload ảnh bìa 3000×3000');
  if (coverOk && String(release.cover_url).endsWith('.svg')) {
    rule(gc, 'Bìa chính thức (không phải bìa tự sinh)', false, 'warning',
      'Đang dùng bìa hệ thống tự sinh — nên upload bìa thật 3000×3000 JPG/PNG');
  }

  // ---- Contributors ----
  const gk = group('Contributors');
  const contrib = contributorsOf('release', rid);
  for (const role of REQUIRED_ROLES) {
    rule(gk, `${role} (≥1)`, (contrib[role] || []).length >= 1, 'error', `Thêm ít nhất 1 ${role} trong tab Metadata`);
  }

  // ---- Tracks ----
  const gt = group('Tracks');
  const tracks = db.prepare(
    `SELECT t.* FROM tracks t JOIN release_tracks rt ON rt.track_id=t.id
       WHERE rt.release_id=? ORDER BY rt.track_no`,
  ).all(rid) as Row[];
  rule(gt, 'Có ít nhất 1 track', tracks.length > 0, 'error', 'Thêm track trong tab Tracks');
  if (release.release_type === 'Single' && tracks.length > 1) {
    rule(gt, 'Single chỉ 1 track', false, 'error', `Single đang có ${tracks.length} track — đổi sang EP/Album`);
  }
  const titlesSeen = new Set<string>();
  const dupTitles = new Set<string>();
  for (const tr of tracks) {
    const audioOk = Boolean(tr.audio_path) && isFile(path.join(AUDIO_DIR, tr.audio_path));
    rule(gt, `Audio: ${tr.title}`, audioOk, 'error', 'Upload file WAV/FLAC cho track này');
    rule(gt, `ISRC: ${tr.title}`, Boolean(tr.isrc), 'error', 'Track thiếu ISRC');
    if (!tr.lyrics && !tr.lyrics_lrc) {
      rule(gt, `Lyrics: ${tr.title}`, false, 'warning', 'Track chưa có lời bài hát');
    }
    const key = tr.title_norm || String(tr.title).toLowerCase();
    if (titlesSeen.has(key)) dupTitles.add(tr.title);
    titlesSeen.add(key);
  }
  if (dupTitles.size > 0) {
    rule(gt, 'Tiêu đề trùng lặp trong tracklist', false, 'warning', Array.from(dupTitles).sort().join(', '));
  }

  let errors = 0;
  let warnings = 0;
  for (const g of groups) {
    for (const r of g.rules) {
      if (r.level === 'error') errors++;
      else if (r.level === 'warning') warnings++;
    }
  }
  return { groups, errors, warnings, can_publish: errors === 0 };
}

router.get('/:product_id/qc', (req: Request, res: Response) => {
  const user = req.user!;
  res.json(runQc(ensureProductAccess(user, req.params.product_id)));
});

// ==========================================================================
// RELEASES — submit-review / approve / reject / publish / takedown / history
// ==========================================================================
/** Flip scheduled → live khi tới giờ (port publisher.run_publisher). Trả số release phát hành. */
function runPublisher(): number {
  const due = db.prepare(
    "SELECT id FROM releases WHERE status='scheduled' AND platform_release_date <= datetime('now')",
  ).all() as Row[];
  if (due.length === 0) return 0;
  const ids = due.map(r => r.id);
  const q = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE tracks SET status='live'
       WHERE audio_path IS NOT NULL AND status='draft'
         AND id IN (SELECT track_id FROM release_tracks WHERE release_id IN (${q}))`,
  ).run(...ids);
  db.prepare(`UPDATE releases SET status='live' WHERE id IN (${q})`).run(...ids);
  return ids.length;
}

/** "now" | "YYYY-MM-DD HH:MM:SS" (UTC) → chuỗi UTC chuẩn; ném lỗi nếu sai. */
function resolveReleaseAt(releaseAt: string): string {
  if (releaseAt === 'now') return nowUtc();
  const s = String(releaseAt).trim();
  const iso = (s.includes('T') ? s : s.replace(' ', 'T'));
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  if (isNaN(d.getTime())) throw new HttpError(400, 'Thời gian hẹn giờ phát hành không hợp lệ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function doPublishLocked(row: Row, actor: string, action = 'publish', releaseAt?: string): Row {
  const productId = row.id;
  // Client chọn "Phát hành ngay" (now) hoặc "Hẹn giờ" (một mốc thời gian) →
  // ghi đè platform_release_date trước khi publish (doPublishLocked chạy trong txn).
  if (releaseAt) {
    const newDate = resolveReleaseAt(releaseAt);
    row.platform_release_date = newDate;
    let preClamp = row.preorder_date;
    if (row.preorder_date && row.preorder_date > newDate) { preClamp = newDate; row.preorder_date = newDate; }
    db.prepare('UPDATE releases SET platform_release_date=?, preorder_date=? WHERE id=?').run(newDate, preClamp, productId);
  }
  const qc = runQc(row);
  if (!qc.can_publish) {
    logAction(productId, action, actor, 'failed', `QC: ${qc.errors} lỗi`);
    throw new HttpError(409, `QC Check còn ${qc.errors} lỗi — sửa xong mới publish được`);
  }

  // cấp UPC nếu chưa có (kho → tự sinh)
  let upc = row.upc;
  if (!upc) {
    const pooled = poolTake('upc', 1);
    if (pooled.length) {
      upc = pooled[0];
    } else if (autoEnabled('upc')) {
      for (let i = 0; i < 50; i++) {
        let body12 = '2';
        for (let j = 0; j < 10; j++) body12 += Math.floor(Math.random() * 10);
        const cand = body12 + gtinCheckDigit(body12);
        if (!db.prepare('SELECT 1 FROM releases WHERE upc=?').get(cand)) { upc = cand; break; }
      }
      if (!upc) throw new HttpError(500, 'Không sinh được UPC');
    } else {
      throw poolExhaustedError('upc');
    }
    db.prepare('UPDATE releases SET upc=? WHERE id=?').run(upc, productId);
    markCodeUsed('upc', upc, productId);
  }

  // đảm bảo có deal mặc định (website)
  if (!db.prepare('SELECT 1 FROM deals WHERE release_id=?').get(productId)) {
    db.prepare(
      'INSERT INTO deals(id,release_id,territories,use_types,commercial_models,start_date) VALUES(?,?,?,?,?,?)',
    ).run(newId(), productId, 'Worldwide', 'OnDemandStream',
      'SubscriptionModel,AdvertisementSupportedModel', (row.platform_release_date || nowUtc()).slice(0, 10));
  }

  const future = (row.platform_release_date || '') > nowUtc();
  const newStatus = future ? 'scheduled' : 'live';
  // duyệt xong thì xóa ghi chú từ chối cũ cho sạch hàng đợi
  db.prepare('UPDATE releases SET status=?, published_at=?, review_note=NULL WHERE id=?').run(newStatus, nowUtc(), productId);
  if (newStatus === 'live') {
    db.prepare(
      `UPDATE tracks SET status='live'
         WHERE audio_path IS NOT NULL AND status IN ('draft','pending_review')
           AND id IN (SELECT track_id FROM release_tracks WHERE release_id=?)`,
    ).run(productId);
  }
  logAction(productId, action, actor, 'success',
    `${future ? 'Hẹn giờ ' + row.platform_release_date : 'Phát hành ngay'} · UPC ${upc}`);
  return { ok: true, status: newStatus, upc, warnings: qc.warnings };
}

/** Pipeline phát hành: khóa ghi (BEGIN IMMEDIATE) + đọc lại trạng thái trong khóa →
 *  2 lần duyệt/publish đồng thời không cùng cấp UPC/deal. Throw trong txn → rollback tự động. */
const doPublishTx = db.transaction((row: Row, actor: string, action: string, releaseAt?: string): Row => {
  const fresh = db.prepare('SELECT status FROM releases WHERE id=?').get(row.id) as Row | undefined;
  if (!fresh) throw new HttpError(404, 'Product không tồn tại');
  if (fresh.status === 'live' || fresh.status === 'scheduled') throw new HttpError(409, 'Product đã được phát hành');
  return doPublishLocked(row, actor, action, releaseAt);
});
function doPublish(row: Row, actor: string, action = 'publish', releaseAt?: string): Row {
  return doPublishTx.immediate(row, actor, action, releaseAt);
}

/** Gửi duyệt: Draft + QC pass → pending_review. Dùng cho route đơn & bulk. */
function applySubmitReview(user: Row, productId: string): number {
  const row = ensureProductAccess(user, productId);
  if (row.status !== 'draft') throw new HttpError(409, 'Chỉ gửi duyệt được product ở trạng thái Draft');
  const qc = runQc(row);
  if (qc.errors > 0) {
    const errs: string[] = [];
    for (const g of qc.groups) {
      for (const r of g.rules) {
        if (r.level === 'error') errs.push(`${g.name}: ${r.label}` + (r.detail ? ` — ${r.detail}` : ''));
      }
    }
    throw new HttpError(400, { message: `QC Check còn ${qc.errors} lỗi — sửa xong mới gửi duyệt được`, errors: errs });
  }
  db.prepare("UPDATE releases SET status='pending_review', submitted_at=?, review_note=NULL WHERE id=?").run(nowUtc(), productId);
  logAction(productId, 'submit_review', user.email, 'success', `Gửi duyệt · QC đạt (${qc.warnings} cảnh báo)`);
  return qc.warnings;
}

/** Takedown: live/scheduled → taken_down (+ gỡ track không còn thuộc release live nào). */
function applyTakedown(productId: string, actor: string): void {
  const row = getRelease(productId);
  if (!['live', 'scheduled'].includes(row.status)) throw new HttpError(409, 'Product không ở trạng thái đã publish');
  db.prepare("UPDATE releases SET status='taken_down' WHERE id=?").run(productId);
  db.prepare(
    `UPDATE tracks SET status='taken_down' WHERE id IN (
       SELECT rt.track_id FROM release_tracks rt
       WHERE rt.release_id=? AND NOT EXISTS (
         SELECT 1 FROM release_tracks rt2 JOIN releases r2 ON r2.id=rt2.release_id
         WHERE rt2.track_id=rt.track_id AND r2.id!=? AND r2.status='live'))`,
  ).run(productId, productId);
  logAction(productId, 'takedown', actor, 'success');
}

/** Xóa: chỉ Draft/Taken down (+ kiểm quyền uploader). */
function applyDelete(user: Row, productId: string): void {
  const row = ensureProductAccess(user, productId, true);
  if (!['draft', 'taken_down'].includes(row.status)) {
    throw new HttpError(409, 'Chỉ xóa được product ở trạng thái Draft/Taken down');
  }
  db.prepare('DELETE FROM releases WHERE id=?').run(productId);
}

router.post('/:product_id/submit-review', (req: Request, res: Response) => {
  const user = req.user!;
  const warnings = applySubmitReview(user, req.params.product_id);
  res.json({ ok: true, status: 'pending_review', warnings });
});

router.post('/:product_id/approve', requireManager, (req: Request, res: Response) => {
  const user = req.user!;
  const row = getRelease(req.params.product_id);
  if (row.status !== 'pending_review') throw new HttpError(409, 'Product không ở hàng đợi duyệt (pending_review)');
  res.json(doPublish(row, user.email, 'approve', req.body?.release_at));
});

/** Hành động hàng loạt trên nhiều product: xóa / takedown / publish / gửi duyệt / duyệt.
 *  Chạy từng id, gom kết quả — 1 id lỗi không chặn các id khác. */
router.post('/bulk', (req: Request, res: Response) => {
  const user = req.user!;
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const action = String(req.body?.action || '');
  const ALLOWED = ['delete', 'takedown', 'publish', 'submit_review', 'approve'];
  if (!ids.length) throw new HttpError(400, 'Chưa chọn product nào');
  if (!ALLOWED.includes(action)) throw new HttpError(400, 'Hành động không hợp lệ');
  const managerOnly = new Set(['takedown', 'publish', 'approve']);
  if (managerOnly.has(action) && !['admin', 'manager'].includes(String(user.role))) {
    throw new HttpError(403, 'Chỉ manager/admin được thực hiện hành động này');
  }
  const releaseAt: string | undefined = req.body?.release_at;

  const results = ids.map(id => {
    try {
      switch (action) {
        case 'delete': applyDelete(user, id); break;
        case 'takedown': applyTakedown(id, user.email); break;
        case 'submit_review': applySubmitReview(user, id); break;
        case 'publish': doPublish(getRelease(id), user.email, 'publish', releaseAt); break;
        case 'approve': {
          const row = getRelease(id);
          if (row.status !== 'pending_review') throw new HttpError(409, 'Product không ở hàng đợi duyệt');
          doPublish(row, user.email, 'approve', releaseAt);
          break;
        }
      }
      return { id, ok: true };
    } catch (e: any) {
      const msg = e instanceof HttpError
        ? (typeof e.detail === 'string' ? e.detail : (e.detail?.message || 'Lỗi'))
        : (e?.message || 'Lỗi');
      return { id, ok: false, error: msg };
    }
  });
  const done = results.filter(r => r.ok).length;
  res.json({ ok: true, action, done, failed: results.length - done, results });
});

router.post('/:product_id/reject', requireManager, (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const row = getRelease(productId);
  if (row.status !== 'pending_review') throw new HttpError(409, 'Product không ở hàng đợi duyệt (pending_review)');
  const note = String(req.body?.note ?? '').trim();
  if (!note) throw new HttpError(400, 'Cần ghi chú lý do từ chối để uploader biết đường sửa');
  db.prepare("UPDATE releases SET status='draft', review_note=? WHERE id=?").run(note, productId);
  logAction(productId, 'reject', user.email, 'success', note);
  res.json({ ok: true, status: 'draft' });
});

router.post('/:product_id/publish', requireManager, (req: Request, res: Response) => {
  const user = req.user!;
  const row = getRelease(req.params.product_id);
  res.json(doPublish(row, user.email, 'publish', req.body?.release_at));
});

router.post('/:product_id/update-release', requireManager, (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const row = getRelease(productId);
  if (!['live', 'scheduled'].includes(row.status)) throw new HttpError(409, 'Product chưa publish — dùng nút Publish');
  runPublisher();
  logAction(productId, 'update', user.email, 'success', 'Đẩy lại metadata mới nhất lên website');
  res.json({ ok: true });
});

router.post('/:product_id/takedown', requireManager, (req: Request, res: Response) => {
  const user = req.user!;
  applyTakedown(req.params.product_id, user.email);
  res.json({ ok: true, status: 'taken_down' });
});

router.get('/:product_id/releases', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  ensureProductAccess(user, productId);
  const rows = db.prepare(
    'SELECT * FROM release_actions WHERE release_id=? ORDER BY created_at DESC LIMIT 100',
  ).all(productId) as Row[];
  res.json({ items: rows });
});

// ==========================================================================
// PRODUCT detail / update / delete + cover
// (đặt SAU các route literal & /:product_id/* để tránh nuốt nhầm '/labels', '/genres'…)
// ==========================================================================
router.get('/:product_id', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const row = ensureProductAccess(user, productId);
  const d: Row = { ...row }; // đã gồm created_by, review_note, submitted_at (SELECT *)
  d.contributors = contributorsOf('release', productId);
  d.track_count = (db.prepare('SELECT COUNT(*) AS n FROM release_tracks WHERE release_id=?').get(productId) as Row).n;
  const label = db.prepare('SELECT * FROM labels WHERE id=?').get(row.label_id) as Row | undefined;
  d.label = label ? { ...label } : null;
  d.creator_email = null;
  if (row.created_by) {
    const creator = db.prepare('SELECT email FROM users WHERE id=?').get(row.created_by) as Row | undefined;
    d.creator_email = creator ? creator.email : null;
  }
  const qc = runQc(row);
  d.qc_errors = qc.errors;
  d.qc_warnings = qc.warnings;
  res.json(d);
});

router.patch('/:product_id', (req: Request, res: Response) => {
  const user = req.user!;
  const productId = req.params.product_id;
  const row = ensureProductAccess(user, productId, true);
  const body = req.body || {};
  const allowed = ['title', 'title_version', 'label_id', 'release_type', 'genre', 'subgenre',
    'metadata_language', 'audio_language', 'parental_warning', 'platform_release_date', 'original_release_date',
    'preorder_date', 'c_line', 'c_line_year', 'p_line', 'p_line_year', 'right_holder', 'upc', 'catalog_number',
    'release_price_tier', 'track_price_tier', 'mastered_by', 'is_compilation', 'is_migrated', 'tags'];
  const data: Record<string, any> = {};
  for (const k of allowed) if (k in body) data[k] = body[k];

  if ('title' in data && !String(data.title ?? '').trim()) throw new HttpError(400, 'Tiêu đề không được để trống');
  if ('release_type' in data && !RELEASE_TYPES.includes(data.release_type)) throw new HttpError(400, 'release_type không hợp lệ');
  // đổi sang Single khi đang có >1 track → chặn
  if ('release_type' in data && data.release_type === 'Single' && data.release_type !== row.release_type) {
    const cnt = (db.prepare('SELECT COUNT(*) AS n FROM release_tracks WHERE release_id=?').get(productId) as Row).n;
    if (cnt > 1) throw new HttpError(409, 'Single chỉ có 1 track — xóa bớt track hoặc chọn EP/Album trước khi đổi.');
  }
  if ('parental_warning' in data && !ADVISORY.includes(data.parental_warning)) throw new HttpError(400, 'parental_advisory không hợp lệ');
  const nowYear = new Date().getFullYear();
  for (const yk of ['c_line_year', 'p_line_year']) {
    if (data[yk] != null && !(data[yk] >= 1900 && data[yk] <= nowYear + 1)) {
      throw new HttpError(400, `${yk} phải trong khoảng 1900–${nowYear + 1}`);
    }
  }
  if ('upc' in data && data.upc) {
    const u = String(data.upc).trim();
    if (!validateUpc(u)) throw new HttpError(400, 'UPC không hợp lệ (checksum GTIN)');
    if (db.prepare('SELECT 1 FROM releases WHERE upc=? AND id!=?').get(u, productId)) {
      throw new HttpError(409, 'UPC đã dùng cho product khác');
    }
    data.upc = u;
  }
  if ('label_id' in data) {
    const lbl = db.prepare('SELECT name FROM labels WHERE id=?').get(data.label_id) as Row | undefined;
    if (!lbl) throw new HttpError(400, 'Label không tồn tại');
    data.label_name = lbl.name;
  }
  // preorder không được SAU release date (cho phép bằng)
  const pre = ('preorder_date' in data) ? data.preorder_date : row.preorder_date;
  const rel = ('platform_release_date' in data) ? data.platform_release_date : row.platform_release_date;
  if (pre && rel && pre > rel) throw new HttpError(400, 'Pre-order date không được sau Release date');

  for (const bk of ['is_compilation', 'is_migrated']) {
    if (bk in data) data[bk] = data[bk] ? 1 : 0;
  }
  if ('title' in data) {
    data.title = String(data.title).trim();
    data.title_norm = normalizeText(data.title);
  }

  const keys = Object.keys(data);
  if (keys.length === 0) return res.json({ ok: true });
  const sets = keys.map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE releases SET ${sets} WHERE id=?`).run(...keys.map(k => data[k]), productId);
  if ('upc' in data && data.upc) markCodeUsed('upc', data.upc, productId);
  // đổi loại release → đồng bộ lại contributors track
  if ('release_type' in data && data.release_type !== row.release_type) propagateContributors(productId, data.release_type);
  res.json({ ok: true });
});

router.delete('/:product_id', (req: Request, res: Response) => {
  const user = req.user!;
  applyDelete(user, req.params.product_id);
  res.json({ ok: true });
});

export default router;
