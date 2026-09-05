/** Cấu hình trung tâm backend — nạp từ backend/.env (folder độc lập).
 *  data/media/secret nằm trong backend/ nên tài khoản + nhạc giữ nguyên. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/src → backend/ (thư mục backend độc lập) → <gốc dự án>
export const BACKEND_DIR = path.resolve(__dirname, '..');
export const ROOT_DIR = path.resolve(BACKEND_DIR, '..');
export const ENV_FILE = path.join(BACKEND_DIR, '.env');

function bootstrapEnv(): void {
  if (fs.existsSync(ENV_FILE)) return;
  const example = path.join(BACKEND_DIR, '.env.example');
  const oldSecret = path.join(BACKEND_DIR, 'data', 'secret.key');
  const secret = fs.existsSync(oldSecret)
    ? fs.readFileSync(oldSecret, 'utf8').trim()
    : crypto.randomBytes(32).toString('hex');
  const apiKey = 'ANS@' + crypto.randomBytes(9).toString('base64url');
  let content = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : '';
  content = content.replace('__GENERATED_SECRET__', secret).replace('__GENERATED_APIKEY__', apiKey);
  if (!content) content = `ANS_SECRET_KEY=${secret}\nANS_API_KEY=${apiKey}\nANS_PORT=4039\n`;
  try { fs.writeFileSync(ENV_FILE, content); console.log(`[config] Đã tạo backend/.env — copy ANS_API_KEY (${apiKey}) sang frontend/.env (VITE_BACKEND_API_KEY).`); }
  catch { /* ignore */ }
}
bootstrapEnv();
dotenv.config({ path: ENV_FILE });

const env = process.env;
function envInt(name: string, def: number): number {
  const raw = (env[name] || '').trim();
  if (!raw) return def;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? def : n;
}
const truthy = (v?: string) => ['1', 'true', 'yes'].includes((v || '').trim().toLowerCase());

// ---- Đường dẫn dữ liệu: nằm trong backend/ (giữ nguyên data/nhạc đã chuyển vào)
export const DATA_DIR = env.ANS_DATA_DIR || path.join(BACKEND_DIR, 'data');
export const MEDIA_DIR = env.ANS_MEDIA_DIR || path.join(BACKEND_DIR, 'media');
export const AUDIO_DIR = path.join(MEDIA_DIR, 'audio');
export const MASTER_DIR = path.join(MEDIA_DIR, 'masters');
export const COVER_DIR = path.join(MEDIA_DIR, 'covers');
export const DELIVERY_DIR = path.join(MEDIA_DIR, 'deliveries');
export const STAGING_DIR = path.join(MEDIA_DIR, 'staging');
export const WAVEFORM_DIR = path.join(MEDIA_DIR, 'waveforms');
export const BRAND_DIR = path.join(MEDIA_DIR, 'brand');
export const AVATAR_DIR = path.join(MEDIA_DIR, 'avatars');
export const ARTIST_IMG_DIR = path.join(MEDIA_DIR, 'artists');
export const SFTP_ROOT = path.join(MEDIA_DIR, 'sftp');

for (const d of [DATA_DIR, AUDIO_DIR, MASTER_DIR, COVER_DIR, DELIVERY_DIR,
  STAGING_DIR, WAVEFORM_DIR, BRAND_DIR, AVATAR_DIR, ARTIST_IMG_DIR, SFTP_ROOT]) {
  fs.mkdirSync(d, { recursive: true });
}

export const DB_PATH = env.ANS_DB_PATH || path.join(DATA_DIR, 'ans_music.db');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

function loadSecret(): string {
  const e = (env.ANS_SECRET_KEY || '').trim();
  if (e) return e;
  if (fs.existsSync(SECRET_FILE)) {
    const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (s) return s;
  }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s);
  return s;
}
export const SECRET_KEY = loadSecret();
if (!SECRET_KEY) throw new Error('SECRET_KEY rỗng — kiểm tra .env / data/secret.key');

export const JWT_ALGORITHM = 'HS256' as const;
export const ACCESS_TOKEN_TTL = 60 * 60 * 24 * 7;   // 7 ngày
export const STREAM_URL_TTL = 60 * 60 * 6;          // signed URL 6 giờ

export const API_KEY = (env.ANS_API_KEY || '').trim();
if (!API_KEY) console.log('[config] ⚠ ANS_API_KEY rỗng — API KEY GATE ĐANG TẮT.');

export const ALLOWED_ORIGINS = (env.ANS_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

export const HOST = (env.ANS_HOST || '0.0.0.0').trim() || '0.0.0.0';
export const PORT = envInt('ANS_PORT', 4039);
// Prefix API — frontend gọi qua VITE_API_URL=http://host:4039/api
export const API_PREFIX = env.ANS_API_PREFIX || '/api';
export const PUBLIC_HOST = (env.ANS_PUBLIC_HOST || '').trim();

// SMTP gửi mã xác thực / đặt lại mật khẩu
export const SMTP_HOST = (env.SMTP_HOST || '').trim();
export const SMTP_PORT = envInt('SMTP_PORT', 587);
export const SMTP_USER = (env.SMTP_USER || '').trim();
export const SMTP_PASSWORD = (env.SMTP_PASSWORD || '').trim();
export const SMTP_FROM = (env.SMTP_FROM || '').trim() || SMTP_USER;
export const SMTP_FROM_NAME = (env.SMTP_FROM_NAME || 'ANS Music').trim();
export const SMTP_TLS = truthy(env.SMTP_TLS || 'true');
export const EMAIL_ENABLED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);
export const EMAIL_CODE_TTL = 10 * 60;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

// SFTP DDEX ingestion
export const SFTP_ENABLED = truthy(env.ANS_SFTP_ENABLED);
export const SFTP_PORT = envInt('ANS_SFTP_PORT', 2222);
export const SFTP_BIND = (env.ANS_SFTP_BIND || '0.0.0.0').trim() || '0.0.0.0';
export const SFTP_HOST_KEY = path.join(DATA_DIR, 'sftp_host_key');
export const SFTP_POLL_SEC = envInt('ANS_SFTP_POLL_SEC', 15);
export const SFTP_STABLE_SEC = envInt('ANS_SFTP_STABLE_SEC', 10);

export const APP_NAME = 'ANS Music';
export const APP_VERSION = '2.2.0';
export const PLAY_COUNT_THRESHOLD_MS = 30_000;
export const ISRC_PREFIX = env.ANS_ISRC_PREFIX || 'VNA0D';
export const TRANSCODE_BITRATE = env.ANS_TRANSCODE_BITRATE || '192k';
export const ADMIN_EMAIL = (env.ANS_ADMIN_EMAIL || 'admin@amnhacso.com').trim();
export const ADMIN_PASSWORD = (env.ANS_ADMIN_PASSWORD || 'Admin@123').trim();

export const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac',
};
