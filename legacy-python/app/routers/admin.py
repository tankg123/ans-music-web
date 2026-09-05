"""Admin CMS API: dashboard, CRUD catalog chuẩn DDEX, upload audio, DDEX import,
review queue, quản lý tài khoản — bảo vệ bằng RBAC v2.0:
  - Toàn router yêu cầu tối thiểu MANAGER (admin|manager) — uploader KHÔNG vào được
    (uploader chỉ dùng products.py cho nhạc của mình).
  - Riêng QUẢN LÝ TÀI KHOẢN + ĐỐI TÁC DELIVERY yêu cầu ADMIN (khai báo thêm
    Depends(require_admin) ở từng endpoint).
"""
import hashlib
import re
import secrets
import shutil
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..config import (ARTIST_IMG_DIR, AUDIO_CONTENT_TYPES, AUDIO_DIR,
                      AVATAR_DIR, COVER_DIR)
from ..covers import generate_cover
from ..db import get_db, new_id
from ..ddex import import_delivery
from ..security import hash_password, require_admin, require_manager
from ..serializers import (serialize_artists, serialize_releases,
                           serialize_tracks)
from ..utils import (clean_isrc, normalize_text, stable_seed, validate_isrc,
                     validate_upc)

RELEASE_STATUSES = ("draft", "pending_review", "live", "scheduled", "taken_down")
TRACK_STATUSES = ("draft", "live", "taken_down")
VALID_ROLES = ("user", "uploader", "manager", "admin")
VALID_PLANS = ("free", "premium")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ACCENT_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")     # màu accent dạng #RRGGBB
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")  # ảnh nghệ sĩ (không nhận SVG)
IMAGE_MAX_BYTES = 5 * 1024 * 1024                # 5MB


def _require_artists_exist(conn: sqlite3.Connection, artist_ids: list):
    for aid in artist_ids or []:
        if not conn.execute("SELECT 1 FROM artists WHERE id=?", (aid,)).fetchone():
            raise HTTPException(400, f"Nghệ sĩ không tồn tại: {aid}")

# Mặc định cả router: manager trở lên (admin|manager) — nội dung/catalog.
# Endpoint nhạy cảm (users, partners) khai báo THÊM require_admin bên dưới.
router = APIRouter(prefix="/admin/v1", tags=["admin"],
                   dependencies=[Depends(require_manager)])


# --------------------------------------------------------------------------
# DASHBOARD
# --------------------------------------------------------------------------
@router.get("/stats")
def stats(conn: sqlite3.Connection = Depends(get_db)):
    def one(sql, *args):
        return conn.execute(sql, args).fetchone()[0]

    top = conn.execute(
        """SELECT t.*, COUNT(ph.id) AS week_plays FROM tracks t
           JOIN play_history ph ON ph.track_id=t.id
             AND ph.played_at >= datetime('now','-7 days')
           GROUP BY t.id ORDER BY week_plays DESC LIMIT 8""").fetchall()
    top_items = serialize_tracks(conn, top)
    for item, r in zip(top_items, top):
        item["week_plays"] = r["week_plays"]

    recent_deliveries = conn.execute(
        "SELECT * FROM deliveries ORDER BY received_at DESC LIMIT 6").fetchall()

    return {
        "tracks": one("SELECT COUNT(*) FROM tracks"),
        "tracks_live": one("SELECT COUNT(*) FROM tracks WHERE status='live'"),
        "releases": one("SELECT COUNT(*) FROM releases"),
        "artists": one("SELECT COUNT(*) FROM artists"),
        "users": one("SELECT COUNT(*) FROM users"),
        "plays_7d": one("SELECT COUNT(*) FROM play_history WHERE played_at >= datetime('now','-7 days')"),
        "plays_total": one("SELECT COUNT(*) FROM play_history"),
        "pending_review": one("SELECT COUNT(*) FROM releases WHERE status='pending_review'"),
        "failed_deliveries": one("SELECT COUNT(*) FROM deliveries WHERE status='failed'"),
        "top_tracks_week": top_items,
        "recent_deliveries": [dict(d) for d in recent_deliveries],
    }


# --------------------------------------------------------------------------
# NGHỆ SĨ
# --------------------------------------------------------------------------
class ArtistBody(BaseModel):
    name: str
    type: str = "person"
    country: Optional[str] = None
    isni: Optional[str] = None
    ipi: Optional[str] = None
    bio: Optional[str] = None
    accent: Optional[str] = None      # màu chủ đạo #RRGGBB (None = giữ nguyên)


def _artist_counts(conn: sqlite3.Connection, ids: list) -> tuple:
    """Đếm số track / release gắn với từng nghệ sĩ (batch 1 query mỗi loại)."""
    if not ids:
        return {}, {}
    qm = ",".join("?" * len(ids))
    tc = dict(conn.execute(
        f"SELECT artist_id, COUNT(DISTINCT track_id) FROM track_artists "
        f"WHERE artist_id IN ({qm}) GROUP BY artist_id", ids).fetchall())
    rc = dict(conn.execute(
        f"SELECT artist_id, COUNT(DISTINCT release_id) FROM release_artists "
        f"WHERE artist_id IN ({qm}) GROUP BY artist_id", ids).fetchall())
    return tc, rc


@router.get("/artists")
def admin_artists(q: str = "", conn: sqlite3.Connection = Depends(get_db)):
    like = f"%{normalize_text(q)}%"
    rows = conn.execute(
        "SELECT * FROM artists WHERE name_norm LIKE ? ORDER BY name LIMIT 200",
        (like,)).fetchall()
    items = serialize_artists(conn, rows)      # đã kèm followers
    tc, rc = _artist_counts(conn, [a["id"] for a in items])
    for a in items:
        a["track_count"] = tc.get(a["id"], 0)
        a["release_count"] = rc.get(a["id"], 0)
    return {"items": items}


@router.get("/artists/{artist_id}")
def admin_artist_detail(artist_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Hồ sơ nghệ sĩ đầy đủ cho trang chi tiết: metadata + top tracks + releases."""
    row = conn.execute("SELECT * FROM artists WHERE id=?", (artist_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy nghệ sĩ")
    item = serialize_artists(conn, [row])[0]   # shape chuẩn + followers
    raw = dict(row)
    for k in ("sort_name", "created_at", "updated_at"):
        item[k] = raw.get(k)
    tc, rc = _artist_counts(conn, [artist_id])
    item["track_count"] = tc.get(artist_id, 0)
    item["release_count"] = rc.get(artist_id, 0)
    item["top_tracks"] = [dict(r) for r in conn.execute(
        """SELECT t.id, t.title, t.isrc, t.play_count FROM tracks t
           JOIN track_artists ta ON ta.track_id = t.id
           WHERE ta.artist_id=? GROUP BY t.id
           ORDER BY t.play_count DESC, t.created_at DESC LIMIT 10""",
        (artist_id,)).fetchall()]
    item["releases"] = [dict(r) for r in conn.execute(
        """SELECT r.id, r.title, r.status FROM releases r
           JOIN release_artists ra ON ra.release_id = r.id
           WHERE ra.artist_id=? GROUP BY r.id
           ORDER BY r.created_at DESC LIMIT 50""",
        (artist_id,)).fetchall()]
    return item


@router.post("/artists/{artist_id}/image")
async def upload_artist_image(artist_id: str, file: UploadFile = File(...),
                              conn: sqlite3.Connection = Depends(get_db)):
    """Upload ảnh đại diện nghệ sĩ — PNG/JPG/WebP ≤5MB, lưu media/artists/."""
    if not conn.execute("SELECT 1 FROM artists WHERE id=?", (artist_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy nghệ sĩ")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in IMAGE_EXTS:
        raise HTTPException(400, "Ảnh nghệ sĩ chỉ nhận PNG/JPG/WebP")
    # token ngẫu nhiên trong tên → đổi ảnh là đổi URL, cache cũ không dính lại
    fname = f"{artist_id}_{secrets.token_hex(5)}{ext}"
    dest = ARTIST_IMG_DIR / fname
    size = 0
    with dest.open("wb") as f:
        while chunk := await file.read(256 * 1024):
            size += len(chunk)
            if size > IMAGE_MAX_BYTES:
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(400, "Ảnh tối đa 5MB")
            f.write(chunk)
    # dọn ảnh cũ của chính nghệ sĩ này
    for old in ARTIST_IMG_DIR.glob(f"{artist_id}_*"):
        if old.name != fname:
            old.unlink(missing_ok=True)
    url = f"/media/artists/{fname}"
    conn.execute("UPDATE artists SET image_url=?, updated_at=datetime('now') WHERE id=?",
                 (url, artist_id))
    return {"ok": True, "image_url": url}


@router.post("/artists", status_code=201)
def create_artist(body: ArtistBody, conn: sqlite3.Connection = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Tên nghệ sĩ không được để trống")
    aid = new_id()
    from ..covers import generate_avatar
    img = COVER_DIR / f"artist_{aid}.svg"
    accent = generate_avatar(img, seed=stable_seed(aid), name=name)
    conn.execute(
        "INSERT INTO artists(id,name,name_norm,sort_name,type,country,isni,ipi,bio,image_url,accent) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (aid, name, normalize_text(name), name, body.type, body.country,
         body.isni, body.ipi, body.bio, f"/media/covers/artist_{aid}.svg", accent))
    return {"id": aid}


@router.patch("/artists/{artist_id}")
def update_artist(artist_id: str, body: ArtistBody,
                  conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM artists WHERE id=?", (artist_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy nghệ sĩ")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Tên nghệ sĩ không được để trống")
    if body.accent is not None and body.accent != "" and not ACCENT_RE.match(body.accent):
        raise HTTPException(400, "accent phải là mã màu hex dạng #RRGGBB")
    # đổi tên → cập nhật cả name_norm (tìm kiếm không dấu) + sort_name
    conn.execute(
        "UPDATE artists SET name=?, name_norm=?, sort_name=?, type=?, country=?, "
        "isni=?, ipi=?, bio=?, updated_at=datetime('now') WHERE id=?",
        (name, normalize_text(name), name, body.type, body.country,
         body.isni, body.ipi, body.bio, artist_id))
    if body.accent:                    # None/rỗng = giữ màu hiện tại (additive)
        conn.execute("UPDATE artists SET accent=? WHERE id=?",
                     (body.accent, artist_id))
    return {"ok": True}


@router.delete("/artists/{artist_id}")
def delete_artist(artist_id: str, conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM artists WHERE id=?", (artist_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy nghệ sĩ")
    n_tracks = conn.execute("SELECT COUNT(*) FROM track_artists WHERE artist_id=?",
                            (artist_id,)).fetchone()[0]
    n_releases = conn.execute("SELECT COUNT(*) FROM release_artists WHERE artist_id=?",
                              (artist_id,)).fetchone()[0]
    if n_tracks or n_releases:
        raise HTTPException(
            409, f"Nghệ sĩ đang gắn với {n_tracks} bài hát và {n_releases} release "
                 f"— gỡ liên kết trước khi xóa")
    conn.execute("DELETE FROM follows WHERE artist_id=?", (artist_id,))
    conn.execute("DELETE FROM artists WHERE id=?", (artist_id,))
    # dọn file ảnh: ảnh upload media/artists/{id}_* + avatar SVG tự sinh
    for old in ARTIST_IMG_DIR.glob(f"{artist_id}_*"):
        old.unlink(missing_ok=True)
    (COVER_DIR / f"artist_{artist_id}.svg").unlink(missing_ok=True)
    return {"ok": True}


# --------------------------------------------------------------------------
# RELEASE (Album/Single/EP)
# --------------------------------------------------------------------------
class ReleaseBody(BaseModel):
    title: str
    upc: str
    release_type: str = "Album"
    label_name: Optional[str] = None
    genre: Optional[str] = None
    p_line: Optional[str] = None
    c_line: Optional[str] = None
    parental_warning: str = "NotExplicit"
    original_release_date: Optional[str] = None
    platform_release_date: Optional[str] = None
    artist_ids: Optional[list] = None    # None = giữ nguyên; [] = gỡ hết
    status: str = "draft"


@router.get("/releases")
def admin_releases(q: str = "", status: str = "",
                   conn: sqlite3.Connection = Depends(get_db)):
    like = f"%{normalize_text(q)}%"
    sql = "SELECT * FROM releases WHERE title_norm LIKE ?"
    args = [like]
    if status:
        sql += " AND status=?"
        args.append(status)
    rows = conn.execute(sql + " ORDER BY created_at DESC LIMIT 200", args).fetchall()
    return {"items": serialize_releases(conn, rows)}


def _validate_release_body(body: ReleaseBody):
    if not body.title.strip():
        raise HTTPException(400, "Thiếu tiêu đề")
    if not validate_upc(body.upc):
        raise HTTPException(400, "UPC không hợp lệ (12–14 số, checksum GTIN)")
    if body.release_type not in ("Album", "Single", "EP", "Compilation"):
        raise HTTPException(400, "release_type phải là Album|Single|EP|Compilation")
    if body.parental_warning not in ("Explicit", "NotExplicit", "Edited"):
        raise HTTPException(400, "parental_warning không hợp lệ")
    if body.status not in RELEASE_STATUSES:
        raise HTTPException(400, f"status phải là {'|'.join(RELEASE_STATUSES)}")


@router.post("/releases", status_code=201)
def create_release(body: ReleaseBody, conn: sqlite3.Connection = Depends(get_db)):
    _validate_release_body(body)
    _require_artists_exist(conn, body.artist_ids)
    if conn.execute("SELECT 1 FROM releases WHERE upc=?", (body.upc,)).fetchone():
        raise HTTPException(409, "UPC đã tồn tại")
    rid = new_id()
    cover = COVER_DIR / f"release_{rid}.svg"
    accent = generate_cover(cover, seed=stable_seed(rid),
                            title=body.title, subtitle=body.label_name or "")
    conn.execute(
        "INSERT INTO releases(id,upc,title,title_norm,release_type,label_name,genre,"
        "p_line,c_line,parental_warning,original_release_date,platform_release_date,"
        "cover_url,accent,status,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (rid, body.upc, body.title.strip(), normalize_text(body.title),
         body.release_type, body.label_name, body.genre, body.p_line, body.c_line,
         body.parental_warning, body.original_release_date, body.platform_release_date,
         f"/media/covers/release_{rid}.svg", accent, body.status, "admin_upload"))
    for seq, aid in enumerate(body.artist_ids or [], start=1):
        conn.execute(
            "INSERT OR IGNORE INTO release_artists(release_id,artist_id,role,sequence) "
            "VALUES(?,?,'MainArtist',?)", (rid, aid, seq))
    from ..idpool import mark_code_used
    mark_code_used(conn, "upc", body.upc, rid)
    return {"id": rid}


@router.patch("/releases/{release_id}")
def update_release(release_id: str, body: ReleaseBody,
                   conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM releases WHERE id=?", (release_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy release")
    _validate_release_body(body)
    _require_artists_exist(conn, body.artist_ids)
    dup = conn.execute("SELECT id FROM releases WHERE upc=? AND id != ?",
                       (body.upc, release_id)).fetchone()
    if dup:
        raise HTTPException(409, "UPC đã dùng cho release khác")
    conn.execute(
        "UPDATE releases SET upc=?, title=?, title_norm=?, release_type=?, label_name=?, "
        "genre=?, p_line=?, c_line=?, parental_warning=?, original_release_date=?, "
        "platform_release_date=?, status=? WHERE id=?",
        (body.upc, body.title.strip(), normalize_text(body.title), body.release_type,
         body.label_name, body.genre, body.p_line, body.c_line, body.parental_warning,
         body.original_release_date, body.platform_release_date, body.status, release_id))
    if body.artist_ids is not None:
        conn.execute("DELETE FROM release_artists WHERE release_id=?", (release_id,))
        for seq, aid in enumerate(body.artist_ids, start=1):
            conn.execute(
                "INSERT OR IGNORE INTO release_artists(release_id,artist_id,role,sequence) "
                "VALUES(?,?,'MainArtist',?)", (release_id, aid, seq))
    return {"ok": True}


@router.delete("/releases/{release_id}")
def delete_release(release_id: str, conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("DELETE FROM releases WHERE id=?", (release_id,))
    return {"ok": True}


@router.post("/releases/{release_id}/cover")
async def upload_cover(release_id: str, file: UploadFile = File(...),
                       conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM releases WHERE id=?", (release_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy release")
    ext = Path(file.filename or "").suffix.lower()
    # không nhận .svg từ upload — SVG có thể chứa script chạy trên origin của app
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "Chỉ nhận JPG/PNG/WebP")
    dest = COVER_DIR / f"release_{release_id}{ext}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    url = f"/media/covers/release_{release_id}{ext}"
    conn.execute("UPDATE releases SET cover_url=? WHERE id=?", (url, release_id))
    return {"ok": True, "cover_url": url}


class TracklistBody(BaseModel):
    track_ids: list  # thứ tự mới


@router.put("/releases/{release_id}/tracks")
def set_tracklist(release_id: str, body: TracklistBody,
                  conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM releases WHERE id=?", (release_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy release")
    # validate TRƯỚC khi xóa + gói trong transaction để không mất tracklist cũ
    if len(set(body.track_ids)) != len(body.track_ids):
        raise HTTPException(400, "Danh sách track có phần tử trùng")
    for tid in body.track_ids:
        if not conn.execute("SELECT 1 FROM tracks WHERE id=?", (tid,)).fetchone():
            raise HTTPException(400, f"Track không tồn tại: {tid}")
    conn.execute("BEGIN")
    try:
        conn.execute("DELETE FROM release_tracks WHERE release_id=?", (release_id,))
        for no, tid in enumerate(body.track_ids, start=1):
            conn.execute(
                "INSERT INTO release_tracks(release_id,track_id,disc_no,track_no) VALUES(?,?,1,?)",
                (release_id, tid, no))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {"ok": True}


# --------------------------------------------------------------------------
# TRACK (SoundRecording)
# --------------------------------------------------------------------------
class TrackBody(BaseModel):
    title: str
    isrc: str
    subtitle: Optional[str] = None
    language: str = "vi"
    genre: Optional[str] = None
    parental_warning: str = "NotExplicit"
    p_line: Optional[str] = None
    lyrics: Optional[str] = None
    lyrics_lrc: Optional[str] = None
    artist_ids: Optional[list] = None    # None = giữ nguyên; [] = gỡ hết
    release_id: Optional[str] = None
    status: str = "draft"


@router.get("/tracks")
def admin_tracks(q: str = "", status: str = "",
                 conn: sqlite3.Connection = Depends(get_db)):
    like = f"%{normalize_text(q)}%"
    sql = "SELECT * FROM tracks WHERE (title_norm LIKE ? OR isrc LIKE ?)"
    args = [like, f"%{q.upper()}%"]
    if status:
        sql += " AND status=?"
        args.append(status)
    rows = conn.execute(sql + " ORDER BY created_at DESC LIMIT 300", args).fetchall()
    return {"items": serialize_tracks(conn, rows)}


@router.post("/tracks", status_code=201)
def create_track(body: TrackBody, conn: sqlite3.Connection = Depends(get_db)):
    isrc = clean_isrc(body.isrc)
    if not validate_isrc(isrc):
        raise HTTPException(400, "ISRC sai định dạng (CC-XXX-YY-NNNNN)")
    if conn.execute("SELECT 1 FROM tracks WHERE isrc=?", (isrc,)).fetchone():
        raise HTTPException(409, "ISRC đã tồn tại")
    if not body.title.strip():
        raise HTTPException(400, "Thiếu tiêu đề")
    if body.parental_warning not in ("Explicit", "NotExplicit", "Edited"):
        raise HTTPException(400, "parental_warning không hợp lệ")
    _require_artists_exist(conn, body.artist_ids)
    if body.release_id and not conn.execute(
            "SELECT 1 FROM releases WHERE id=?", (body.release_id,)).fetchone():
        raise HTTPException(400, "Release không tồn tại")
    tid = new_id()
    conn.execute(
        "INSERT INTO tracks(id,isrc,title,title_norm,subtitle,language,genre,"
        "parental_warning,p_line,lyrics,lyrics_lrc,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, isrc, body.title.strip(), normalize_text(body.title), body.subtitle,
         body.language, body.genre, body.parental_warning, body.p_line,
         body.lyrics, body.lyrics_lrc, "draft"))
    for seq, aid in enumerate(body.artist_ids or [], start=1):
        role = "MainArtist" if seq == 1 else "FeaturedArtist"
        conn.execute(
            "INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)",
            (tid, aid, role, seq))
    if body.release_id:
        no = conn.execute(
            "SELECT COALESCE(MAX(track_no),0)+1 FROM release_tracks WHERE release_id=?",
            (body.release_id,)).fetchone()[0]
        conn.execute(
            "INSERT OR IGNORE INTO release_tracks(release_id,track_id,disc_no,track_no) "
            "VALUES(?,?,1,?)", (body.release_id, tid, no))
    from ..idpool import mark_code_used
    mark_code_used(conn, "isrc", isrc, tid)
    return {"id": tid}


@router.patch("/tracks/{track_id}")
def update_track(track_id: str, body: TrackBody,
                 conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy bài hát")
    isrc = clean_isrc(body.isrc)
    if not validate_isrc(isrc):
        raise HTTPException(400, "ISRC sai định dạng")
    dup = conn.execute("SELECT 1 FROM tracks WHERE isrc=? AND id != ?",
                       (isrc, track_id)).fetchone()
    if dup:
        raise HTTPException(409, "ISRC đã dùng cho bài khác")
    if body.status not in TRACK_STATUSES:
        raise HTTPException(400, f"status phải là {'|'.join(TRACK_STATUSES)}")
    if body.parental_warning not in ("Explicit", "NotExplicit", "Edited"):
        raise HTTPException(400, "parental_warning không hợp lệ")
    _require_artists_exist(conn, body.artist_ids)
    if body.status == "live" and not row["audio_path"]:
        raise HTTPException(400, "Chưa có file audio — không thể chuyển sang live")
    conn.execute(
        "UPDATE tracks SET isrc=?, title=?, title_norm=?, subtitle=?, language=?, genre=?, "
        "parental_warning=?, p_line=?, lyrics=?, lyrics_lrc=?, status=? WHERE id=?",
        (isrc, body.title.strip(), normalize_text(body.title), body.subtitle,
         body.language, body.genre, body.parental_warning, body.p_line,
         body.lyrics, body.lyrics_lrc, body.status, track_id))
    if body.artist_ids is not None:
        conn.execute("DELETE FROM track_artists WHERE track_id=?", (track_id,))
        for seq, aid in enumerate(body.artist_ids, start=1):
            role = "MainArtist" if seq == 1 else "FeaturedArtist"
            conn.execute(
                "INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)",
                (track_id, aid, role, seq))
    return {"ok": True}


@router.delete("/tracks/{track_id}")
def delete_track(track_id: str, conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute(
        "SELECT audio_path, master_path FROM tracks WHERE id=?", (track_id,)).fetchone()
    if row:
        if row["audio_path"]:
            p = AUDIO_DIR / row["audio_path"]
            if p.is_file():
                p.unlink()
        # dọn cả bản gốc WAV trong media/masters (file lớn nhất — nếu quên sẽ rò rỉ đĩa)
        if row["master_path"]:
            from ..config import MASTER_DIR
            mp = MASTER_DIR / Path(row["master_path"]).name
            if mp.is_file():
                mp.unlink()
    from ..waveform import invalidate_waveform
    invalidate_waveform(track_id)
    conn.execute("DELETE FROM tracks WHERE id=?", (track_id,))
    return {"ok": True}


def _audio_duration_ms(path: Path) -> int:
    try:
        import mutagen
        mf = mutagen.File(str(path))
        if mf and mf.info and mf.info.length:
            return int(mf.info.length * 1000)
    except Exception:
        pass
    if path.suffix.lower() == ".wav":
        import wave
        try:
            with wave.open(str(path), "rb") as wf:
                return int(wf.getnframes() / wf.getframerate() * 1000)
        except Exception:
            return 0
    return 0


async def ingest_track_audio(conn: sqlite3.Connection, track_id: str,
                             file: UploadFile) -> dict:
    """Nạp + chuẩn hóa audio cho 1 track (dùng chung: admin.py & products.py).
    Người gọi tự lo phân quyền TRƯỚC khi gọi hàm này."""
    row = conn.execute("SELECT audio_path FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy bài hát")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in AUDIO_CONTENT_TYPES:
        raise HTTPException(400, f"Định dạng không hỗ trợ ({ext}). "
                                 f"Nhận: {', '.join(AUDIO_CONTENT_TYPES)}")

    # Ghi vào file tạm — chỉ thay file thật khi validate xong,
    # upload hỏng không phá file audio đang phát.
    tmp = AUDIO_DIR / f"{track_id}.uploading{ext}"
    sha = hashlib.sha256()
    try:
        with tmp.open("wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                sha.update(chunk)
                f.write(chunk)
        duration = _audio_duration_ms(tmp)
        if duration <= 0:
            raise HTTPException(400, "File audio không đọc được (hỏng hoặc sai định dạng)")
        dest = AUDIO_DIR / f"{track_id}{ext}"
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)

    # chuẩn hóa: bản gốc WAV 44.1kHz (masters/) + bản stream AAC (nếu có ffmpeg)
    from ..transcode import process_audio
    audio_name, master_name = dest.name, None
    tr = process_audio(dest, track_id)
    if tr:
        audio_name, master_name = tr["audio_name"], tr["master_name"]
        if dest.name != audio_name:
            dest.unlink(missing_ok=True)     # file upload gốc đã chuẩn hóa xong

    digest = sha.hexdigest()
    dup = conn.execute(
        "SELECT id, title FROM tracks WHERE audio_hash=? AND id != ?",
        (digest, track_id)).fetchone()

    # đổi định dạng file → dọn file cũ khác tên
    old = row["audio_path"]
    if old and old != audio_name:
        (AUDIO_DIR / old).unlink(missing_ok=True)

    conn.execute(
        "UPDATE tracks SET audio_path=?, master_path=?, audio_hash=?, duration_ms=? WHERE id=?",
        (audio_name, master_name, digest, duration, track_id))
    from ..waveform import invalidate_waveform
    invalidate_waveform(track_id)      # audio mới → phân tích lại waveform
    return {"ok": True, "duration_ms": duration, "sha256": digest,
            "transcoded": bool(tr),
            "duplicate_of": dict(dup) if dup else None}


@router.post("/tracks/{track_id}/audio")
async def upload_audio(track_id: str, file: UploadFile = File(...),
                       conn: sqlite3.Connection = Depends(get_db)):
    """Upload audio (manager/admin — router-level require_manager)."""
    return await ingest_track_audio(conn, track_id, file)


# --------------------------------------------------------------------------
# DDEX INGESTION
# --------------------------------------------------------------------------
@router.post("/ddex/import")
async def ddex_import(file: UploadFile = File(...),
                      auto_publish: bool = Query(False),
                      conn: sqlite3.Connection = Depends(get_db)):
    xml_bytes = await file.read()
    if len(xml_bytes) > 20 * 1024 * 1024:
        raise HTTPException(413, "File XML quá lớn")
    report = import_delivery(conn, xml_bytes, auto_publish=auto_publish)
    return report


@router.get("/deliveries")
def deliveries(status: str = "", conn: sqlite3.Connection = Depends(get_db)):
    sql = "SELECT * FROM deliveries"
    args = []
    if status:
        sql += " WHERE status=?"
        args.append(status)
    rows = conn.execute(sql + " ORDER BY received_at DESC LIMIT 200", args).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/deliveries/{delivery_id}")
def delivery_detail(delivery_id: str, conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT * FROM deliveries WHERE id=?", (delivery_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy delivery")
    return dict(row)


# --------------------------------------------------------------------------
# REVIEW QUEUE
# --------------------------------------------------------------------------
@router.get("/review-queue")
def review_queue(conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        "SELECT * FROM releases WHERE status='pending_review' ORDER BY created_at").fetchall()
    return {"items": serialize_releases(conn, rows)}


@router.post("/review-queue/{release_id}/approve")
def approve(release_id: str, user: dict = Depends(require_manager),
            conn: sqlite3.Connection = Depends(get_db)):
    """Duyệt từ hàng chờ.
    - Product tạo trong CMS (source='product') → CHUNG pipeline publish v2.0
      (QC + cấp UPC + deal + published_at) để không lên live thiếu dữ liệu.
    - Release nhập từ DDEX (đã validate ở khâu ingestion, có sẵn UPC/deal) →
      chỉ chuyển trạng thái, KHÔNG bắt qua QC của product module."""
    row = conn.execute("SELECT * FROM releases WHERE id=? AND status='pending_review'",
                       (release_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Release không nằm trong hàng chờ duyệt")
    if row["source"] == "product":
        from .products import _do_publish
        return _do_publish(conn, row, user["email"], action="approve")
    # release nhập ngoài (DDEX/studio) — flip trạng thái như cũ
    future = conn.execute(
        "SELECT 1 FROM releases WHERE id=? AND platform_release_date > datetime('now')",
        (release_id,)).fetchone()
    new_status = "scheduled" if future else "live"
    conn.execute("UPDATE releases SET status=? WHERE id=?", (new_status, release_id))
    if new_status == "live":
        conn.execute(
            """UPDATE tracks SET status = CASE WHEN audio_path IS NOT NULL THEN 'live' ELSE 'draft' END
               WHERE id IN (SELECT track_id FROM release_tracks WHERE release_id=?)
                 AND status IN ('draft','pending_review')""", (release_id,))
    return {"ok": True, "status": new_status}


class RejectQueueBody(BaseModel):
    note: str = ""


@router.post("/review-queue/{release_id}/reject")
def reject(release_id: str, body: RejectQueueBody = None,
           user: dict = Depends(require_manager),
           conn: sqlite3.Connection = Depends(get_db)):
    """Từ chối → về DRAFT + ghi review_note để người tạo sửa lại (KHÔNG takedown,
    tránh product của uploader bị kẹt vĩnh viễn không sửa được)."""
    row = conn.execute("SELECT * FROM releases WHERE id=? AND status='pending_review'",
                       (release_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Release không nằm trong hàng chờ duyệt")
    note = ((body.note if body else "") or "").strip() or "Bị từ chối duyệt phát hành"
    conn.execute("UPDATE releases SET status='draft', review_note=? WHERE id=?",
                 (note, release_id))
    from .products import _log_action
    _log_action(conn, release_id, "reject", user["email"], "success", note)
    return {"ok": True, "status": "draft"}


# --------------------------------------------------------------------------
# KHO MÃ UPC / ISRC
# --------------------------------------------------------------------------
class PoolAddBody(BaseModel):
    kind: str                    # isrc | upc
    codes: list


def _validate_pool_code(kind: str, raw: str) -> Optional[str]:
    """Chuẩn hóa + validate 1 mã. Trả về mã sạch hoặc None nếu sai định dạng."""
    code = raw.strip().upper()
    if kind == "isrc":
        code = clean_isrc(code)
        return code if validate_isrc(code) else None
    code = code.replace("-", "").replace(" ", "")
    return code if validate_upc(code) else None


def _pool_add_codes(conn: sqlite3.Connection, kind: str, raw_codes: list) -> dict:
    from ..db import new_id as _nid
    added, skipped = [], []
    for raw in raw_codes:
        if not str(raw).strip():
            continue
        code = _validate_pool_code(kind, str(raw))
        if not code:
            skipped.append({"code": str(raw).strip(), "reason": "sai định dạng/checksum"})
            continue
        if conn.execute("SELECT 1 FROM id_pool WHERE code=?", (code,)).fetchone():
            skipped.append({"code": code, "reason": "đã có trong kho"})
            continue
        table, col = ("tracks", "isrc") if kind == "isrc" else ("releases", "upc")
        in_use = conn.execute(f"SELECT 1 FROM {table} WHERE {col}=?", (code,)).fetchone()
        conn.execute(
            "INSERT INTO id_pool(id,kind,code,status,used_at) "
            "VALUES(?,?,?,?, CASE WHEN ? THEN datetime('now') END)",
            (_nid(), kind, code, "used" if in_use else "available",
             1 if in_use else 0))
        (skipped if in_use else added).append(
            {"code": code, "reason": "catalog đã dùng — lưu trạng thái used"} if in_use else code)
    return {"added": added, "skipped": skipped}


@router.get("/idpool")
def idpool_list(kind: str = Query("isrc", pattern="^(isrc|upc)$"),
                status: str = "", conn: sqlite3.Connection = Depends(get_db)):
    from ..idpool import auto_enabled, pool_counts
    sql = "SELECT * FROM id_pool WHERE kind=?"
    args: list = [kind]
    if status in ("available", "used"):
        sql += " AND status=?"
        args.append(status)
    rows = conn.execute(sql + " ORDER BY status, added_at DESC, code LIMIT 500",
                        args).fetchall()
    return {
        "items": [dict(r) for r in rows],
        **pool_counts(conn, kind),
        "auto_generate": auto_enabled(conn, kind),
    }


@router.post("/idpool", status_code=201)
def idpool_add(body: PoolAddBody, conn: sqlite3.Connection = Depends(get_db)):
    if body.kind not in ("isrc", "upc"):
        raise HTTPException(400, "kind phải là isrc|upc")
    if not body.codes:
        raise HTTPException(400, "Chưa có mã nào")
    if len(body.codes) > 10000:
        raise HTTPException(400, "Tối đa 10.000 mã mỗi lần")
    return _pool_add_codes(conn, body.kind, body.codes)


@router.post("/idpool/import")
async def idpool_import(kind: str = Query(..., pattern="^(isrc|upc)$"),
                        file: UploadFile = File(...),
                        conn: sqlite3.Connection = Depends(get_db)):
    """Import file .txt — mỗi dòng một mã (chấp nhận phân tách bởi dấu phẩy)."""
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(413, "File quá lớn (tối đa 2MB)")
    text = raw.decode("utf-8", errors="replace")
    codes = [c for line in text.splitlines() for c in line.split(",")]
    if not any(c.strip() for c in codes):
        raise HTTPException(400, "File không có mã nào")
    return _pool_add_codes(conn, kind, codes)


@router.delete("/idpool/{pool_id}")
def idpool_delete(pool_id: str, conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT status FROM id_pool WHERE id=?", (pool_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy mã")
    if row["status"] != "available":
        raise HTTPException(409, "Mã đã dùng — không thể xóa khỏi kho")
    conn.execute("DELETE FROM id_pool WHERE id=?", (pool_id,))
    return {"ok": True}


class PoolSettingsBody(BaseModel):
    kind: str
    auto_generate: bool


@router.patch("/idpool/settings")
def idpool_settings(body: PoolSettingsBody,
                    conn: sqlite3.Connection = Depends(get_db)):
    from ..db import set_setting
    from ..idpool import AUTO_KEYS
    if body.kind not in AUTO_KEYS:
        raise HTTPException(400, "kind phải là isrc|upc")
    set_setting(conn, AUTO_KEYS[body.kind], "1" if body.auto_generate else "0")
    return {"ok": True, "auto_generate": body.auto_generate}


# --------------------------------------------------------------------------
# ĐỐI TÁC DELIVERY (distributor/label — mục 6.2 tài liệu ý tưởng)
# CHỈ ADMIN — liên quan API key, không mở cho manager.
# --------------------------------------------------------------------------
class PartnerBody(BaseModel):
    name: str
    dpid: Optional[str] = None
    contact_email: Optional[str] = None
    auto_publish: bool = False


@router.get("/partners", dependencies=[Depends(require_admin)])
def list_partners(conn: sqlite3.Connection = Depends(get_db)):
    # chỉ đối tác kênh API (SFTP distribution nằm ở màn Distributions riêng)
    rows = conn.execute(
        """SELECT p.*, (SELECT COUNT(*) FROM deliveries d WHERE d.partner_id = p.id)
                  AS delivery_count
           FROM delivery_partners p
           WHERE p.delivery_channel IS NULL OR p.delivery_channel='api'
           ORDER BY p.created_at DESC""").fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d.pop("api_key_hash", None)      # không bao giờ trả hash ra ngoài
        d["auto_publish"] = bool(d["auto_publish"])
        items.append(d)
    return {"items": items}


def _new_api_key() -> str:
    import secrets
    return "ans_" + secrets.token_urlsafe(32)


@router.post("/partners", status_code=201, dependencies=[Depends(require_admin)])
def create_partner(body: PartnerBody, conn: sqlite3.Connection = Depends(get_db)):
    from .ingestion import hash_api_key
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Thiếu tên đối tác")
    if body.dpid and conn.execute(
            "SELECT 1 FROM delivery_partners WHERE dpid=?", (body.dpid,)).fetchone():
        raise HTTPException(409, "DPID đã tồn tại")
    pid = new_id()
    api_key = _new_api_key()
    conn.execute(
        "INSERT INTO delivery_partners(id,name,dpid,contact_email,api_key_hash,"
        "auto_publish,delivery_channel) VALUES(?,?,?,?,?,?,'api')",
        (pid, name, body.dpid or None, body.contact_email,
         hash_api_key(api_key), int(body.auto_publish)))
    # api_key chỉ trả về ĐÚNG MỘT LẦN — server chỉ lưu hash
    return {"id": pid, "api_key": api_key}


@router.patch("/partners/{partner_id}", dependencies=[Depends(require_admin)])
def update_partner(partner_id: str, body: PartnerBody,
                   conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM delivery_partners WHERE id=?",
                        (partner_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy đối tác")
    if not body.name.strip():
        raise HTTPException(400, "Thiếu tên đối tác")
    if body.dpid and conn.execute(
            "SELECT 1 FROM delivery_partners WHERE dpid=? AND id!=?",
            (body.dpid, partner_id)).fetchone():
        raise HTTPException(409, "DPID đã thuộc đối tác/distribution khác")
    conn.execute(
        "UPDATE delivery_partners SET name=?, dpid=?, contact_email=?, auto_publish=? "
        "WHERE id=?",
        (body.name.strip(), body.dpid or None, body.contact_email,
         int(body.auto_publish), partner_id))
    return {"ok": True}


@router.post("/partners/{partner_id}/regenerate-key",
             dependencies=[Depends(require_admin)])
def regenerate_key(partner_id: str, conn: sqlite3.Connection = Depends(get_db)):
    from .ingestion import hash_api_key
    if not conn.execute("SELECT 1 FROM delivery_partners WHERE id=?",
                        (partner_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy đối tác")
    api_key = _new_api_key()
    conn.execute("UPDATE delivery_partners SET api_key_hash=? WHERE id=?",
                 (hash_api_key(api_key), partner_id))
    return {"api_key": api_key}


@router.delete("/partners/{partner_id}", dependencies=[Depends(require_admin)])
def delete_partner(partner_id: str, conn: sqlite3.Connection = Depends(get_db)):
    _drop_sftp_dropbox(conn, partner_id)
    conn.execute("DELETE FROM delivery_partners WHERE id=?", (partner_id,))
    return {"ok": True}


# --------------------------------------------------------------------------
# DISTRIBUTION SFTP (DDEX delivery kiểu YouTube) — CHỈ ADMIN
# Distribution = delivery_partner có delivery_channel='sftp' + SSH key + dropbox.
# --------------------------------------------------------------------------
class DistributionBody(BaseModel):
    name: str
    dpid: Optional[str] = None
    contact_email: Optional[str] = None
    auto_publish: bool = False
    # để trống → server tự sinh cặp key (trả private 1 lần); có → dùng public đối tác dán vào
    public_key: Optional[str] = None


def _drop_sftp_dropbox(conn: sqlite3.Connection, partner_id: str):
    """Xóa thư mục dropbox SFTP khi xóa distribution."""
    import shutil
    from ..config import SFTP_ROOT
    row = conn.execute("SELECT sftp_username FROM delivery_partners WHERE id=?",
                       (partner_id,)).fetchone()
    if row and row["sftp_username"]:
        shutil.rmtree(SFTP_ROOT / row["sftp_username"], ignore_errors=True)


def _sftp_conn_info() -> dict:
    """Thông tin kết nối SFTP quảng bá cho đối tác."""
    from ..config import PUBLIC_HOST, SFTP_ENABLED, SFTP_PORT
    from ..distributions import host_key_fingerprint
    host = PUBLIC_HOST
    if not host:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            host = s.getsockname()[0]
        except OSError:
            host = "127.0.0.1"
        finally:
            s.close()
    return {"host": host, "port": SFTP_PORT, "enabled": SFTP_ENABLED,
            "host_key_fingerprint": host_key_fingerprint()}


@router.get("/sftp-info", dependencies=[Depends(require_admin)])
def sftp_info():
    """Cấu hình SFTP server (host, cổng, fingerprint host key) để chỉ đối tác."""
    return _sftp_conn_info()


@router.get("/distributions", dependencies=[Depends(require_admin)])
def list_distributions(conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        """SELECT p.id, p.name, p.dpid, p.contact_email, p.auto_publish,
                  p.sftp_username, p.ssh_fingerprint, p.last_delivery_at, p.created_at,
                  (SELECT COUNT(*) FROM deliveries d WHERE d.partner_id=p.id) AS delivery_count
           FROM delivery_partners p WHERE p.delivery_channel='sftp'
           ORDER BY p.created_at DESC""").fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["auto_publish"] = bool(d["auto_publish"])
        items.append(d)
    return {"items": items, "sftp": _sftp_conn_info()}


@router.post("/distributions", status_code=201, dependencies=[Depends(require_admin)])
def create_distribution(body: DistributionBody,
                        conn: sqlite3.Connection = Depends(get_db)):
    from ..config import SFTP_ROOT
    from ..distributions import (fingerprint_of, generate_keypair,
                                 make_sftp_username, normalize_public_key)
    from .ingestion import hash_api_key
    import secrets
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Thiếu tên distribution")
    if body.dpid and conn.execute(
            "SELECT 1 FROM delivery_partners WHERE dpid=?", (body.dpid,)).fetchone():
        raise HTTPException(409, "DPID đã tồn tại")

    # 1) key: đối tác dán public, hoặc server sinh cặp (trả private 1 lần)
    private_key = None
    if body.public_key and body.public_key.strip():
        try:
            public_key = normalize_public_key(body.public_key)
        except ValueError as e:
            raise HTTPException(400, str(e))
        fp = fingerprint_of(public_key)
    else:
        kp = generate_keypair()
        public_key, private_key, fp = kp["public_key"], kp["private_key"], kp["fingerprint"]

    pid = new_id()
    username = make_sftp_username(name, secrets.token_hex(3))
    # dropbox chroot
    for sub in ("incoming", "processed", "failed"):
        (SFTP_ROOT / username / sub).mkdir(parents=True, exist_ok=True)
    conn.execute(
        "INSERT INTO delivery_partners(id,name,dpid,contact_email,api_key_hash,"
        "auto_publish,delivery_channel,sftp_username,ssh_public_key,ssh_fingerprint) "
        "VALUES(?,?,?,?,?,?,'sftp',?,?,?)",
        (pid, name, body.dpid or None, body.contact_email,
         hash_api_key("sftp_" + secrets.token_urlsafe(16)),   # SFTP không dùng api_key nhưng cột NOT NULL
         int(body.auto_publish), username, public_key, fp))
    # private_key chỉ trả 1 LẦN (server KHÔNG lưu) để admin đưa cho đối tác
    return {"id": pid, "sftp_username": username, "ssh_public_key": public_key,
            "ssh_fingerprint": fp, "private_key": private_key,
            "sftp": _sftp_conn_info()}


@router.post("/distributions/{dist_id}/rotate-key",
             dependencies=[Depends(require_admin)])
def rotate_distribution_key(dist_id: str, body: DistributionBody = None,
                            conn: sqlite3.Connection = Depends(get_db)):
    """Cấp lại key (đối tác mất private, hoặc đổi sang public key mới đối tác dán)."""
    from ..distributions import fingerprint_of, generate_keypair, normalize_public_key
    row = conn.execute("SELECT 1 FROM delivery_partners WHERE id=? AND delivery_channel='sftp'",
                       (dist_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy distribution")
    private_key = None
    if body and body.public_key and body.public_key.strip():
        try:
            public_key = normalize_public_key(body.public_key)
        except ValueError as e:
            raise HTTPException(400, str(e))
        fp = fingerprint_of(public_key)
    else:
        kp = generate_keypair()
        public_key, private_key, fp = kp["public_key"], kp["private_key"], kp["fingerprint"]
    conn.execute("UPDATE delivery_partners SET ssh_public_key=?, ssh_fingerprint=? WHERE id=?",
                 (public_key, fp, dist_id))
    return {"ssh_public_key": public_key, "ssh_fingerprint": fp, "private_key": private_key}


@router.patch("/distributions/{dist_id}", dependencies=[Depends(require_admin)])
def update_distribution(dist_id: str, body: DistributionBody,
                        conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM delivery_partners WHERE id=? AND delivery_channel='sftp'",
                        (dist_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy distribution")
    if not body.name.strip():
        raise HTTPException(400, "Thiếu tên")
    if body.dpid and conn.execute(
            "SELECT 1 FROM delivery_partners WHERE dpid=? AND id!=?",
            (body.dpid, dist_id)).fetchone():
        raise HTTPException(409, "DPID đã thuộc đối tác/distribution khác")
    conn.execute(
        "UPDATE delivery_partners SET name=?, dpid=?, contact_email=?, auto_publish=? WHERE id=?",
        (body.name.strip(), body.dpid or None, body.contact_email,
         int(body.auto_publish), dist_id))
    return {"ok": True}


@router.get("/distributions/{dist_id}/deliveries",
            dependencies=[Depends(require_admin)])
def distribution_deliveries(dist_id: str, conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        "SELECT id, message_id, message_type, ern_version, status, received_at, "
        "processed_at FROM deliveries WHERE partner_id=? ORDER BY received_at DESC LIMIT 50",
        (dist_id,)).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.delete("/distributions/{dist_id}", dependencies=[Depends(require_admin)])
def delete_distribution(dist_id: str, conn: sqlite3.Connection = Depends(get_db)):
    _drop_sftp_dropbox(conn, dist_id)
    conn.execute("DELETE FROM delivery_partners WHERE id=?", (dist_id,))
    return {"ok": True}


# --------------------------------------------------------------------------
# QUẢN LÝ TÀI KHOẢN — CHỈ ADMIN (manager không đụng được người dùng)
# --------------------------------------------------------------------------
class UserCreateBody(BaseModel):
    email: str
    password: str
    display_name: str = ""
    role: str = "user"
    plan: str = "free"


class UserPatchBody(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    plan: Optional[str] = None


class AdminResetPasswordBody(BaseModel):
    new_password: str


def _get_user_or_404(conn: sqlite3.Connection, user_id: str) -> dict:
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy người dùng")
    return dict(row)


def _admin_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]


@router.get("/users", dependencies=[Depends(require_admin)])
def admin_users(q: str = "", role: str = "",
                conn: sqlite3.Connection = Depends(get_db)):
    """Danh sách tài khoản: ?q= tìm theo email/tên, ?role= lọc theo vai trò."""
    if role and role not in VALID_ROLES:
        raise HTTPException(400, f"role phải là {'|'.join(VALID_ROLES)}")
    sql = """SELECT u.id, u.email, u.display_name, u.role, u.plan, u.created_at,
                    u.avatar_url, u.email_verified, u.totp_enabled,
                    (SELECT COUNT(*) FROM playlists p WHERE p.owner_id=u.id) AS playlists,
                    (SELECT COUNT(*) FROM play_history ph WHERE ph.user_id=u.id) AS plays
             FROM users u WHERE 1=1"""
    args: list = []
    if q.strip():
        like = f"%{q.strip()}%"
        sql += " AND (u.email LIKE ? OR COALESCE(u.display_name,'') LIKE ?)"
        args += [like, like]
    if role:
        sql += " AND u.role=?"
        args.append(role)
    rows = conn.execute(sql + " ORDER BY u.created_at DESC LIMIT 500", args).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["email_verified"] = bool(d.get("email_verified"))
        d["totp_enabled"] = bool(d.get("totp_enabled"))
        items.append(d)
    return {"items": items}


@router.post("/users", status_code=201, dependencies=[Depends(require_admin)])
def admin_create_user(body: UserCreateBody,
                      conn: sqlite3.Connection = Depends(get_db)):
    """Admin tạo tài khoản trực tiếp — bỏ qua bước xác thực email (email_verified=1)."""
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Email không hợp lệ")
    if len(body.password) < 6:
        raise HTTPException(400, "Mật khẩu tối thiểu 6 ký tự")
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"role phải là {'|'.join(VALID_ROLES)}")
    if body.plan not in VALID_PLANS:
        raise HTTPException(400, f"plan phải là {'|'.join(VALID_PLANS)}")
    if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        raise HTTPException(409, "Email đã được đăng ký")
    uid = new_id()
    name = body.display_name.strip() or email.split("@")[0]
    conn.execute(
        "INSERT INTO users(id,email,password_hash,display_name,role,plan,email_verified) "
        "VALUES(?,?,?,?,?,?,1)",
        (uid, email, hash_password(body.password), name, body.role, body.plan))
    return {"id": uid, "email": email, "display_name": name,
            "role": body.role, "plan": body.plan}


@router.patch("/users/{user_id}")
def admin_update_user(user_id: str, body: UserPatchBody,
                      admin: dict = Depends(require_admin),
                      conn: sqlite3.Connection = Depends(get_db)):
    target = _get_user_or_404(conn, user_id)
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(400, f"role phải là {'|'.join(VALID_ROLES)}")
        if body.role != target["role"]:
            # tự đổi role chính mình = khóa nhầm cửa — chặn tuyệt đối
            if user_id == admin["id"]:
                raise HTTPException(400, "Không thể tự đổi vai trò của chính mình")
            # hạ admin cuối: khóa ghi TRƯỚC khi đếm để 2 request đồng thời không
            # cùng vượt qua guard (BEGIN IMMEDIATE serialize việc kiểm tra + ghi)
            conn.execute("BEGIN IMMEDIATE")
            try:
                if target["role"] == "admin" and _admin_count(conn) <= 1:
                    conn.execute("ROLLBACK")
                    raise HTTPException(400, "Phải còn ít nhất 1 admin")
                conn.execute("UPDATE users SET role=? WHERE id=?", (body.role, user_id))
                conn.execute("COMMIT")
            except HTTPException:
                raise
            except Exception:
                conn.execute("ROLLBACK")
                raise
    if body.plan is not None:
        if body.plan not in VALID_PLANS:
            raise HTTPException(400, f"plan phải là {'|'.join(VALID_PLANS)}")
        conn.execute("UPDATE users SET plan=? WHERE id=?", (body.plan, user_id))
    if body.display_name is not None:
        name = body.display_name.strip()
        if not name:
            raise HTTPException(400, "Tên hiển thị không được để trống")
        conn.execute("UPDATE users SET display_name=? WHERE id=?", (name, user_id))
    return {"ok": True}


@router.post("/users/{user_id}/reset-password",
             dependencies=[Depends(require_admin)])
def admin_reset_password(user_id: str, body: AdminResetPasswordBody,
                         conn: sqlite3.Connection = Depends(get_db)):
    """Admin đặt mật khẩu mới cho tài khoản (quên mật khẩu + không nhận được email)."""
    _get_user_or_404(conn, user_id)
    if len(body.new_password) < 6:
        raise HTTPException(400, "Mật khẩu tối thiểu 6 ký tự")
    # tăng token_version → token cũ của tài khoản đó hết hiệu lực ngay
    conn.execute(
        "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
        (hash_password(body.new_password), user_id))
    return {"ok": True, "message": "Đã đặt mật khẩu mới"}


@router.post("/users/{user_id}/disable-2fa",
             dependencies=[Depends(require_admin)])
def admin_disable_2fa(user_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Gỡ 2FA khi người dùng mất thiết bị xác thực."""
    _get_user_or_404(conn, user_id)
    conn.execute("UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?",
                 (user_id,))
    return {"ok": True, "message": "Đã tắt xác thực 2 lớp của tài khoản"}


@router.delete("/users/{user_id}")
def admin_delete_user(user_id: str, admin: dict = Depends(require_admin),
                      conn: sqlite3.Connection = Depends(get_db)):
    target = _get_user_or_404(conn, user_id)
    if user_id == admin["id"]:
        raise HTTPException(400, "Không thể tự xóa tài khoản của chính mình")
    # Cascade sạch trong 1 transaction — dữ liệu cá nhân xóa hết,
    # NỘI DUNG (releases uploader đã tạo) giữ lại, chỉ gỡ liên kết created_by.
    # BEGIN IMMEDIATE + đếm admin BÊN TRONG khóa ghi → 2 xóa admin đồng thời
    # không cùng vượt guard (chống mất admin cuối do race).
    conn.execute("BEGIN IMMEDIATE")
    try:
        if target["role"] == "admin" and _admin_count(conn) <= 1:
            conn.execute("ROLLBACK")
            raise HTTPException(400, "Phải còn ít nhất 1 admin")
        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id IN "
            "(SELECT id FROM playlists WHERE owner_id=?)", (user_id,))
        conn.execute("DELETE FROM playlists WHERE owner_id=?", (user_id,))
        conn.execute("DELETE FROM favorites WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM follows WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM play_history WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM email_codes WHERE email=?", (target["email"],))
        conn.execute("UPDATE releases SET created_by=NULL WHERE created_by=?",
                     (user_id,))
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        conn.execute("COMMIT")
    except HTTPException:
        raise
    except Exception:
        conn.execute("ROLLBACK")
        raise
    # DB xong mới dọn file avatar (lỗi file không làm hỏng transaction)
    for old in AVATAR_DIR.glob(f"{user_id}_*"):
        old.unlink(missing_ok=True)
    return {"ok": True}
