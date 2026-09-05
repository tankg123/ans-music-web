/** better-sqlite3 — schema DDEX 1:1 với bản Python (đã migrate đầy đủ).
 *  Dùng lại chính file DB cũ nên toàn bộ tài khoản + nhạc giữ nguyên. */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { DB_PATH } from './config.js';

export type Row = Record<string, any>;

// CREATE TABLE IF NOT EXISTS — khớp schema thực đã migrate của bản Python.
const SCHEMA = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS app_settings ( key TEXT PRIMARY KEY, value TEXT );

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_norm TEXT, sort_name TEXT,
  type TEXT DEFAULT 'person', country TEXT, isni TEXT, ipi TEXT, bio TEXT,
  image_url TEXT, accent TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT );

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, dpid TEXT,
  isrc_prefix TEXT, c_line TEXT, p_line TEXT, right_holder TEXT,
  contact_email TEXT, website TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now')) );

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY, upc TEXT UNIQUE, grid TEXT, catalog_number TEXT,
  title TEXT NOT NULL, title_norm TEXT, subtitle TEXT,
  release_type TEXT DEFAULT 'Album', label_id TEXT REFERENCES labels(id),
  label_name TEXT, genre TEXT, subgenre TEXT, p_line TEXT, c_line TEXT,
  parental_warning TEXT DEFAULT 'NotExplicit',
  original_release_date TEXT, platform_release_date TEXT,
  cover_url TEXT, accent TEXT, status TEXT DEFAULT 'live',
  source TEXT DEFAULT 'admin_upload', delivery_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  title_version TEXT, metadata_language TEXT DEFAULT 'vi', audio_language TEXT DEFAULT 'vi',
  c_line_year INTEGER, p_line_year INTEGER, right_holder TEXT, preorder_date TEXT,
  release_price_tier TEXT, track_price_tier TEXT, mastered_by TEXT,
  is_compilation INTEGER DEFAULT 0, is_migrated INTEGER DEFAULT 0, tags TEXT,
  published_at TEXT, created_by TEXT, review_note TEXT, submitted_at TEXT,
  source_partner_id TEXT );

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY, isrc TEXT UNIQUE, title TEXT NOT NULL, title_norm TEXT,
  subtitle TEXT, duration_ms INTEGER DEFAULT 0, language TEXT DEFAULT 'vi', genre TEXT,
  parental_warning TEXT DEFAULT 'NotExplicit', p_line TEXT, audio_path TEXT, audio_hash TEXT,
  lyrics TEXT, lyrics_lrc TEXT, play_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'live', created_at TEXT DEFAULT (datetime('now')),
  master_path TEXT, secondary_isrc TEXT, secondary_genre TEXT,
  clip_start_seconds INTEGER DEFAULT 30, c_line TEXT, c_line_year INTEGER, p_line_year INTEGER,
  right_holder TEXT, instant_grat_stream_date TEXT, instant_grat_download_date TEXT,
  contributors_customized INTEGER DEFAULT 0 );

CREATE TABLE IF NOT EXISTS release_tracks (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  disc_no INTEGER DEFAULT 1, track_no INTEGER DEFAULT 1,
  PRIMARY KEY (release_id, track_id) );

CREATE TABLE IF NOT EXISTS track_artists (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'MainArtist', sequence INTEGER DEFAULT 1,
  PRIMARY KEY (track_id, artist_id, role) );

CREATE TABLE IF NOT EXISTS release_artists (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'MainArtist', sequence INTEGER DEFAULT 1,
  PRIMARY KEY (release_id, artist_id, role) );

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  territories TEXT DEFAULT 'Worldwide', excluded_territories TEXT,
  use_types TEXT DEFAULT 'OnDemandStream', commercial_models TEXT DEFAULT 'SubscriptionModel',
  start_date TEXT, end_date TEXT );

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  display_name TEXT, avatar_url TEXT, role TEXT DEFAULT 'user', plan TEXT DEFAULT 'free',
  settings TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')),
  email_verified INTEGER DEFAULT 1, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0,
  token_version INTEGER DEFAULT 0 );

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, cover_url TEXT, accent TEXT,
  visibility TEXT DEFAULT 'private', is_editorial INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT );

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, track_id) );

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, entity_type, entity_id) );

CREATE TABLE IF NOT EXISTS follows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, artist_id) );

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at TEXT DEFAULT (datetime('now')), ms_played INTEGER DEFAULT 0, source TEXT );

CREATE TABLE IF NOT EXISTS id_pool (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'available', used_by TEXT,
  added_at TEXT DEFAULT (datetime('now')), used_at TEXT );

CREATE TABLE IF NOT EXISTS genres ( id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, name_norm TEXT );

CREATE TABLE IF NOT EXISTS release_actions (
  id TEXT PRIMARY KEY, release_id TEXT NOT NULL, action TEXT NOT NULL,
  provider TEXT DEFAULT 'website', status TEXT DEFAULT 'success',
  actor_email TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')) );

CREATE TABLE IF NOT EXISTS delivery_partners (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, dpid TEXT UNIQUE, contact_email TEXT,
  api_key_hash TEXT, auto_publish INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  sftp_username TEXT, ssh_public_key TEXT, ssh_fingerprint TEXT,
  delivery_channel TEXT DEFAULT 'api', last_delivery_at TEXT );

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, partner_name TEXT, dpid TEXT, message_id TEXT, message_type TEXT,
  ern_version TEXT, xml_path TEXT, status TEXT DEFAULT 'received', log TEXT,
  received_at TEXT DEFAULT (datetime('now')), processed_at TEXT,
  channel TEXT DEFAULT 'admin_upload', partner_id TEXT );

CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, password_hash TEXT, display_name TEXT,
  purpose TEXT DEFAULT 'register', attempts INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')) );

CREATE INDEX IF NOT EXISTS idx_tracks_norm ON tracks(title_norm);
CREATE INDEX IF NOT EXISTS idx_artists_norm ON artists(name_norm);
CREATE INDEX IF NOT EXISTS idx_releases_norm ON releases(title_norm);
CREATE INDEX IF NOT EXISTS idx_history_track ON play_history(track_id, played_at);
CREATE INDEX IF NOT EXISTS idx_history_user ON play_history(user_id, played_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_pmsg ON deliveries(COALESCE(partner_id, dpid), message_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_partner_sftp_user ON delivery_partners(sftp_username) WHERE sftp_username IS NOT NULL;

-- v2.2: source_partner_id đã có trong schema releases ở trên (cách ly đa đối tác)
`;

export const db = new Database(DB_PATH, { timeout: 30000 });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Bổ sung cột còn thiếu nếu mở DB cũ hơn (ALTER an toàn, bỏ qua nếu đã có). */
function ensureColumns(): void {
  const adds: Array<[string, string, string]> = [
    ['releases', 'source_partner_id', 'TEXT'],
    ['releases', 'created_by', 'TEXT'],
    ['releases', 'review_note', 'TEXT'],
    ['releases', 'submitted_at', 'TEXT'],
    ['users', 'totp_secret', 'TEXT'],
    ['users', 'totp_enabled', 'INTEGER DEFAULT 0'],
    ['users', 'token_version', 'INTEGER DEFAULT 0'],
    ['users', 'email_verified', 'INTEGER DEFAULT 1'],
    ['labels', 'contact_email', 'TEXT'], ['labels', 'website', 'TEXT'], ['labels', 'notes', 'TEXT'],
    ['tracks', 'master_path', 'TEXT'], ['tracks', 'contributors_customized', 'INTEGER DEFAULT 0'],
    ['delivery_partners', 'sftp_username', 'TEXT'], ['delivery_partners', 'ssh_public_key', 'TEXT'],
    ['delivery_partners', 'ssh_fingerprint', 'TEXT'],
    ['delivery_partners', 'delivery_channel', "TEXT DEFAULT 'api'"],
    ['delivery_partners', 'last_delivery_at', 'TEXT'],
  ];
  for (const [table, col, type] of adds) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
      if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch { /* bảng chưa tồn tại — SCHEMA ở trên sẽ tạo */ }
  }
}

export function initDb(): void {
  db.exec(SCHEMA);
  ensureColumns();
}

export const newId = (): string => crypto.randomBytes(16).toString('hex');

// ---- app_settings helpers ----
export function getSetting(key: string, def: string | null = null): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as Row | undefined;
  return row ? row.value : def;
}
export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value);
}
