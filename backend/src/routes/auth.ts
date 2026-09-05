/** /v1/auth — Đăng ký (xác thực email 2 bước) / đăng nhập — JWT + rate-limit
 *  chống brute-force. Port 1:1 backend/app/routers/auth_routes.py. */
import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { db, newId, type Row } from '../db.js';
import {
  hashPassword, verifyPassword, createToken, createPending2faToken,
  decodeToken, HttpError,
} from '../security.js';
import { verifyTotp } from '../totp.js';
import { getBrand } from '../branding.js';
import { sendVerificationCode, sendResetCode } from '../emailer.js';
import {
  SECRET_KEY, EMAIL_CODE_TTL, EMAIL_CODE_MAX_ATTEMPTS, EMAIL_ENABLED,
} from '../config.js';

const router = Router();

/** Bọc handler async: mọi lỗi (kể cả HttpError) → next(e) cho middleware lỗi trung tâm.
 *  (Express 4 KHÔNG tự bắt lỗi async.) */
const h = (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------------------------------------------------------------------------
// Rate-limit in-memory (production nên dùng Redis để chia sẻ giữa các instance)
// ---------------------------------------------------------------------------
type RateStore = Map<string, number[]>;

// Login: tối đa 8 lần sai / 10 phút / IP
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_SEC = 600;
const loginFails: RateStore = new Map();

// Gửi mã (đăng ký + quên mật khẩu): tối đa 5 lần / 10 phút / IP
const CODE_MAX = 5;
const CODE_WINDOW = 600;
const codeSends: RateStore = new Map();

// 2FA: đếm RIÊNG theo tài khoản, KHÔNG reset khi đăng nhập đúng mật khẩu
// (nếu dùng chung bộ đếm login, attacker biết mật khẩu có thể xóa bộ đếm bằng
//  1 lần login rồi brute-force mã TOTP không giới hạn).
const TWOFA_MAX_FAILS = 6;
const TWOFA_WINDOW = 600;
const twofaFails: RateStore = new Map();

function checkRate(store: RateStore, key: string, limit: number, window: number, msg: string): void {
  const now = Date.now() / 1000;
  let q = store.get(key);
  if (!q) { q = []; store.set(key, q); }
  while (q.length && q[0] < now - window) q.shift();
  if (q.length >= limit) throw new HttpError(429, msg);
}
function recordFail(store: RateStore, key: string): void {
  let q = store.get(key);
  if (!q) { q = []; store.set(key, q); }
  q.push(Date.now() / 1000);
}

function checkLoginRate(ip: string): void {
  checkRate(loginFails, ip, LOGIN_MAX_FAILS, LOGIN_WINDOW_SEC,
    'Sai mật khẩu quá nhiều lần — thử lại sau ít phút');
}

function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Định dạng UTC 'YYYY-MM-DD HH:MM:SS' (khớp datetime('now') của SQLite + Python). */
function utcStr(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** hmac(SECRET_KEY, "email:code") sha256 hex — khớp Python. */
function hashCode(email: string, code: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(`${email}:${code}`).digest('hex');
}

/** So sánh hằng-thời-gian 2 chuỗi hex (khớp hmac.compare_digest). */
function timingEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Mã 6 số an toàn (0..999999, zero-pad) — khớp secrets.randbelow(1000000). */
function genCode(): string {
  return crypto.randomInt(1000000).toString().padStart(6, '0');
}

function userPayload(user: Row, token: string) {
  return {
    token,
    user: {
      id: user.id, email: user.email, display_name: user.display_name,
      role: user.role, plan: user.plan, avatar_url: user.avatar_url ?? null,
    },
  };
}

function validateRegister(email: string, password: string): void {
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  if (password.length < 6) throw new HttpError(400, 'Mật khẩu tối thiểu 6 ký tự');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
    throw new HttpError(409, 'Email đã được đăng ký');
  }
}

// ---------------------------------------------------------------------------
// ĐĂNG KÝ — 2 bước qua email
// ---------------------------------------------------------------------------

/** Bước 1: nhận thông tin, gửi mã 6 số tới email (lưu tạm, chưa tạo tài khoản). */
router.post('/register/request', h(async (req, res) => {
  const ip = clientIp(req);
  checkRate(codeSends, ip, CODE_MAX, CODE_WINDOW, 'Gửi mã quá nhiều lần — thử lại sau ít phút');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  validateRegister(email, password);

  const code = genCode();
  const name = String(req.body?.display_name || '').trim() || email.split('@')[0];
  const expires = utcStr(new Date(Date.now() + EMAIL_CODE_TTL * 1000));
  db.prepare(
    "INSERT INTO email_codes(email,code_hash,password_hash,display_name,purpose," +
    "attempts,expires_at,created_at) VALUES(?,?,?,?,?,0,?,datetime('now')) " +
    "ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, " +
    "password_hash=excluded.password_hash, display_name=excluded.display_name, " +
    "attempts=0, expires_at=excluded.expires_at, created_at=datetime('now')"
  ).run(email, hashCode(email, code), hashPassword(password), name, 'register', expires);
  recordFail(codeSends, ip);

  let sent: boolean;
  try {
    // Tên brand lấy từ cấu hình Admin để email hiển thị đúng thương hiệu
    sent = await sendVerificationCode(email, code, getBrand().brand_name);
  } catch {
    // SMTP đã cấu hình nhưng gửi thất bại → dọn mã, báo lỗi rõ ràng
    db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
    throw new HttpError(502, 'Không gửi được email xác thực — thử lại sau ít phút');
  }
  res.json({
    email_sent: sent, email, ttl_seconds: EMAIL_CODE_TTL,
    dev_hint: (sent || EMAIL_ENABLED) ? null
      : 'Chưa cấu hình SMTP — xem mã ở console server (.env để bật email)',
  });
}));

/** Bước 2: kiểm tra mã, tạo tài khoản, trả token. */
router.post('/register/confirm', h((req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').replace(/\D/g, '');
  // chỉ nhận mã purpose='register' — mã đặt lại mật khẩu không tạo được tài khoản
  const row = db.prepare(
    "SELECT * FROM email_codes WHERE email=? AND purpose='register'"
  ).get(email) as Row | undefined;
  if (!row) throw new HttpError(400, 'Chưa yêu cầu mã hoặc mã đã dùng — hãy gửi lại mã');
  const now = utcStr(new Date());
  if (row.expires_at < now) {
    db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
    throw new HttpError(400, 'Mã đã hết hạn — hãy gửi lại mã');
  }
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
    throw new HttpError(429, 'Nhập sai mã quá nhiều lần — hãy gửi lại mã');
  }
  if (!timingEqual(row.code_hash, hashCode(email, code))) {
    db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE email=?').run(email);
    throw new HttpError(400, 'Mã xác thực không đúng');
  }

  // mã đúng → tạo tài khoản (chống trùng nếu người khác vừa đăng ký cùng email,
  // kể cả race double-submit → trả 409 sạch thay vì 500 IntegrityError)
  const uid = newId();
  try {
    db.prepare(
      'INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES(?,?,?,?,1)'
    ).run(uid, email, row.password_hash, row.display_name);
  } catch (e: any) {
    if (String(e?.code || '').includes('CONSTRAINT')) {
      db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
      throw new HttpError(409, 'Email đã được đăng ký');
    }
    throw e;
  }
  db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid) as Row;
  res.json(userPayload(user, createToken(uid, user.role, user.token_version || 0)));
}));
// Lưu ý: KHÔNG mở endpoint đăng ký trực tiếp (bỏ qua email). Mọi đăng ký đi qua
// /register/request → /register/confirm (dev-mode vẫn chạy, mã in ra console).

// ---------------------------------------------------------------------------
// ĐĂNG NHẬP (+ 2FA)
// ---------------------------------------------------------------------------

router.post('/login', h((req, res) => {
  const ip = clientIp(req);
  checkLoginRate(ip);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const row = db.prepare('SELECT * FROM users WHERE email=?').get(email) as Row | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    recordFail(loginFails, ip);
    throw new HttpError(401, 'Email hoặc mật khẩu không đúng');
  }
  loginFails.delete(ip);
  // Bật 2FA → chưa cấp access token; trả token trung gian chờ mã TOTP
  if (row.totp_enabled && row.totp_secret) {
    return res.json({
      requires_2fa: true,
      pending: createPending2faToken(row.id),
      email: row.email,
    });
  }
  res.json(userPayload(row, createToken(row.id, row.role, row.token_version || 0)));
}));

/** Bước 2 đăng nhập khi bật 2FA: token trung gian + mã Google Authenticator. */
router.post('/2fa/verify', h((req, res) => {
  const pending = String(req.body?.pending || '');
  const payload = decodeToken(pending);
  if (!payload || payload.typ !== '2fa') {
    throw new HttpError(401, 'Phiên xác thực đã hết hạn — đăng nhập lại');
  }
  const uid = payload.sub;
  // bộ đếm theo TÀI KHOẢN — chặn brute-force mã 6 số dù đã có mật khẩu đúng
  checkRate(twofaFails, uid, TWOFA_MAX_FAILS, TWOFA_WINDOW,
    'Nhập sai mã xác thực quá nhiều lần — thử lại sau ít phút');
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(uid) as Row | undefined;
  if (!row || !row.totp_enabled || !row.totp_secret) {
    throw new HttpError(401, 'Tài khoản không bật 2FA');
  }
  if (!verifyTotp(row.totp_secret, String(req.body?.code || ''))) {
    recordFail(twofaFails, uid);
    throw new HttpError(401, 'Mã xác thực không đúng');
  }
  twofaFails.delete(uid);
  res.json(userPayload(row, createToken(row.id, row.role, row.token_version || 0)));
}));

// ---------------------------------------------------------------------------
// QUÊN MẬT KHẨU: gửi mã qua email → xác nhận mã + mật khẩu mới
// ---------------------------------------------------------------------------

/** Gửi mã đặt lại mật khẩu. LUÔN trả 200 — không lộ email nào đã đăng ký. */
router.post('/password/forgot', h(async (req, res) => {
  const ip = clientIp(req);
  checkRate(codeSends, ip, CODE_MAX, CODE_WINDOW, 'Gửi mã quá nhiều lần — thử lại sau ít phút');
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  recordFail(codeSends, ip);

  const row = db.prepare('SELECT 1 FROM users WHERE email=?').get(email);
  if (row) {
    const code = genCode();
    const expires = utcStr(new Date(Date.now() + EMAIL_CODE_TTL * 1000));
    db.prepare(
      "INSERT INTO email_codes(email,code_hash,password_hash,display_name,purpose," +
      "attempts,expires_at,created_at) VALUES(?,?,NULL,NULL,'reset',0,?,datetime('now')) " +
      "ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, " +
      "password_hash=NULL, display_name=NULL, purpose='reset', " +
      "attempts=0, expires_at=excluded.expires_at, created_at=datetime('now')"
    ).run(email, hashCode(email, code), expires);
    try {
      await sendResetCode(email, code, getBrand().brand_name);
    } catch {
      db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
      throw new HttpError(502, 'Không gửi được email — thử lại sau ít phút');
    }
  }
  // phản hồi giống hệt nhau dù email có tồn tại hay không
  res.json({
    ok: true, ttl_seconds: EMAIL_CODE_TTL,
    message: 'Nếu email đã đăng ký, mã đặt lại mật khẩu sẽ được gửi tới.',
  });
}));

router.post('/password/reset', h((req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const newPassword = String(req.body?.new_password || '');
  if (newPassword.length < 6) throw new HttpError(400, 'Mật khẩu tối thiểu 6 ký tự');
  const row = db.prepare(
    "SELECT * FROM email_codes WHERE email=? AND purpose='reset'"
  ).get(email) as Row | undefined;
  if (!row) throw new HttpError(400, 'Chưa yêu cầu đặt lại mật khẩu hoặc mã đã dùng');
  const now = utcStr(new Date());
  if (row.expires_at < now) {
    db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
    throw new HttpError(400, 'Mã đã hết hạn — yêu cầu mã mới');
  }
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
    throw new HttpError(429, 'Nhập sai quá nhiều lần — yêu cầu mã mới');
  }
  if (!timingEqual(row.code_hash, hashCode(email, String(req.body?.code || '').trim()))) {
    db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE email=?').run(email);
    throw new HttpError(400, 'Mã xác thực không đúng');
  }
  // tăng token_version → mọi phiên/token cũ (kể cả của kẻ tấn công) hết hiệu lực
  db.prepare(
    'UPDATE users SET password_hash=?, token_version=token_version+1 WHERE email=?'
  ).run(hashPassword(newPassword), email);
  db.prepare('DELETE FROM email_codes WHERE email=?').run(email);
  res.json({ ok: true, message: 'Đã đổi mật khẩu — đăng nhập bằng mật khẩu mới' });
}));

export default router;
