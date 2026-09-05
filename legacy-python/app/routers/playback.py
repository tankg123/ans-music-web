"""Streaming audio (HTTP Range + signed URL), download WAV và heartbeat 30s."""
import os
import re
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel

from ..config import (AUDIO_DIR, AUDIO_CONTENT_TYPES, MASTER_DIR,
                      PLAY_COUNT_THRESHOLD_MS)
from ..db import get_db
from ..security import get_optional_user
from ..utils import safe_filename, verify_download_sig, verify_stream_sig

router = APIRouter(tags=["playback"])

CHUNK = 256 * 1024
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class HeartbeatBody(BaseModel):
    track_id: str
    ms_played: int = 0
    source: Optional[str] = None       # album|playlist|search|chart...


@router.post("/v1/playback/heartbeat")
def heartbeat(body: HeartbeatBody,
              conn: sqlite3.Connection = Depends(get_db),
              user: Optional[dict] = Depends(get_optional_user)):
    """Client gọi khi vượt mốc 30s (hoặc kết thúc bài ngắn hơn 30s).

    Một lượt gọi = một lượt nghe hợp lệ; client chịu trách nhiệm gọi đúng 1 lần/lượt phát.
    """
    track = conn.execute(
        "SELECT id, duration_ms, status, audio_path FROM tracks WHERE id=?",
        (body.track_id,)).fetchone()
    if not track:
        raise HTTPException(404, "Không tìm thấy bài hát")
    if track["status"] != "live" or not track["audio_path"]:
        return {"counted": False, "reason": "bài hát không khả dụng"}
    dur = track["duration_ms"] or 0
    threshold = (min(PLAY_COUNT_THRESHOLD_MS, max(1000, dur - 1000))
                 if dur > 0 else PLAY_COUNT_THRESHOLD_MS)
    if body.ms_played < threshold:
        return {"counted": False, "reason": f"cần nghe tối thiểu {threshold // 1000}s"}
    conn.execute(
        "INSERT INTO play_history(user_id,track_id,ms_played,source) VALUES(?,?,?,?)",
        (user["id"] if user else None, body.track_id,
         body.ms_played, body.source))
    conn.execute("UPDATE tracks SET play_count = play_count + 1 WHERE id=?",
                 (body.track_id,))
    return {"counted": True}


@router.get("/stream/{track_id}")
def stream(track_id: str,
           exp: str = Query(...), sig: str = Query(...),
           range_header: Optional[str] = Header(None, alias="Range"),
           conn: sqlite3.Connection = Depends(get_db)):
    if not verify_stream_sig(track_id, exp, sig):
        raise HTTPException(403, "Link streaming không hợp lệ hoặc đã hết hạn")

    row = conn.execute(
        "SELECT audio_path, status FROM tracks WHERE id=?", (track_id,)).fetchone()
    if not row or not row["audio_path"]:
        raise HTTPException(404, "Không có file audio")
    # draft chỉ có admin lấy được signed URL (gate ở /v1/tracks/{id}/stream);
    # taken_down chặn tuyệt đối kể cả URL còn hạn
    if row["status"] == "taken_down":
        raise HTTPException(403, "Bài hát không khả dụng")

    path = (AUDIO_DIR / row["audio_path"]).resolve()
    if not str(path).startswith(str(AUDIO_DIR.resolve())) or not path.is_file():
        raise HTTPException(404, "File audio không tồn tại")

    file_size = path.stat().st_size
    content_type = AUDIO_CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")

    start, end = 0, file_size - 1
    status_code = 200
    if range_header:
        m = RANGE_RE.match(range_header)
        if m:
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), file_size - 1)
            elif m.group(2):
                # suffix range: bytes=-N (N byte cuối)
                start = max(0, file_size - int(m.group(2)))
            if start >= file_size:
                return Response(status_code=416,
                                headers={"Content-Range": f"bytes */{file_size}"})
            status_code = 206

    length = end - start + 1

    def iter_file():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                data = f.read(min(CHUNK, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "private, max-age=3600",
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(iter_file(), status_code=status_code,
                             media_type=content_type, headers=headers)


# --------------------------------------------------------------------------
# DOWNLOAD — ưu tiên bản gốc WAV 44.1kHz trong masters/
# --------------------------------------------------------------------------
def _download_source(row) -> Optional[Path]:
    """Chọn file tải: master WAV nếu có, không thì file phát."""
    if row["master_path"]:
        p = MASTER_DIR / row["master_path"]
        if p.is_file():
            return p
    if row["audio_path"]:
        p = AUDIO_DIR / row["audio_path"]
        if p.is_file():
            return p
    return None


def _track_display_name(conn, track_id: str, title: str) -> str:
    artists = conn.execute(
        """SELECT a.name FROM track_artists ta JOIN artists a ON a.id=ta.artist_id
           WHERE ta.track_id=? AND ta.role='MainArtist' ORDER BY ta.sequence LIMIT 2""",
        (track_id,)).fetchall()
    prefix = ", ".join(r["name"] for r in artists)
    return f"{prefix} - {title}" if prefix else title


@router.get("/download/track/{track_id}")
def download_track(track_id: str, exp: str = Query(...), sig: str = Query(...),
                   conn: sqlite3.Connection = Depends(get_db)):
    if not verify_download_sig("track", track_id, exp, sig):
        raise HTTPException(403, "Link tải không hợp lệ hoặc đã hết hạn")
    row = conn.execute(
        "SELECT title, audio_path, master_path, status FROM tracks WHERE id=?",
        (track_id,)).fetchone()
    if not row or row["status"] != "live":
        raise HTTPException(404, "Bài hát không khả dụng")
    src = _download_source(row)
    if not src:
        raise HTTPException(404, "Không có file audio")
    fname = safe_filename(_track_display_name(conn, track_id, row["title"])) + src.suffix
    media = "audio/wav" if src.suffix == ".wav" else AUDIO_CONTENT_TYPES.get(
        src.suffix, "application/octet-stream")
    return FileResponse(src, media_type=media, filename=fname)


@router.get("/download/album/{release_id}")
def download_album(release_id: str, exp: str = Query(...), sig: str = Query(...),
                   conn: sqlite3.Connection = Depends(get_db)):
    if not verify_download_sig("album", release_id, exp, sig):
        raise HTTPException(403, "Link tải không hợp lệ hoặc đã hết hạn")
    rel = conn.execute(
        "SELECT title, status FROM releases WHERE id=?", (release_id,)).fetchone()
    if not rel or rel["status"] != "live":
        raise HTTPException(404, "Album không khả dụng")
    tracks = conn.execute(
        """SELECT t.id, t.title, t.audio_path, t.master_path, rt.track_no
           FROM tracks t JOIN release_tracks rt ON rt.track_id=t.id
           WHERE rt.release_id=? AND t.status='live' AND t.audio_path IS NOT NULL
           ORDER BY rt.disc_no, rt.track_no""", (release_id,)).fetchall()
    if not tracks:
        raise HTTPException(404, "Album chưa có bài phát hành nào")

    # WAV vốn không nén được thêm → ZIP_STORED cho nhanh
    fd, tmp_path = tempfile.mkstemp(suffix=".zip", prefix="ans_album_")
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_STORED) as zf:
            for t in tracks:
                src = _download_source(t)
                if not src:
                    continue
                arc = safe_filename(f"{t['track_no']:02d} - {t['title']}") + src.suffix
                zf.write(src, arcname=arc)
    except OSError:
        os.unlink(tmp_path)
        raise HTTPException(500, "Không đóng gói được album")

    zip_name = safe_filename(rel["title"]) + ".zip"
    return FileResponse(tmp_path, media_type="application/zip", filename=zip_name,
                        background=BackgroundTask(os.unlink, tmp_path))
