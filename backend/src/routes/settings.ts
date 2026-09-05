/** /admin/v1/settings — cài đặt thương hiệu (Admin): đổi tên web, logo, màu, tagline.
 *  Port 1:1 từ backend/app/routers/settings.py. Toàn bộ route yêu cầu quyền admin. */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { BRAND_DEFAULTS, BRAND_EDITABLE, getBrand } from '../branding.js';
import { BRAND_DIR } from '../config.js';
import { setSetting, db } from '../db.js';
import { HttpError, requireAdmin } from '../security.js';

const router = Router();
router.use(requireAdmin); // dependencies=[Depends(require_admin)] cho cả router

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const LOGO_EXTS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const FAVICON_EXTS = new Set(['.ico', '.png', '.svg', '.jpg', '.jpeg', '.webp']);
// Ký tự xuống dòng cần ép về 1 dòng: CR (0x0d), LF (0x0a), LINE SEP (U+2028),
// PARAGRAPH SEP (U+2029). Dựng bằng char code để tránh literal line-terminator trong source.
const NEWLINE_RE = new RegExp('[' + String.fromCharCode(0x0d, 0x0a, 0x2028, 0x2029) + ']+', 'g');
// Chỉ các field của BrandBody bên Python (exclude_unset) — không nhận key lạ.
const BRAND_BODY_KEYS = ['brand_name', 'brand_short', 'brand_suffix', 'brand_tagline', 'brand_accent'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.get('/brand', (_req: Request, res: Response) => {
  res.json(getBrand());
});

router.patch('/brand', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, any>;
  // exclude_unset: chỉ giữ field client gửi trong số các field hợp lệ
  const data: Record<string, any> = {};
  for (const k of BRAND_BODY_KEYS) if (k in body) data[k] = body[k];

  if ('brand_accent' in data && data.brand_accent) {
    if (!ACCENT_RE.test(String(data.brand_accent))) {
      throw new HttpError(400, 'Màu accent phải dạng hex #RRGGBB');
    }
  }
  if ('brand_name' in data && !String(data.brand_name ?? '').trim()) {
    throw new HttpError(400, 'Tên web không được để trống');
  }
  for (const [key, val] of Object.entries(data)) {
    if (!BRAND_EDITABLE.has(key)) continue;
    // ép về 1 dòng: brand_name đi vào Subject email — ký tự xuống dòng
    // (CR/LF/U+2028/U+2029) làm email raise → sập đăng ký
    const clean = String(val ?? '').replace(NEWLINE_RE, ' ').trim();
    setSetting(key, clean);
  }
  res.json({ ok: true, brand: getBrand() });
});

router.post('/logo', upload.single('file'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Thiếu file logo');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!LOGO_EXTS.has(ext)) {
    throw new HttpError(400, 'Logo chỉ nhận SVG/PNG/JPG/WebP (khuyến nghị vuông, nền trong)');
  }
  // tên có hash ngẫu nhiên → URL đổi mỗi lần upload → cache dài mà không kẹt logo cũ
  const fname = `logo_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const dest = path.join(BRAND_DIR, fname);
  fs.writeFileSync(dest, file.buffer);
  // dọn logo cũ (giữ lại đúng file mới)
  for (const old of listLogoFiles()) {
    if (old !== fname) {
      try { fs.unlinkSync(path.join(BRAND_DIR, old)); } catch { /* missing_ok */ }
    }
  }
  const url = `/media/brand/${fname}`;
  setSetting('brand_logo_url', url);
  res.json({ ok: true, brand_logo_url: url });
});

router.post('/favicon', upload.single('file'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Thiếu file favicon');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!FAVICON_EXTS.has(ext)) {
    throw new HttpError(400, 'Favicon chỉ nhận ICO/PNG/SVG/JPG/WebP (khuyến nghị vuông 32×32 hoặc 64×64)');
  }
  // tên có hash → URL đổi mỗi lần upload → trình duyệt tự nạp favicon mới, không kẹt cache
  const fname = `favicon_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const dest = path.join(BRAND_DIR, fname);
  fs.writeFileSync(dest, file.buffer);
  for (const old of listFaviconFiles()) {
    if (old !== fname) {
      try { fs.unlinkSync(path.join(BRAND_DIR, old)); } catch { /* missing_ok */ }
    }
  }
  const url = `/media/brand/${fname}`;
  setSetting('brand_favicon_url', url);
  res.json({ ok: true, brand_favicon_url: url });
});

router.post('/reset', (_req: Request, res: Response) => {
  // Về mặc định (xóa mọi tùy chỉnh brand).
  const del = db.prepare('DELETE FROM app_settings WHERE key=?');
  for (const key of BRAND_EDITABLE) del.run(key);
  for (const old of [...listLogoFiles(), ...listFaviconFiles()]) {
    try { fs.unlinkSync(path.join(BRAND_DIR, old)); } catch { /* missing_ok */ }
  }
  res.json({ ok: true, brand: BRAND_DEFAULTS });
});

/** Danh sách file logo_* trong BRAND_DIR (tương đương BRAND_DIR.glob('logo_*')). */
function listLogoFiles(): string[] {
  try {
    return fs.readdirSync(BRAND_DIR).filter(n => n.startsWith('logo_'));
  } catch {
    return [];
  }
}

/** Danh sách file favicon_* trong BRAND_DIR. */
function listFaviconFiles(): string[] {
  try {
    return fs.readdirSync(BRAND_DIR).filter(n => n.startsWith('favicon_'));
  } catch {
    return [];
  }
}

export default router;
