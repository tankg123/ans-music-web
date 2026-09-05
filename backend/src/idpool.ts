/** Kho mã định danh UPC/ISRC — label nhập dải mã thật (tay hoặc file .txt),
 *  hệ thống cấp phát dần khi phát hành; hết kho thì tự sinh nếu được bật.
 *  Port 1:1 backend/app/idpool.py (better-sqlite3 đồng bộ, dùng db trực tiếp). */
import { db, getSetting, type Row } from './db.js';
import { HttpError } from './security.js';

export const AUTO_KEYS: Record<string, string> = {
  isrc: 'auto_generate_isrc',
  upc: 'auto_generate_upc',
};

export function autoEnabled(kind: string): boolean {
  return getSetting(AUTO_KEYS[kind], '1') === '1';
}

export function poolCounts(kind: string): { available: number; used: number } {
  const row = db.prepare(
    "SELECT SUM(status='available') AS avail, SUM(status='used') AS used " +
    'FROM id_pool WHERE kind=?',
  ).get(kind) as Row;
  return { available: row.avail || 0, used: row.used || 0 };
}

/** Lấy tối đa `count` mã available từ kho (đánh dấu used ngay).
 *
 *  Mã trùng exclude hoặc đã lỡ tồn tại trong catalog sẽ bị đánh dấu used
 *  (dọn kho) và bỏ qua. */
export function poolTake(kind: string, count: number, exclude?: Set<string>): string[] {
  const ex = exclude || new Set<string>();
  const taken: string[] = [];
  const rows = db.prepare(
    "SELECT id, code FROM id_pool WHERE kind=? AND status='available' " +
    'ORDER BY added_at, code',
  ).all(kind) as Row[];
  const [table, col] = kind === 'isrc' ? ['tracks', 'isrc'] : ['releases', 'upc'];
  const catalogHit = db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`);
  const markUsed = db.prepare(
    "UPDATE id_pool SET status='used', used_at=datetime('now') WHERE id=?",
  );
  for (const r of rows) {
    if (taken.length >= count) break;
    const code = r.code;
    if (ex.has(code)) continue;
    if (catalogHit.get(code)) {
      // mã trong kho nhưng catalog đã dùng (nhập tay trước đó) → dọn
      markUsed.run(r.id);
      continue;
    }
    markUsed.run(r.id);
    taken.push(code);
  }
  return taken;
}

/** Bất kỳ mã nào được gán vào catalog (kể cả nhập tay/tự sinh) nếu nằm
 *  trong kho thì cập nhật trạng thái — kho luôn phản ánh đúng thực tế. */
export function markCodeUsed(kind: string, code: string, usedBy: string): void {
  db.prepare(
    "UPDATE id_pool SET status='used', used_at=datetime('now'), used_by=? " +
    'WHERE kind=? AND code=?',
  ).run(usedBy, kind, code);
}

export function poolExhaustedError(kind: string): HttpError {
  const label = kind === 'isrc' ? 'ISRC' : 'UPC';
  return new HttpError(
    409,
    `Kho mã ${label} đã hết và chế độ tự sinh đang TẮT — ` +
    `thêm mã trong Admin → Kho mã, hoặc bật tự sinh.`,
  );
}
