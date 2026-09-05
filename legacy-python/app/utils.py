"""Tiện ích: chuẩn hóa tiếng Việt, validate ISRC/UPC, signed stream URL."""
import hashlib
import hmac
import re
import time
import unicodedata
import zlib

from .config import SECRET_KEY, STREAM_URL_TTL

_D_MAP = {"đ": "d", "Đ": "d"}


def normalize_text(s: str) -> str:
    """Bỏ dấu tiếng Việt + lowercase để tìm kiếm không dấu."""
    if not s:
        return ""
    s = "".join(_D_MAP.get(ch, ch) for ch in s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


ISRC_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$")


def validate_isrc(isrc: str) -> bool:
    """ISRC 12 ký tự: CC-XXX-YY-NNNNN (bỏ dấu gạch)."""
    if not isrc:
        return False
    return bool(ISRC_RE.match(isrc.replace("-", "").upper()))


def clean_isrc(isrc: str) -> str:
    return isrc.replace("-", "").upper().strip()


def validate_upc(upc: str) -> bool:
    """UPC/EAN 12–14 số, checksum GTIN."""
    if not upc or not upc.isdigit() or not (12 <= len(upc) <= 14):
        return False
    digits = [int(c) for c in upc]
    check = digits.pop()
    digits.reverse()
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(digits))
    return (10 - total % 10) % 10 == check


def sign_stream(track_id: str, ttl: int = STREAM_URL_TTL) -> str:
    """Trả về query string exp/sig cho URL streaming (chống hotlink)."""
    exp = int(time.time()) + ttl
    sig = hmac.new(
        SECRET_KEY.encode(), f"{track_id}.{exp}".encode(), hashlib.sha256
    ).hexdigest()[:32]
    return f"exp={exp}&sig={sig}"


def sign_download(kind: str, obj_id: str, ttl: int = 3600) -> str:
    """Query string exp/sig cho link tải xuống (namespace riêng với stream)."""
    exp = int(time.time()) + ttl
    sig = hmac.new(
        SECRET_KEY.encode(), f"dl:{kind}:{obj_id}.{exp}".encode(), hashlib.sha256
    ).hexdigest()[:32]
    return f"exp={exp}&sig={sig}"


def verify_download_sig(kind: str, obj_id: str, exp: str, sig: str) -> bool:
    try:
        exp_i = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_i < time.time():
        return False
    expected = hmac.new(
        SECRET_KEY.encode(), f"dl:{kind}:{obj_id}.{exp_i}".encode(), hashlib.sha256
    ).hexdigest()[:32]
    return hmac.compare_digest(expected, sig or "")


def safe_filename(name: str) -> str:
    """Loại ký tự cấm trong tên file tải xuống (giữ Unicode/tiếng Việt)."""
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "", name).strip() or "download"


def verify_stream_sig(track_id: str, exp: str, sig: str) -> bool:
    try:
        exp_i = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_i < time.time():
        return False
    expected = hmac.new(
        SECRET_KEY.encode(), f"{track_id}.{exp_i}".encode(), hashlib.sha256
    ).hexdigest()[:32]
    return hmac.compare_digest(expected, sig or "")


def gtin_check_digit(digits: str) -> str:
    """Tính số kiểm tra GTIN cho chuỗi số (không gồm check digit)."""
    rev = [int(c) for c in digits][::-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(rev))
    return str((10 - total % 10) % 10)


def stable_seed(s: str) -> int:
    """Seed tất định từ chuỗi — hash() builtin đổi mỗi process (PYTHONHASHSEED)."""
    return zlib.crc32((s or "").encode("utf-8")) & 0xFFFF


def fmt_duration(ms: int) -> str:
    s = int((ms or 0) / 1000)
    return f"{s // 60}:{s % 60:02d}"
