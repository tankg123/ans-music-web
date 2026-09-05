/** Điểm khởi động server ANS Music (Node). */
import os from 'node:os';
import { createApp, serveMedia, errorHandler } from './app.js';
import { initDb } from './db.js';
import { HOST, PORT, APP_VERSION, API_PREFIX } from './config.js';
import { registerRoutes } from './routes/index.js';
import { seedIfEmpty } from './seed.js';

function lanIp(): string {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const a of iface || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

async function main() {
  initDb();
  seedIfEmpty();

  const app = createApp();
  registerRoutes(app);   // mount /api/v1, /api/admin/v1, /api/stream, /api/download, /api/ingestion
  serveMedia(app);       // /api/media/covers|brand|avatars|artists
  app.use(errorHandler);

  const ip = lanIp();
  const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║     ANS MUSIC — BACKEND API (Node) v' + APP_VERSION + '      ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log(`  * API      : http://127.0.0.1:${PORT}${API_PREFIX}`);
    if (HOST === '0.0.0.0') console.log(`  * LAN      : http://${ip}:${PORT}${API_PREFIX}`);
    console.log(`  * Frontend : chạy riêng (frontend/, Vite) — trỏ VITE_API_URL vào đây`);
    console.log('');
  });

  // SFTP DDEX ingestion (bật bằng ANS_SFTP_ENABLED=true)
  const { startSftp } = await import('./sftp.js');
  await startSftp();

  return server;
}

main().catch((e) => { console.error('Khởi động thất bại:', e); process.exit(1); });
