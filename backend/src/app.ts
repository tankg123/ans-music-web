/** Express app (API-only, tách rời frontend) — CORS + API key gate + media.
 *  Frontend React gọi qua VITE_API_URL=http://host:PORT/api với header X-API-Key. */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import {
  API_KEY, ALLOWED_ORIGINS, API_PREFIX, APP_VERSION, COVER_DIR, BRAND_DIR,
  AVATAR_DIR, ARTIST_IMG_DIR,
} from './config.js';
import { HttpError } from './security.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // CORS: frontend là origin KHÁC (Vite :5300 / domain riêng). Auth bằng API key +
  // Bearer token (không cookie) nên phản chiếu origin an toàn; siết bằng
  // ANS_ALLOWED_ORIGINS nếu muốn.
  app.use(cors({
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['X-API-Key', 'Content-Type', 'Authorization', 'Range'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  }));

  // ---- API KEY gate: mọi API JSON (/api/v1, /api/admin/v1) phải kèm X-API-Key ----
  const V1 = `${API_PREFIX}/v1/`;
  const ADMIN = `${API_PREFIX}/admin/v1/`;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (API_KEY && (p.startsWith(V1) || p.startsWith(ADMIN))) {
      if (req.method !== 'OPTIONS' && req.header('X-API-Key') !== API_KEY) {
        return res.status(401).json({ detail: 'Thiếu hoặc sai API key (X-API-Key)' });
      }
    }
    next();
  });

  // JSON body (trừ /ingestion nhận XML raw — router tự xử lý)
  app.use((req, res, next) => {
    if (req.path.startsWith(`${API_PREFIX}/ingestion/`)) return next();
    express.json({ limit: '2mb' })(req, res, next);
  });

  const health = (_req: Request, res: Response) => res.json({ status: 'ok', version: APP_VERSION });
  app.get('/health', health);
  app.get(`${API_PREFIX}/health`, health);
  return app;
}

/** Phục vụ media công khai (cover/brand/avatar/artist) dưới /api/media — cache 1 ngày. */
export function serveMedia(app: express.Express): void {
  const p = API_PREFIX;
  const opts = { maxAge: '1d' };
  app.use(`${p}/media/covers`, express.static(COVER_DIR, opts));
  app.use(`${p}/media/brand`, express.static(BRAND_DIR, opts));
  app.use(`${p}/media/avatars`, express.static(AVATAR_DIR, opts));
  app.use(`${p}/media/artists`, express.static(ARTIST_IMG_DIR, opts));
}

/** Middleware lỗi tập trung. */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) { res.status(err.status).json({ detail: err.detail }); return; }
  if (err && err.type === 'entity.too.large') { res.status(413).json({ detail: 'Dữ liệu quá lớn' }); return; }
  console.error('[error]', err);
  res.status(500).json({ detail: 'Lỗi máy chủ' });
}
