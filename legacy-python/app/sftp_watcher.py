"""Watcher SFTP: quét dropbox mỗi distribution, nạp DDEX delivery vào web.

Quy ước 1 delivery = 1 file ERN XML + các file audio đi kèm (cùng thư mục hoặc
thư mục con). Khi XML + audio 'ổn định' (không đổi trong ANS_SFTP_STABLE_SEC
giây → tránh nạp lúc đối tác đang upload dở), watcher:
  1) parse + import_delivery (tạo release/track theo ISRC, khớp role contributor)
  2) đính kèm audio theo ISRC ↔ file tham chiếu trong XML (hoặc dò theo tên)
  3) chuyển delivery sang processed/ (hoặc failed/ nếu lỗi)
"""
import asyncio
import hashlib
import time
from pathlib import Path

from . import config
from .db import connect
from .ddex import import_delivery, parse_ern

_AUDIO_EXTS = (".wav", ".flac", ".mp3", ".m4a", ".ogg", ".aiff", ".aif")


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


def _stable(path: Path, now: float) -> bool:
    """File coi là ổn định nếu sửa lần cuối cách đây >= SFTP_STABLE_SEC."""
    try:
        return (now - path.stat().st_mtime) >= config.SFTP_STABLE_SEC
    except OSError:
        return False


def _find_audio(delivery_dir: Path, file_uri: str, isrc: str, single_release: bool):
    """Tìm file audio cho 1 recording: ưu tiên tên file trong XML, rồi ISRC trong
    tên file. CHỈ fallback 'file audio duy nhất' khi delivery có ĐÚNG 1 recording —
    nếu nhiều recording mà không khớp thì trả None (tránh gán nhầm 1 file cho mọi
    track)."""
    base = Path((file_uri or "").replace("\\", "/")).name.lower()
    # KHÔNG dùng rglob toàn bộ delivery (chống symlink/thoát thư mục ngoài ý muốn);
    # chỉ nhận file THẬT nằm dưới delivery_dir, không theo symlink.
    candidates = []
    for p in delivery_dir.rglob("*"):
        try:
            if p.is_file() and not p.is_symlink() and p.suffix.lower() in _AUDIO_EXTS \
               and p.resolve().is_relative_to(delivery_dir.resolve()):
                candidates.append(p)
        except OSError:
            continue
    if base:
        for p in candidates:
            if p.name.lower() == base:
                return p
    if isrc:
        iso = isrc.replace("-", "").upper()
        for p in candidates:
            if iso in p.name.replace("-", "").upper():
                return p
    # chỉ khi delivery có DUY NHẤT 1 recording + 1 file audio → gán luôn
    if single_release and len(candidates) == 1:
        return candidates[0]
    return None


def _attach_audio(conn, parsed: dict, report: dict, delivery_dir: Path, log: list):
    """Sau import, gắn file audio thật vào ĐÚNG track mà import vừa tạo/sửa cho
    delivery này (theo id trong report.tracks) — KHÔNG dò lại theo ISRC toàn hệ
    thống (tránh chạm track của đối tác khác trùng ISRC)."""
    from .utils import clean_isrc
    # map isrc → track id mà import THỰC SỰ đã tạo/sửa cho delivery này
    allowed = {clean_isrc(t.get("isrc", "")): t.get("id")
               for t in report.get("tracks", []) if t.get("id")}
    recs = parsed.get("recordings", [])
    single = len(recs) == 1
    attached = 0
    for rec in recs:
        try:
            isrc = clean_isrc(rec.get("isrc", ""))
            tid = allowed.get(isrc)
            if not tid:
                continue   # track không do delivery này tạo/sửa → không đụng vào
            src = _find_audio(delivery_dir, rec.get("file_uri", ""), isrc, single)
            if not src:
                log.append(f"  ⚠ Track ISRC {isrc}: không thấy file audio khớp — bỏ qua")
                continue
            attached += _attach_one(conn, tid, src, rec)
        except Exception as e:      # noqa: BLE001 — 1 track lỗi không chặn cả delivery
            log.append(f"  ⚠ Track ISRC {rec.get('isrc')}: lỗi đính audio — {e}")
    log.append(f"  ♫ Đã đính kèm audio cho {attached} track")


def _attach_one(conn, tid: str, src: Path, rec: dict) -> int:
    """Đính 1 file audio vào track. Trả 1 nếu thành công."""
    from .config import AUDIO_DIR
    from .transcode import process_audio
    from .waveform import invalidate_waveform
    ext = src.suffix.lower()
    dest = AUDIO_DIR / f"{tid}{ext}"
    sha = hashlib.sha256()
    with src.open("rb") as fi, dest.open("wb") as fo:
        while chunk := fi.read(1024 * 1024):
            sha.update(chunk)
            fo.write(chunk)
    dur = _audio_duration_ms(dest) or (rec.get("duration_ms") or 0)
    audio_name, master_name = dest.name, None
    tr = process_audio(dest, tid)
    if tr:
        audio_name, master_name = tr["audio_name"], tr["master_name"]
        if dest.name != audio_name:
            dest.unlink(missing_ok=True)
    conn.execute(
        "UPDATE tracks SET audio_path=?, master_path=?, audio_hash=?, "
        "duration_ms=COALESCE(NULLIF(?,0), duration_ms) WHERE id=?",
        (audio_name, master_name, sha.hexdigest(), dur, tid))
    # track có audio + release đang live → cho track live luôn
    conn.execute(
        "UPDATE tracks SET status='live' WHERE id=? AND status IN ('draft','pending_review') "
        "AND EXISTS (SELECT 1 FROM release_tracks rt JOIN releases r ON r.id=rt.release_id "
        "            WHERE rt.track_id=? AND r.status='live')", (tid, tid))
    invalidate_waveform(tid)
    return 1


def _process_one(conn, partner: dict, xml_path: Path) -> bool:
    """Nạp 1 delivery (1 file XML). Trả True nếu xử lý (thành công hay thất bại
    đều move ra khỏi incoming)."""
    delivery_dir = xml_path.parent
    log = []
    try:
        xml_bytes = xml_path.read_bytes()
        parsed = parse_ern(xml_bytes)
        report = import_delivery(conn, xml_bytes,
                                 auto_publish=bool(partner["auto_publish"]),
                                 partner=partner)
        log = list(report.get("log", []))
        if report["status"] not in ("duplicate", "failed"):
            _attach_audio(conn, parsed, report, delivery_dir, log)
        conn.execute(
            "UPDATE delivery_partners SET last_delivery_at=datetime('now') WHERE id=?",
            (partner["id"],))
        ok = report["status"] not in ("failed",)
    except Exception as e:       # noqa: BLE001 — parse/nạp lỗi phải quản lý được
        log.append(f"Lỗi xử lý: {e}")
        ok = False

    dest_root = config.SFTP_ROOT / partner["sftp_username"] / ("processed" if ok else "failed")
    dest_root.mkdir(parents=True, exist_ok=True)
    stamp = str(int(time.time()))
    try:
        # gói cả thư mục delivery (nếu XML nằm trong thư mục con) hoặc chỉ file XML
        if delivery_dir.name == "incoming":
            xml_path.replace(dest_root / f"{stamp}_{xml_path.name}")
        else:
            delivery_dir.replace(dest_root / f"{stamp}_{delivery_dir.name}")
    except OSError:
        pass
    print(f"[sftp-watch] {partner['name']}: {xml_path.name} → "
          f"{'processed' if ok else 'failed'}")
    for line in log:
        print("   " + line)
    return True


def scan_once():
    """Quét tất cả dropbox 1 lần (đồng bộ, gọi trong thread)."""
    conn = connect()
    try:
        partners = conn.execute(
            "SELECT * FROM delivery_partners WHERE delivery_channel='sftp' "
            "AND sftp_username IS NOT NULL").fetchall()
        now = time.time()
        for p in partners:
            partner = dict(p)
            incoming = config.SFTP_ROOT / partner["sftp_username"] / "incoming"
            if not incoming.is_dir():
                continue
            xmls = sorted(incoming.rglob("*.xml"))
            for xml_path in xmls:
                # cả XML lẫn mọi audio trong thư mục delivery phải ổn định
                folder = xml_path.parent
                files = [f for f in folder.rglob("*") if f.is_file()]
                if not files or not all(_stable(f, now) for f in files):
                    continue
                _process_one(conn, partner, xml_path)
    finally:
        conn.close()


async def sftp_watch_loop():
    """Vòng lặp nền — quét dropbox mỗi SFTP_POLL_SEC giây."""
    if not config.SFTP_ENABLED:
        return
    while True:
        try:
            await asyncio.to_thread(scan_once)
        except Exception as e:      # noqa: BLE001
            print(f"[sftp-watch] lỗi vòng quét: {e}")
        await asyncio.sleep(config.SFTP_POLL_SEC)
