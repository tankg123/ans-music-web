import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend TÁCH RỜI: frontend gọi trực tiếp VITE_API_URL (http://localhost:4039/api)
// với header X-API-Key (CORS đã mở ở backend) → KHÔNG cần proxy.
// Cổng 5300 riêng (tránh đụng cổng mặc định 5173 của các dự án Vite/Electron khác).
// strictPort: nếu 5300 bận thì báo lỗi ngay thay vì âm thầm nhảy cổng.
export default defineConfig({
  plugins: [react()],
  server: { port: 5300, strictPort: true, host: true },
  build: { outDir: 'dist', sourcemap: false },
});
