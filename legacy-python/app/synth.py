"""Bộ tổng hợp nhạc demo — sinh file WAV nghe được (chord + bass + arpeggio + trống)
để nền tảng có nội dung ngay khi chạy lần đầu, không đụng bản quyền.

Render vectorized bằng numpy (nhanh, ổn định). Mỗi track sinh tất định từ seed.
"""
import math
import random
import wave
from pathlib import Path

import numpy as np

SR = 44100  # chuẩn lưu trữ của nền tảng: WAV 44.1kHz

# Tần số nốt gốc (octave 4)
NOTE_FREQS = {
    "C": 261.63, "C#": 277.18, "D": 293.66, "D#": 311.13, "E": 329.63,
    "F": 349.23, "F#": 369.99, "G": 392.00, "G#": 415.30, "A": 440.00,
    "A#": 466.16, "B": 493.88,
}
NOTE_NAMES = list(NOTE_FREQS.keys())

MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]

# Vòng hợp âm theo bậc trong scale
PROGRESSIONS = [
    [0, 4, 5, 3],   # I V vi IV
    [0, 5, 3, 4],   # I vi IV V
    [5, 3, 0, 4],   # vi IV I V
    [0, 3, 4, 3],   # I IV V IV
    [5, 4, 3, 4],   # vi V IV V
]


def note_freq(root_idx: int, semitone: int, octave: int = 0) -> float:
    return NOTE_FREQS[NOTE_NAMES[root_idx % 12]] * (2 ** (semitone / 12)) * (2 ** octave)


def _adsr(n: int, sr: int, a=0.01, d=0.08, s=0.7, r=0.15) -> np.ndarray:
    an, dn, rn = int(a * sr), int(d * sr), int(r * sr)
    if an + dn + rn >= n:
        # nốt quá ngắn: fade tam giác
        half = max(1, n // 2)
        return np.concatenate([np.linspace(0, 1, half), np.linspace(1, 0, n - half)])
    sn = n - an - dn - rn
    return np.concatenate([
        np.linspace(0, 1, an, endpoint=False),
        np.linspace(1, s, dn, endpoint=False),
        np.full(sn, s),
        np.linspace(s, 0, rn),
    ])


def _mix(buf: np.ndarray, start: int, mono: np.ndarray, vol: float, pan: float = 0.0):
    """Cộng tín hiệu mono vào buffer stereo (n, 2) tại vị trí start."""
    end = min(len(buf), start + len(mono))
    if end <= start:
        return
    seg = mono[: end - start]
    left = vol * (1 - max(0.0, pan))
    right = vol * (1 + min(0.0, pan))
    buf[start:end, 0] += seg * left
    buf[start:end, 1] += seg * right


def _tone(freq: float, dur: float, wave_mix=(1.0, 0.0), sr: int = SR) -> np.ndarray:
    n = max(1, int(dur * sr))
    t = np.arange(n) / sr
    w = 2 * math.pi * freq
    sine_amt, saw_amt = wave_mix
    v = sine_amt * np.sin(w * t)
    if saw_amt:
        # "saw" mềm: cộng hài bậc 2 và 3
        v = v + saw_amt * (0.5 * np.sin(2 * w * t) + 0.25 * np.sin(3 * w * t))
    return v * _adsr(n, sr)


def _kick(sr: int = SR) -> np.ndarray:
    n = int(0.16 * sr)
    t = np.arange(n) / sr
    freq = 120 * np.exp(-t * 22) + 42
    return np.sin(2 * math.pi * freq * t) * np.exp(-t * 16)


def _hat(nprng: np.random.Generator, sr: int = SR) -> np.ndarray:
    n = int(0.05 * sr)
    return (nprng.random(n) * 2 - 1) * np.exp(-np.arange(n) / (0.008 * sr))


def synthesize_track(path: Path, seed: int, style: str = "pop",
                     bars: int = 20, bpm: int = None) -> int:
    """Sinh 1 bản nhạc WAV stereo. Trả về duration_ms."""
    rng = random.Random(seed)
    nprng = np.random.default_rng(seed)

    styles = {
        "pop":      dict(bpm=(96, 118),  scale=MAJOR, arp=True,  pad=True,  drums=True,  mix=(1.0, 0.25)),
        "ballad":   dict(bpm=(66, 80),   scale=MINOR, arp=True,  pad=True,  drums=False, mix=(1.0, 0.1)),
        "lofi":     dict(bpm=(70, 84),   scale=MINOR, arp=True,  pad=True,  drums=True,  mix=(1.0, 0.05)),
        "edm":      dict(bpm=(122, 128), scale=MINOR, arp=True,  pad=True,  drums=True,  mix=(0.8, 0.5)),
        "acoustic": dict(bpm=(88, 104),  scale=MAJOR, arp=True,  pad=False, drums=False, mix=(1.0, 0.2)),
    }
    cfg = styles.get(style, styles["pop"])
    bpm = bpm or rng.randint(*cfg["bpm"])
    scale = cfg["scale"]
    root = rng.randrange(12)
    prog = rng.choice(PROGRESSIONS)

    beat = 60.0 / bpm
    bar = beat * 4
    total_sec = bars * bar + 1.5
    n_samples = int(total_sec * SR)
    buf = np.zeros((n_samples, 2), dtype=np.float64)

    def chord_notes(degree):
        return [scale[degree % 7] + (12 if degree >= 7 else 0),
                scale[(degree + 2) % 7] + (12 if degree + 2 >= 7 else 0),
                scale[(degree + 4) % 7] + (12 if degree + 4 >= 7 else 0)]

    arp_pat = rng.choice([[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1], [0, 1, 2, 2]])
    melody_seed = [rng.choice([0, 1, 2, 4, 5]) for _ in range(16)]
    kick_wave = _kick()

    for b in range(bars):
        t0 = b * bar
        degree = prog[b % len(prog)]
        notes = chord_notes(degree)
        start = int(t0 * SR)

        # Pad hợp âm (nốt dài)
        if cfg["pad"]:
            for k, semi in enumerate(notes):
                _mix(buf, start, _tone(note_freq(root, semi, 0), bar * 0.98, cfg["mix"]),
                     0.10, pan=(-0.3 + 0.3 * k))

        # Bass trên beat 1 và 3
        for bi in (0, 2):
            bs = int((t0 + bi * beat) * SR)
            _mix(buf, bs, _tone(note_freq(root, scale[degree % 7], -2), beat * 1.6),
                 0.22)

        # Arpeggio nốt 1/8
        if cfg["arp"]:
            for step in range(8):
                semi = notes[arp_pat[step % 4]]
                st = int((t0 + step * beat / 2) * SR)
                _mix(buf, st, _tone(note_freq(root, semi, 1), beat * 0.45, cfg["mix"]),
                     0.09, pan=0.35 if step % 2 else -0.35)

        # Giai điệu chính (từ bar 3, nghỉ ngẫu nhiên)
        if b >= 2:
            for step in range(4):
                if rng.random() < 0.28:
                    continue
                deg = melody_seed[(b * 4 + step) % 16]
                semi = scale[(degree + deg) % 7] + 12
                st = int((t0 + step * beat) * SR)
                _mix(buf, st,
                     _tone(note_freq(root, semi, 1), beat * rng.choice([0.5, 0.9, 1.4]), (1.0, 0.15)),
                     0.14, pan=rng.uniform(-0.2, 0.2))

        # Trống
        if cfg["drums"]:
            for bi in range(4):
                bs = int((t0 + bi * beat) * SR)
                if bi in (0, 2):
                    _mix(buf, bs, kick_wave, 0.8)
                for half in range(2):
                    hs = int((t0 + (bi + half * 0.5) * beat) * SR)
                    _mix(buf, hs, _hat(nprng), 0.12, pan=0.3)

    # Normalize về đỉnh 0.88 rồi ghi WAV 16-bit stereo
    peak = max(1e-9, float(np.abs(buf).max()))
    pcm = np.clip(buf * (0.88 / peak), -1.0, 1.0)
    frames = (pcm * 32767).astype("<i2").tobytes()

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(frames)

    return int(total_sec * 1000)
