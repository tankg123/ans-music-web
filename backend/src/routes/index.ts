/** Mount toàn bộ router dưới prefix /api (frontend gọi qua VITE_API_URL). */
import type { Express } from 'express';
import { API_PREFIX } from '../config.js';
import { getBrand } from '../branding.js';
import authRouter from './auth.js';
import catalogRouter from './catalog.js';
import meRouter from './me.js';
import playbackRouter from './playback.js';
import settingsRouter from './settings.js';
import ingestionRouter from './ingestion.js';
import productsRouter from './products.js';
import adminRouter from './admin.js';

export function registerRoutes(app: Express): void {
  const p = API_PREFIX;
  // brand công khai (frontend nạp lúc khởi động — thay window.ANS_CFG cũ)
  app.get(`${p}/v1/brand`, (_req, res) => res.json(getBrand()));

  app.use(`${p}/v1/auth`, authRouter);
  app.use(`${p}/v1/me`, meRouter);
  app.use(`${p}/v1`, catalogRouter);                 // /home /search /tracks /albums /artists…
  app.use(`${p}/ingestion/v1`, ingestionRouter);
  app.use(`${p}/admin/v1/products`, productsRouter); // cụ thể
  app.use(`${p}/admin/v1/settings`, settingsRouter); // cụ thể
  app.use(`${p}/admin/v1`, adminRouter);             // tổng quát
  app.use(`${p}`, playbackRouter);                   // /api/v1/playback /api/stream /api/download
}
