"""Upload Studio — luồng đưa nhạc lên gọn trong một màn hình:
kéo thả nhiều file → tự đọc tag → điền thông tin release → tự sinh ISRC/UPC
→ phát hành ngay / hẹn giờ / vào hàng chờ duyệt. Tất cả ghi DB trong 1 transaction.
"""
import hashlib
import random
import re
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..config import (AUDIO_CONTENT_TYPES, AUDIO_DIR, COVER_DIR, ISRC_PREFIX,
                      MASTER_DIR, STAGING_DIR, STAGING_TTL_HOURS)
from ..covers import generate_cover
from ..db import get_db, new_id
from ..ddex import _get_or_create_artist
from ..idpool import (auto_enabled, mark_code_used, pool_counts,
                      pool_exhausted_error, pool_take)
from ..security import require_admin
from ..transcode import cleanup_processed, ffmpeg_available, process_audio
from ..utils import (clean_isrc, gtin_check_digit, normalize_text,
                     validate_isrc, validate_upc)

router = APIRouter(prefix="/admin/v1/studio", tags=["studio"],
                   dependencies=[Depends(require_admin)])

COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp")
ACCENT_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def cleanup_staging() -> None:
    """Dọn file staging quá hạn (gọi lúc khởi động)."""
    cutoff = time.time() - STAGING_TTL_HOURS * 3600
    for f in STAGING_DIR.glob("*"):
        try:
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def _staging_path(staging_id: str) -> Optional[Path]:
    if not re.fullmatch(r"[0-9a-f]{32}", staging_id or ""):
        return None
    matches = list(STAGING_DIR.glob(f"{staging_id}.*"))
    return matches[0] if matches else None


def _read_tags(path: Path) -> dict:
    """Đọc tag ID3/Vorbis/MP4 bằng mutagen (easy mode) — best effort."""
    tags = {"title": "", "artist": "", "album": "", "genre": "",
            "date": "", "tracknumber": ""}
    try:
        import mutagen
        mf = mutagen.File(str(path), easy=True)
        if mf and mf.tags:
            for key in tags:
                val = mf.tags.get(key)
                if val:
                    tags[key] = str(val[0]).strip()
    except Exception:
        pass
    # tracknumber dạng "3/12" → "3"
    if "/" in tags["tracknumber"]:
        tags["tracknumber"] = tags["tracknumber"].split("/")[0]
    return tags


def _duration_ms(path: Path) -> int:
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


# --------------------------------------------------------------------------
# BƯỚC 1: upload file vào staging + phân tích
# --------------------------------------------------------------------------
@router.post("/upload")
async def studio_upload(file: UploadFile = File(...),
                        kind: str = Query("audio", pattern="^(audio|cover)$"),
                        conn: sqlite3.Connection = Depends(get_db)):
    ext = Path(file.filename or "").suffix.lower()
    if kind == "audio" and ext not in AUDIO_CONTENT_TYPES:
        raise HTTPException(400, f"Định dạng audio không hỗ trợ ({ext})")
    if kind == "cover" and ext not in COVER_EXTS:
        raise HTTPException(400, "Ảnh bìa chỉ nhận JPG/PNG/WebP")

    sid = new_id()
    dest = STAGING_DIR / f"{sid}{ext}"
    sha = hashlib.sha256()
    size = 0
    with dest.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            sha.update(chunk)
            size += len(chunk)
            f.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "File rỗng")

    if kind == "cover":
        return {"staging_id": sid, "kind": "cover", "filename": file.filename}

    duration = _duration_ms(dest)
    if duration <= 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"Không đọc được audio: {file.filename}")
    digest = sha.hexdigest()
    dup = conn.execute(
        "SELECT id, title FROM tracks WHERE audio_hash=?", (digest,)).fetchone()
    return {
        "staging_id": sid, "kind": "audio",
        "filename": file.filename, "duration_ms": duration, "sha256": digest,
        "tags": _read_tags(dest),
        "duplicate_of": dict(dup) if dup else None,
    }


# --------------------------------------------------------------------------
# TỰ SINH ĐỊNH DANH
# --------------------------------------------------------------------------
def _next_isrcs(conn: sqlite3.Connection, count: int,
                exclude: Optional[set] = None) -> List[str]:
    """Sinh dãy ISRC kế tiếp theo prefix + năm hiện tại.

    exclude: các ISRC nhập tay trong CÙNG request — auto không được đụng vào.
    """
    exclude = exclude or set()
    yy = datetime.now().strftime("%y")
    base = f"{ISRC_PREFIX}{yy}"
    rows = conn.execute(
        "SELECT isrc FROM tracks WHERE isrc LIKE ?", (f"{base}%",)).fetchall()
    max_seq = 0
    for isrc_val in [r["isrc"] for r in rows] + list(exclude):
        tail = isrc_val[len(base):] if isrc_val.startswith(base) else ""
        if tail.isdigit():
            max_seq = max(max_seq, int(tail))
    out = []
    seq = max_seq
    while len(out) < count:
        seq += 1
        isrc = f"{base}{seq:05d}"
        if isrc in exclude:
            continue
        if not validate_isrc(isrc):
            raise HTTPException(500, f"ISRC tự sinh không hợp lệ: {isrc} "
                                     f"(kiểm tra ANS_ISRC_PREFIX)")
        out.append(isrc)
    return out


def _generate_upc(conn: sqlite3.Connection) -> str:
    """UPC 12 số nội bộ, prefix '2' (dải lưu hành nội bộ), đảm bảo unique."""
    for _ in range(50):
        body = "2" + "".join(random.choices("0123456789", k=10))
        upc = body + gtin_check_digit(body)
        if not conn.execute("SELECT 1 FROM releases WHERE upc=?", (upc,)).fetchone():
            return upc
    raise HTTPException(500, "Không sinh được UPC unique")


# --------------------------------------------------------------------------
# BƯỚC 2: publish — tạo artists/release/tracks trong 1 transaction
# --------------------------------------------------------------------------
class StudioTrack(BaseModel):
    staging_id: str
    title: str
    artists: List[str] = []
    isrc: Optional[str] = None           # None/rỗng → tự sinh
    genre: Optional[str] = None
    language: str = "vi"
    parental_warning: str = "NotExplicit"
    lyrics_lrc: Optional[str] = None


class StudioPublish(BaseModel):
    title: str
    upc: Optional[str] = None            # None/rỗng → tự sinh nội bộ
    release_type: Optional[str] = None   # None → auto theo số bài
    label_name: Optional[str] = None
    genre: Optional[str] = None
    p_line: Optional[str] = None
    c_line: Optional[str] = None
    parental_warning: str = "NotExplicit"
    original_release_date: Optional[str] = None
    publish_mode: str = "review"         # draft|review|live|schedule
    scheduled_at: Optional[str] = None   # ISO datetime khi mode=schedule
    cover_staging_id: Optional[str] = None
    cover_accent: Optional[str] = None   # hex do client tính từ ảnh bìa
    artists: List[str] = []              # rỗng → lấy nghệ sĩ của track 1
    tracks: List[StudioTrack]


def _to_utc_naive(raw: str) -> datetime:
    """Parse ISO datetime (ưu tiên UTC 'Z' từ client) → UTC naive để so với
    datetime('now') của SQLite. Chuỗi không có timezone coi là giờ local server."""
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.astimezone()          # gắn timezone local
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


@router.post("/publish", status_code=201)
def studio_publish(body: StudioPublish, conn: sqlite3.Connection = Depends(get_db)):
    # ---------- VALIDATE cơ bản (uniqueness check nằm TRONG transaction) ----------
    if not body.title.strip():
        raise HTTPException(400, "Thiếu tên release")
    if not body.tracks:
        raise HTTPException(400, "Chưa có bài hát nào")
    if body.publish_mode not in ("draft", "review", "live", "schedule"):
        raise HTTPException(400, "publish_mode không hợp lệ")
    if body.parental_warning not in ("Explicit", "NotExplicit", "Edited"):
        raise HTTPException(400, "parental_warning không hợp lệ")

    scheduled_at = None
    if body.publish_mode == "schedule":
        try:
            scheduled_at = _to_utc_naive((body.scheduled_at or "").strip())
        except ValueError:
            raise HTTPException(400, "scheduled_at phải là ISO datetime (YYYY-MM-DDTHH:MM)")

    manual_upc = (body.upc or "").strip()
    if manual_upc and not validate_upc(manual_upc):
        raise HTTPException(400, "UPC không hợp lệ (checksum GTIN)")

    audio_files = []
    for i, t in enumerate(body.tracks):
        if not t.title.strip():
            raise HTTPException(400, f"Bài #{i + 1} thiếu tiêu đề")
        if t.parental_warning not in ("Explicit", "NotExplicit", "Edited"):
            raise HTTPException(400, f"Bài #{i + 1}: parental_warning không hợp lệ")
        path = _staging_path(t.staging_id)
        if not path:
            raise HTTPException(400, f"Bài #{i + 1}: file staging không tồn tại "
                                     f"(đã quá hạn {STAGING_TTL_HOURS}h?)")
        audio_files.append(path)

    # ISRC nhập tay: validate định dạng + trùng lẫn nhau (DB check trong transaction)
    manual = {}
    for i, t in enumerate(body.tracks):
        isrc = clean_isrc(t.isrc) if (t.isrc or "").strip() else ""
        if isrc:
            if not validate_isrc(isrc):
                raise HTTPException(400, f"Bài #{i + 1}: ISRC sai định dạng")
            manual[i] = isrc
    if len(set(manual.values())) != len(manual):
        raise HTTPException(400, "Có ISRC nhập trùng nhau")

    cover_path = None
    if body.cover_staging_id:
        cover_path = _staging_path(body.cover_staging_id)
        if not cover_path:
            raise HTTPException(400, "Ảnh bìa staging không tồn tại")
    accent = body.cover_accent if ACCENT_RE.match(body.cover_accent or "") else None

    release_type = body.release_type or (
        "Single" if len(body.tracks) == 1 else "EP" if len(body.tracks) <= 6 else "Album")
    if release_type not in ("Album", "Single", "EP", "Compilation"):
        raise HTTPException(400, "release_type không hợp lệ")

    # ---------- FILE OPS: chuẩn hóa audio (WAV 44.1kHz master + AAC stream) ----------
    # Có ffmpeg: sinh cặp master/stream TỪ file staging mà không đụng vào nó
    # → lỗi ở bất kỳ đâu chỉ cần xóa file sinh ra, staging còn nguyên để publish lại.
    rid = new_id()
    placed = []            # [{tid, processed, staging, final|None}]
    cover_moved = None     # (dest_path, staging_path)
    track_rows = []

    def _undo_files():
        for rec in placed:
            try:
                if rec["processed"]:
                    cleanup_processed(rec["tid"])     # staging còn nguyên
                elif rec["final"] and rec["final"].exists():
                    shutil.move(str(rec["final"]), str(rec["staging"]))
            except OSError:
                pass
        if cover_moved:
            try:
                if cover_moved[0].exists():
                    shutil.move(str(cover_moved[0]), str(cover_moved[1]))
            except OSError:
                pass
        (COVER_DIR / f"release_{rid}.svg").unlink(missing_ok=True)

    try:
        for i, (t, src) in enumerate(zip(body.tracks, audio_files)):
            tid = new_id()
            sha = hashlib.sha256(src.read_bytes()).hexdigest()
            duration = _duration_ms(src)
            pr = process_audio(src, tid)             # WAV 44.1k master + m4a stream
            if pr:
                audio_name, master_name = pr["audio_name"], pr["master_name"]
                placed.append({"tid": tid, "processed": True,
                               "staging": src, "final": None})
            else:
                # không có ffmpeg → giữ nguyên file gốc làm file phát
                dest = AUDIO_DIR / f"{tid}{src.suffix.lower()}"
                shutil.move(str(src), str(dest))
                audio_name, master_name = dest.name, None
                placed.append({"tid": tid, "processed": False,
                               "staging": src, "final": dest})
            track_rows.append(dict(
                id=tid, title=t.title.strip(),
                genre=t.genre or body.genre, language=t.language,
                parental_warning=t.parental_warning, lyrics_lrc=t.lyrics_lrc,
                duration_ms=duration, audio_path=audio_name,
                master_path=master_name, audio_hash=sha,
                artist_names=[a.strip() for a in t.artists if a.strip()],
                track_no=i + 1, transcoded=bool(pr),
            ))

        if cover_path:
            cover_dest = COVER_DIR / f"release_{rid}{cover_path.suffix.lower()}"
            cover_staging_orig = cover_path
            shutil.move(str(cover_path), str(cover_dest))
            cover_moved = (cover_dest, cover_staging_orig)
            cover_url = f"/media/covers/{cover_dest.name}"
            accent = accent or "#7c5cff"
    except OSError as e:
        _undo_files()
        raise HTTPException(500, f"Lỗi xử lý file: {e}")

    # ---------- DB: 1 transaction, BEGIN IMMEDIATE chống race ISRC/UPC ----------
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    mode_map = {
        "draft":    ("draft", "draft", None),
        "review":   ("pending_review", "draft", None),
        "live":     ("live", "live", now_utc),
        "schedule": ("scheduled", "draft",
                     scheduled_at.strftime("%Y-%m-%d %H:%M:%S") if scheduled_at else None),
    }
    rel_status, trk_status, platform_date = mode_map[body.publish_mode]

    conn.execute("BEGIN IMMEDIATE")
    try:
        # uniqueness check khi đã nắm write-lock → publish đồng thời không đụng nhau
        if manual_upc:
            if conn.execute("SELECT 1 FROM releases WHERE upc=?", (manual_upc,)).fetchone():
                raise HTTPException(409, "UPC đã tồn tại")
            upc = manual_upc
        else:
            # ưu tiên mã trong KHO → hết kho mới tự sinh (nếu được bật)
            pooled = pool_take(conn, "upc", 1)
            if pooled:
                upc = pooled[0]
            elif auto_enabled(conn, "upc"):
                upc = _generate_upc(conn)
            else:
                raise pool_exhausted_error("upc")
        for i, isrc in manual.items():
            if conn.execute("SELECT 1 FROM tracks WHERE isrc=?", (isrc,)).fetchone():
                raise HTTPException(409, f"Bài #{i + 1}: ISRC {isrc} đã tồn tại")
        need = len(body.tracks) - len(manual)
        alloc = pool_take(conn, "isrc", need, exclude=set(manual.values()))
        if len(alloc) < need:
            if auto_enabled(conn, "isrc"):
                alloc += _next_isrcs(conn, need - len(alloc),
                                     exclude=set(manual.values()) | set(alloc))
            else:
                raise pool_exhausted_error("isrc")
        isrcs = [manual.get(i) or alloc.pop(0) for i in range(len(body.tracks))]
        for row, isrc in zip(track_rows, isrcs):
            row["isrc"] = isrc

        if not cover_path:
            svg = COVER_DIR / f"release_{rid}.svg"
            accent = generate_cover(
                svg, seed=int(upc[-6:]), title=body.title,
                subtitle=(body.artists or track_rows[0]["artist_names"] or [""])[0])
            cover_url = f"/media/covers/{svg.name}"
        release_artist_names = body.artists or track_rows[0]["artist_names"]
        release_artist_ids = [_get_or_create_artist(conn, n)
                              for n in release_artist_names if n.strip()]

        conn.execute(
            "INSERT INTO releases(id,upc,title,title_norm,release_type,label_name,genre,"
            "p_line,c_line,parental_warning,original_release_date,platform_release_date,"
            "cover_url,accent,status,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (rid, upc, body.title.strip(), normalize_text(body.title), release_type,
             body.label_name, body.genre, body.p_line, body.c_line,
             body.parental_warning, body.original_release_date, platform_date,
             cover_url, accent, rel_status, "studio_upload"))
        for seq, aid in enumerate(release_artist_ids, start=1):
            conn.execute(
                "INSERT OR IGNORE INTO release_artists(release_id,artist_id,role,sequence) "
                "VALUES(?,?,'MainArtist',?)", (rid, aid, seq))
        conn.execute(
            "INSERT INTO deals(id,release_id,territories,use_types,commercial_models,start_date) "
            "VALUES(?,?,?,?,?,?)",
            (new_id(), rid, "Worldwide", "OnDemandStream",
             "SubscriptionModel,AdvertisementSupportedModel",
             (platform_date or datetime.now().strftime("%Y-%m-%d"))[:10]))

        for row in track_rows:
            conn.execute(
                "INSERT INTO tracks(id,isrc,title,title_norm,duration_ms,language,genre,"
                "parental_warning,p_line,audio_path,master_path,audio_hash,lyrics_lrc,status) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (row["id"], row["isrc"], row["title"], normalize_text(row["title"]),
                 row["duration_ms"], row["language"], row["genre"],
                 row["parental_warning"], body.p_line, row["audio_path"],
                 row["master_path"], row["audio_hash"], row["lyrics_lrc"], trk_status))
            conn.execute(
                "INSERT INTO release_tracks(release_id,track_id,disc_no,track_no) "
                "VALUES(?,?,1,?)", (rid, row["id"], row["track_no"]))
            for seq, name in enumerate(row["artist_names"], start=1):
                aid = _get_or_create_artist(conn, name)
                role = "MainArtist" if seq == 1 else "FeaturedArtist"
                conn.execute(
                    "INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) "
                    "VALUES(?,?,?,?)", (row["id"], aid, role, seq))
            mark_code_used(conn, "isrc", row["isrc"], row["id"])
        mark_code_used(conn, "upc", upc, rid)
        conn.execute("COMMIT")
    except HTTPException:
        conn.execute("ROLLBACK")
        _undo_files()
        raise
    except sqlite3.IntegrityError as e:
        conn.execute("ROLLBACK")
        _undo_files()
        raise HTTPException(409, f"Xung đột định danh với thao tác khác — bấm publish lại ({e})")
    except Exception:
        conn.execute("ROLLBACK")
        _undo_files()
        raise

    # thành công → file staging đã dùng xong, dọn sạch
    for rec in placed:
        if rec["processed"]:
            rec["staging"].unlink(missing_ok=True)

    return {
        "release_id": rid, "upc": upc, "status": rel_status,
        "release_type": release_type,
        "transcoded": ffmpeg_available(),
        "tracks": [{"id": r["id"], "isrc": r["isrc"], "title": r["title"],
                    "transcoded": r["transcoded"]} for r in track_rows],
    }


@router.get("/info")
def studio_info(conn: sqlite3.Connection = Depends(get_db)):
    """Thông tin cho UI: ffmpeg, prefix ISRC, ISRC kế tiếp, kho mã."""
    yy = datetime.now().strftime("%y")
    return {
        "ffmpeg": ffmpeg_available(),
        "isrc_prefix": f"{ISRC_PREFIX}{yy}",
        "next_isrc": _next_isrcs(conn, 1)[0],
        "pool": {
            "isrc": {**pool_counts(conn, "isrc"), "auto": auto_enabled(conn, "isrc")},
            "upc": {**pool_counts(conn, "upc"), "auto": auto_enabled(conn, "upc")},
        },
    }
