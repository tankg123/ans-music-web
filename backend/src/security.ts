/** Auth — PBKDF2 (KHỚP ĐỊNH DẠNG bản Python để user cũ đăng nhập được) + JWT + RBAC. */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { SECRET_KEY, ACCESS_TOKEN_TTL } from './config.js';
import { db, type Row } from './db.js';

const PBKDF2_ITERATIONS = 200_000;

/** Định dạng: pbkdf2$<iters>$<salt_hex>$<digest_hex> — y hệt Python hashlib. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'),
    PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${digest}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [, iters, salt, digest] = stored.split('$');
    const cand = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'),
      parseInt(iters, 10), digest.length / 2, 'sha256').toString('hex');
    const a = Buffer.from(cand), b = Buffer.from(digest);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

export interface AccessClaims { sub: string; role: string; tv: number; iat: number; exp: number; }
export interface PendingClaims { sub: string; typ: string; iat: number; exp: number; }

export function createToken(userId: string, role: string, tokenVersion = 0): string {
  return jwt.sign({ sub: userId, role, tv: tokenVersion }, SECRET_KEY,
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL });
}
export function createPending2faToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: '2fa' }, SECRET_KEY, { algorithm: 'HS256', expiresIn: 300 });
}
export function decodeToken(token: string): any | null {
  try { return jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] }); }
  catch { return null; }
}

function extractToken(req: Request): string | null {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}
export function loadUser(userId: string): Row | null {
  return (db.prepare('SELECT * FROM users WHERE id=?').get(userId) as Row) || null;
}
function tokenFresh(payload: any, user: Row): boolean {
  return Number(payload.tv || 0) === Number(user.token_version || 0);
}

/** Ném lỗi HTTP (bắt ở middleware lỗi tập trung). */
export class HttpError extends Error {
  status: number; detail: any;
  constructor(status: number, detail: any) { super(typeof detail === 'string' ? detail : 'error'); this.status = status; this.detail = detail; }
}

// Gắn user đã xác thực vào req
declare global { namespace Express { interface Request { user?: Row; } } }

export function currentUser(req: Request): Row {
  const token = extractToken(req);
  const payload = token ? decodeToken(token) : null;
  if (!payload || payload.typ) throw new HttpError(401, 'Chưa đăng nhập hoặc phiên đã hết hạn');
  const user = loadUser(payload.sub);
  if (!user) throw new HttpError(401, 'Tài khoản không tồn tại');
  if (!tokenFresh(payload, user)) throw new HttpError(401, 'Phiên đã hết hạn — đăng nhập lại');
  return user;
}
export function optionalUser(req: Request): Row | null {
  const token = extractToken(req);
  const payload = token ? decodeToken(token) : null;
  if (!payload || payload.typ) return null;
  const user = loadUser(payload.sub);
  if (user && !tokenFresh(payload, user)) return null;
  return user;
}

// ---- RBAC middleware ----
export const STAFF_ROLES = ['admin', 'manager', 'uploader'];
export const MANAGER_ROLES = ['admin', 'manager'];
export const isManager = (u: Row): boolean => MANAGER_ROLES.includes(u.role);

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  try { req.user = currentUser(req); next(); } catch (e) { next(e); }
};
export const requireStaff = (req: Request, _res: Response, next: NextFunction) => {
  try { const u = currentUser(req); if (!STAFF_ROLES.includes(u.role)) throw new HttpError(403, 'Cần quyền quản trị nội dung'); req.user = u; next(); } catch (e) { next(e); }
};
export const requireManager = (req: Request, _res: Response, next: NextFunction) => {
  try { const u = currentUser(req); if (!MANAGER_ROLES.includes(u.role)) throw new HttpError(403, 'Cần quyền quản lý phát hành'); req.user = u; next(); } catch (e) { next(e); }
};
export const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
  try { const u = currentUser(req); if (u.role !== 'admin') throw new HttpError(403, 'Cần quyền quản trị'); req.user = u; next(); } catch (e) { next(e); }
};
export const attachOptionalUser = (req: Request, _res: Response, next: NextFunction) => {
  req.user = optionalUser(req) || undefined; next();
};
