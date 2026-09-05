"""Pipeline audio: transcode WAV/FLAC → AAC (m4a) cho streaming bằng ffmpeg.

Có ffmpeg  → file phát là AAC nhẹ (~10× nhỏ hơn WAV), bản gốc giữ ở media/masters.
Không ffmpeg → stream thẳng file gốc (degrade êm, không lỗi).
Production nâng lên HLS đa bitrate theo mục 7 của tài liệu ý tưởng.
"""
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from .config import AUDIO_DIR, MASTER_DIR, TRANSCODE_BITRATE

FFMPEG = shutil.which("ffmpeg")

# định dạng nên transcode (lossless/nặng); mp3/m4a/ogg đã nén sẵn thì giữ nguyên
TRANSCODE_EXTS = {".wav", ".flac"}


def ffmpeg_available() -> bool:
    return FFMPEG is not None


def process_audio(src: Path, track_id: str) -> Optional[dict]:
    """Pipeline chuẩn v1.4: mọi upload → bản gốc WAV 44.1kHz/16-bit stereo
    (media/masters — nguồn sự thật + file download) + bản stream AAC nhẹ.

    KHÔNG đụng vào file src (caller giữ để undo). Trả về
    {"audio_name": ..., "master_name": ...} hoặc None nếu không có ffmpeg.
    """
    if not FFMPEG:
        return None

    master = MASTER_DIR / f"{track_id}.wav"
    m_tmp = MASTER_DIR / f"{track_id}.tmp.wav"
    stream = AUDIO_DIR / f"{track_id}.m4a"
    s_tmp = AUDIO_DIR / f"{track_id}.tmp.m4a"
    try:
        proc = subprocess.run(
            [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(src), "-vn",
             "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le",
             "-f", "wav", str(m_tmp)],
            capture_output=True, timeout=300)
        if proc.returncode != 0 or not m_tmp.is_file() or m_tmp.stat().st_size == 0:
            m_tmp.unlink(missing_ok=True)
            return None
        proc = subprocess.run(
            [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(m_tmp), "-vn",
             "-c:a", "aac", "-b:a", TRANSCODE_BITRATE,
             "-movflags", "+faststart", "-f", "mp4", str(s_tmp)],
            capture_output=True, timeout=300)
        if proc.returncode != 0 or not s_tmp.is_file() or s_tmp.stat().st_size == 0:
            m_tmp.unlink(missing_ok=True)
            s_tmp.unlink(missing_ok=True)
            return None
        m_tmp.replace(master)
        s_tmp.replace(stream)
        return {"audio_name": stream.name, "master_name": master.name}
    except (subprocess.SubprocessError, OSError):
        m_tmp.unlink(missing_ok=True)
        s_tmp.unlink(missing_ok=True)
        return None


def cleanup_processed(track_id: str) -> None:
    """Xóa cặp file đã sinh bởi process_audio (dùng khi rollback)."""
    (MASTER_DIR / f"{track_id}.wav").unlink(missing_ok=True)
    (AUDIO_DIR / f"{track_id}.m4a").unlink(missing_ok=True)


def transcode_for_streaming(src: Path, track_id: str) -> Optional[dict]:
    """Transcode file nguồn thành {track_id}.m4a trong AUDIO_DIR.

    Trả về {"audio_name": ..., "master_name": ...} nếu đã transcode,
    None nếu bỏ qua (không có ffmpeg / định dạng đã nén / transcode lỗi).
    Bản gốc được CHUYỂN vào MASTER_DIR (nguồn sự thật, phục vụ re-encode sau này).
    """
    if not FFMPEG or src.suffix.lower() not in TRANSCODE_EXTS:
        return None

    out = AUDIO_DIR / f"{track_id}.m4a"
    tmp = AUDIO_DIR / f"{track_id}.transcoding.m4a"
    try:
        proc = subprocess.run(
            [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(src),
             "-vn", "-c:a", "aac", "-b:a", TRANSCODE_BITRATE,
             "-movflags", "+faststart",
             "-f", "mp4", str(tmp)],
            capture_output=True, timeout=300,
        )
        if proc.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
            tmp.unlink(missing_ok=True)
            return None
        tmp.replace(out)
    except (subprocess.SubprocessError, OSError):
        tmp.unlink(missing_ok=True)
        return None

    master = MASTER_DIR / f"{track_id}{src.suffix.lower()}"
    try:
        src.replace(master)
        master_name = master.name
    except OSError:
        master_name = None  # giữ nguyên chỗ cũ nếu không di chuyển được

    return {"audio_name": out.name, "master_name": master_name}
