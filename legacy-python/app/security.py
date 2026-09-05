"""Auth: hash mật khẩu (PBKDF2 stdlib) + JWT access token."""
import hashlib
import hmac
import secrets
import time
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request

from .config import ACCESS_TOKEN_TTL, JWT_ALGORITHM, SECRET_KEY
from .db import connect

PBKDF2_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, digest = stored.split("$")
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iters)
        ).hex()
        return hmac.compare_digest(candidate, digest)
    except (ValueError, AttributeError):
        return False


def create_token(user_id: str, role: str, token_version: int = 0) -> str:
    now = int(time.time())
    payload = {"sub": user_id, "role": role, "tv": token_version,
               "iat": now, "exp": now + ACCESS_TOKEN_TTL}
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


def _extract_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def _load_user(user_id: str) -> Optional[dict]:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _token_fresh(payload: dict, user: dict) -> bool:
    """Token còn hiệu lực nếu tv trong token khớp token_version hiện tại của user
    (đổi mật khẩu/reset sẽ tăng token_version → mọi token cũ vô hiệu)."""
    return int(payload.get("tv", 0)) == int(user.get("token_version") or 0)


def get_current_user(request: Request) -> dict:
    token = _extract_token(request)
    payload = decode_token(token) if token else None
    # token trung gian (typ='2fa' chờ nhập mã) KHÔNG phải access token —
    # nếu không chặn ở đây thì 2FA bị vượt qua chỉ với mật khẩu
    if not payload or payload.get("typ"):
        raise HTTPException(401, "Chưa đăng nhập hoặc phiên đã hết hạn")
    user = _load_user(payload["sub"])
    if not user:
        raise HTTPException(401, "Tài khoản không tồn tại")
    if not _token_fresh(payload, user):
        raise HTTPException(401, "Phiên đã hết hạn — đăng nhập lại")
    return user


def get_optional_user(request: Request) -> Optional[dict]:
    token = _extract_token(request)
    payload = decode_token(token) if token else None
    if not payload or payload.get("typ"):
        return None
    user = _load_user(payload["sub"])
    if user and not _token_fresh(payload, user):
        return None
    return user


def create_pending_2fa_token(user_id: str) -> str:
    """Token trung gian sau khi đúng mật khẩu, chờ mã TOTP — sống 5 phút."""
    now = int(time.time())
    payload = {"sub": user_id, "typ": "2fa", "iat": now, "exp": now + 300}
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Cần quyền quản trị")
    return user


# ---- Phân quyền v2.0 ----
# admin    : toàn quyền (kể cả người dùng, cài đặt, đối tác)
# manager  : quản lý delivery — duyệt phát hành, chỉnh sửa mọi nội dung
# uploader : chỉ tạo/sửa product NHẠC CỦA MÌNH, không phát hành (gửi hàng đợi duyệt)
# user     : người nghe
STAFF_ROLES = ("admin", "manager", "uploader")
MANAGER_ROLES = ("admin", "manager")


def require_staff(user: dict = Depends(get_current_user)) -> dict:
    """Vào được khu vực CMS (admin/manager/uploader)."""
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(403, "Cần quyền quản trị nội dung")
    return user


def require_manager(user: dict = Depends(get_current_user)) -> dict:
    """Duyệt/phát hành/chỉnh sửa mọi nội dung (admin/manager)."""
    if user.get("role") not in MANAGER_ROLES:
        raise HTTPException(403, "Cần quyền quản lý phát hành")
    return user


def is_manager(user: dict) -> bool:
    return user.get("role") in MANAGER_ROLES
