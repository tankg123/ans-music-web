"""Khởi động ANS Music.

Mặc định lắng nghe trên MỌI card mạng (0.0.0.0) để điện thoại/thiết bị khác
CÙNG MẠNG LAN truy cập được qua http://<IP-LAN>:8000
Chỉ muốn giới hạn localhost: đặt biến môi trường ANS_HOST=127.0.0.1
"""
import os
import socket
import sys
from pathlib import Path

# Console Windows mặc định cp1252 — ép UTF-8 để in được tiếng Việt
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

# Code server nằm trong backend/ — thêm vào sys.path để import "app.main"
_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_ROOT / "backend"))

# Nạp .env TRƯỚC khi đọc ANS_HOST/ANS_PORT — không thì 2 biến này trong .env
# bị bỏ qua (app.config chỉ load .env sau, lúc uvicorn đã bind cổng rồi)
try:
    from dotenv import load_dotenv
    load_dotenv(_ROOT / ".env")
except ImportError:
    pass

import uvicorn  # noqa: E402


def lan_ip() -> str:
    """IP LAN chính (interface dùng để ra ngoài)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    host = os.environ.get("ANS_HOST", "0.0.0.0").strip() or "0.0.0.0"
    try:
        port = int((os.environ.get("ANS_PORT") or "8000").strip())
    except ValueError:
        port = 8000
    ip = lan_ip()

    print()
    print("  ╔══════════════════════════════════════════════════╗")
    print("  ║              ANS MUSIC đang chạy                 ║")
    print("  ╚══════════════════════════════════════════════════╝")
    print(f"  * Trên máy này   : http://127.0.0.1:{port}")
    if host == "0.0.0.0":
        print(f"  * ĐIỆN THOẠI/LAN : http://{ip}:{port}")
        print(f"  * Admin (LAN)    : http://{ip}:{port}/admin")
        print()
        print("  → Điện thoại cùng WiFi/mạng LAN mở trình duyệt gõ:")
        print(f"        http://{ip}:{port}")
    else:
        print(f"  * Admin CMS      : http://127.0.0.1:{port}/admin")
    print(f"  * API docs       : http://127.0.0.1:{port}/docs")
    print()
    uvicorn.run("app.main:app", host=host, port=port, log_level="info")
