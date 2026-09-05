"""Module Product (theo UPDATE_ADD_PRODUCT.md) — đơn vị phát hành chuyên nghiệp.

Product = 1 dòng trong bảng `releases` (không tạo schema song song) → Publish
là nhạc hiện ngay trên website. Gồm: CRUD product, tracks trong product,
contributors theo role, QC Check, Publish/Takedown + lịch sử phát hành.
"""
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..config import AUDIO_DIR, COVER_DIR, ISRC_PREFIX
from ..covers import generate_cover
from ..db import get_db, new_id
from ..idpool import auto_enabled, mark_code_used, pool_exhausted_error, pool_take
from ..publisher import run_publisher
from ..security import require_manager, require_staff
from ..utils import (clean_isrc, normalize_text, stable_seed, validate_isrc,
                     validate_upc)

# Phân quyền v2.0: mặc định require_staff (admin/manager/uploader);
# các endpoint PHÁT HÀNH (publish/approve/reject/update-release/takedown)
# nâng lên require_manager ở từng endpoint.
router = APIRouter(prefix="/admin/v1/products", tags=["products"],
                   dependencies=[Depends(require_staff)])

REQUIRED_ROLES = ["MainArtist", "Composer", "Lyricist", "MusicPublisher",
                  "Producer", "Mixer"]
OPTIONAL_ROLES = ["FeaturedArtist", "Remixer", "Performer"]
ALL_ROLES = REQUIRED_ROLES + OPTIONAL_ROLES
RELEASE_TYPES = ("Single", "EP", "Album", "Compilation")
ADVISORY = ("NotExplicit", "Explicit", "Edited")   # None / Explicit / Edited


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _get_release(conn, product_id: str):
    row = conn.execute("SELECT * FROM releases WHERE id=?", (product_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy product")
    return row


def _log_action(conn, release_id: str, action: str, actor: str,
                status: str = "success", detail: str = ""):
    conn.execute(
        "INSERT INTO release_actions(id,release_id,action,provider,status,actor_email,detail) "
        "VALUES(?,?,?,?,?,?,?)",
        (new_id(), release_id, action, "website", status, actor, detail))


def _ensure_product_access(conn, user: dict, product_id: str, write: bool = False):
    """Lấy product + kiểm tra quyền theo role (dùng chung cho mọi endpoint).

    - admin/manager: thấy và sửa tất cả.
    - uploader: CHỈ product có created_by == user.id — product của người khác
      trả 404 (không phải 403, tránh lộ sự tồn tại). Với write=True, product
      phải đang Draft: đã gửi duyệt/phát hành thì uploader không sửa được nữa
      (bị reject sẽ quay về draft → sửa tiếp được).
    """
    row = _get_release(conn, product_id)
    if user.get("role") == "uploader":
        if row["created_by"] != user["id"]:
            raise HTTPException(404, "Không tìm thấy product")
        if write and row["status"] != "draft":
            raise HTTPException(
                409, "Product đã gửi duyệt/phát hành — chỉ sửa được khi ở trạng thái Draft")
    return row


def _ensure_track_access(conn, user: dict, track_id: str, write: bool = False):
    """Scoping uploader cho endpoint thao tác thẳng track_id (không qua product):
    track phải thuộc ít nhất 1 product của uploader (khác → 404 tránh lộ tồn tại);
    write=True → product chứa track phải đang Draft."""
    if user.get("role") != "uploader":
        return
    rows = conn.execute(
        """SELECT r.status FROM release_tracks rt JOIN releases r ON r.id=rt.release_id
           WHERE rt.track_id=? AND r.created_by=?""", (track_id, user["id"])).fetchall()
    if not rows:
        raise HTTPException(404, "Không tìm thấy track")
    if write and not any(r["status"] == "draft" for r in rows):
        raise HTTPException(
            409, "Product đã gửi duyệt/phát hành — chỉ sửa được khi ở trạng thái Draft")


# ==========================================================================
# LABELS (danh mục cho select + prefix ISRC)
# ==========================================================================
class LabelBody(BaseModel):
    name: str
    isrc_prefix: Optional[str] = None
    dpid: Optional[str] = None
    c_line: Optional[str] = None
    p_line: Optional[str] = None
    right_holder: Optional[str] = None
    # v2.0: thông tin liên hệ / quản lý chuyên sâu
    contact_email: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None


# Subquery đếm dùng chung cho list + detail (giữ product_count cũ — admin.js
# đang dùng; các cột mới chỉ THÊM, không đổi shape). {scope} = lọc created_by
# cho uploader (chỉ đếm product của chính họ, không lộ số liệu người khác).
def _label_counts_sql(scope: str = "") -> str:
    return f"""
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id{scope}) AS product_count,
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id AND r.status='live'{scope}) AS live_count,
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id AND r.status='draft'{scope}) AS draft_count,
    (SELECT COUNT(*) FROM releases r WHERE r.label_id=l.id AND r.status='pending_review'{scope}) AS pending_count,
    (SELECT COUNT(*) FROM release_tracks rt JOIN releases r ON r.id=rt.release_id
     WHERE r.label_id=l.id{scope}) AS track_count"""


@router.get("/labels")
def list_labels(q: str = "", user: dict = Depends(require_staff),
                conn: sqlite3.Connection = Depends(get_db)):
    # uploader chỉ đếm product của mình (5 subquery đếm đều cần lọc created_by)
    scope, scope_args = "", []
    if user.get("role") == "uploader":
        scope = " AND r.created_by=?"
        scope_args = [user["id"]] * 5
    sql = f"SELECT l.*, {_label_counts_sql(scope)} FROM labels l"
    args: list = list(scope_args)
    if q.strip():
        sql += " WHERE l.name LIKE ?"
        args.append(f"%{q.strip()}%")
    rows = conn.execute(sql + " ORDER BY l.name", args).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/labels/{label_id}")
def label_detail(label_id: str, user: dict = Depends(require_staff),
                 conn: sqlite3.Connection = Depends(get_db)):
    """Chi tiết label + danh sách products của label + stats theo status."""
    label = conn.execute("SELECT * FROM labels WHERE id=?", (label_id,)).fetchone()
    if not label:
        raise HTTPException(404, "Không tìm thấy label")
    sql = """SELECT r.id, r.title, r.status, r.upc, r.release_type,
             (SELECT COUNT(*) FROM release_tracks rt WHERE rt.release_id=r.id) AS track_count
             FROM releases r WHERE r.label_id=?"""
    args: list = [label_id]
    # uploader chỉ thấy product CỦA MÌNH trong label (nhất quán scoping products)
    if user.get("role") == "uploader":
        sql += " AND r.created_by=?"
        args.append(user["id"])
    products = [dict(p) for p in
                conn.execute(sql + " ORDER BY r.created_at DESC", args).fetchall()]
    d = dict(label)
    d["products"] = products
    # stats tính từ chính danh sách products (đã scope theo role) → luôn khớp nhau
    d["stats"] = {
        "product_count": len(products),
        "live_count": sum(1 for p in products if p["status"] == "live"),
        "draft_count": sum(1 for p in products if p["status"] == "draft"),
        "pending_count": sum(1 for p in products if p["status"] == "pending_review"),
        "track_count": sum(p["track_count"] for p in products),
    }
    return d


def _validate_prefix(prefix: Optional[str]) -> Optional[str]:
    if not prefix:
        return None
    p = prefix.strip().upper()
    import re
    if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}", p):
        raise HTTPException(400, "ISRC prefix phải 5 ký tự: 2 chữ quốc gia + 3 mã registrant (VD: VNA0D)")
    return p


@router.post("/labels", status_code=201, dependencies=[Depends(require_manager)])
def create_label(body: LabelBody, conn: sqlite3.Connection = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(400, "Thiếu tên label")
    lid = new_id()
    conn.execute(
        "INSERT INTO labels(id,name,dpid,isrc_prefix,c_line,p_line,right_holder,"
        "contact_email,website,notes) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (lid, body.name.strip(), body.dpid, _validate_prefix(body.isrc_prefix),
         body.c_line, body.p_line, body.right_holder,
         body.contact_email, body.website, body.notes))
    return {"id": lid}


class LabelPatch(BaseModel):
    # PATCH từng phần (exclude_unset) — client cũ gửi đủ field vẫn chạy y hệt
    name: Optional[str] = None
    dpid: Optional[str] = None
    isrc_prefix: Optional[str] = None
    c_line: Optional[str] = None
    p_line: Optional[str] = None
    right_holder: Optional[str] = None
    contact_email: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/labels/{label_id}", dependencies=[Depends(require_manager)])
def update_label(label_id: str, body: LabelPatch,
                 conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM labels WHERE id=?", (label_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy label")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        if not (data["name"] or "").strip():
            raise HTTPException(400, "Tên label không được để trống")
        data["name"] = data["name"].strip()
    if "isrc_prefix" in data:
        data["isrc_prefix"] = _validate_prefix(data["isrc_prefix"])
    if not data:
        return {"ok": True}
    sets = ", ".join(f"{k}=?" for k in data)
    conn.execute(f"UPDATE labels SET {sets} WHERE id=?", [*data.values(), label_id])
    # đồng bộ tên label đã denormalize sang releases.label_name
    if "name" in data:
        conn.execute("UPDATE releases SET label_name=? WHERE label_id=?",
                     (data["name"], label_id))
    return {"ok": True}


@router.delete("/labels/{label_id}", dependencies=[Depends(require_manager)])
def delete_label(label_id: str, conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM labels WHERE id=?", (label_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy label")
    cnt = conn.execute("SELECT COUNT(*) FROM releases WHERE label_id=?",
                       (label_id,)).fetchone()[0]
    if cnt:
        raise HTTPException(
            409, f"Label còn {cnt} product — chuyển product sang label khác trước khi xóa")
    conn.execute("DELETE FROM labels WHERE id=?", (label_id,))
    return {"ok": True}


# ==========================================================================
# GENRES (danh mục thể loại — quản lý được, mặc định 'Pop')
# ==========================================================================
DEFAULT_GENRES = ["Pop", "V-Pop", "Ballad", "Rock", "R&B", "Rap / Hip-Hop",
                  "EDM", "Dance", "Lo-fi", "Acoustic", "Indie", "Jazz",
                  "Classical", "Country", "Bolero", "Nhạc Trẻ", "Instrumental"]


def _ensure_default_genres(conn):
    if conn.execute("SELECT 1 FROM genres LIMIT 1").fetchone():
        return
    for name in DEFAULT_GENRES:
        conn.execute("INSERT OR IGNORE INTO genres(id,name,name_norm) VALUES(?,?,?)",
                     (new_id(), name, normalize_text(name)))


class GenreBody(BaseModel):
    name: str


@router.get("/genres")
def list_genres(conn: sqlite3.Connection = Depends(get_db)):
    _ensure_default_genres(conn)
    rows = conn.execute(
        """SELECT g.*, (SELECT COUNT(*) FROM releases r WHERE r.genre=g.name) AS product_count
           FROM genres g ORDER BY g.name""").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/genres", status_code=201, dependencies=[Depends(require_manager)])
def create_genre(body: GenreBody, conn: sqlite3.Connection = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Thiếu tên thể loại")
    norm = normalize_text(name)
    # trả về TÊN CHUẨN HÓA đã lưu (để 'pop' khớp đúng 'Pop' trong danh mục)
    existing = conn.execute(
        "SELECT id, name FROM genres WHERE name_norm=?", (norm,)).fetchone()
    if existing:
        return {"id": existing["id"], "name": existing["name"], "existed": True}
    gid = new_id()
    try:
        conn.execute("INSERT INTO genres(id,name,name_norm) VALUES(?,?,?)",
                     (gid, name, norm))
    except sqlite3.IntegrityError:
        # race: request khác vừa tạo cùng tên → trả bản đã có
        row = conn.execute(
            "SELECT id, name FROM genres WHERE name_norm=? OR name=?",
            (norm, name)).fetchone()
        if row:
            return {"id": row["id"], "name": row["name"], "existed": True}
        raise
    return {"id": gid, "name": name}


@router.delete("/genres/{genre_id}", dependencies=[Depends(require_manager)])
def delete_genre(genre_id: str, conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("DELETE FROM genres WHERE id=?", (genre_id,))
    return {"ok": True}


# ==========================================================================
# NGHỆ SĨ CHO PICKER CONTRIBUTORS — mức staff để UPLOADER cũng tìm/tạo được
# (API quản trị nghệ sĩ đầy đủ ở admin.py yêu cầu manager)
# ==========================================================================
class ArtistQuickBody(BaseModel):
    name: str
    type: str = "person"


@router.get("/artist-options")
def artist_options(q: str = "", conn: sqlite3.Connection = Depends(get_db)):
    sql = "SELECT id, name, type, image_url FROM artists"
    args: list = []
    if q.strip():
        sql += " WHERE name_norm LIKE ?"
        args.append(f"%{normalize_text(q)}%")
    rows = conn.execute(sql + " ORDER BY name LIMIT 30", args).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/artist-options", status_code=201)
def artist_quick_create(body: ArtistQuickBody,
                        conn: sqlite3.Connection = Depends(get_db)):
    """Tạo nhanh nghệ sĩ khi gắn contributors — idempotent theo tên không dấu."""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Tên nghệ sĩ không được để trống")
    norm = normalize_text(name)
    row = conn.execute("SELECT id, name FROM artists WHERE name_norm=?", (norm,)).fetchone()
    if row:
        return {"id": row["id"], "name": row["name"], "existed": True}
    aid = new_id()
    from ..covers import generate_avatar
    img = COVER_DIR / f"artist_{aid}.svg"
    accent = generate_avatar(img, seed=stable_seed(aid), name=name)
    conn.execute(
        "INSERT INTO artists(id,name,name_norm,sort_name,type,image_url,accent) "
        "VALUES(?,?,?,?,?,?,?)",
        (aid, name, norm, name, body.type,
         f"/media/covers/artist_{aid}.svg", accent))
    return {"id": aid, "name": name}


# ==========================================================================
# PRODUCTS — list / create / detail / update / delete
# ==========================================================================
class ProductCreate(BaseModel):
    title: str
    title_version: Optional[str] = None
    release_type: str = "Single"
    label_id: str
    is_migrated: bool = False


@router.get("")
def list_products(state: str = "", q: str = "",
                  user: dict = Depends(require_staff),
                  conn: sqlite3.Connection = Depends(get_db)):
    sql = """SELECT r.*, l.name AS label_display, u.email AS creator_email,
             (SELECT COUNT(*) FROM release_tracks rt WHERE rt.release_id=r.id) AS track_count,
             (SELECT GROUP_CONCAT(a.name, ', ') FROM release_artists ra
                JOIN artists a ON a.id=ra.artist_id
                WHERE ra.release_id=r.id AND ra.role='MainArtist') AS main_artists
             FROM releases r LEFT JOIN labels l ON l.id=r.label_id
             LEFT JOIN users u ON u.id=r.created_by WHERE 1=1"""
    args: list = []
    # uploader chỉ thấy product của chính mình; manager/admin thấy tất cả
    if user.get("role") == "uploader":
        sql += " AND r.created_by=?"
        args.append(user["id"])
    if state:
        sql += " AND r.status=?"
        args.append(state)
    if q:
        sql += " AND r.title_norm LIKE ?"
        args.append(f"%{normalize_text(q)}%")
    rows = conn.execute(sql + " ORDER BY r.created_at DESC LIMIT 300", args).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("", status_code=201)
def create_product(body: ProductCreate, user: dict = Depends(require_staff),
                   conn: sqlite3.Connection = Depends(get_db)):
    if not body.title.strip():
        raise HTTPException(400, "Thiếu tiêu đề product")
    if body.release_type not in RELEASE_TYPES:
        raise HTTPException(400, f"release_type phải là {'|'.join(RELEASE_TYPES)}")
    label = conn.execute("SELECT * FROM labels WHERE id=?", (body.label_id,)).fetchone()
    if not label:
        raise HTTPException(400, "Label không tồn tại")
    rid = new_id()
    svg = COVER_DIR / f"release_{rid}.svg"
    accent = generate_cover(svg, seed=stable_seed(rid), title=body.title,
                            subtitle=label["name"])
    # Mặc định: copyright kế thừa từ label; năm = năm hiện tại; các ngày =
    # thời điểm tạo product; genre = 'Pop' (đều SỬA được ở tab Metadata).
    now = _now_utc()
    year = datetime.now().year
    conn.execute(
        "INSERT INTO releases(id,title,title_norm,title_version,release_type,label_id,"
        "label_name,cover_url,accent,status,source,is_migrated,is_compilation,"
        "metadata_language,audio_language,parental_warning,genre,"
        "c_line,c_line_year,p_line,p_line_year,right_holder,"
        "platform_release_date,original_release_date,preorder_date,created_by) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (rid, body.title.strip(), normalize_text(body.title),
         body.title_version, body.release_type, body.label_id, label["name"],
         f"/media/covers/{svg.name}", accent, "draft", "product",
         int(body.is_migrated), 1 if body.release_type == "Compilation" else 0,
         "vi", "vi", "NotExplicit", "Pop",
         label["c_line"], year, label["p_line"], year, label["right_holder"],
         now, now, now, user["id"]))
    return {"id": rid}


def _contributors_of(conn, owner: str, owner_id: str) -> dict:
    """owner: 'release' | 'track' → {role: [{artist_id, name, image_url}]}"""
    table = "release_artists" if owner == "release" else "track_artists"
    col = "release_id" if owner == "release" else "track_id"
    rows = conn.execute(
        f"""SELECT x.role, x.sequence, a.id AS artist_id, a.name, a.image_url
            FROM {table} x JOIN artists a ON a.id=x.artist_id
            WHERE x.{col}=? ORDER BY x.role, x.sequence""", (owner_id,)).fetchall()
    out: dict = {r: [] for r in ALL_ROLES}
    for r in rows:
        out.setdefault(r["role"], []).append(
            {"artist_id": r["artist_id"], "name": r["name"], "image_url": r["image_url"]})
    return out


@router.get("/{product_id}")
def product_detail(product_id: str, user: dict = Depends(require_staff),
                   conn: sqlite3.Connection = Depends(get_db)):
    row = _ensure_product_access(conn, user, product_id)
    d = dict(row)   # đã gồm created_by, review_note, submitted_at (SELECT *)
    d["contributors"] = _contributors_of(conn, "release", product_id)
    d["track_count"] = conn.execute(
        "SELECT COUNT(*) FROM release_tracks WHERE release_id=?", (product_id,)).fetchone()[0]
    label = conn.execute("SELECT * FROM labels WHERE id=?", (row["label_id"],)).fetchone()
    d["label"] = dict(label) if label else None
    # email người tạo (JOIN users) — hiển thị trong hàng đợi duyệt
    d["creator_email"] = None
    if row["created_by"]:
        creator = conn.execute("SELECT email FROM users WHERE id=?",
                               (row["created_by"],)).fetchone()
        d["creator_email"] = creator["email"] if creator else None
    qc = _run_qc(conn, row)
    d["qc_errors"] = qc["errors"]
    d["qc_warnings"] = qc["warnings"]
    return d


class ProductPatch(BaseModel):
    title: Optional[str] = None
    title_version: Optional[str] = None
    label_id: Optional[str] = None
    release_type: Optional[str] = None
    genre: Optional[str] = None
    subgenre: Optional[str] = None
    metadata_language: Optional[str] = None
    audio_language: Optional[str] = None
    parental_warning: Optional[str] = None
    platform_release_date: Optional[str] = None
    original_release_date: Optional[str] = None
    preorder_date: Optional[str] = None
    c_line: Optional[str] = None
    c_line_year: Optional[int] = None
    p_line: Optional[str] = None
    p_line_year: Optional[int] = None
    right_holder: Optional[str] = None
    upc: Optional[str] = None
    catalog_number: Optional[str] = None
    release_price_tier: Optional[str] = None
    track_price_tier: Optional[str] = None
    mastered_by: Optional[str] = None
    is_compilation: Optional[bool] = None
    is_migrated: Optional[bool] = None
    tags: Optional[str] = None


@router.patch("/{product_id}")
def update_product(product_id: str, body: ProductPatch,
                   user: dict = Depends(require_staff),
                   conn: sqlite3.Connection = Depends(get_db)):
    row = _ensure_product_access(conn, user, product_id, write=True)
    data = body.model_dump(exclude_unset=True)

    if "title" in data and not (data["title"] or "").strip():
        raise HTTPException(400, "Tiêu đề không được để trống")
    if "release_type" in data and data["release_type"] not in RELEASE_TYPES:
        raise HTTPException(400, "release_type không hợp lệ")
    # đổi sang Single khi đang có >1 track → chặn (giữ bất biến 'Single = 1 track'
    # và tránh _propagate_contributors ghi đè track đã tự chỉnh)
    if ("release_type" in data and data["release_type"] == "Single"
            and data["release_type"] != row["release_type"]):
        cnt = conn.execute(
            "SELECT COUNT(*) FROM release_tracks WHERE release_id=?",
            (product_id,)).fetchone()[0]
        if cnt > 1:
            raise HTTPException(
                409, "Single chỉ có 1 track — xóa bớt track hoặc chọn EP/Album trước khi đổi.")
    if "parental_warning" in data and data["parental_warning"] not in ADVISORY:
        raise HTTPException(400, "parental_advisory không hợp lệ")
    for yk in ("c_line_year", "p_line_year"):
        if data.get(yk) is not None and not (1900 <= data[yk] <= datetime.now().year + 1):
            raise HTTPException(400, f"{yk} phải trong khoảng 1900–{datetime.now().year + 1}")
    if "upc" in data and data["upc"]:
        u = data["upc"].strip()
        if not validate_upc(u):
            raise HTTPException(400, "UPC không hợp lệ (checksum GTIN)")
        if conn.execute("SELECT 1 FROM releases WHERE upc=? AND id!=?",
                        (u, product_id)).fetchone():
            raise HTTPException(409, "UPC đã dùng cho product khác")
        data["upc"] = u
    if "label_id" in data:
        lbl = conn.execute("SELECT name FROM labels WHERE id=?", (data["label_id"],)).fetchone()
        if not lbl:
            raise HTTPException(400, "Label không tồn tại")
        data["label_name"] = lbl["name"]
    # preorder không được SAU release date (cho phép bằng — mặc định cùng lúc tạo)
    pre = data.get("preorder_date", row["preorder_date"])
    rel = data.get("platform_release_date", row["platform_release_date"])
    if pre and rel and pre > rel:
        raise HTTPException(400, "Pre-order date không được sau Release date")

    for bk in ("is_compilation", "is_migrated"):
        if bk in data:
            data[bk] = int(bool(data[bk]))
    if "title" in data:
        data["title"] = data["title"].strip()
        data["title_norm"] = normalize_text(data["title"])

    if not data:
        return {"ok": True}
    sets = ", ".join(f"{k}=?" for k in data)
    conn.execute(f"UPDATE releases SET {sets} WHERE id=?",
                 [*data.values(), product_id])
    if "upc" in data and data["upc"]:
        mark_code_used(conn, "upc", data["upc"], product_id)
    # đổi loại release → đồng bộ lại contributors track (Single khóa/sync,
    # Album chỉ sync track chưa tự chỉnh)
    if "release_type" in data and data["release_type"] != row["release_type"]:
        _propagate_contributors(conn, product_id, data["release_type"])
    return {"ok": True}


@router.delete("/{product_id}")
def delete_product(product_id: str, user: dict = Depends(require_staff),
                   conn: sqlite3.Connection = Depends(get_db)):
    row = _ensure_product_access(conn, user, product_id, write=True)
    if row["status"] not in ("draft", "taken_down"):
        raise HTTPException(409, "Chỉ xóa được product ở trạng thái Draft/Taken down")
    conn.execute("DELETE FROM releases WHERE id=?", (product_id,))
    return {"ok": True}


@router.post("/{product_id}/cover")
async def upload_product_cover(product_id: str, file: UploadFile = File(...),
                               user: dict = Depends(require_staff),
                               conn: sqlite3.Connection = Depends(get_db)):
    _ensure_product_access(conn, user, product_id, write=True)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "Ảnh bìa chỉ nhận JPG/PNG/WebP (khuyến nghị 3000×3000)")
    dest = COVER_DIR / f"release_{product_id}{ext}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    url = f"/media/covers/{dest.name}"
    conn.execute("UPDATE releases SET cover_url=? WHERE id=?", (url, product_id))
    return {"ok": True, "cover_url": url}


@router.post("/{product_id}/tracks/{track_id}/audio")
async def upload_product_track_audio(product_id: str, track_id: str,
                                     file: UploadFile = File(...),
                                     user: dict = Depends(require_staff),
                                     conn: sqlite3.Connection = Depends(get_db)):
    """Upload audio cho track — mức STAFF nên UPLOADER cũng dùng được (endpoint
    audio ở admin.py bị chặn bởi require_manager). Kiểm tra track thuộc product
    và uploader có quyền + product đang Draft."""
    _ensure_product_access(conn, user, product_id, write=True)
    belongs = conn.execute(
        "SELECT 1 FROM release_tracks WHERE release_id=? AND track_id=?",
        (product_id, track_id)).fetchone()
    if not belongs:
        raise HTTPException(404, "Track không thuộc product này")
    from .admin import ingest_track_audio
    return await ingest_track_audio(conn, track_id, file)


# ==========================================================================
# CONTRIBUTORS (product & track) — PUT full-replace theo role
# ==========================================================================
class ContributorsBody(BaseModel):
    contributors: dict     # {role: [artist_id, ...]}


def _put_contributors(conn, owner: str, owner_id: str, payload: dict):
    table = "release_artists" if owner == "release" else "track_artists"
    col = "release_id" if owner == "release" else "track_id"
    for role in payload:
        if role not in ALL_ROLES:
            raise HTTPException(400, f"Role không hợp lệ: {role}")
    for role, artist_ids in payload.items():
        for aid in artist_ids:
            if not conn.execute("SELECT 1 FROM artists WHERE id=?", (aid,)).fetchone():
                raise HTTPException(400, f"Nghệ sĩ không tồn tại: {aid}")
        if len(set(artist_ids)) != len(artist_ids):
            raise HTTPException(400, f"Role {role}: nghệ sĩ trùng lặp")
    for role, artist_ids in payload.items():
        conn.execute(f"DELETE FROM {table} WHERE {col}=? AND role=?", (owner_id, role))
        for seq, aid in enumerate(artist_ids, start=1):
            conn.execute(
                f"INSERT INTO {table}({col},artist_id,role,sequence) VALUES(?,?,?,?)",
                (owner_id, aid, role, seq))


def _copy_contributors_to_track(conn, product_id: str, track_id: str):
    """Sao chép TOÀN BỘ contributors của product → track (thay thế hoàn toàn)."""
    conn.execute("DELETE FROM track_artists WHERE track_id=?", (track_id,))
    for r in conn.execute(
            "SELECT artist_id, role, sequence FROM release_artists WHERE release_id=?",
            (product_id,)).fetchall():
        conn.execute(
            "INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) "
            "VALUES(?,?,?,?)", (track_id, r["artist_id"], r["role"], r["sequence"]))


def _propagate_contributors(conn, product_id: str, release_type: str):
    """Sau khi lưu contributors ở product:
      - Single: đồng bộ MỌI track (khóa dùng chung).
      - Album/EP/Compilation: chỉ đồng bộ track CHƯA tự chỉnh riêng (customized=0).
    """
    rows = conn.execute(
        "SELECT track_id, contributors_customized FROM release_tracks rt "
        "JOIN tracks t ON t.id = rt.track_id WHERE rt.release_id=?",
        (product_id,)).fetchall()
    for r in rows:
        if release_type == "Single" or not r["contributors_customized"]:
            _copy_contributors_to_track(conn, product_id, r["track_id"])


@router.put("/{product_id}/contributors")
def put_product_contributors(product_id: str, body: ContributorsBody,
                             user: dict = Depends(require_staff),
                             conn: sqlite3.Connection = Depends(get_db)):
    row = _ensure_product_access(conn, user, product_id, write=True)
    _put_contributors(conn, "release", product_id, body.contributors)
    # kế thừa xuống track theo loại release
    _propagate_contributors(conn, product_id, row["release_type"])
    return {"ok": True, "contributors": _contributors_of(conn, "release", product_id)}


@router.put("/tracks/{track_id}/contributors")
def put_track_contributors(track_id: str, body: ContributorsBody,
                           user: dict = Depends(require_staff),
                           conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute(
            "SELECT 1 FROM release_tracks WHERE track_id=?", (track_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy track")
    _ensure_track_access(conn, user, track_id, write=True)
    # track thuộc BẤT KỲ Single nào → khóa (track_artists dùng chung toàn cục;
    # không phụ thuộc thứ tự JOIN như fetchone() cũ)
    locked = conn.execute(
        """SELECT 1 FROM release_tracks rt JOIN releases r ON r.id=rt.release_id
           WHERE rt.track_id=? AND r.release_type='Single' LIMIT 1""",
        (track_id,)).fetchone()
    if locked:
        raise HTTPException(
            409, "Single dùng chung Contributors với product — sửa ở tab Metadata, "
                 "không chỉnh riêng cho track.")
    _put_contributors(conn, "track", track_id, body.contributors)
    # đánh dấu track đã tự chỉnh → không bị ghi đè khi product đổi contributors
    conn.execute("UPDATE tracks SET contributors_customized=1 WHERE id=?", (track_id,))
    return {"ok": True, "contributors": _contributors_of(conn, "track", track_id)}


# ==========================================================================
# TRACKS trong product
# ==========================================================================
def _next_isrc_for_label(conn, label_prefix: Optional[str],
                         exclude: Optional[set] = None) -> str:
    """1 mã ISRC: ưu tiên kho → auto theo prefix label (nếu có) hoặc prefix hệ thống."""
    exclude = exclude or set()
    pooled = pool_take(conn, "isrc", 1, exclude=exclude)
    if pooled:
        return pooled[0]
    if not auto_enabled(conn, "isrc"):
        raise pool_exhausted_error("isrc")
    prefix = (label_prefix or ISRC_PREFIX).upper()
    yy = datetime.now().strftime("%y")
    base = f"{prefix}{yy}"
    rows = conn.execute("SELECT isrc FROM tracks WHERE isrc LIKE ?", (f"{base}%",)).fetchall()
    max_seq = 0
    for r in [x["isrc"] for x in rows] + list(exclude):
        tail = r[len(base):] if r and r.startswith(base) else ""
        if tail.isdigit():
            max_seq = max(max_seq, int(tail))
    seq = max_seq
    while True:
        seq += 1
        isrc = f"{base}{seq:05d}"
        if isrc in exclude:
            continue
        if not validate_isrc(isrc):
            raise HTTPException(500, f"ISRC tự sinh không hợp lệ ({isrc}) — kiểm tra prefix label")
        if not conn.execute("SELECT 1 FROM tracks WHERE isrc=?", (isrc,)).fetchone():
            return isrc


class ProductTrackCreate(BaseModel):
    title: str
    isrc: Optional[str] = None


@router.get("/{product_id}/tracks")
def product_tracks(product_id: str, user: dict = Depends(require_staff),
                   conn: sqlite3.Connection = Depends(get_db)):
    _ensure_product_access(conn, user, product_id)
    rows = conn.execute(
        """SELECT t.*, rt.track_no FROM tracks t
           JOIN release_tracks rt ON rt.track_id=t.id
           WHERE rt.release_id=? ORDER BY rt.disc_no, rt.track_no""",
        (product_id,)).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["artists"] = [dict(a) for a in conn.execute(
            """SELECT a.id, a.name FROM track_artists ta JOIN artists a ON a.id=ta.artist_id
               WHERE ta.track_id=? AND ta.role='MainArtist' ORDER BY ta.sequence""",
            (r["id"],)).fetchall()]
        # file: format + size + trạng thái
        d["file_format"] = Path(r["audio_path"]).suffix[1:].upper() if r["audio_path"] else None
        d["file_size"] = 0
        d["upload_state"] = "missing"
        if r["audio_path"]:
            p = AUDIO_DIR / r["audio_path"]
            if p.is_file():
                d["file_size"] = p.stat().st_size
                d["upload_state"] = "uploaded"
        d["has_master"] = bool(r["master_path"])
        d["contributors"] = _contributors_of(conn, "track", r["id"])
        d["contributors_customized"] = bool(r["contributors_customized"])
        items.append(d)
    return {"items": items}


@router.post("/{product_id}/tracks", status_code=201)
def add_product_track(product_id: str, body: ProductTrackCreate,
                      user: dict = Depends(require_staff),
                      conn: sqlite3.Connection = Depends(get_db)):
    row = _ensure_product_access(conn, user, product_id, write=True)
    if not body.title.strip():
        raise HTTPException(400, "Thiếu tiêu đề track")

    # Single chỉ chứa đúng 1 track
    if row["release_type"] == "Single":
        cnt = conn.execute(
            "SELECT COUNT(*) FROM release_tracks WHERE release_id=?",
            (product_id,)).fetchone()[0]
        if cnt >= 1:
            raise HTTPException(
                409, "Single chỉ có 1 track. Đổi Release Type sang EP/Album để thêm track.")

    label = conn.execute("SELECT isrc_prefix FROM labels WHERE id=?",
                         (row["label_id"],)).fetchone()
    manual = clean_isrc(body.isrc) if (body.isrc or "").strip() else ""
    if row["is_migrated"] and not manual:
        raise HTTPException(400, "Product ở chế độ Migrated network — phải nhập ISRC thủ công")
    if manual:
        if not validate_isrc(manual):
            raise HTTPException(400, "ISRC sai định dạng (CC-XXX-YY-NNNNN)")
        if conn.execute("SELECT 1 FROM tracks WHERE isrc=?", (manual,)).fetchone():
            raise HTTPException(409, f"ISRC {manual} đã tồn tại")
        isrc = manual
    else:
        isrc = _next_isrc_for_label(conn, label["isrc_prefix"] if label else None)

    tid = new_id()
    conn.execute(
        "INSERT INTO tracks(id,isrc,title,title_norm,language,genre,parental_warning,"
        "p_line,p_line_year,c_line,c_line_year,right_holder,status) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, isrc, body.title.strip(), normalize_text(body.title),
         row["audio_language"] or "vi", row["genre"], row["parental_warning"],
         row["p_line"], row["p_line_year"], row["c_line"], row["c_line_year"],
         row["right_holder"], "draft"))
    no = conn.execute(
        "SELECT COALESCE(MAX(track_no),0)+1 FROM release_tracks WHERE release_id=?",
        (product_id,)).fetchone()[0]
    conn.execute(
        "INSERT INTO release_tracks(release_id,track_id,disc_no,track_no) VALUES(?,?,1,?)",
        (product_id, tid, no))
    # track mới kế thừa contributors từ product (customized=0 mặc định)
    _copy_contributors_to_track(conn, product_id, tid)
    mark_code_used(conn, "isrc", isrc, tid)
    return {"id": tid, "isrc": isrc, "track_no": no}


class TrackDetailPatch(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None            # Title Version
    isrc: Optional[str] = None
    secondary_isrc: Optional[str] = None
    genre: Optional[str] = None
    secondary_genre: Optional[str] = None
    language: Optional[str] = None            # Audio Language
    parental_warning: Optional[str] = None
    clip_start_seconds: Optional[int] = None
    c_line: Optional[str] = None
    c_line_year: Optional[int] = None
    p_line: Optional[str] = None
    p_line_year: Optional[int] = None
    right_holder: Optional[str] = None
    instant_grat_stream_date: Optional[str] = None
    instant_grat_download_date: Optional[str] = None
    lyrics: Optional[str] = None
    lyrics_lrc: Optional[str] = None


@router.patch("/tracks/{track_id}")
def patch_product_track(track_id: str, body: TrackDetailPatch,
                        user: dict = Depends(require_staff),
                        conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy track")
    _ensure_track_access(conn, user, track_id, write=True)
    data = body.model_dump(exclude_unset=True)
    if "title" in data:
        if not (data["title"] or "").strip():
            raise HTTPException(400, "Tiêu đề không được để trống")
        data["title"] = data["title"].strip()
        data["title_norm"] = normalize_text(data["title"])
    if "isrc" in data and data["isrc"]:
        isrc = clean_isrc(data["isrc"])
        if not validate_isrc(isrc):
            raise HTTPException(400, "ISRC sai định dạng")
        if conn.execute("SELECT 1 FROM tracks WHERE isrc=? AND id!=?",
                        (isrc, track_id)).fetchone():
            raise HTTPException(409, "ISRC đã dùng cho track khác")
        data["isrc"] = isrc
    if "parental_warning" in data and data["parental_warning"] not in ADVISORY:
        raise HTTPException(400, "parental_advisory không hợp lệ")
    if data.get("clip_start_seconds") is not None and data["clip_start_seconds"] < 0:
        raise HTTPException(400, "Clip start phải ≥ 0")
    if not data:
        return {"ok": True}
    sets = ", ".join(f"{k}=?" for k in data)
    conn.execute(f"UPDATE tracks SET {sets} WHERE id=?", [*data.values(), track_id])
    if "isrc" in data and data["isrc"]:
        mark_code_used(conn, "isrc", data["isrc"], track_id)
    return {"ok": True}


class ReorderBody(BaseModel):
    track_ids: List[str]


@router.put("/{product_id}/tracks/reorder")
def reorder_product_tracks(product_id: str, body: ReorderBody,
                           user: dict = Depends(require_staff),
                           conn: sqlite3.Connection = Depends(get_db)):
    _ensure_product_access(conn, user, product_id, write=True)
    current = {r["track_id"] for r in conn.execute(
        "SELECT track_id FROM release_tracks WHERE release_id=?", (product_id,))}
    if set(body.track_ids) != current or len(body.track_ids) != len(current):
        raise HTTPException(400, "Danh sách reorder phải chứa đúng toàn bộ track của product")
    for no, tid in enumerate(body.track_ids, start=1):
        conn.execute("UPDATE release_tracks SET track_no=? WHERE release_id=? AND track_id=?",
                     (no, product_id, tid))
    return {"ok": True}


@router.delete("/{product_id}/tracks/{track_id}")
def remove_product_track(product_id: str, track_id: str,
                         user: dict = Depends(require_staff),
                         conn: sqlite3.Connection = Depends(get_db)):
    _ensure_product_access(conn, user, product_id, write=True)
    conn.execute("DELETE FROM release_tracks WHERE release_id=? AND track_id=?",
                 (product_id, track_id))
    # track mồ côi (không thuộc release nào khác) → xóa hẳn kèm file
    if not conn.execute("SELECT 1 FROM release_tracks WHERE track_id=?",
                        (track_id,)).fetchone():
        row = conn.execute("SELECT audio_path, master_path FROM tracks WHERE id=?",
                           (track_id,)).fetchone()
        if row:
            from ..config import MASTER_DIR
            from ..waveform import invalidate_waveform
            if row["audio_path"]:
                (AUDIO_DIR / row["audio_path"]).unlink(missing_ok=True)
            if row["master_path"]:
                (MASTER_DIR / row["master_path"]).unlink(missing_ok=True)
            invalidate_waveform(track_id)
        conn.execute("DELETE FROM tracks WHERE id=?", (track_id,))
    return {"ok": True}


# ==========================================================================
# QC CHECK
# ==========================================================================
def _run_qc(conn, release) -> dict:
    rid = release["id"]
    groups: list = []

    def group(name):
        g = {"name": name, "rules": []}
        groups.append(g)
        return g

    def rule(g, label, ok, level="error", detail=""):
        g["rules"].append({
            "label": label,
            "level": "pass" if ok else level,
            "detail": "" if ok else detail,
        })

    # ---- Metadata ----
    gm = group("Metadata")
    rule(gm, "Tiêu đề", bool(release["title"]))
    rule(gm, "Label", bool(release["label_id"]), detail="Chọn label trong tab Metadata")
    rule(gm, "Primary genre", bool(release["genre"]), detail="Chọn thể loại chính")
    rule(gm, "Release date", bool(release["platform_release_date"]),
         detail="Đặt ngày phát hành")
    rule(gm, "Original release date", bool(release["original_release_date"]),
         detail="Đặt ngày phát hành gốc")
    rule(gm, "C-Line (©) + năm", bool(release["c_line"] and release["c_line_year"]),
         detail="Điền Copyrights")
    rule(gm, "P-Line (℗) + năm", bool(release["p_line"] and release["p_line_year"]),
         detail="Điền Copyrights")
    rule(gm, "Right holder", bool(release["right_holder"]), detail="Điền chủ sở hữu quyền")
    pre_ok = (not release["preorder_date"] or not release["platform_release_date"]
              or release["preorder_date"] <= release["platform_release_date"])
    rule(gm, "Pre-order ≤ Release date", pre_ok,
         detail="Pre-order date không được sau Release date")

    # ---- Cover art ----
    gc = group("Cover art")
    cover_ok = bool(release["cover_url"])
    rule(gc, "Có ảnh bìa", cover_ok, detail="Upload ảnh bìa 3000×3000")
    if cover_ok and release["cover_url"].endswith(".svg"):
        rule(gc, "Bìa chính thức (không phải bìa tự sinh)", False, level="warning",
             detail="Đang dùng bìa hệ thống tự sinh — nên upload bìa thật 3000×3000 JPG/PNG")

    # ---- Contributors ----
    gk = group("Contributors")
    contrib = _contributors_of(conn, "release", rid)
    for role in REQUIRED_ROLES:
        rule(gk, f"{role} (≥1)", len(contrib.get(role, [])) >= 1,
             detail=f"Thêm ít nhất 1 {role} trong tab Metadata")

    # ---- Tracks ----
    gt = group("Tracks")
    tracks = conn.execute(
        """SELECT t.* FROM tracks t JOIN release_tracks rt ON rt.track_id=t.id
           WHERE rt.release_id=? ORDER BY rt.track_no""", (rid,)).fetchall()
    rule(gt, "Có ít nhất 1 track", len(tracks) > 0, detail="Thêm track trong tab Tracks")
    if release["release_type"] == "Single" and len(tracks) > 1:
        rule(gt, "Single chỉ 1 track", False,
             detail=f"Single đang có {len(tracks)} track — đổi sang EP/Album")
    titles_seen = set()
    dup_titles = set()
    for tr in tracks:
        audio_ok = bool(tr["audio_path"]) and (AUDIO_DIR / tr["audio_path"]).is_file()
        rule(gt, f"Audio: {tr['title']}", audio_ok,
             detail="Upload file WAV/FLAC cho track này")
        rule(gt, f"ISRC: {tr['title']}", bool(tr["isrc"]),
             detail="Track thiếu ISRC")
        if not tr["lyrics"] and not tr["lyrics_lrc"]:
            rule(gt, f"Lyrics: {tr['title']}", False, level="warning",
                 detail="Track chưa có lời bài hát")
        key = (tr["title_norm"] or tr["title"].lower())
        if key in titles_seen:
            dup_titles.add(tr["title"])
        titles_seen.add(key)
    if dup_titles:
        rule(gt, "Tiêu đề trùng lặp trong tracklist", False, level="warning",
             detail=", ".join(sorted(dup_titles)))

    errors = sum(1 for g in groups for r in g["rules"] if r["level"] == "error")
    warnings = sum(1 for g in groups for r in g["rules"] if r["level"] == "warning")
    return {"groups": groups, "errors": errors, "warnings": warnings,
            "can_publish": errors == 0}


@router.get("/{product_id}/qc")
def product_qc(product_id: str, user: dict = Depends(require_staff),
               conn: sqlite3.Connection = Depends(get_db)):
    return _run_qc(conn, _ensure_product_access(conn, user, product_id))


# ==========================================================================
# RELEASES — submit-review / approve / reject / publish / takedown / history
# ==========================================================================
def _do_publish(conn, row, actor: str, action: str = "publish") -> dict:
    """Pipeline phát hành dùng chung cho publish trực tiếp (manager) và
    approve (duyệt từ hàng đợi): QC → cấp UPC → deal mặc định → live/scheduled.

    Khóa ghi (BEGIN IMMEDIATE) + đọc lại trạng thái trong khóa → 2 lần duyệt/publish
    đồng thời không cùng cấp UPC/deal (chống double-publish)."""
    product_id = row["id"]
    conn.execute("BEGIN IMMEDIATE")
    try:
        fresh = conn.execute("SELECT status FROM releases WHERE id=?",
                             (product_id,)).fetchone()
        if not fresh:
            raise HTTPException(404, "Product không tồn tại")
        if fresh["status"] in ("live", "scheduled"):
            conn.execute("ROLLBACK")
            raise HTTPException(409, "Product đã được phát hành")
        result = _do_publish_locked(conn, row, actor, action)
        conn.execute("COMMIT")
        return result
    except HTTPException:
        # _do_publish_locked có thể đã ROLLBACK (QC fail cần ghi log ngoài txn)
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise


def _do_publish_locked(conn, row, actor: str, action: str = "publish") -> dict:
    product_id = row["id"]
    qc = _run_qc(conn, row)
    if not qc["can_publish"]:
        _log_action(conn, product_id, action, actor, "failed",
                    f"QC: {qc['errors']} lỗi")
        raise HTTPException(409, f"QC Check còn {qc['errors']} lỗi — sửa xong mới publish được")

    # cấp UPC nếu chưa có (kho → tự sinh)
    upc = row["upc"]
    if not upc:
        pooled = pool_take(conn, "upc", 1)
        if pooled:
            upc = pooled[0]
        elif auto_enabled(conn, "upc"):
            import random
            from ..utils import gtin_check_digit
            for _ in range(50):
                body12 = "2" + "".join(random.choices("0123456789", k=10))
                cand = body12 + gtin_check_digit(body12)
                if not conn.execute("SELECT 1 FROM releases WHERE upc=?", (cand,)).fetchone():
                    upc = cand
                    break
            if not upc:
                raise HTTPException(500, "Không sinh được UPC")
        else:
            raise pool_exhausted_error("upc")
        conn.execute("UPDATE releases SET upc=? WHERE id=?", (upc, product_id))
        mark_code_used(conn, "upc", upc, product_id)

    # đảm bảo có deal mặc định (website)
    if not conn.execute("SELECT 1 FROM deals WHERE release_id=?", (product_id,)).fetchone():
        conn.execute(
            "INSERT INTO deals(id,release_id,territories,use_types,commercial_models,start_date) "
            "VALUES(?,?,?,?,?,?)",
            (new_id(), product_id, "Worldwide", "OnDemandStream",
             "SubscriptionModel,AdvertisementSupportedModel",
             (row["platform_release_date"] or _now_utc())[:10]))

    future = (row["platform_release_date"] or "") > _now_utc()
    new_status = "scheduled" if future else "live"
    # duyệt xong thì xóa ghi chú từ chối cũ (nếu có) cho sạch hàng đợi
    conn.execute("UPDATE releases SET status=?, published_at=?, review_note=NULL WHERE id=?",
                 (new_status, _now_utc(), product_id))
    if new_status == "live":
        conn.execute(
            """UPDATE tracks SET status='live'
               WHERE audio_path IS NOT NULL AND status IN ('draft','pending_review')
                 AND id IN (SELECT track_id FROM release_tracks WHERE release_id=?)""",
            (product_id,))
    _log_action(conn, product_id, action, actor, "success",
                f"{'Hẹn giờ ' + row['platform_release_date'] if future else 'Phát hành ngay'} · UPC {upc}")
    return {"ok": True, "status": new_status, "upc": upc,
            "warnings": qc["warnings"]}


@router.post("/{product_id}/submit-review")
def submit_product_review(product_id: str, user: dict = Depends(require_staff),
                          conn: sqlite3.Connection = Depends(get_db)):
    """Uploader gửi product vào hàng đợi duyệt: draft → pending_review.
    Chạy QC trước — còn lỗi mức error thì 400 kèm danh sách lỗi."""
    row = _ensure_product_access(conn, user, product_id)
    if row["status"] != "draft":
        raise HTTPException(409, "Chỉ gửi duyệt được product ở trạng thái Draft")
    qc = _run_qc(conn, row)
    if qc["errors"] > 0:
        errs = [f"{g['name']}: {r['label']}" + (f" — {r['detail']}" if r["detail"] else "")
                for g in qc["groups"] for r in g["rules"] if r["level"] == "error"]
        raise HTTPException(400, {
            "message": f"QC Check còn {qc['errors']} lỗi — sửa xong mới gửi duyệt được",
            "errors": errs})
    # xóa ghi chú reject cũ khi gửi lại (lịch sử vẫn còn trong release_actions);
    # track thuộc product giữ nguyên trạng thái draft
    conn.execute(
        "UPDATE releases SET status='pending_review', submitted_at=?, review_note=NULL "
        "WHERE id=?", (_now_utc(), product_id))
    _log_action(conn, product_id, "submit_review", user["email"], "success",
                f"Gửi duyệt · QC đạt ({qc['warnings']} cảnh báo)")
    return {"ok": True, "status": "pending_review", "warnings": qc["warnings"]}


@router.post("/{product_id}/approve")
def approve_product(product_id: str, user: dict = Depends(require_manager),
                    conn: sqlite3.Connection = Depends(get_db)):
    """Manager duyệt product trong hàng đợi → chạy pipeline publish (live/scheduled)."""
    row = _get_release(conn, product_id)
    if row["status"] != "pending_review":
        raise HTTPException(409, "Product không ở hàng đợi duyệt (pending_review)")
    return _do_publish(conn, row, user["email"], action="approve")


class RejectBody(BaseModel):
    note: str


@router.post("/{product_id}/reject")
def reject_product(product_id: str, body: RejectBody,
                   user: dict = Depends(require_manager),
                   conn: sqlite3.Connection = Depends(get_db)):
    """Manager từ chối: pending_review → draft, lưu review_note để uploader sửa."""
    row = _get_release(conn, product_id)
    if row["status"] != "pending_review":
        raise HTTPException(409, "Product không ở hàng đợi duyệt (pending_review)")
    note = body.note.strip()
    if not note:
        raise HTTPException(400, "Cần ghi chú lý do từ chối để uploader biết đường sửa")
    conn.execute("UPDATE releases SET status='draft', review_note=? WHERE id=?",
                 (note, product_id))
    _log_action(conn, product_id, "reject", user["email"], "success", note)
    return {"ok": True, "status": "draft"}


@router.post("/{product_id}/publish")
def publish_product(product_id: str, user: dict = Depends(require_manager),
                    conn: sqlite3.Connection = Depends(get_db)):
    """Publish trực tiếp (bỏ qua hàng đợi) — chỉ manager/admin."""
    row = _get_release(conn, product_id)
    return _do_publish(conn, row, user["email"], action="publish")


@router.post("/{product_id}/update-release")
def update_release_action(product_id: str, user: dict = Depends(require_manager),
                          conn: sqlite3.Connection = Depends(get_db)):
    row = _get_release(conn, product_id)
    if row["status"] not in ("live", "scheduled"):
        raise HTTPException(409, "Product chưa publish — dùng nút Publish")
    run_publisher(conn)
    _log_action(conn, product_id, "update", user["email"], "success",
                "Đẩy lại metadata mới nhất lên website")
    return {"ok": True}


@router.post("/{product_id}/takedown")
def takedown_product(product_id: str, user: dict = Depends(require_manager),
                     conn: sqlite3.Connection = Depends(get_db)):
    row = _get_release(conn, product_id)
    if row["status"] not in ("live", "scheduled"):
        raise HTTPException(409, "Product không ở trạng thái đã publish")
    conn.execute("UPDATE releases SET status='taken_down' WHERE id=?", (product_id,))
    # chỉ gỡ track không còn thuộc release live nào khác
    conn.execute(
        """UPDATE tracks SET status='taken_down' WHERE id IN (
             SELECT rt.track_id FROM release_tracks rt
             WHERE rt.release_id=? AND NOT EXISTS (
               SELECT 1 FROM release_tracks rt2 JOIN releases r2 ON r2.id=rt2.release_id
               WHERE rt2.track_id=rt.track_id AND r2.id!=? AND r2.status='live'))""",
        (product_id, product_id))
    _log_action(conn, product_id, "takedown", user["email"], "success")
    return {"ok": True, "status": "taken_down"}


@router.get("/{product_id}/releases")
def product_release_history(product_id: str, user: dict = Depends(require_staff),
                            conn: sqlite3.Connection = Depends(get_db)):
    _ensure_product_access(conn, user, product_id)
    rows = conn.execute(
        "SELECT * FROM release_actions WHERE release_id=? ORDER BY created_at DESC LIMIT 100",
        (product_id,)).fetchall()
    return {"items": [dict(r) for r in rows]}