"""Cấu hình trung tâm của ANS Music. Mọi khóa bảo mật nạp từ file .env."""
import os
import secrets
from pathlib import Path

# Cấu trúc dự án:  <gốc>/backend/app/…  ·  <gốc>/frontend/…  ·  <gốc>/.env
BACKEND_DIR = Path(__file__).resolve().parent.parent   # backend/
ROOT_DIR = BACKEND_DIR.parent                          # thư mục gốc dự án
ENV_FILE = ROOT_DIR / ".env"                           # .env ở gốc — bạn quản lý


def _bootstrap_env() -> None:
    """Lần đầu chạy chưa có .env → tạo sẵn với secret sinh ngẫu nhiên để
    người dùng quản lý/chỉnh sửa (thay vì bắt đầu từ con số 0)."""
    if ENV_FILE.exists():
        return
    # tái dùng secret.key cũ nếu đã có → không vô hiệu token/URL của phiên đang chạy
    old_secret = BACKEND_DIR / "data" / "secret.key"
    secret = (old_secret.read_text(encoding="utf-8").strip()
              if old_secret.exists() else secrets.token_hex(32))
    example = ROOT_DIR / ".env.example"
    tpl = example.read_text(encoding="utf-8") if example.exists() else ""
    content = (tpl
               .replace("__GENERATED_SECRET__", secret)
               .replace("__GENERATED_APIKEY__", "anspk_" + secrets.token_urlsafe(32)))
    if not content:
        content = (f"ANS_SECRET_KEY={secret}\n"
                   f"ANS_API_KEY=anspk_{secrets.token_urlsafe(32)}\n")
    try:
        ENV_FILE.write_text(content, encoding="utf-8")
        print("[config] Đã tạo file .env với secret ngẫu nhiên — bạn có thể sửa để quản lý.")
    except OSError:
        pass


_bootstrap_env()
try:
    from dotenv import load_dotenv
    load_dotenv(ENV_FILE)
except ImportError:
    pass

DATA_DIR = BACKEND_DIR / "data"        # DB + secret (dữ liệu server)
MEDIA_DIR = BACKEND_DIR / "media"      # audio/cover/brand (dữ liệu server)
AUDIO_DIR = MEDIA_DIR / "audio"
MASTER_DIR = MEDIA_DIR / "masters"      # bản gốc WAV/FLAC khi đã transcode
COVER_DIR = MEDIA_DIR / "covers"
DELIVERY_DIR = MEDIA_DIR / "deliveries"
STAGING_DIR = MEDIA_DIR / "staging"     # file chờ trong Upload Studio
WAVEFORM_DIR = MEDIA_DIR / "waveforms"  # cache JSON đỉnh sóng cho UI
BRAND_DIR = MEDIA_DIR / "brand"         # logo & asset thương hiệu tùy chỉnh
AVATAR_DIR = MEDIA_DIR / "avatars"      # ảnh đại diện người dùng
ARTIST_IMG_DIR = MEDIA_DIR / "artists"  # ảnh đại diện nghệ sĩ (upload từ Admin)
SFTP_ROOT = MEDIA_DIR / "sftp"          # dropbox SFTP mỗi distribution (DDEX delivery)
STATIC_DIR = ROOT_DIR / "frontend"     # toàn bộ giao diện web (URL vẫn /static/…)

for d in (DATA_DIR, AUDIO_DIR, MASTER_DIR, COVER_DIR, DELIVERY_DIR, STAGING_DIR,
          WAVEFORM_DIR, BRAND_DIR, AVATAR_DIR, ARTIST_IMG_DIR, SFTP_ROOT):
    d.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "ans_music.db"

_SECRET_FILE = DATA_DIR / "secret.key"


def _env_int(name: str, default: int) -> int:
    """Đọc int từ env an toàn — biến rỗng/không hợp lệ dùng default (không crash)."""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"[config] {name}='{raw}' không phải số — dùng mặc định {default}")
        return default


def _load_secret() -> str:
    """Secret ký JWT & signed URL — sinh một lần, lưu vào data/secret.key."""
    env = (os.environ.get("ANS_SECRET_KEY") or "").strip()
    if env:
        return env
    if _SECRET_FILE.exists():
        saved = _SECRET_FILE.read_text(encoding="utf-8").strip()
        if saved:                      # bỏ qua file rỗng/cắt cụt → tái sinh
            return saved
    secret = secrets.token_hex(32)
    _SECRET_FILE.write_text(secret, encoding="utf-8")
    return secret


SECRET_KEY = _load_secret()
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY rỗng — kiểm tra .env / data/secret.key")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = 60 * 60 * 24 * 7      # 7 ngày (demo; production nên 15' + refresh)
STREAM_URL_TTL = 60 * 60 * 6             # signed stream URL sống 6 giờ

# ---- API KEY giao tiếp frontend ↔ backend (đổi trong .env: ANS_API_KEY) ----
# Frontend phải gửi header X-API-Key khớp khóa này cho mọi API JSON (/v1, /admin/v1).
# Bỏ trống = tắt kiểm tra (không khuyến nghị).
API_KEY = os.environ.get("ANS_API_KEY", "").strip()
if not API_KEY:
    print("[config] ⚠ ANS_API_KEY rỗng — API KEY GATE ĐANG TẮT. Đặt ANS_API_KEY trong .env.")

# ---- CORS: chỉ cho phép origin trong ANS_ALLOWED_ORIGINS (mặc định: same-origin
# duy nhất). KHÔNG dùng "*" để trang lạ không đọc/replay được API key. ----
ALLOWED_ORIGINS = [o.strip() for o in
                   os.environ.get("ANS_ALLOWED_ORIGINS", "").split(",") if o.strip()]

# ---- SMTP gửi mã xác thực email khi đăng ký (cấu hình trong .env) ----
# Dùng Google Workspace / Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587,
# SMTP_USER=email của bạn, SMTP_PASSWORD=App Password (không phải mật khẩu thường).
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = _env_int("SMTP_PORT", 587)
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.environ.get("SMTP_FROM", "").strip() or SMTP_USER
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "ANS Music").strip()
SMTP_TLS = os.environ.get("SMTP_TLS", "true").strip().lower() in ("1", "true", "yes")
EMAIL_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

EMAIL_CODE_TTL = 10 * 60                 # mã xác thực email sống 10 phút
EMAIL_CODE_MAX_ATTEMPTS = 5

# Nhận diện đuôi file audio cho upload / streaming
AUDIO_CONTENT_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
}

APP_NAME = "ANS Music"
APP_VERSION = "2.1.0"
PLAY_COUNT_THRESHOLD_MS = 30_000         # 1 lượt nghe hợp lệ khi >= 30s (chuẩn ngành)

# Tự sinh ISRC nội bộ trong Upload Studio: {PREFIX}{YY}{NNNNN}
# PREFIX = mã quốc gia + mã registrant (đăng ký thật với IFPI khi lên production)
ISRC_PREFIX = os.environ.get("ANS_ISRC_PREFIX", "VNA0D")

# Transcode streaming: bitrate AAC khi có ffmpeg
TRANSCODE_BITRATE = os.environ.get("ANS_TRANSCODE_BITRATE", "192k")
STAGING_TTL_HOURS = 24                   # file staging quá hạn sẽ bị dọn

# ---- SFTP ingestion DDEX (kiểu YouTube): đối tác push XML+audio lên dropbox ----
# Bật ANS_SFTP_ENABLED=true để mở SFTP server nhúng. Mỗi distribution có 1 cặp
# SSH key + thư mục dropbox riêng (chroot). Cổng riêng, KHÔNG đụng SSH hệ thống (22).
SFTP_ENABLED = os.environ.get("ANS_SFTP_ENABLED", "false").strip().lower() in ("1", "true", "yes")
SFTP_PORT = _env_int("ANS_SFTP_PORT", 2222)
SFTP_BIND = os.environ.get("ANS_SFTP_BIND", "0.0.0.0").strip() or "0.0.0.0"
# Host quảng bá cho đối tác (điền domain/IP VPS). Trống → tự đoán IP LAN.
PUBLIC_HOST = os.environ.get("ANS_PUBLIC_HOST", "").strip()
SFTP_HOST_KEY = DATA_DIR / "sftp_host_key"   # host key cố định → fingerprint không đổi
SFTP_POLL_SEC = _env_int("ANS_SFTP_POLL_SEC", 15)   # chu kỳ quét dropbox
SFTP_STABLE_SEC = _env_int("ANS_SFTP_STABLE_SEC", 10)  # file "ổn định" sau N giây không đổi
