/** Chuyển row DB → JSON cho client (kèm nghệ sĩ, album, trạng thái thích).
 *  Port 1:1 backend/app/serializers.py — tên field GIỮ NGUYÊN để frontend cũ
 *  tương thích. better-sqlite3 đồng bộ nên không cần await/conn. */
import { db, type Row } from './db.js';

/** Dựng chuỗi placeholder "?,?,?" cho mệnh đề IN. */
const placeholders = (n: number): string => Array(n).fill('?').join(',');

/** Tập entity_id mà user đã "thích" (favorites) trong danh sách ids. */
function likedSet(userId: string | undefined | null, entityType: string, ids: string[]): Set<string> {
  if (!userId || ids.length === 0) return new Set();
  const q = placeholders(ids.length);
  const rows = db.prepare(
    `SELECT entity_id FROM favorites WHERE user_id=? AND entity_type=? AND entity_id IN (${q})`,
  ).all(userId, entityType, ...ids) as Row[];
  return new Set(rows.map(r => r.entity_id));
}

export function serializeTracks(rows: Row[], userId?: string | null): any[] {
  const tracks = rows || [];
  if (tracks.length === 0) return [];
  const ids = tracks.map(t => t.id);
  const q = placeholders(ids.length);

  const artistRows = db.prepare(
    `SELECT ta.track_id, ta.role, ta.sequence, a.id, a.name, a.image_url
       FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
       WHERE ta.track_id IN (${q}) AND ta.role IN ('MainArtist','FeaturedArtist')
       ORDER BY ta.sequence`,
  ).all(...ids) as Row[];
  const artistsByTrack = new Map<string, any[]>();
  for (const r of artistRows) {
    if (!artistsByTrack.has(r.track_id)) artistsByTrack.set(r.track_id, []);
    artistsByTrack.get(r.track_id)!.push({ id: r.id, name: r.name, role: r.role });
  }

  const releaseRows = db.prepare(
    `SELECT rt.track_id, rt.track_no, r.id, r.title, r.cover_url, r.accent, r.release_type,
            r.label_name, r.upc
       FROM release_tracks rt JOIN releases r ON r.id = rt.release_id
       WHERE rt.track_id IN (${q})
       ORDER BY r.created_at, r.id`,
  ).all(...ids) as Row[];
  const releaseByTrack = new Map<string, any>();
  for (const r of releaseRows) {
    if (!releaseByTrack.has(r.track_id)) {
      releaseByTrack.set(r.track_id, {
        id: r.id, title: r.title, cover_url: r.cover_url,
        accent: r.accent, track_no: r.track_no,
        label_name: r.label_name, upc: r.upc,
      });
    }
  }

  const liked = likedSet(userId, 'track', ids);

  return tracks.map(t => {
    const rel = releaseByTrack.get(t.id);
    return {
      id: t.id,
      title: t.title,
      subtitle: t.subtitle ?? null,
      isrc: t.isrc ?? null,
      duration_ms: t.duration_ms ?? 0,
      genre: t.genre ?? null,
      explicit: t.parental_warning === 'Explicit',
      play_count: t.play_count ?? 0,
      status: t.status ?? null,
      has_lyrics: Boolean(t.lyrics_lrc || t.lyrics),
      has_audio: Boolean(t.audio_path),
      artists: artistsByTrack.get(t.id) ?? [],
      release: rel ? {
        id: rel.id, title: rel.title, cover_url: rel.cover_url,
        accent: rel.accent, label_name: rel.label_name, upc: rel.upc,
      } : null,
      track_no: rel ? (rel.track_no ?? null) : null,
      cover_url: rel ? (rel.cover_url ?? null) : null,
      accent: rel ? (rel.accent ?? null) : null,
      liked: liked.has(t.id),
    };
  });
}

export function serializeReleases(rows: Row[], userId?: string | null): any[] {
  const releases = rows || [];
  if (releases.length === 0) return [];
  const ids = releases.map(r => r.id);
  const q = placeholders(ids.length);

  const artistRows = db.prepare(
    `SELECT ra.release_id, a.id, a.name FROM release_artists ra
       JOIN artists a ON a.id = ra.artist_id
       WHERE ra.release_id IN (${q}) AND ra.role='MainArtist' ORDER BY ra.sequence`,
  ).all(...ids) as Row[];
  const byRelease = new Map<string, any[]>();
  for (const r of artistRows) {
    if (!byRelease.has(r.release_id)) byRelease.set(r.release_id, []);
    byRelease.get(r.release_id)!.push({ id: r.id, name: r.name });
  }

  const countRows = db.prepare(
    `SELECT release_id, COUNT(*) AS n FROM release_tracks WHERE release_id IN (${q}) GROUP BY release_id`,
  ).all(...ids) as Row[];
  const counts = new Map<string, number>();
  for (const r of countRows) counts.set(r.release_id, r.n);

  const liked = likedSet(userId, 'release', ids);

  return releases.map(r => ({
    id: r.id,
    title: r.title,
    upc: r.upc ?? null,
    release_type: r.release_type ?? null,
    genre: r.genre ?? null,
    cover_url: r.cover_url ?? null,
    accent: r.accent ?? null,
    label_name: r.label_name ?? null,
    release_date: r.platform_release_date || r.original_release_date || null,
    status: r.status ?? null,
    artists: byRelease.get(r.id) ?? [],
    track_count: counts.get(r.id) ?? 0,
    liked: liked.has(r.id),
  }));
}

export function serializeArtists(rows: Row[], userId?: string | null): any[] {
  const artists = rows || [];
  if (artists.length === 0) return [];
  const ids = artists.map(a => a.id);
  const q = placeholders(ids.length);

  const followerRows = db.prepare(
    `SELECT artist_id, COUNT(*) AS n FROM follows WHERE artist_id IN (${q}) GROUP BY artist_id`,
  ).all(...ids) as Row[];
  const followers = new Map<string, number>();
  for (const r of followerRows) followers.set(r.artist_id, r.n);

  const following = new Set<string>();
  if (userId) {
    const rows2 = db.prepare(
      `SELECT artist_id FROM follows WHERE user_id=? AND artist_id IN (${q})`,
    ).all(userId, ...ids) as Row[];
    for (const r of rows2) following.add(r.artist_id);
  }

  return artists.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type ?? null,
    country: a.country ?? null,
    bio: a.bio ?? null,
    image_url: a.image_url ?? null,
    accent: a.accent ?? null,
    isni: a.isni ?? null,
    ipi: a.ipi ?? null,
    followers: followers.get(a.id) ?? 0,
    following: following.has(a.id),
  }));
}

export function serializePlaylists(rows: Row[]): any[] {
  const playlists = rows || [];
  if (playlists.length === 0) return [];
  const ids = playlists.map(p => p.id);
  const q = placeholders(ids.length);

  const countRows = db.prepare(
    `SELECT playlist_id, COUNT(*) AS n FROM playlist_tracks WHERE playlist_id IN (${q}) GROUP BY playlist_id`,
  ).all(...ids) as Row[];
  const counts = new Map<string, number>();
  for (const r of countRows) counts.set(r.playlist_id, r.n);

  const ownerRows = db.prepare(
    `SELECT p.id, u.display_name FROM playlists p JOIN users u ON u.id=p.owner_id
       WHERE p.id IN (${q})`,
  ).all(...ids) as Row[];
  const owners = new Map<string, any>();
  for (const r of ownerRows) owners.set(r.id, r.display_name);

  return playlists.map(p => ({
    id: p.id,
    title: p.title,
    description: p.description ?? null,
    cover_url: p.cover_url ?? null,
    accent: p.accent ?? null,
    visibility: p.visibility ?? null,
    is_editorial: Boolean(p.is_editorial),
    owner_id: p.owner_id ?? null,
    owner_name: owners.get(p.id) ?? null,
    track_count: counts.get(p.id) ?? 0,
  }));
}
