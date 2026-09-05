"""Phân tích đỉnh sóng (peaks) cho UI waveform kiểu Adobe Audition.

Mỗi track được decode về mono 8kHz rồi chia thành BUCKETS đoạn, lấy biên độ
đỉnh của từng đoạn, chuẩn hóa 0..1 và cache JSON — client vẽ canvas chi tiết.
WAV 16-bit đọc bằng stdlib+numpy; các định dạng khác decode qua ffmpeg.
"""
import json
import subprocess
import wave
from pathlib import Path
from typing import List, Optional

import numpy as np

from .config import WAVEFORM_DIR
from .transcode import FFMPEG

BUCKETS = 1000
DECODE_RATE = 8000


def _decode_wav(path: Path) -> Optional[np.ndarray]:
    try:
        with wave.open(str(path), "rb") as wf:
            if wf.getsampwidth() != 2:
                return None                    # không phải 16-bit → nhờ ffmpeg
            ch = wf.getnchannels()
            raw = wf.readframes(wf.getnframes())
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        if ch > 1:
            data = data[: len(data) - len(data) % ch].reshape(-1, ch).mean(axis=1)
        return data
    except (wave.Error, EOFError, OSError):
        return None


def _decode_ffmpeg(path: Path) -> Optional[np.ndarray]:
    if not FFMPEG:
        return None
    try:
        proc = subprocess.run(
            [FFMPEG, "-v", "error", "-i", str(path),
             "-ac", "1", "-ar", str(DECODE_RATE), "-f", "s16le", "-"],
            capture_output=True, timeout=120,
        )
        if proc.returncode != 0 or not proc.stdout:
            return None
        return np.frombuffer(proc.stdout, dtype="<i2").astype(np.float32) / 32768.0
    except (subprocess.SubprocessError, OSError):
        return None


def compute_peaks(audio_path: Path) -> List[float]:
    """Trả về danh sách BUCKETS đỉnh biên độ 0..1 (rỗng nếu không decode được)."""
    data = None
    if audio_path.suffix.lower() == ".wav":
        data = _decode_wav(audio_path)
    if data is None:
        data = _decode_ffmpeg(audio_path)
    if data is None or len(data) < BUCKETS:
        return []

    trimmed = len(data) - len(data) % BUCKETS
    peaks = np.abs(data[:trimmed]).reshape(BUCKETS, -1).max(axis=1)
    top = float(peaks.max())
    if top <= 0:
        return []
    peaks = peaks / top
    return [round(float(p), 3) for p in peaks]


def waveform_cache_path(track_id: str) -> Path:
    return WAVEFORM_DIR / f"{track_id}.json"


def get_or_build_waveform(track_id: str, audio_path: Path) -> List[float]:
    """Đọc cache; chưa có thì phân tích rồi lưu."""
    cache = waveform_cache_path(track_id)
    if cache.is_file():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            cache.unlink(missing_ok=True)
    peaks = compute_peaks(audio_path)
    if peaks:
        try:
            cache.write_text(json.dumps(peaks), encoding="utf-8")
        except OSError:
            pass
    return peaks


def invalidate_waveform(track_id: str) -> None:
    waveform_cache_path(track_id).unlink(missing_ok=True)
