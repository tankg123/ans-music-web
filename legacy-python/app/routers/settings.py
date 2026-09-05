"""Cài đặt thương hiệu (Admin) — đổi tên web, logo, màu, tagline."""
import re
import secrets
import shutil
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..branding import BRAND_DEFAULTS, EDITABLE, get_brand
from ..config import BRAND_DIR
from ..db import get_db, set_setting
from ..security import require_admin

router = APIRouter(prefix="/admin/v1/settings", tags=["settings"],
                   dependencies=[Depends(require_admin)])

ACCENT_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
LOGO_EXTS = (".svg", ".png", ".jpg", ".jpeg", ".webp")


class BrandBody(BaseModel):
    brand_name: Optional[str] = None
    brand_short: Optional[str] = None
    brand_suffix: Optional[str] = None
    brand_tagline: Optional[str] = None
    brand_accent: Optional[str] = None


@router.get("/brand")
def read_brand(conn: sqlite3.Connection = Depends(get_db)):
    return get_brand(conn)


@router.patch("/brand")
def update_brand(body: BrandBody, conn: sqlite3.Connection = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "brand_accent" in data and data["brand_accent"]:
        if not ACCENT_RE.match(data["brand_accent"]):
            raise HTTPException(400, "Màu accent phải dạng hex #RRGGBB")
    if "brand_name" in data and not (data["brand_name"] or "").strip():
        raise HTTPException(400, "Tên web không được để trống")
    for key, val in data.items():
        if key not in EDITABLE:
            continue
        # ép về 1 dòng: brand_name đi vào Subject email — ký tự xuống dòng
        # (CR/LF/U+2028/U+2029) làm EmailMessage raise ValueError → sập đăng ký
        clean = re.sub("[\r\n\u2028\u2029]+", " ", val or "").strip()
        set_setting(conn, key, clean)
    return {"ok": True, "brand": get_brand(conn)}


@router.post("/logo")
async def upload_logo(file: UploadFile = File(...),
                      conn: sqlite3.Connection = Depends(get_db)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in LOGO_EXTS:
        raise HTTPException(400, "Logo chỉ nhận SVG/PNG/JPG/WebP (khuyến nghị vuông, nền trong)")
    # tên có hash ngẫu nhiên → URL đổi mỗi lần upload → cache dài mà không bị kẹt logo cũ
    fname = f"logo_{secrets.token_hex(6)}{ext}"
    dest = BRAND_DIR / fname
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    # dọn logo cũ (giữ lại đúng file mới)
    for old in BRAND_DIR.glob("logo_*"):
        if old.name != fname:
            old.unlink(missing_ok=True)
    url = f"/media/brand/{fname}"
    set_setting(conn, "brand_logo_url", url)
    return {"ok": True, "brand_logo_url": url}


@router.post("/reset")
def reset_brand(conn: sqlite3.Connection = Depends(get_db)):
    """Về mặc định (xóa mọi tùy chỉnh brand)."""
    for key in EDITABLE:
        conn.execute("DELETE FROM app_settings WHERE key=?", (key,))
    for old in BRAND_DIR.glob("logo_*"):
        old.unlink(missing_ok=True)
    return {"ok": True, "brand": BRAND_DEFAULTS}
