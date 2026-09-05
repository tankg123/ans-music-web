"""Catalog công khai: trang chủ, tìm kiếm, bài hát, album, nghệ sĩ, BXH, thể loại."""
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..security import get_current_user, get_optional_user
from ..serializers import (serialize_artists, serialize_playlists,
                           serialize_releases, serialize_tracks)
from ..utils import normalize_text, sign_download, sign_stream

router = APIRouter(prefix="/v1", tags=["catalog"])

LIVE_TRACK = "t.status = 'live' AND t.audio_path IS NOT NULL"


def _uid(user: Optional[dict]) -> Optional[str]:
    return user["id"] if user else None


# --------------------------------------------------------------------------
# TRANG CHỦ
# --------------------------------------------------------------------------
@router.get("/home")
def home(conn: sqlite3.Connection = Depends(get_db),
         user: Optional[dict] = Depends(get_optional_user)):
    uid = _uid(user)
    # lazy publisher: release hẹn giờ tới hạn lên live ngay lần tải trang chủ
    from ..publisher import run_publisher
    run_publisher(conn)

    new_releases = conn.execute(
        "SELECT * FROM releases WHERE status='live' "
        "ORDER BY platform_release_date DESC, created_at DESC LIMIT 12").fetchall()

    top_tracks = conn.execute(
        f"""SELECT t.*, COUNT(ph.id) AS week_plays FROM tracks t
            JOIN play_history ph ON ph.track_id = t.id
              AND ph.played_at >= datetime('now', '-7 days')
            WHERE {LIVE_TRACK}
            GROUP BY t.id ORDER BY week_plays DESC LIMIT 10""").fetchall()

    editorial = conn.execute(
        "SELECT * FROM playlists WHERE is_editorial=1 AND visibility='public' "
        "ORDER BY created_at LIMIT 8").fetchall()

    artists = conn.execute(
        """SELECT a.*, SUM(t.play_count) AS total_plays FROM artists a
           JOIN track_artists ta ON ta.artist_id = a.id AND ta.role='MainArtist'
           JOIN tracks t ON t.id = ta.track_id AND t.status='live'
           GROUP BY a.id ORDER BY total_plays DESC LIMIT 10""").fetchall()

    recently_played = []
    if uid:
        rows = conn.execute(
            f"""SELECT t.*, MAX(ph.played_at) AS last_played FROM play_history ph
                JOIN tracks t ON t.id = ph.track_id
                WHERE ph.user_id = ? AND {LIVE_TRACK}
                GROUP BY t.id ORDER BY last_played DESC LIMIT 10""", (uid,)).fetchall()
        recently_played = serialize_tracks(conn, rows, uid)

    genres = conn.execute(
        "SELECT genre, COUNT(*) AS n FROM tracks "
        "WHERE genre IS NOT NULL AND status='live' GROUP BY genre ORDER BY n DESC").fetchall()

    return {
        "new_releases": serialize_releases(conn, new_releases, uid),
        "top_tracks": serialize_tracks(conn, top_tracks, uid),
        "editorial_playlists": serialize_playlists(conn, editorial),
        "popular_artists": serialize_artists(conn, artists, uid),
        "recently_played": recently_played,
        "genres": [{"name": g["genre"], "track_count": g["n"]} for g in genres],
    }


# --------------------------------------------------------------------------
# TÌM KIẾM (không dấu, instant)
# --------------------------------------------------------------------------
@router.get("/search")
def search(q: str = Query(..., min_length=1, max_length=120),
           limit: int = Query(8, ge=1, le=50),
           conn: sqlite3.Connection = Depends(get_db),
           user: Optional[dict] = Depends(get_optional_user)):
    uid = _uid(user)
    norm = normalize_text(q)
    like = f"%{norm}%"
    prefix = f"{norm}%"

    tracks = conn.execute(
        f"""SELECT t.* FROM tracks t WHERE {LIVE_TRACK} AND t.title_norm LIKE ?
            ORDER BY (t.title_norm LIKE ?) DESC, t.play_count DESC LIMIT ?""",
        (like, prefix, limit)).fetchall()

    # tìm theo tên nghệ sĩ → thêm bài của nghệ sĩ khớp
    artist_tracks = conn.execute(
        f"""SELECT DISTINCT t.* FROM tracks t
            JOIN track_artists ta ON ta.track_id = t.id
            JOIN artists a ON a.id = ta.artist_id
            WHERE {LIVE_TRACK} AND a.name_norm LIKE ?
            ORDER BY t.play_count DESC LIMIT ?""", (like, limit)).fetchall()
    seen = {t["id"] for t in tracks}
    tracks = list(tracks) + [t for t in artist_tracks if t["id"] not in seen]

    releases = conn.execute(
        """SELECT * FROM releases WHERE status='live' AND title_norm LIKE ?
           ORDER BY (title_norm LIKE ?) DESC LIMIT ?""",
        (like, prefix, limit)).fetchall()

    artists = conn.execute(
        """SELECT * FROM artists WHERE name_norm LIKE ?
           ORDER BY (name_norm LIKE ?) DESC LIMIT ?""",
        (like, prefix, limit)).fetchall()

    playlists = conn.execute(
        """SELECT * FROM playlists WHERE visibility='public'
           AND (title LIKE ? OR title LIKE ?) LIMIT ?""",
        (f"%{q}%", f"%{norm}%", limit)).fetchall()

    return {
        "query": q,
        "tracks": serialize_tracks(conn, tracks[:limit], uid),
        "releases": serialize_releases(conn, releases, uid),
        "artists": serialize_artists(conn, artists, uid),
        "playlists": serialize_playlists(conn, playlists),
    }


# --------------------------------------------------------------------------
# TRACK
# --------------------------------------------------------------------------
@router.get("/tracks")
def list_tracks(sort: str = Query("new", pattern="^(new|top|az)$"),
                limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0),
                conn: sqlite3.Connection = Depends(get_db),
                user: Optional[dict] = Depends(get_optional_user)):
    """Tất cả bài hát đang phát hành — sort: new|top|az."""
    order = {"new": "t.created_at DESC", "top": "t.play_count DESC",
             "az": "t.title_norm ASC"}[sort]
    rows = conn.execute(
        f"SELECT t.* FROM tracks t WHERE {LIVE_TRACK} "
        f"ORDER BY {order} LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    total = conn.execute(
        f"SELECT COUNT(*) FROM tracks t WHERE {LIVE_TRACK}").fetchone()[0]
    return {"items": serialize_tracks(conn, rows, _uid(user)), "total": total}
def _is_admin(user: Optional[dict]) -> bool:
    return bool(user and user.get("role") == "admin")


@router.get("/tracks/{track_id}")
def get_track(track_id: str, conn: sqlite3.Connection = Depends(get_db),
              user: Optional[dict] = Depends(get_optional_user)):
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy bài hát")
    if row["status"] != "live" and not _is_admin(user):
        raise HTTPException(404, "Không tìm thấy bài hát")
    data = serialize_tracks(conn, [row], _uid(user))[0]
    credits = conn.execute(
        """SELECT a.id, a.name, ta.role FROM track_artists ta
           JOIN artists a ON a.id=ta.artist_id WHERE ta.track_id=? ORDER BY ta.sequence""",
        (track_id,)).fetchall()
    data["credits"] = [dict(c) for c in credits]
    data["p_line"] = row["p_line"]
    data["language"] = row["language"]
    data["parental_warning"] = row["parental_warning"]
    return data


@router.get("/tracks/{track_id}/stream")
def get_stream_url(track_id: str, conn: sqlite3.Connection = Depends(get_db),
                   user: Optional[dict] = Depends(get_optional_user)):
    row = conn.execute(
        "SELECT id, audio_path, status FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row or not row["audio_path"]:
        raise HTTPException(404, "Bài hát chưa có file audio")
    # admin được preview track draft trong module Product
    if row["status"] != "live" and not _is_admin(user):
        raise HTTPException(403, "Bài hát hiện không khả dụng")
    return {"url": f"/stream/{track_id}?{sign_stream(track_id)}"}


@router.get("/tracks/{track_id}/download")
def get_track_download(track_id: str, conn: sqlite3.Connection = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """Link tải bài hát (bản gốc WAV 44.1kHz nếu có) — yêu cầu đăng nhập."""
    row = conn.execute(
        "SELECT audio_path, status FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row or not row["audio_path"] or row["status"] != "live":
        raise HTTPException(404, "Bài hát không khả dụng để tải")
    return {"url": f"/download/track/{track_id}?{sign_download('track', track_id)}"}


@router.get("/albums/{release_id}/download")
def get_album_download(release_id: str, conn: sqlite3.Connection = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """Link tải cả album (ZIP các file WAV) — yêu cầu đăng nhập."""
    rel = conn.execute("SELECT status FROM releases WHERE id=?", (release_id,)).fetchone()
    if not rel or rel["status"] != "live":
        raise HTTPException(404, "Album không khả dụng")
    n = conn.execute(
        """SELECT COUNT(*) FROM tracks t JOIN release_tracks rt ON rt.track_id=t.id
           WHERE rt.release_id=? AND t.status='live' AND t.audio_path IS NOT NULL""",
        (release_id,)).fetchone()[0]
    if not n:
        raise HTTPException(404, "Album chưa có bài phát hành nào")
    return {"url": f"/download/album/{release_id}?{sign_download('album', release_id)}",
            "track_count": n}


@router.get("/tracks/{track_id}/waveform")
def get_waveform(track_id: str, conn: sqlite3.Connection = Depends(get_db),
                 user: Optional[dict] = Depends(get_optional_user)):
    """Đỉnh sóng 1000 điểm (0..1) cho UI waveform — cache server-side."""
    from fastapi.responses import JSONResponse
    from ..config import AUDIO_DIR
    from ..waveform import get_or_build_waveform
    row = conn.execute(
        "SELECT audio_path, status FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row or not row["audio_path"]:
        raise HTTPException(404, "Bài hát chưa có audio")
    if row["status"] != "live" and not _is_admin(user):
        raise HTTPException(404, "Không tìm thấy bài hát")
    peaks = get_or_build_waveform(track_id, AUDIO_DIR / row["audio_path"])
    if not peaks:
        raise HTTPException(404, "Không phân tích được waveform")
    return JSONResponse({"peaks": peaks},
                        headers={"Cache-Control": "private, max-age=3600"})


@router.get("/tracks/{track_id}/lyrics")
def get_lyrics(track_id: str, conn: sqlite3.Connection = Depends(get_db),
               user: Optional[dict] = Depends(get_optional_user)):
    row = conn.execute(
        "SELECT lyrics, lyrics_lrc, status FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row or (row["status"] != "live" and not _is_admin(user)):
        raise HTTPException(404, "Không tìm thấy bài hát")
    return {"lyrics": row["lyrics"], "lrc": row["lyrics_lrc"]}


# --------------------------------------------------------------------------
# ALBUM / RELEASE
# --------------------------------------------------------------------------
@router.get("/albums")
def list_albums(limit: int = Query(24, ge=1, le=100), offset: int = 0,
                conn: sqlite3.Connection = Depends(get_db),
                user: Optional[dict] = Depends(get_optional_user)):
    rows = conn.execute(
        "SELECT * FROM releases WHERE status='live' "
        "ORDER BY platform_release_date DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    return {"items": serialize_releases(conn, rows, _uid(user))}


@router.get("/albums/{release_id}")
def get_album(release_id: str, conn: sqlite3.Connection = Depends(get_db),
              user: Optional[dict] = Depends(get_optional_user)):
    uid = _uid(user)
    row = conn.execute("SELECT * FROM releases WHERE id=?", (release_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy album")
    data = serialize_releases(conn, [row], uid)[0]
    data.update({
        "p_line": row["p_line"], "c_line": row["c_line"],
        "original_release_date": row["original_release_date"],
        "platform_release_date": row["platform_release_date"],
        "parental_warning": row["parental_warning"],
    })
    tracks = conn.execute(
        """SELECT t.* FROM tracks t JOIN release_tracks rt ON rt.track_id = t.id
           WHERE rt.release_id=? ORDER BY rt.disc_no, rt.track_no""",
        (release_id,)).fetchall()
    data["tracks"] = serialize_tracks(conn, tracks, uid)
    data["total_duration_ms"] = sum(t["duration_ms"] or 0 for t in data["tracks"])
    deal = conn.execute("SELECT * FROM deals WHERE release_id=? LIMIT 1",
                        (release_id,)).fetchone()
    data["deal"] = dict(deal) if deal else None
    return data


# --------------------------------------------------------------------------
# NGHỆ SĨ
# --------------------------------------------------------------------------
@router.get("/artists")
def list_artists(limit: int = Query(30, ge=1, le=100),
                 conn: sqlite3.Connection = Depends(get_db),
                 user: Optional[dict] = Depends(get_optional_user)):
    rows = conn.execute("SELECT * FROM artists ORDER BY name LIMIT ?", (limit,)).fetchall()
    return {"items": serialize_artists(conn, rows, _uid(user))}


@router.get("/artists/{artist_id}")
def get_artist(artist_id: str, conn: sqlite3.Connection = Depends(get_db),
               user: Optional[dict] = Depends(get_optional_user)):
    uid = _uid(user)
    row = conn.execute("SELECT * FROM artists WHERE id=?", (artist_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy nghệ sĩ")
    data = serialize_artists(conn, [row], uid)[0]

    top = conn.execute(
        f"""SELECT DISTINCT t.* FROM tracks t
            JOIN track_artists ta ON ta.track_id=t.id
            WHERE ta.artist_id=? AND {LIVE_TRACK}
            ORDER BY t.play_count DESC LIMIT 10""", (artist_id,)).fetchall()
    data["top_tracks"] = serialize_tracks(conn, top, uid)

    releases = conn.execute(
        """SELECT DISTINCT r.* FROM releases r
           JOIN release_artists ra ON ra.release_id=r.id
           WHERE ra.artist_id=? AND r.status='live'
           ORDER BY r.platform_release_date DESC""", (artist_id,)).fetchall()
    data["releases"] = serialize_releases(conn, releases, uid)

    appears_on = conn.execute(
        """SELECT DISTINCT r.* FROM releases r
           JOIN release_tracks rt ON rt.release_id = r.id
           JOIN track_artists ta ON ta.track_id = rt.track_id
           WHERE ta.artist_id=? AND ta.role='FeaturedArtist' AND r.status='live'""",
        (artist_id,)).fetchall()
    data["appears_on"] = serialize_releases(conn, appears_on, uid)

    similar = conn.execute(
        """SELECT DISTINCT a.* FROM artists a
           JOIN track_artists ta ON ta.artist_id = a.id
           JOIN tracks t ON t.id = ta.track_id
           WHERE a.id != ? AND t.genre IN (
             SELECT DISTINCT t2.genre FROM tracks t2
             JOIN track_artists ta2 ON ta2.track_id=t2.id WHERE ta2.artist_id=?)
           LIMIT 6""", (artist_id, artist_id)).fetchall()
    data["similar_artists"] = serialize_artists(conn, similar, uid)

    plays = conn.execute(
        """SELECT SUM(t.play_count) AS n FROM tracks t
           JOIN track_artists ta ON ta.track_id=t.id WHERE ta.artist_id=?""",
        (artist_id,)).fetchone()
    data["total_plays"] = plays["n"] or 0
    return data


# --------------------------------------------------------------------------
# BẢNG XẾP HẠNG
# --------------------------------------------------------------------------
@router.get("/charts")
def charts(period: str = Query("week", pattern="^(week|month|all)$"),
           conn: sqlite3.Connection = Depends(get_db),
           user: Optional[dict] = Depends(get_optional_user)):
    uid = _uid(user)
    if period == "all":
        rows = conn.execute(
            f"SELECT t.*, t.play_count AS period_plays FROM tracks t "
            f"WHERE {LIVE_TRACK} ORDER BY t.play_count DESC LIMIT 50").fetchall()
    else:
        days = 7 if period == "week" else 30
        rows = conn.execute(
            f"""SELECT t.*, COUNT(ph.id) AS period_plays FROM tracks t
                JOIN play_history ph ON ph.track_id=t.id
                  AND ph.played_at >= datetime('now', '-{days} days')
                WHERE {LIVE_TRACK}
                GROUP BY t.id ORDER BY period_plays DESC LIMIT 50""").fetchall()
    items = serialize_tracks(conn, rows, uid)
    for i, (item, r) in enumerate(zip(items, rows)):
        item["rank"] = i + 1
        item["period_plays"] = r["period_plays"]
    return {"period": period, "items": items}


# --------------------------------------------------------------------------
# THỂ LOẠI
# --------------------------------------------------------------------------
@router.get("/genres/{genre}/tracks")
def genre_tracks(genre: str, limit: int = Query(50, ge=1, le=100),
                 conn: sqlite3.Connection = Depends(get_db),
                 user: Optional[dict] = Depends(get_optional_user)):
    rows = conn.execute(
        f"SELECT t.* FROM tracks t WHERE {LIVE_TRACK} AND t.genre=? "
        f"ORDER BY t.play_count DESC LIMIT ?", (genre, limit)).fetchall()
    return {"genre": genre, "items": serialize_tracks(conn, rows, _uid(user))}


# --------------------------------------------------------------------------
# PLAYLIST CÔNG KHAI
# --------------------------------------------------------------------------
@router.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: str, conn: sqlite3.Connection = Depends(get_db),
                 user: Optional[dict] = Depends(get_optional_user)):
    uid = _uid(user)
    row = conn.execute("SELECT * FROM playlists WHERE id=?", (playlist_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy playlist")
    if row["visibility"] == "private" and row["owner_id"] != uid:
        raise HTTPException(403, "Playlist này ở chế độ riêng tư")
    data = serialize_playlists(conn, [row])[0]
    tracks = conn.execute(
        """SELECT t.*, pt.position FROM tracks t
           JOIN playlist_tracks pt ON pt.track_id = t.id
           WHERE pt.playlist_id=? ORDER BY pt.position""", (playlist_id,)).fetchall()
    data["tracks"] = serialize_tracks(conn, tracks, uid)
    data["total_duration_ms"] = sum(t["duration_ms"] or 0 for t in data["tracks"])
    data["is_owner"] = row["owner_id"] == uid
    return data
