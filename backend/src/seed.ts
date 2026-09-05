/** Seed — bản Node DÙNG LẠI DB cũ (đã có nhạc + tài khoản) nên chỉ đảm bảo có
 *  admin. Nếu DB trắng hoàn toàn: tạo admin từ .env (nhạc demo giữ ở bản Python). */
import { db, newId } from './db.js';
import { hashPassword } from './security.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './config.js';

export function seedIfEmpty(): void {
  const admin = db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get();
  if (!admin) {
    const exists = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL) as any;
    if (exists) {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(exists.id);
    } else {
      db.prepare(
        "INSERT INTO users(id,email,password_hash,display_name,role,plan,email_verified) VALUES(?,?,?,?,?,?,1)")
        .run(newId(), ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), 'Admin', 'admin', 'premium');
      console.log(`[seed] Đã tạo admin: ${ADMIN_EMAIL}`);
    }
  }
  const nTracks = (db.prepare('SELECT COUNT(*) n FROM tracks').get() as any).n;
  console.log(`[seed] DB sẵn sàng — ${nTracks} track trong catalog.`);
}
