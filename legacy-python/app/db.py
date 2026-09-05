"""SQLite helper — schema theo mô hình dữ liệu DDEX trong tài liệu ý tưởng.

Demo dùng SQLite cho zero-setup; production thay bằng PostgreSQL
(schema gần như giữ nguyên, xem mục 5 của y-tuong-web-nghe-nhac-ddex.md).
"""
import sqlite3
import uuid
from contextlib import contextmanager

from .config import DB_PATH

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_norm TEXT,
  sort_name TEXT,
  type TEXT DEFAULT 'person',
  country TEXT,
  isni TEXT, ipi TEXT,
  bio TEXT,
  image_url TEXT,
  accent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dpid TEXT
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  upc TEXT UNIQUE,
  grid TEXT, catalog_number TEXT,
  title TEXT NOT NULL,
  title_norm TEXT,
  subtitle TEXT,
  release_type TEXT DEFAULT 'Album',          -- Album|Single|EP|Compilation
  label_id TEXT REFERENCES labels(id),
  label_name TEXT,
  genre TEXT, subgenre TEXT,
  p_line TEXT, c_line TEXT,
  parental_warning TEXT DEFAULT 'NotExplicit',
  original_release_date TEXT,
  platform_release_date TEXT,
  cover_url TEXT,
  accent TEXT,
  status TEXT DEFAULT 'live',                 -- draft|pending_review|live|taken_down
  source TEXT DEFAULT 'admin_upload',         -- admin_upload|ddex_feed|seed
  delivery_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  isrc TEXT UNIQUE,
  title TEXT NOT NULL,
  title_norm TEXT,
  subtitle TEXT,
  duration_ms INTEGER DEFAULT 0,
  language TEXT DEFAULT 'vi',
  genre TEXT,
  parental_warning TEXT DEFAULT 'NotExplicit',
  p_line TEXT,
  audio_path TEXT,
  audio_hash TEXT,
  lyrics TEXT,
  lyrics_lrc TEXT,
  play_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'live',                 -- draft|live|taken_down
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_tracks (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  disc_no INTEGER DEFAULT 1,
  track_no INTEGER DEFAULT 1,
  PRIMARY KEY (release_id, track_id)
);

CREATE TABLE IF NOT EXISTS track_artists (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'MainArtist',             -- MainArtist|FeaturedArtist|Composer|Producer...
  sequence INTEGER DEFAULT 1,
  PRIMARY KEY (track_id, artist_id, role)
);

CREATE TABLE IF NOT EXISTS release_artists (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'MainArtist',
  sequence INTEGER DEFAULT 1,
  PRIMARY KEY (release_id, artist_id, role)
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  territories TEXT DEFAULT 'Worldwide',
  excluded_territories TEXT,
  use_types TEXT DEFAULT 'OnDemandStream',
  commercial_models TEXT DEFAULT 'SubscriptionModel',
  start_date TEXT, end_date TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',                   -- user|admin
  plan TEXT DEFAULT 'free',                   -- free|premium
  settings TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  accent TEXT,
  visibility TEXT DEFAULT 'private',          -- public|private|unlisted
  is_editorial INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,                  -- track|release|playlist
  entity_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS follows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, artist_id)
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at TEXT DEFAULT (datetime('now')),
  ms_played INTEGER DEFAULT 0,
  source TEXT
);

CREATE TABLE IF NOT EXISTS id_pool (          -- kho mã UPC/ISRC cấp phát dần
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                         -- isrc | upc
  code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'available',            -- available | used
  used_by TEXT,                               -- track_id / release_id đã dùng mã
  added_at TEXT DEFAULT (datetime('now')),
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS delivery_partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dpid TEXT UNIQUE,                           -- DDEX Party ID của đối tác
  contact_email TEXT,
  api_key_hash TEXT,                          -- SHA-256 của API key (không lưu plaintext)
  auto_publish INTEGER DEFAULT 0,             -- 1 = bỏ qua Review Queue
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  partner_name TEXT,
  dpid TEXT,
  message_id TEXT,
  message_type TEXT,                          -- NewReleaseMessage|PurgeReleaseMessage
  ern_version TEXT,
  xml_path TEXT,
  status TEXT DEFAULT 'received',             -- received|validated|imported|failed
  log TEXT,
  received_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracks_norm ON tracks(title_norm);
CREATE INDEX IF NOT EXISTS idx_artists_norm ON artists(name_norm);
CREATE INDEX IF NOT EXISTS idx_releases_norm ON releases(title_norm);
CREATE INDEX IF NOT EXISTS idx_history_track ON play_history(track_id, played_at);
CREATE INDEX IF NOT EXISTS idx_history_user ON play_history(user_id, played_at);
"""


def new_id() -> str:
    return uuid.uuid4().hex


def connect() -> sqlite3.Connection:
    # check_same_thread=False: endpoint async (upload/DDEX) chạy trên event loop,
    # còn dependency sync chạy ở threadpool — mỗi request 1 connection nên vẫn an toàn.
    # isolation_level=None (autocommit): FastAPI chạy teardown dependency SAU khi
    # response đã gửi, nếu commit ở teardown thì request kế tiếp có thể đọc thiếu
    # dữ liệu vừa ghi (read-after-write race). Autocommit + WAL loại bỏ race đó.
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False,
                           isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


MIGRATIONS = [
    # v1.1: kênh nhận delivery (admin_upload | partner_api)
    "ALTER TABLE deliveries ADD COLUMN channel TEXT DEFAULT 'admin_upload'",
    # v1.1: bản gốc master khi audio_path là file đã transcode
    "ALTER TABLE tracks ADD COLUMN master_path TEXT",
    # v1.1: delivery gắn với đối tác ĐÃ XÁC THỰC (không tin DPID tự khai trong XML)
    "ALTER TABLE deliveries ADD COLUMN partner_id TEXT",
    "DROP INDEX IF EXISTS idx_deliveries_msg",
    # idempotent theo phạm vi đối tác xác thực; delivery qua admin dùng dpid trong XML
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_pmsg "
    "ON deliveries(COALESCE(partner_id, dpid), message_id)",

    # ---- v1.6: module Product (theo UPDATE_ADD_PRODUCT.md) ----
    # releases = product; bổ sung metadata chuẩn phát hành
    "ALTER TABLE releases ADD COLUMN title_version TEXT",
    "ALTER TABLE releases ADD COLUMN metadata_language TEXT DEFAULT 'vi'",
    "ALTER TABLE releases ADD COLUMN audio_language TEXT DEFAULT 'vi'",
    "ALTER TABLE releases ADD COLUMN c_line_year INTEGER",
    "ALTER TABLE releases ADD COLUMN p_line_year INTEGER",
    "ALTER TABLE releases ADD COLUMN right_holder TEXT",
    "ALTER TABLE releases ADD COLUMN preorder_date TEXT",
    "ALTER TABLE releases ADD COLUMN release_price_tier TEXT",
    "ALTER TABLE releases ADD COLUMN track_price_tier TEXT",
    "ALTER TABLE releases ADD COLUMN mastered_by TEXT",
    "ALTER TABLE releases ADD COLUMN is_compilation INTEGER DEFAULT 0",
    "ALTER TABLE releases ADD COLUMN is_migrated INTEGER DEFAULT 0",
    "ALTER TABLE releases ADD COLUMN tags TEXT",
    "ALTER TABLE releases ADD COLUMN published_at TEXT",
    # tracks: field cấp track theo spec
    "ALTER TABLE tracks ADD COLUMN secondary_isrc TEXT",
    "ALTER TABLE tracks ADD COLUMN secondary_genre TEXT",
    "ALTER TABLE tracks ADD COLUMN clip_start_seconds INTEGER DEFAULT 30",
    "ALTER TABLE tracks ADD COLUMN c_line TEXT",
    "ALTER TABLE tracks ADD COLUMN c_line_year INTEGER",
    "ALTER TABLE tracks ADD COLUMN p_line_year INTEGER",
    "ALTER TABLE tracks ADD COLUMN right_holder TEXT",
    "ALTER TABLE tracks ADD COLUMN instant_grat_stream_date TEXT",
    "ALTER TABLE tracks ADD COLUMN instant_grat_download_date TEXT",
    # label có prefix ISRC riêng để auto-generate
    "ALTER TABLE labels ADD COLUMN isrc_prefix TEXT",
    # lịch sử phát hành (tab Releases)
    """CREATE TABLE IF NOT EXISTS release_actions (
        id TEXT PRIMARY KEY,
        release_id TEXT NOT NULL,
        action TEXT NOT NULL,              -- publish | update | takedown
        provider TEXT DEFAULT 'website',
        status TEXT DEFAULT 'success',
        actor_email TEXT,
        detail TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""",

    # ---- v1.7: label mặc định copyright + genres + track kế thừa contributors ----
    "ALTER TABLE labels ADD COLUMN c_line TEXT",
    "ALTER TABLE labels ADD COLUMN p_line TEXT",
    "ALTER TABLE labels ADD COLUMN right_holder TEXT",
    # cờ track đã tự chỉnh contributors riêng (album) → không bị ghi đè khi
    # đồng bộ từ product. Single luôn giữ 0 (khóa, dùng chung với product).
    "ALTER TABLE tracks ADD COLUMN contributors_customized INTEGER DEFAULT 0",
    # danh mục thể loại (Genre) quản lý được
    """CREATE TABLE IF NOT EXISTS genres (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        name_norm TEXT
    )""",

    # ---- v1.8: xác thực email khi đăng ký + cờ đã xác thực ----
    "ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1",
    """CREATE TABLE IF NOT EXISTS email_codes (
        email TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        password_hash TEXT,
        display_name TEXT,
        purpose TEXT DEFAULT 'register',
        attempts INTEGER DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    )""",

    # ---- v2.0: 2FA TOTP + role uploader/manager + quản lý sâu ----
    "ALTER TABLE users ADD COLUMN totp_secret TEXT",
    "ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0",
    # token_version: đổi mật khẩu/reset → tăng số này → token cũ hết hiệu lực ngay
    "ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0",
    "ALTER TABLE releases ADD COLUMN created_by TEXT",       # uploader chỉ thấy product của mình
    "ALTER TABLE releases ADD COLUMN review_note TEXT",      # ghi chú duyệt/từ chối
    "ALTER TABLE releases ADD COLUMN submitted_at TEXT",     # thời điểm gửi duyệt
    "ALTER TABLE labels ADD COLUMN contact_email TEXT",
    "ALTER TABLE labels ADD COLUMN website TEXT",
    "ALTER TABLE labels ADD COLUMN notes TEXT",
    "ALTER TABLE labels ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",

    # ---- v2.1: Distribution SFTP (DDEX delivery kiểu YouTube) ----
    # đối tác = delivery_partners; thêm cấu hình SFTP + SSH public key (authorized).
    "ALTER TABLE delivery_partners ADD COLUMN sftp_username TEXT",   # tài khoản SFTP (chroot)
    "ALTER TABLE delivery_partners ADD COLUMN ssh_public_key TEXT",  # authorized key (OpenSSH)
    "ALTER TABLE delivery_partners ADD COLUMN ssh_fingerprint TEXT",
    "ALTER TABLE delivery_partners ADD COLUMN delivery_channel TEXT DEFAULT 'api'",  # api | sftp
    "ALTER TABLE delivery_partners ADD COLUMN last_delivery_at TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_partner_sftp_user "
    "ON delivery_partners(sftp_username) WHERE sftp_username IS NOT NULL",
    # đối tác nào đã đưa release này vào → chống 1 đối tác ghi đè release/track
    # (UPC/ISRC) của đối tác khác (cách ly đa đối tác).
    "ALTER TABLE releases ADD COLUMN source_partner_id TEXT",
]


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        for sql in MIGRATIONS:
            try:
                conn.execute(sql)
            except sqlite3.OperationalError:
                pass  # cột đã tồn tại
        conn.commit()
    finally:
        conn.close()


@contextmanager
def get_conn():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db():
    """FastAPI dependency: mỗi request một connection."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


def get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
