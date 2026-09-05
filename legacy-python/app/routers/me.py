"""Không gian cá nhân: hồ sơ, 2FA, playlist, yêu thích, theo dõi, lịch sử nghe."""
import secrets as _secrets
import shutil
import sqlite3
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from ..branding import get_brand
from ..config import AVATAR_DIR, COVER_DIR
from ..covers import generate_cover
from ..db import get_db, new_id
from ..qr_svg import qr_svg
from ..security import (create_token, get_current_user, hash_password,
                        verify_password)
from ..serializers import (serialize_artists, serialize_playlists,
                           serialize_releases, serialize_tracks)
from ..totp import new_secret, otpauth_uri, verify_totp
from ..utils import stable_seed

router = APIRouter(prefix="/v1/me", tags=["me"])

AVATAR_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")
AVATAR_MAX_BYTES = 5 * 1024 * 1024   # 5MB


class PlaylistBody(BaseModel):
    title: str
    description: Optional[str] = None
    visibility: str = "private"


class PlaylistPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[str] = None


class AddTrackBody(BaseModel):
    track_id: str


class OrderBody(BaseModel):
    track_ids: List[str]


class ProfilePatch(BaseModel):
    display_name: Optional[str] = None
    settings: Optional[dict] = None


@router.get("")
def me(user: dict = Depends(get_current_user)):
    return {k: user[k] for k in
            ("id", "email", "display_name", "role", "plan", "avatar_url", "settings")}


@router.get("/profile")
def my_profile(user: dict = Depends(get_current_user),
               conn: sqlite3.Connection = Depends(get_db)):
    """Hồ sơ đầy đủ cho trang Profile: thông tin + thống kê + trạng thái 2FA."""
    uid = user["id"]
    stats = {
        "playlists": conn.execute(
            "SELECT COUNT(*) FROM playlists WHERE owner_id=?", (uid,)).fetchone()[0],
        "favorites": conn.execute(
            "SELECT COUNT(*) FROM favorites WHERE user_id=? AND entity_type='track'",
            (uid,)).fetchone()[0],
        "follows": conn.execute(
            "SELECT COUNT(*) FROM follows WHERE user_id=?", (uid,)).fetchone()[0],
        "plays": conn.execute(
            "SELECT COUNT(*) FROM play_history WHERE user_id=?", (uid,)).fetchone()[0],
    }
    return {
        "id": uid, "email": user["email"], "display_name": user["display_name"],
        "role": user["role"], "plan": user["plan"],
        "avatar_url": user.get("avatar_url"),
        "created_at": user.get("created_at"),
        "email_verified": bool(user.get("email_verified", 1)),
        "totp_enabled": bool(user.get("totp_enabled")),
        "stats": stats,
    }


# --------------------------------------------------------------------------
# AVATAR + ĐỔI MẬT KHẨU
# --------------------------------------------------------------------------
@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...),
                        user: dict = Depends(get_current_user),
                        conn: sqlite3.Connection = Depends(get_db)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in AVATAR_EXTS:
        raise HTTPException(400, "Avatar chỉ nhận PNG/JPG/WebP/GIF")
    fname = f"{user['id']}_{_secrets.token_hex(5)}{ext}"
    dest = AVATAR_DIR / fname
    size = 0
    with dest.open("wb") as f:
        while chunk := await file.read(256 * 1024):
            size += len(chunk)
            if size > AVATAR_MAX_BYTES:
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(400, "Ảnh tối đa 5MB")
            f.write(chunk)
    # dọn avatar cũ của chính user
    for old in AVATAR_DIR.glob(f"{user['id']}_*"):
        if old.name != fname:
            old.unlink(missing_ok=True)
    url = f"/media/avatars/{fname}"
    conn.execute("UPDATE users SET avatar_url=? WHERE id=?", (url, user["id"]))
    return {"ok": True, "avatar_url": url}


class PasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/password")
def change_password(body: PasswordBody, user: dict = Depends(get_current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(400, "Mật khẩu hiện tại không đúng")
    if len(body.new_password) < 6:
        raise HTTPException(400, "Mật khẩu mới tối thiểu 6 ký tự")
    # tăng token_version để vô hiệu mọi phiên KHÁC; cấp token mới cho phiên hiện tại
    new_tv = (user.get("token_version") or 0) + 1
    conn.execute("UPDATE users SET password_hash=?, token_version=? WHERE id=?",
                 (hash_password(body.new_password), new_tv, user["id"]))
    fresh = create_token(user["id"], user["role"], new_tv)
    return {"ok": True, "message": "Đã đổi mật khẩu", "token": fresh}


# --------------------------------------------------------------------------
# 2FA — TOTP (Google Authenticator)
# --------------------------------------------------------------------------
class TotpCodeBody(BaseModel):
    code: str


class TotpDisableBody(BaseModel):
    password: str
    code: str


@router.post("/2fa/setup")
def twofa_setup(user: dict = Depends(get_current_user),
                conn: sqlite3.Connection = Depends(get_db)):
    """Sinh secret mới (chưa bật) — trả otpauth URI + QR SVG để quét."""
    if user.get("totp_enabled"):
        raise HTTPException(409, "2FA đang bật — tắt trước khi tạo lại")
    secret = new_secret()
    conn.execute("UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?",
                 (secret, user["id"]))
    brand = get_brand(conn)["brand_name"]
    uri = otpauth_uri(secret, user["email"], brand_name=brand)
    return {"secret": secret, "otpauth": uri,
            "qr_svg": qr_svg(uri),
            "issuer_label": f"{brand} - {user['email']}"}


@router.post("/2fa/enable")
def twofa_enable(body: TotpCodeBody, user: dict = Depends(get_current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    """Xác nhận mã từ app → bật 2FA thật sự."""
    if user.get("totp_enabled"):
        raise HTTPException(409, "2FA đã bật rồi")
    if not user.get("totp_secret"):
        raise HTTPException(400, "Chưa tạo secret — bấm Thiết lập 2FA trước")
    if not verify_totp(user["totp_secret"], body.code):
        raise HTTPException(400, "Mã không đúng — kiểm tra lại app Google Authenticator")
    conn.execute("UPDATE users SET totp_enabled=1 WHERE id=?", (user["id"],))
    return {"ok": True, "message": "Đã bật xác thực 2 lớp"}


@router.post("/2fa/disable")
def twofa_disable(body: TotpDisableBody, user: dict = Depends(get_current_user),
                  conn: sqlite3.Connection = Depends(get_db)):
    """Tắt 2FA — yêu cầu cả mật khẩu lẫn mã TOTP hiện tại."""
    if not user.get("totp_enabled"):
        raise HTTPException(400, "2FA chưa bật")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(400, "Mật khẩu không đúng")
    if not verify_totp(user["totp_secret"], body.code):
        raise HTTPException(400, "Mã xác thực không đúng")
    conn.execute("UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?",
                 (user["id"],))
    return {"ok": True, "message": "Đã tắt xác thực 2 lớp"}


@router.patch("")
def update_me(body: ProfilePatch, user: dict = Depends(get_current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    if body.display_name is not None:
        name = body.display_name.strip()
        if not name:
            raise HTTPException(400, "Tên hiển thị không được để trống")
        conn.execute("UPDATE users SET display_name=? WHERE id=?", (name, user["id"]))
    if body.settings is not None:
        import json
        conn.execute("UPDATE users SET settings=? WHERE id=?",
                     (json.dumps(body.settings, ensure_ascii=False), user["id"]))
    return {"ok": True}


# --------------------------------------------------------------------------
# PLAYLIST
# --------------------------------------------------------------------------
def _own_playlist(conn, playlist_id: str, user_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM playlists WHERE id=?", (playlist_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy playlist")
    if row["owner_id"] != user_id:
        raise HTTPException(403, "Bạn không sở hữu playlist này")
    return row


@router.get("/playlists")
def my_playlists(user: dict = Depends(get_current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        "SELECT * FROM playlists WHERE owner_id=? ORDER BY created_at DESC",
        (user["id"],)).fetchall()
    return {"items": serialize_playlists(conn, rows)}


@router.post("/playlists", status_code=201)
def create_playlist(body: PlaylistBody, user: dict = Depends(get_current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Tên playlist không được để trống")
    if body.visibility not in ("public", "private", "unlisted"):
        raise HTTPException(400, "visibility không hợp lệ")
    pid = new_id()
    cover = COVER_DIR / f"playlist_{pid}.svg"
    accent = generate_cover(cover, seed=stable_seed(pid), title=title,
                            subtitle=user["display_name"] or "Playlist")
    conn.execute(
        "INSERT INTO playlists(id,owner_id,title,description,cover_url,accent,visibility) "
        "VALUES(?,?,?,?,?,?,?)",
        (pid, user["id"], title, body.description,
         f"/media/covers/playlist_{pid}.svg", accent, body.visibility))
    row = conn.execute("SELECT * FROM playlists WHERE id=?", (pid,)).fetchone()
    return serialize_playlists(conn, [row])[0]


@router.patch("/playlists/{playlist_id}")
def update_playlist(playlist_id: str, body: PlaylistPatch,
                    user: dict = Depends(get_current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    _own_playlist(conn, playlist_id, user["id"])
    if body.title is not None and body.title.strip():
        conn.execute("UPDATE playlists SET title=?, updated_at=datetime('now') WHERE id=?",
                     (body.title.strip(), playlist_id))
    if body.description is not None:
        conn.execute("UPDATE playlists SET description=? WHERE id=?",
                     (body.description, playlist_id))
    if body.visibility in ("public", "private", "unlisted"):
        conn.execute("UPDATE playlists SET visibility=? WHERE id=?",
                     (body.visibility, playlist_id))
    return {"ok": True}


@router.delete("/playlists/{playlist_id}")
def delete_playlist(playlist_id: str, user: dict = Depends(get_current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    _own_playlist(conn, playlist_id, user["id"])
    conn.execute("DELETE FROM playlists WHERE id=?", (playlist_id,))
    return {"ok": True}


@router.post("/playlists/{playlist_id}/tracks", status_code=201)
def add_track(playlist_id: str, body: AddTrackBody,
              user: dict = Depends(get_current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    _own_playlist(conn, playlist_id, user["id"])
    if not conn.execute("SELECT 1 FROM tracks WHERE id=?", (body.track_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy bài hát")
    dup = conn.execute(
        "SELECT 1 FROM playlist_tracks WHERE playlist_id=? AND track_id=?",
        (playlist_id, body.track_id)).fetchone()
    if dup:
        raise HTTPException(409, "Bài hát đã có trong playlist")
    pos = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id=?",
        (playlist_id,)).fetchone()[0]
    conn.execute(
        "INSERT INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)",
        (playlist_id, body.track_id, pos))
    conn.execute("UPDATE playlists SET updated_at=datetime('now') WHERE id=?", (playlist_id,))
    return {"ok": True, "position": pos}


@router.delete("/playlists/{playlist_id}/tracks/{track_id}")
def remove_track(playlist_id: str, track_id: str,
                 user: dict = Depends(get_current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    _own_playlist(conn, playlist_id, user["id"])
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?",
                 (playlist_id, track_id))
    return {"ok": True}


@router.put("/playlists/{playlist_id}/order")
def reorder(playlist_id: str, body: OrderBody,
            user: dict = Depends(get_current_user),
            conn: sqlite3.Connection = Depends(get_db)):
    _own_playlist(conn, playlist_id, user["id"])
    current = {r["track_id"] for r in conn.execute(
        "SELECT track_id FROM playlist_tracks WHERE playlist_id=?", (playlist_id,))}
    if set(body.track_ids) != current or len(body.track_ids) != len(current):
        raise HTTPException(400, "Danh sách sắp xếp phải chứa đúng toàn bộ bài trong playlist")
    for pos, tid in enumerate(body.track_ids):
        conn.execute(
            "UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?",
            (pos, playlist_id, tid))
    return {"ok": True}


# --------------------------------------------------------------------------
# YÊU THÍCH
# --------------------------------------------------------------------------
VALID_FAV_TYPES = ("track", "release", "playlist")


@router.get("/favorites")
def favorites(type: str = "track", user: dict = Depends(get_current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    if type not in VALID_FAV_TYPES:
        raise HTTPException(400, "type phải là track|release|playlist")
    uid = user["id"]
    if type == "track":
        rows = conn.execute(
            """SELECT t.* FROM tracks t JOIN favorites f ON f.entity_id=t.id
               WHERE f.user_id=? AND f.entity_type='track' ORDER BY f.created_at DESC""",
            (uid,)).fetchall()
        return {"items": serialize_tracks(conn, rows, uid)}
    if type == "release":
        rows = conn.execute(
            """SELECT r.* FROM releases r JOIN favorites f ON f.entity_id=r.id
               WHERE f.user_id=? AND f.entity_type='release' ORDER BY f.created_at DESC""",
            (uid,)).fetchall()
        return {"items": serialize_releases(conn, rows, uid)}
    rows = conn.execute(
        """SELECT p.* FROM playlists p JOIN favorites f ON f.entity_id=p.id
           WHERE f.user_id=? AND f.entity_type='playlist' ORDER BY f.created_at DESC""",
        (uid,)).fetchall()
    return {"items": serialize_playlists(conn, rows)}


@router.put("/favorites/{entity_type}/{entity_id}")
def add_favorite(entity_type: str, entity_id: str,
                 user: dict = Depends(get_current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    if entity_type not in VALID_FAV_TYPES:
        raise HTTPException(400, "type phải là track|release|playlist")
    table = {"track": "tracks", "release": "releases", "playlist": "playlists"}[entity_type]
    if not conn.execute(f"SELECT 1 FROM {table} WHERE id=?", (entity_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy đối tượng")
    conn.execute(
        "INSERT OR IGNORE INTO favorites(user_id,entity_type,entity_id) VALUES(?,?,?)",
        (user["id"], entity_type, entity_id))
    if entity_type == "track":
        conn.execute(
            """UPDATE tracks SET like_count = (SELECT COUNT(*) FROM favorites
               WHERE entity_type='track' AND entity_id=?) WHERE id=?""",
            (entity_id, entity_id))
    return {"ok": True, "liked": True}


@router.delete("/favorites/{entity_type}/{entity_id}")
def remove_favorite(entity_type: str, entity_id: str,
                    user: dict = Depends(get_current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    conn.execute(
        "DELETE FROM favorites WHERE user_id=? AND entity_type=? AND entity_id=?",
        (user["id"], entity_type, entity_id))
    if entity_type == "track":
        conn.execute(
            """UPDATE tracks SET like_count = (SELECT COUNT(*) FROM favorites
               WHERE entity_type='track' AND entity_id=?) WHERE id=?""",
            (entity_id, entity_id))
    return {"ok": True, "liked": False}


# --------------------------------------------------------------------------
# THEO DÕI NGHỆ SĨ
# --------------------------------------------------------------------------
@router.get("/follows")
def follows(user: dict = Depends(get_current_user),
            conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        """SELECT a.* FROM artists a JOIN follows f ON f.artist_id=a.id
           WHERE f.user_id=? ORDER BY f.created_at DESC""", (user["id"],)).fetchall()
    return {"items": serialize_artists(conn, rows, user["id"])}


@router.post("/follows/{artist_id}", status_code=201)
def follow(artist_id: str, user: dict = Depends(get_current_user),
           conn: sqlite3.Connection = Depends(get_db)):
    if not conn.execute("SELECT 1 FROM artists WHERE id=?", (artist_id,)).fetchone():
        raise HTTPException(404, "Không tìm thấy nghệ sĩ")
    conn.execute("INSERT OR IGNORE INTO follows(user_id,artist_id) VALUES(?,?)",
                 (user["id"], artist_id))
    return {"ok": True, "following": True}


@router.delete("/follows/{artist_id}")
def unfollow(artist_id: str, user: dict = Depends(get_current_user),
             conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("DELETE FROM follows WHERE user_id=? AND artist_id=?",
                 (user["id"], artist_id))
    return {"ok": True, "following": False}


# --------------------------------------------------------------------------
# LỊCH SỬ NGHE
# --------------------------------------------------------------------------
@router.get("/history")
def history(limit: int = 30, user: dict = Depends(get_current_user),
            conn: sqlite3.Connection = Depends(get_db)):
    # clamp cả cận dưới: limit âm → SQLite hiểu LIMIT -1 = KHÔNG giới hạn (đổ hết)
    limit = max(1, min(limit, 100))
    rows = conn.execute(
        """SELECT t.*, MAX(ph.played_at) AS last_played FROM play_history ph
           JOIN tracks t ON t.id=ph.track_id
           WHERE ph.user_id=? AND t.status='live'
           GROUP BY t.id ORDER BY last_played DESC LIMIT ?""",
        (user["id"], limit)).fetchall()
    items = serialize_tracks(conn, rows, user["id"])
    for item, r in zip(items, rows):
        item["last_played"] = r["last_played"]
    return {"items": items}
