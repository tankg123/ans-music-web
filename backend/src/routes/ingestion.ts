/** /ingestion/v1 — kênh ingestion cho đối tác (distributor/label).
 *  Port 1:1 từ backend/app/routers/ingestion.py.
 *
 *  Đối tác được cấp API key trong Admin CMS → bắn DDEX ERN XML thẳng vào:
 *    POST /ingestion/v1/deliveries   (header X-API-Key, body = XML raw)
 *    GET  /ingestion/v1/deliveries/:id/status
 *  Auto-publish hay vào Review Queue tùy cấu hình từng đối tác.
 *
 *  LƯU Ý: app.ts đã BỎ QUA express.json cho /ingestion → route POST tự parse
 *  raw body bằng express.raw (type match mọi content-type). Chỉ đối tác channel='api'.
 */
import express, { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';

import { db, type Row } from '../db.js';
import { importDelivery } from '../ddex.js';
import { HttpError } from '../security.js';

const router = Router();

const MAX_XML_BYTES = 20 * 1024 * 1024;
// Giới hạn cao hơn MAX_XML_BYTES một chút để check thủ công (413 kèm message chuẩn)
// vẫn chạy cho payload 20–25MB; trên 25MB thì raw-body chặn sớm.
const rawXml = express.raw({ type: '*/*', limit: '25mb' });

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

function authPartner(apiKey: string | undefined): Row {
  if (!apiKey) throw new HttpError(401, 'Thiếu header X-API-Key');
  // chỉ đối tác kênh API — SFTP distribution KHÔNG dùng api_key (cột chỉ để NOT NULL)
  const row = db.prepare(
    'SELECT * FROM delivery_partners WHERE api_key_hash=? '
    + "AND (delivery_channel IS NULL OR delivery_channel='api')",
  ).get(hashApiKey(apiKey)) as Row | undefined;
  if (!row) throw new HttpError(401, 'API key không hợp lệ');
  return row;
}

router.post('/deliveries', rawXml, (req: Request, res: Response) => {
  const partner = authPartner(req.header('X-API-Key') || undefined);
  const xmlBytes = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
  if (!xmlBytes.length) {
    throw new HttpError(400, 'Body rỗng — gửi DDEX ERN XML trực tiếp trong body');
  }
  if (xmlBytes.length > MAX_XML_BYTES) {
    throw new HttpError(413, 'XML quá lớn (tối đa 20MB)');
  }
  const report = importDelivery(xmlBytes, {
    autoPublish: Boolean(partner.auto_publish),
    partner: partner as any,
  });
  res.status(201).json({
    delivery_id: report.delivery_id,
    status: report.status,
    releases: report.releases ?? [],
    tracks: report.tracks ?? [],
    log: report.log ?? [],
  });
});

router.get('/deliveries/:delivery_id/status', (req: Request, res: Response) => {
  const partner = authPartner(req.header('X-API-Key') || undefined);
  const row = db.prepare(
    'SELECT id, message_id, message_type, ern_version, status, log, '
    + 'received_at, processed_at FROM deliveries WHERE id=? AND partner_id=?',
  ).get(req.params.delivery_id, partner.id) as Row | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy delivery của bạn');
  res.json(row);
});

export default router;
