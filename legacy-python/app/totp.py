"""TOTP (RFC 6238) cho 2FA — thuần stdlib, tương thích Google Authenticator.

Chu kỳ 30s, 6 số, HMAC-SHA1 (chuẩn mặc định của Google Authenticator).
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
import urllib.parse


def new_secret() -> str:
    """Secret base32 20 byte (chuẩn GA)."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code_at(secret: str, counter: int) -> str:
    # padding lại base32 (secret lưu không có '=')
    pad = "=" * (-len(secret) % 8)
    key = base64.b32decode(secret.upper() + pad)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    num = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{num % 1_000_000:06d}"


def totp_now(secret: str, at: float = None) -> str:
    t = int((at if at is not None else time.time()) // 30)
    return _code_at(secret, t)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """So khớp code với cửa sổ ±window chu kỳ (lệch đồng hồ điện thoại)."""
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6 or not secret:
        return False
    t = int(time.time() // 30)
    return any(hmac.compare_digest(_code_at(secret, t + off), code)
               for off in range(-window, window + 1))


def otpauth_uri(secret: str, email: str, brand_name: str = "ANS Music") -> str:
    """URI otpauth:// — Google Authenticator hiển thị '{brand} - {email}'."""
    label = urllib.parse.quote(f"{brand_name} - {email}")
    issuer = urllib.parse.quote(brand_name)
    return f"otpauth://totp/{label}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30"
