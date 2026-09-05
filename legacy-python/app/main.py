"""ANS Music — FastAPI app chính: API + phục vụ web app & admin CMS."""
import asyncio
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

# An toàn khi chạy trực tiếp `uvicorn app.main:app` trên console cp1252
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from .branding import get_brand
from .config import (ALLOWED_ORIGINS, API_KEY, APP_NAME, APP_VERSION,
                     ARTIST_IMG_DIR, AVATAR_DIR, BRAND_DIR, COVER_DIR,
                     STATIC_DIR)
from .db import connect, get_conn, init_db
from .publisher import run_publisher
from .routers import (admin, auth_routes, catalog, ingestion, me, playback,
                      products, settings, studio)
from .routers.studio import cleanup_staging
from .seed import seed_if_empty


async def _publisher_loop():
    """Phát hành release hẹn giờ — kiểm tra mỗi 60s."""
    while True:
        try:
            with get_conn() as conn:
                n = run_publisher(conn)
                if n:
                    print(f"[publisher] Đã phát hành {n} release tới hạn")
        except Exception as e:
            print(f"[publisher] lỗi: {e}")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_if_empty()
    cleanup_staging()
    tasks = [asyncio.create_task(_publisher_loop())]
    # SFTP DDEX ingestion (kiểu YouTube) — chỉ chạy khi bật trong .env
    from .config import SFTP_ENABLED
    sftp_server = None
    if SFTP_ENABLED:
        from .sftp_server import start_sftp_server, stop_sftp_server
        from .sftp_watcher import sftp_watch_loop
        sftp_server = await start_sftp_server()
        tasks.append(asyncio.create_task(sftp_watch_loop()))
    yield
    for t in tasks:
        t.cancel()
    if sftp_server is not None:
        from .sftp_server import stop_sftp_server
        stop_sftp_server()


app = FastAPI(
    title=APP_NAME,
    description="Nền tảng nghe nhạc trực tuyến — metadata chuẩn DDEX "
                "(xem tài liệu ý tưởng: y-tuong-web-nghe-nhac-ddex.md)",
    version=APP_VERSION,
    lifespan=lifespan,
)

class SelectiveGZipMiddleware(GZipMiddleware):
    """Không nén audio stream (phá Range/206) và media tĩnh (đã nén sẵn)."""

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith(("/stream/", "/media/")):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


# ---- API KEY gate: mọi API JSON (/v1, /admin/v1) phải kèm header X-API-Key ----
# KHÔNG áp cho: trang HTML, static, ảnh bìa, /stream & /download (đã có signed URL,
# lại được <audio>/<img>/location tải nên không gửi header được), /ingestion (đối tác
# dùng khóa riêng), /health, /docs.
_API_PREFIXES = ("/v1/", "/admin/v1/")


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if API_KEY and any(path.startswith(p) for p in _API_PREFIXES):
            if request.method != "OPTIONS":  # cho phép CORS preflight
                if request.headers.get("X-API-Key", "") != API_KEY:
                    return JSONResponse(
                        {"detail": "Thiếu hoặc sai API key (X-API-Key)"}, status_code=401)
        return await call_next(request)


app.add_middleware(SelectiveGZipMiddleware, minimum_size=1024)
app.add_middleware(ApiKeyMiddleware)
# CORS: chỉ origin trong ALLOWED_ORIGINS (từ .env). Rỗng = same-origin duy nhất
# → trang lạ không đọc được HTML/API key và không replay được cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["X-API-Key", "Content-Type", "Authorization"],
)


@app.middleware("http")
async def cache_headers(request, call_next):
    """Tối ưu tải lại: asset tĩnh (JS/CSS/logo/icon) cache DÀI vì đã đánh version
    qua ?v= — đổi bản thì URL đổi, tự lấy mới. Trang HTML luôn no-cache (chứa
    API key + brand tiêm động). Ảnh bìa/logo brand cache 1 ngày."""
    response = await call_next(request)
    path = request.url.path
    if response.status_code in (200, 304) and "cache-control" not in response.headers:
        if path.startswith(("/media/covers/", "/media/brand/",
                            "/media/avatars/", "/media/artists/")):
            response.headers["Cache-Control"] = "public, max-age=86400"
        elif path.startswith("/static/"):
            # 7 ngày; JS/CSS busting bằng ?v=, asset khác đổi hiếm
            response.headers["Cache-Control"] = "public, max-age=604800"
        elif path in ("/", "/admin", "/login", "/admin/login"):
            response.headers["Cache-Control"] = "no-cache"
    return response


app.include_router(auth_routes.router)
app.include_router(catalog.router)
app.include_router(me.router)
app.include_router(playback.router)
app.include_router(admin.router)
app.include_router(products.router)
app.include_router(settings.router)
app.include_router(studio.router)
app.include_router(ingestion.router)

# CHỈ phục vụ ảnh bìa + logo brand công khai — audio gốc chỉ đi qua /stream
# (signed URL), XML delivery không bao giờ được serve trực tiếp.
app.mount("/media/covers", StaticFiles(directory=COVER_DIR), name="covers")
app.mount("/media/brand", StaticFiles(directory=BRAND_DIR), name="brand")
app.mount("/media/avatars", StaticFiles(directory=AVATAR_DIR), name="avatars")
app.mount("/media/artists", StaticFiles(directory=ARTIST_IMG_DIR), name="artist_imgs")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


import json as _json


def _json_for_script(obj) -> str:
    """JSON an toàn để nhúng vào <script> — chặn thoát khỏi thẻ script."""
    return (_json.dumps(obj)
            .replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("&", "\\u0026")
            .replace(" ", "\\u2028").replace(" ", "\\u2029"))


def _brand_now() -> dict:
    conn = connect()
    try:
        return get_brand(conn)
    finally:
        conn.close()


def _serve_html(filename: str) -> HTMLResponse:
    """Đọc HTML và tiêm cấu hình (API key + brand) vào <head> — áp dụng brand
    tức thì lúc tải trang, không tốn request phụ, không nháy giao diện mặc định."""
    html = (STATIC_DIR / filename).read_text(encoding="utf-8")
    payload = {"apiKey": API_KEY, "brand": _brand_now(), "version": APP_VERSION}
    cfg = f'<script>window.ANS_CFG={_json_for_script(payload)};</script>'
    if "</head>" in html:
        html = html.replace("</head>", cfg + "</head>", 1)
    else:
        html = cfg + html
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/", include_in_schema=False)
def index():
    return _serve_html("index.html")


@app.get("/admin", include_in_schema=False)
def admin_page():
    return _serve_html("admin.html")


@app.get("/login", include_in_schema=False)
@app.get("/admin/login", include_in_schema=False)
def login_page():
    return _serve_html("login.html")


@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    # dùng logo brand nếu đã tùy chỉnh, không thì logo mặc định
    logo = _brand_now().get("brand_logo_url", "")
    if logo.startswith("/media/brand/"):
        f = BRAND_DIR / logo.rsplit("/", 1)[-1]
        if f.is_file():
            return FileResponse(f)
    return FileResponse(STATIC_DIR / "img" / "logo.svg")


@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok", "version": APP_VERSION}
