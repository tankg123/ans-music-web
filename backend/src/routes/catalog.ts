/** /v1 — Catalog công khai: trang chủ, tìm kiếm, bài hát, album, nghệ sĩ, BXH, thể loại.
 *  Port 1:1 backend/app/routers/catalog.py. Field trả GIỮ NGUYÊN cho frontend cũ.
 *  better-sqlite3 đồng bộ → handler đồng bộ; throw HttpError được Express 4 bắt tự động. */
import { Router, type Request, type Response, type Express } from 'express';
import path from 'node:path';

import { db, type Row } from '../db.js';
import { HttpError, optionalUser, requireAuth } from '../security.js';
import {
  serializeArtists, serializePlaylists, serializeReleases, serializeTracks,
} from '../serializers.js';
import { normalizeText, signDownload, signStream } from '../utils.js';
import { getOrBuildWaveform } from '../waveform.js';
import { AUDIO_DIR } from '../config.js';

const router = Router();

const LIVE_TRACK = "t.status = 'live' AND t.audio_path IS NOT NULL";

const placeholders = (n: number): string => Array(n).fill('?').join(',');

function uidOf(user: Row | null): string | null {
  return user ? user.id : null;
}
function isAdmin(user: Row | null): boolean {
  return Boolean(user && user.role === 'admin');
}

/** Đọc query dạng string (nhận cả trường hợp mảng). */
function qStr(v: unknown): string {
  return String(Array.isArray(v) ? v[0] : v ?? '');
}
/** Đọc query dạng int với mặc định + kẹp [min,max] (giống ràng buộc FastAPI Query). */
function qInt(v: unknown, def: number, min: number, max: number): number {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return def;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Lazy publisher: release 'scheduled' tới hạn → 'live' ngay khi tải trang chủ.
 *  (Port backend/app/publisher.py — module publisher chưa tách riêng nên nội tuyến.) */
function runPublisher(): number {
  const due = db.prepare(
    "SELECT id FROM releases WHERE status='scheduled' AND platform_release_date <= datetime('now')",
  ).all() as Row[];
  if (due.length === 0) return 0;
  const ids = due.map(r => r.id);
  const q = placeholders(ids.length);
  db.prepare(
    `UPDATE tracks SET status='live'
        WHERE audio_path IS NOT NULL AND status='draft'
          AND id IN (SELECT track_id FROM release_tracks WHERE release_id IN (${q}))`,
  ).run(...ids);
  db.prepare(`UPDATE releases SET status='live' WHERE id IN (${q})`).run(...ids);
  return ids.length;
}

// --------------------------------------------------------------------------
// TRANG CHỦ
// --------------------------------------------------------------------------
router.get('/home', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const uid = uidOf(user);
  runPublisher();

  const newReleases = db.prepare(
    "SELECT * FROM releases WHERE status='live' " +
    "ORDER BY platform_release_date DESC, created_at DESC LIMIT 12",
  ).all() as Row[];

  const topTracks = db.prepare(
    `SELECT t.*, COUNT(ph.id) AS week_plays FROM tracks t
        JOIN play_history ph ON ph.track_id = t.id
          AND ph.played_at >= datetime('now', '-7 days')
        WHERE ${LIVE_TRACK}
        GROUP BY t.id ORDER BY week_plays DESC LIMIT 10`,
  ).all() as Row[];

  const editorial = db.prepare(
    "SELECT * FROM playlists WHERE is_editorial=1 AND visibility='public' " +
    "ORDER BY created_at LIMIT 8",
  ).all() as Row[];

  const artists = db.prepare(
    `SELECT a.*, SUM(t.play_count) AS total_plays FROM artists a
        JOIN track_artists ta ON ta.artist_id = a.id AND ta.role='MainArtist'
        JOIN tracks t ON t.id = ta.track_id AND t.status='live'
        GROUP BY a.id ORDER BY total_plays DESC LIMIT 10`,
  ).all() as Row[];

  let recentlyPlayed: any[] = [];
  if (uid) {
    const rows = db.prepare(
      `SELECT t.*, MAX(ph.played_at) AS last_played FROM play_history ph
          JOIN tracks t ON t.id = ph.track_id
          WHERE ph.user_id = ? AND ${LIVE_TRACK}
          GROUP BY t.id ORDER BY last_played DESC LIMIT 10`,
    ).all(uid) as Row[];
    recentlyPlayed = serializeTracks(rows, uid);
  }

  const genres = db.prepare(
    "SELECT genre, COUNT(*) AS n FROM tracks " +
    "WHERE genre IS NOT NULL AND status='live' GROUP BY genre ORDER BY n DESC",
  ).all() as Row[];

  res.json({
    new_releases: serializeReleases(newReleases, uid),
    top_tracks: serializeTracks(topTracks, uid),
    editorial_playlists: serializePlaylists(editorial),
    popular_artists: serializeArtists(artists, uid),
    recently_played: recentlyPlayed,
    genres: genres.map(g => ({ name: g.genre, track_count: g.n })),
  });
});

// --------------------------------------------------------------------------
// TÌM KIẾM (không dấu, instant)
// --------------------------------------------------------------------------
router.get('/search', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const uid = uidOf(user);
  const q = qStr(req.query.q);
  if (!q) throw new HttpError(422, 'Thiếu tham số q');
  const limit = qInt(req.query.limit, 8, 1, 50);

  const norm = normalizeText(q);
  const like = `%${norm}%`;
  const prefix = `${norm}%`;

  const titleTracks = db.prepare(
    `SELECT t.* FROM tracks t WHERE ${LIVE_TRACK} AND t.title_norm LIKE ?
        ORDER BY (t.title_norm LIKE ?) DESC, t.play_count DESC LIMIT ?`,
  ).all(like, prefix, limit) as Row[];

  const artistTracks = db.prepare(
    `SELECT DISTINCT t.* FROM tracks t
        JOIN track_artists ta ON ta.track_id = t.id
        JOIN artists a ON a.id = ta.artist_id
        WHERE ${LIVE_TRACK} AND a.name_norm LIKE ?
        ORDER BY t.play_count DESC LIMIT ?`,
  ).all(like, limit) as Row[];
  const seen = new Set(titleTracks.map(t => t.id));
  const tracks = [...titleTracks, ...artistTracks.filter(t => !seen.has(t.id))];

  const releases = db.prepare(
    `SELECT * FROM releases WHERE status='live' AND title_norm LIKE ?
        ORDER BY (title_norm LIKE ?) DESC LIMIT ?`,
  ).all(like, prefix, limit) as Row[];

  const artists = db.prepare(
    `SELECT * FROM artists WHERE name_norm LIKE ?
        ORDER BY (name_norm LIKE ?) DESC LIMIT ?`,
  ).all(like, prefix, limit) as Row[];

  const playlists = db.prepare(
    `SELECT * FROM playlists WHERE visibility='public'
        AND (title LIKE ? OR title LIKE ?) LIMIT ?`,
  ).all(`%${q}%`, `%${norm}%`, limit) as Row[];

  res.json({
    query: q,
    tracks: serializeTracks(tracks.slice(0, limit), uid),
    releases: serializeReleases(releases, uid),
    artists: serializeArtists(artists, uid),
    playlists: serializePlaylists(playlists),
  });
});

// --------------------------------------------------------------------------
// TRACK
// --------------------------------------------------------------------------
const TRACK_ORDER: Record<string, string> = {
  new: 't.created_at DESC', top: 't.play_count DESC', az: 't.title_norm ASC',
};

router.get('/tracks', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const sort = qStr(req.query.sort) || 'new';
  const order = TRACK_ORDER[sort] || TRACK_ORDER.new;
  const limit = qInt(req.query.limit, 100, 1, 200);
  const offset = qInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const rows = db.prepare(
    `SELECT t.* FROM tracks t WHERE ${LIVE_TRACK} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(limit, offset) as Row[];
  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM tracks t WHERE ${LIVE_TRACK}`,
  ).get() as Row).n;
  res.json({ items: serializeTracks(rows, uidOf(user)), total });
});

router.get('/tracks/:trackId', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const trackId = req.params.trackId;
  const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(trackId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy bài hát');
  if (row.status !== 'live' && !isAdmin(user)) throw new HttpError(404, 'Không tìm thấy bài hát');

  const data = serializeTracks([row], uidOf(user))[0];
  const credits = db.prepare(
    `SELECT a.id, a.name, ta.role FROM track_artists ta
        JOIN artists a ON a.id=ta.artist_id WHERE ta.track_id=? ORDER BY ta.sequence`,
  ).all(trackId) as Row[];
  data.credits = credits;
  data.p_line = row.p_line;
  data.language = row.language;
  data.parental_warning = row.parental_warning;
  res.json(data);
});

router.get('/tracks/:trackId/stream', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const trackId = req.params.trackId;
  const row = db.prepare(
    'SELECT id, audio_path, status FROM tracks WHERE id=?',
  ).get(trackId) as Row | undefined;
  if (!row || !row.audio_path) throw new HttpError(404, 'Bài hát chưa có file audio');
  if (row.status !== 'live' && !isAdmin(user)) throw new HttpError(403, 'Bài hát hiện không khả dụng');
  res.json({ url: `/stream/${trackId}?${signStream(trackId)}` });
});

router.get('/tracks/:trackId/download', requireAuth, (req: Request, res: Response) => {
  const trackId = req.params.trackId;
  const row = db.prepare(
    'SELECT audio_path, status FROM tracks WHERE id=?',
  ).get(trackId) as Row | undefined;
  if (!row || !row.audio_path || row.status !== 'live') {
    throw new HttpError(404, 'Bài hát không khả dụng để tải');
  }
  res.json({ url: `/download/track/${trackId}?${signDownload('track', trackId)}` });
});

router.get('/albums/:releaseId/download', requireAuth, (req: Request, res: Response) => {
  const releaseId = req.params.releaseId;
  const rel = db.prepare('SELECT status FROM releases WHERE id=?').get(releaseId) as Row | undefined;
  if (!rel || rel.status !== 'live') throw new HttpError(404, 'Album không khả dụng');
  const n = (db.prepare(
    `SELECT COUNT(*) AS n FROM tracks t JOIN release_tracks rt ON rt.track_id=t.id
        WHERE rt.release_id=? AND t.status='live' AND t.audio_path IS NOT NULL`,
  ).get(releaseId) as Row).n;
  if (!n) throw new HttpError(404, 'Album chưa có bài phát hành nào');
  res.json({
    url: `/download/album/${releaseId}?${signDownload('album', releaseId)}`,
    track_count: n,
  });
});

router.get('/tracks/:trackId/waveform', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const trackId = req.params.trackId;
  const row = db.prepare(
    'SELECT audio_path, status FROM tracks WHERE id=?',
  ).get(trackId) as Row | undefined;
  if (!row || !row.audio_path) throw new HttpError(404, 'Bài hát chưa có audio');
  if (row.status !== 'live' && !isAdmin(user)) throw new HttpError(404, 'Không tìm thấy bài hát');
  const peaks = getOrBuildWaveform(trackId, path.join(AUDIO_DIR, row.audio_path));
  if (!peaks) throw new HttpError(404, 'Không phân tích được waveform');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.json({ peaks });
});

router.get('/tracks/:trackId/lyrics', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const trackId = req.params.trackId;
  const row = db.prepare(
    'SELECT lyrics, lyrics_lrc, status FROM tracks WHERE id=?',
  ).get(trackId) as Row | undefined;
  if (!row || (row.status !== 'live' && !isAdmin(user))) {
    throw new HttpError(404, 'Không tìm thấy bài hát');
  }
  res.json({ lyrics: row.lyrics, lrc: row.lyrics_lrc });
});

// --------------------------------------------------------------------------
// ALBUM / RELEASE
// --------------------------------------------------------------------------
router.get('/albums', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const limit = qInt(req.query.limit, 24, 1, 100);
  const offset = qInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const rows = db.prepare(
    "SELECT * FROM releases WHERE status='live' " +
    'ORDER BY platform_release_date DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as Row[];
  res.json({ items: serializeReleases(rows, uidOf(user)) });
});

router.get('/albums/:releaseId', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const uid = uidOf(user);
  const releaseId = req.params.releaseId;
  const row = db.prepare('SELECT * FROM releases WHERE id=?').get(releaseId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy album');

  const data = serializeReleases([row], uid)[0];
  data.p_line = row.p_line;
  data.c_line = row.c_line;
  data.original_release_date = row.original_release_date;
  data.platform_release_date = row.platform_release_date;
  data.parental_warning = row.parental_warning;

  const tracks = db.prepare(
    `SELECT t.* FROM tracks t JOIN release_tracks rt ON rt.track_id = t.id
        WHERE rt.release_id=? ORDER BY rt.disc_no, rt.track_no`,
  ).all(releaseId) as Row[];
  data.tracks = serializeTracks(tracks, uid);
  data.total_duration_ms = data.tracks.reduce((s: number, t: any) => s + (t.duration_ms || 0), 0);

  const deal = db.prepare('SELECT * FROM deals WHERE release_id=? LIMIT 1').get(releaseId) as Row | undefined;
  data.deal = deal || null;
  res.json(data);
});

// --------------------------------------------------------------------------
// NGHỆ SĨ
// --------------------------------------------------------------------------
router.get('/artists', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const limit = qInt(req.query.limit, 30, 1, 100);
  const rows = db.prepare('SELECT * FROM artists ORDER BY name LIMIT ?').all(limit) as Row[];
  res.json({ items: serializeArtists(rows, uidOf(user)) });
});

router.get('/artists/:artistId', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const uid = uidOf(user);
  const artistId = req.params.artistId;
  const row = db.prepare('SELECT * FROM artists WHERE id=?').get(artistId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy nghệ sĩ');
  const data = serializeArtists([row], uid)[0];

  const top = db.prepare(
    `SELECT DISTINCT t.* FROM tracks t
        JOIN track_artists ta ON ta.track_id=t.id
        WHERE ta.artist_id=? AND ${LIVE_TRACK}
        ORDER BY t.play_count DESC LIMIT 10`,
  ).all(artistId) as Row[];
  data.top_tracks = serializeTracks(top, uid);

  const releases = db.prepare(
    `SELECT DISTINCT r.* FROM releases r
        JOIN release_artists ra ON ra.release_id=r.id
        WHERE ra.artist_id=? AND r.status='live'
        ORDER BY r.platform_release_date DESC`,
  ).all(artistId) as Row[];
  data.releases = serializeReleases(releases, uid);

  const appearsOn = db.prepare(
    `SELECT DISTINCT r.* FROM releases r
        JOIN release_tracks rt ON rt.release_id = r.id
        JOIN track_artists ta ON ta.track_id = rt.track_id
        WHERE ta.artist_id=? AND ta.role='FeaturedArtist' AND r.status='live'`,
  ).all(artistId) as Row[];
  data.appears_on = serializeReleases(appearsOn, uid);

  const similar = db.prepare(
    `SELECT DISTINCT a.* FROM artists a
        JOIN track_artists ta ON ta.artist_id = a.id
        JOIN tracks t ON t.id = ta.track_id
        WHERE a.id != ? AND t.genre IN (
          SELECT DISTINCT t2.genre FROM tracks t2
          JOIN track_artists ta2 ON ta2.track_id=t2.id WHERE ta2.artist_id=?)
        LIMIT 6`,
  ).all(artistId, artistId) as Row[];
  data.similar_artists = serializeArtists(similar, uid);

  const plays = db.prepare(
    `SELECT SUM(t.play_count) AS n FROM tracks t
        JOIN track_artists ta ON ta.track_id=t.id WHERE ta.artist_id=?`,
  ).get(artistId) as Row;
  data.total_plays = plays.n || 0;
  res.json(data);
});

// --------------------------------------------------------------------------
// BẢNG XẾP HẠNG
// --------------------------------------------------------------------------
router.get('/charts', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const uid = uidOf(user);
  let period = qStr(req.query.period) || 'week';
  if (period !== 'week' && period !== 'month' && period !== 'all') period = 'week';

  let rows: Row[];
  if (period === 'all') {
    rows = db.prepare(
      `SELECT t.*, t.play_count AS period_plays FROM tracks t ` +
      `WHERE ${LIVE_TRACK} ORDER BY t.play_count DESC LIMIT 50`,
    ).all() as Row[];
  } else {
    const days = period === 'week' ? 7 : 30;
    rows = db.prepare(
      `SELECT t.*, COUNT(ph.id) AS period_plays FROM tracks t
          JOIN play_history ph ON ph.track_id=t.id
            AND ph.played_at >= datetime('now', '-${days} days')
          WHERE ${LIVE_TRACK}
          GROUP BY t.id ORDER BY period_plays DESC LIMIT 50`,
    ).all() as Row[];
  }
  const items = serializeTracks(rows, uid);
  items.forEach((item, i) => {
    item.rank = i + 1;
    item.period_plays = rows[i].period_plays;
  });
  res.json({ period, items });
});

// --------------------------------------------------------------------------
// THỂ LOẠI
// --------------------------------------------------------------------------
router.get('/genres/:genre/tracks', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const genre = req.params.genre;
  const limit = qInt(req.query.limit, 50, 1, 100);
  const rows = db.prepare(
    `SELECT t.* FROM tracks t WHERE ${LIVE_TRACK} AND t.genre=? ` +
    'ORDER BY t.play_count DESC LIMIT ?',
  ).all(genre, limit) as Row[];
  res.json({ genre, items: serializeTracks(rows, uidOf(user)) });
});

// --------------------------------------------------------------------------
// PLAYLIST CÔNG KHAI
// --------------------------------------------------------------------------
router.get('/playlists/:playlistId', (req: Request, res: Response) => {
  const user = optionalUser(req);
  const uid = uidOf(user);
  const playlistId = req.params.playlistId;
  const row = db.prepare('SELECT * FROM playlists WHERE id=?').get(playlistId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy playlist');
  if (row.visibility === 'private' && row.owner_id !== uid) {
    throw new HttpError(403, 'Playlist này ở chế độ riêng tư');
  }
  const data = serializePlaylists([row])[0];
  const tracks = db.prepare(
    `SELECT t.*, pt.position FROM tracks t
        JOIN playlist_tracks pt ON pt.track_id = t.id
        WHERE pt.playlist_id=? ORDER BY pt.position`,
  ).all(playlistId) as Row[];
  data.tracks = serializeTracks(tracks, uid);
  data.total_duration_ms = data.tracks.reduce((s: number, t: any) => s + (t.duration_ms || 0), 0);
  data.is_owner = row.owner_id === uid;
  res.json(data);
});

/** Mount vào app tại prefix '/v1' (dùng bởi routes/index.ts). */
export function mountCatalog(app: Express): void {
  app.use('/v1', router);
}

export default router;
