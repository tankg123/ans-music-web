# 🎵 ANS Music — Backend Node.js + Frontend React (tách rời)

Nền tảng nghe nhạc (chuẩn DDEX) gồm **2 phần độc lập**, liên kết qua HTTP + API key:

```
ANS_web_music/
├── backend/        API Node.js (Express + TypeScript + better-sqlite3)  → http://localhost:4039/api
│   ├── src/        (config, db, security, routes/, services…)
│   ├── data/       SQLite DB + secret.key (dữ liệu — không commit)
│   ├── media/      audio / covers / brand / sftp… (nhạc — không commit)
│   └── .env        cấu hình backend (API key, port, SMTP, SFTP…)
├── frontend/       Giao diện React (Vite + TypeScript)                    → http://localhost:5300
│   ├── src/        (api.ts, player, pages/, admin/, components/)
│   └── .env        VITE_API_URL + VITE_BACKEND_API_KEY
├── legacy-python/  Bản Python cũ (tham chiếu — có thể xóa)
├── samples/ddex/   file ERN mẫu
└── package.json    script chạy nhanh
```

## 🚀 Chạy

```bash
# 1. Cài dependencies (backend + frontend)
npm run setup

# 2a. Chạy CẢ HAI cùng lúc (2 tiến trình)
npm run dev

# 2b. — hoặc 2 cửa sổ terminal riêng —
npm run backend     # API   → http://localhost:4039/api
npm run frontend    # React → http://localhost:5300
```
Yêu cầu: **Node 18+**, **ffmpeg** trong PATH. Mở **http://localhost:5300**.
> Cổng frontend cố định **5300** (`strictPort`) để không đụng cổng mặc định 5173 của các dự án Vite/Electron khác trên máy.

### 📱 Truy cập từ điện thoại / máy khác cùng mạng LAN
Cả backend (`0.0.0.0:4039`) và frontend (`host:true`, `:5300`) đã lắng nghe trên mọi IP.
1. Xem IP LAN của máy chủ: `ipconfig` (mục **IPv4 Address**, ví dụ `192.168.1.179`).
2. Trên điện thoại (cùng Wi‑Fi/LAN) mở: **`http://<IP-LAN>:5300`** (vd `http://192.168.1.179:5300`).
3. Frontend **tự trỏ API sang đúng IP đang mở** (không cần sửa `VITE_API_URL`) — điện thoại gọi backend `:4039` qua chính IP đó.
4. Nếu không vào được: mở **Windows Firewall** cho cổng `4039` và `5300` (Private/Public), và chắc chắn 2 thiết bị cùng mạng, router không bật *AP/Client Isolation*.

## 🔗 Kết nối backend ↔ frontend

Frontend gọi backend qua biến trong **`frontend/.env`** (bạn chỉnh được):
```
VITE_API_URL=http://localhost:4039/api
VITE_BACKEND_API_KEY=<api-key-của-bạn>
```
- Mọi request kèm header `X-API-Key: <VITE_BACKEND_API_KEY>`; backend từ chối 401 nếu sai.
- Đổi API key: sửa **`ANS_API_KEY`** trong `backend/.env` **và** `VITE_BACKEND_API_KEY` trong `frontend/.env` cho khớp, rồi khởi động lại.
- Đổi cổng backend: `ANS_PORT` trong `backend/.env` + cập nhật `VITE_API_URL`.
- Media/nhạc phục vụ tại `…/api/media/…`, streaming (HTTP Range + signed URL) tại `…/api/stream/…`.

## 🔐 backend/.env (bạn quản lý)

`ANS_SECRET_KEY` (ký JWT + signed URL), `ANS_API_KEY=<api-key-của-bạn>` (phải khớp `VITE_BACKEND_API_KEY`), `ANS_PORT=4039`,
tài khoản admin khởi tạo, `ANS_ALLOWED_ORIGINS` (CORS — trống = cho mọi origin, siết bằng
domain khi lên production), SMTP (gửi mã xác thực/đặt lại mật khẩu), SFTP DDEX
(`ANS_SFTP_ENABLED`, `ANS_SFTP_PORT`…). `.env`, `data/`, `media/` đã nằm trong `.gitignore`.

**Tài khoản admin khởi tạo:** đặt qua `ANS_ADMIN_EMAIL` / `ANS_ADMIN_PASSWORD` trong `backend/.env`.

## ✨ Tính năng

Nghe nhạc (player toàn cục, tua/next/prev, waveform), tìm kiếm tiếng Việt không dấu, Album/Nghệ sĩ,
Thư viện/Playlist, Hồ sơ cá nhân (avatar, đổi mật khẩu, **2FA TOTP** Google Authenticator),
đăng ký xác thực email + quên mật khẩu. **Admin CMS** (Products/Bài hát/Nghệ sĩ/Labels/Duyệt/
Kho mã UPC-ISRC/DDEX/Đối tác/Distributions/Tài khoản/Cài đặt) với phân quyền uploader/manager/admin.
**DDEX Ingestion**: import ERN XML + **SFTP kiểu YouTube** (đối tác push bằng SSH key vào dropbox,
watcher tự nạp + khớp role XML→metadata).

## 🚢 Triển khai
- **Backend**: `npm --prefix backend run build` → chạy `node backend/dist/index.js` (systemd). Mở cổng 4039 (+ cổng SFTP nếu bật).
- **Frontend**: `npm --prefix frontend run build` → thư mục `frontend/dist` (deploy lên nginx/CDN tĩnh). Đặt `VITE_API_URL` trỏ tới domain backend, đặt `ANS_ALLOWED_ORIGINS` ở backend = domain frontend.
