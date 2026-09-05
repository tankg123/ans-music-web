/** Playback — heartbeat đếm lượt nghe + streaming (HTTP Range, signed URL) + tải WAV.
 *  Port 1:1 backend/app/routers/playback.py. Router KHÔNG prefix: mount ở gốc app
 *  (registerRoutes: app.use(playbackRouter)) để có /v1/playback/heartbeat, /stream,
 *  /download/... đúng như bản Python.
 *
 *  Album ZIP: bản Python dùng zipfile.ZIP_STORED. Chưa có lib 'archiver' nên tự dựng
 *  ZIP không nén (STORED) bằng Buffer — CRC32 tự tính, tương thích mọi trình giải nén. */
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, type Row } from '../db.js';
import { HttpError, optionalUser } from '../security.js';
import {
  AUDIO_DIR, MASTER_DIR, AUDIO_CONTENT_TYPES, PLAY_COUNT_THRESHOLD_MS,
} from '../config.js';
import { safeFilename, verifyDownloadSig, verifyStreamSig } from '../utils.js';

const router = Router();

const CHUNK = 256 * 1024;
const RANGE_RE = /^bytes=(\d*)-(\d*)/;

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/** Content-Disposition an toàn cho tên file tiếng Việt (ASCII fallback + RFC5987). */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// --------------------------------------------------------------------------
// HEARTBEAT — client gọi khi vượt mốc 30s (hoặc kết thúc bài ngắn hơn 30s)
// --------------------------------------------------------------------------
router.post('/v1/playback/heartbeat', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const body = req.body || {};
  const trackId = body.track_id == null ? '' : String(body.track_id);
  let msPlayed = parseInt(String(body.ms_played ?? 0), 10);
  if (!Number.isFinite(msPlayed)) msPlayed = 0;
  const source = body.source == null ? null : String(body.source);

  const track = db.prepare(
    'SELECT id, duration_ms, status, audio_path FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!track) throw new HttpError(404, 'Không tìm thấy bài hát');
  if (track.status !== 'live' || !track.audio_path) {
    return res.json({ counted: false, reason: 'bài hát không khả dụng' });
  }
  const dur = track.duration_ms || 0;
  const threshold = dur > 0
    ? Math.min(PLAY_COUNT_THRESHOLD_MS, Math.max(1000, dur - 1000))
    : PLAY_COUNT_THRESHOLD_MS;
  if (msPlayed < threshold) {
    return res.json({ counted: false, reason: `cần nghe tối thiểu ${Math.floor(threshold / 1000)}s` });
  }
  db.prepare('INSERT INTO play_history(user_id,track_id,ms_played,source) VALUES(?,?,?,?)')
    .run(user ? user.id : null, trackId, msPlayed, source);
  db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id=?').run(trackId);
  return res.json({ counted: true });
});

// --------------------------------------------------------------------------
// STREAM — signed URL + HTTP Range (QUAN TRỌNG cho tua nhạc)
// --------------------------------------------------------------------------
router.get('/stream/:track_id', (req: Request, res: Response) => {
  const trackId = req.params.track_id;
  const exp = String(req.query.exp ?? '');
  const sig = String(req.query.sig ?? '');
  if (!verifyStreamSig(trackId, exp, sig)) {
    throw new HttpError(403, 'Link streaming không hợp lệ hoặc đã hết hạn');
  }

  const row = db.prepare(
    'SELECT audio_path, status FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!row || !row.audio_path) throw new HttpError(404, 'Không có file audio');
  // draft chỉ có admin lấy được signed URL (gate ở /v1/tracks/{id}/stream);
  // taken_down chặn tuyệt đối kể cả URL còn hạn
  if (row.status === 'taken_down') throw new HttpError(403, 'Bài hát không khả dụng');

  const base = path.resolve(AUDIO_DIR);
  const resolved = path.resolve(AUDIO_DIR, row.audio_path);
  if (!(resolved === base || resolved.startsWith(base + path.sep)) || !isFile(resolved)) {
    throw new HttpError(404, 'File audio không tồn tại');
  }

  const fileSize = fs.statSync(resolved).size;
  const contentType = AUDIO_CONTENT_TYPES[path.extname(resolved).toLowerCase()]
    || 'application/octet-stream';

  let start = 0;
  let end = fileSize - 1;
  let statusCode = 200;
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const m = RANGE_RE.exec(rangeHeader);
    if (m) {
      if (m[1]) {
        start = parseInt(m[1], 10);
        if (m[2]) end = Math.min(parseInt(m[2], 10), fileSize - 1);
      } else if (m[2]) {
        // suffix range: bytes=-N (N byte cuối)
        start = Math.max(0, fileSize - parseInt(m[2], 10));
      }
      if (start >= fileSize) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      statusCode = 206;
    }
  }

  const length = end - start + 1;
  res.status(statusCode);
  res.set({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(length),
    'Cache-Control': 'private, max-age=3600',
  });
  if (statusCode === 206) res.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);

  const stream = fs.createReadStream(resolved, { start, end, highWaterMark: CHUNK });
  stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

// --------------------------------------------------------------------------
// DOWNLOAD — ưu tiên bản gốc WAV 44.1kHz trong masters/
// --------------------------------------------------------------------------
/** Chọn file tải: master WAV nếu có, không thì file phát. */
function downloadSource(row: Row): string | null {
  if (row.master_path) {
    const p = path.join(MASTER_DIR, row.master_path);
    if (isFile(p)) return p;
  }
  if (row.audio_path) {
    const p = path.join(AUDIO_DIR, row.audio_path);
    if (isFile(p)) return p;
  }
  return null;
}

function trackDisplayName(trackId: string, title: string): string {
  const artists = db.prepare(
    `SELECT a.name FROM track_artists ta JOIN artists a ON a.id=ta.artist_id
       WHERE ta.track_id=? AND ta.role='MainArtist' ORDER BY ta.sequence LIMIT 2`).all(trackId) as Row[];
  const prefix = artists.map(r => r.name).join(', ');
  return prefix ? `${prefix} - ${title}` : title;
}

/** Gửi 1 file về client dạng attachment (không cần Range cho tải). */
function sendFileDownload(res: Response, src: string, media: string, filename: string): void {
  const size = fs.statSync(src).size;
  res.status(200);
  res.set({
    'Content-Type': media,
    'Content-Length': String(size),
    'Content-Disposition': contentDisposition(filename),
  });
  const stream = fs.createReadStream(src, { highWaterMark: CHUNK });
  stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

router.get('/download/track/:track_id', (req: Request, res: Response) => {
  const trackId = req.params.track_id;
  const exp = String(req.query.exp ?? '');
  const sig = String(req.query.sig ?? '');
  if (!verifyDownloadSig('track', trackId, exp, sig)) {
    throw new HttpError(403, 'Link tải không hợp lệ hoặc đã hết hạn');
  }
  const row = db.prepare(
    'SELECT title, audio_path, master_path, status FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!row || row.status !== 'live') throw new HttpError(404, 'Bài hát không khả dụng');
  const src = downloadSource(row);
  if (!src) throw new HttpError(404, 'Không có file audio');
  const suffix = path.extname(src);
  const fname = safeFilename(trackDisplayName(trackId, row.title)) + suffix;
  const media = suffix === '.wav'
    ? 'audio/wav'
    : (AUDIO_CONTENT_TYPES[suffix] || 'application/octet-stream');
  sendFileDownload(res, src, media, fname);
});

router.get('/download/album/:release_id', (req: Request, res: Response) => {
  const releaseId = req.params.release_id;
  const exp = String(req.query.exp ?? '');
  const sig = String(req.query.sig ?? '');
  if (!verifyDownloadSig('album', releaseId, exp, sig)) {
    throw new HttpError(403, 'Link tải không hợp lệ hoặc đã hết hạn');
  }
  const rel = db.prepare(
    'SELECT title, status FROM releases WHERE id=?').get(releaseId) as Row | undefined;
  if (!rel || rel.status !== 'live') throw new HttpError(404, 'Album không khả dụng');
  const tracks = db.prepare(
    `SELECT t.id, t.title, t.audio_path, t.master_path, rt.track_no
       FROM tracks t JOIN release_tracks rt ON rt.track_id=t.id
       WHERE rt.release_id=? AND t.status='live' AND t.audio_path IS NOT NULL
       ORDER BY rt.disc_no, rt.track_no`).all(releaseId) as Row[];
  if (tracks.length === 0) throw new HttpError(404, 'Album chưa có bài phát hành nào');

  const tmpPath = path.join(os.tmpdir(), `ans_album_${crypto.randomBytes(8).toString('hex')}.zip`);
  try {
    buildStoredZip(tmpPath, tracks);
  } catch {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw new HttpError(500, 'Không đóng gói được album');
  }

  const zipName = safeFilename(rel.title) + '.zip';
  const cleanup = () => { fs.unlink(tmpPath, () => { /* ignore */ }); };
  const size = fs.statSync(tmpPath).size;
  res.status(200);
  res.set({
    'Content-Type': 'application/zip',
    'Content-Length': String(size),
    'Content-Disposition': contentDisposition(zipName),
  });
  const stream = fs.createReadStream(tmpPath, { highWaterMark: CHUNK });
  stream.on('error', () => { cleanup(); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  stream.on('close', cleanup);
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

// --------------------------------------------------------------------------
// ZIP STORED tối giản (không nén) — đủ để đóng gói WAV vốn không nén thêm được.
// --------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

interface CentralEntry { nameBuf: Buffer; crc: number; size: number; localOffset: number; }

function buildStoredZip(tmpPath: string, tracks: Row[]): void {
  const fd = fs.openSync(tmpPath, 'w');
  let offset = 0;
  const central: CentralEntry[] = [];
  try {
    for (const t of tracks) {
      const src = downloadSource(t);
      if (!src) continue;
      const arc = safeFilename(`${String(t.track_no).padStart(2, '0')} - ${t.title}`) + path.extname(src);
      const data = fs.readFileSync(src);
      const crc = crc32(data);
      const nameBuf = Buffer.from(arc, 'utf8');

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);   // signature
      local.writeUInt16LE(20, 4);           // version needed
      local.writeUInt16LE(0x0800, 6);       // flags: UTF-8 filename
      local.writeUInt16LE(0, 8);            // method: stored
      local.writeUInt16LE(0, 10);           // mod time
      local.writeUInt16LE(0x21, 12);        // mod date (1980-01-01)
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18); // compressed size
      local.writeUInt32LE(data.length, 22); // uncompressed size
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);           // extra len
      fs.writeSync(fd, local);
      fs.writeSync(fd, nameBuf);
      fs.writeSync(fd, data);

      central.push({ nameBuf, crc, size: data.length, localOffset: offset });
      offset += local.length + nameBuf.length + data.length;
    }

    const cdStart = offset;
    for (const e of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);  // signature
      h.writeUInt16LE(20, 4);          // version made by
      h.writeUInt16LE(20, 6);          // version needed
      h.writeUInt16LE(0x0800, 8);      // flags: UTF-8
      h.writeUInt16LE(0, 10);          // method
      h.writeUInt16LE(0, 12);          // mod time
      h.writeUInt16LE(0x21, 14);       // mod date
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.size, 20);     // compressed
      h.writeUInt32LE(e.size, 24);     // uncompressed
      h.writeUInt16LE(e.nameBuf.length, 28);
      h.writeUInt16LE(0, 30);          // extra len
      h.writeUInt16LE(0, 32);          // comment len
      h.writeUInt16LE(0, 34);          // disk number start
      h.writeUInt16LE(0, 36);          // internal attrs
      h.writeUInt32LE(0, 38);          // external attrs
      h.writeUInt32LE(e.localOffset, 42);
      fs.writeSync(fd, h);
      fs.writeSync(fd, e.nameBuf);
      offset += h.length + e.nameBuf.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);          // signature
    eocd.writeUInt16LE(0, 4);                   // disk number
    eocd.writeUInt16LE(0, 6);                   // cd start disk
    eocd.writeUInt16LE(central.length, 8);      // entries this disk
    eocd.writeUInt16LE(central.length, 10);     // total entries
    eocd.writeUInt32LE(offset - cdStart, 12);   // cd size
    eocd.writeUInt32LE(cdStart, 14);            // cd offset
    eocd.writeUInt16LE(0, 18);                  // comment len
    fs.writeSync(fd, eocd);
  } finally {
    fs.closeSync(fd);
  }
}

export default router;
