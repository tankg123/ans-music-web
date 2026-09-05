"""Đăng ký (xác thực email 2 bước) / đăng nhập — JWT + rate-limit chống brute-force."""
import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..branding import get_brand
from ..config import (EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_TTL, EMAIL_ENABLED,
                      SECRET_KEY)
from ..db import get_db, new_id
from ..emailer import send_reset_code, send_verification_code
from ..security import (create_pending_2fa_token, create_token, decode_token,
                        hash_password, verify_password)
from ..totp import verify_totp

router = APIRouter(prefix="/v1/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Rate-limit login: tối đa 8 lần sai / 10 phút cho mỗi IP (in-memory —
# production dùng Redis để chia sẻ giữa các instance)
LOGIN_MAX_FAILS = 8
LOGIN_WINDOW_SEC = 600
_login_fails: dict = defaultdict(deque)

# Rate-limit gửi mã đăng ký: tối đa 5 lần / 10 phút / IP
CODE_MAX = 5
CODE_WINDOW = 600
_code_sends: dict = defaultdict(deque)

# Rate-limit 2FA: đếm RIÊNG theo tài khoản, KHÔNG bị reset khi đăng nhập đúng
# mật khẩu (nếu dùng chung bộ đếm login, attacker biết mật khẩu có thể xóa bộ
# đếm bằng 1 lần login rồi brute-force mã TOTP không giới hạn).
TWOFA_MAX_FAILS = 6
TWOFA_WINDOW = 600
_twofa_fails: dict = defaultdict(deque)


def _check_rate(store: dict, key: str, limit: int, window: int, msg: str):
    now = time.time()
    q = store[key]
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, msg)


def _check_login_rate(ip: str):
    _check_rate(_login_fails, ip, LOGIN_MAX_FAILS, LOGIN_WINDOW_SEC,
               "Sai mật khẩu quá nhiều lần — thử lại sau ít phút")


def _record_login_fail(ip: str):
    _login_fails[ip].append(time.time())


def _hash_code(email: str, code: str) -> str:
    return hmac.new(SECRET_KEY.encode(), f"{email}:{code}".encode(),
                    hashlib.sha256).hexdigest()


class RegisterBody(BaseModel):
    email: str
    password: str
    display_name: str = ""


class ConfirmBody(BaseModel):
    email: str
    code: str


class LoginBody(BaseModel):
    email: str
    password: str


def _user_payload(user: dict, token: str) -> dict:
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"],
            "display_name": user["display_name"], "role": user["role"],
            "plan": user["plan"], "avatar_url": user.get("avatar_url"),
        },
    }


def _validate_register(conn, email: str, password: str):
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Email không hợp lệ")
    if len(password) < 6:
        raise HTTPException(400, "Mật khẩu tối thiểu 6 ký tự")
    if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        raise HTTPException(409, "Email đã được đăng ký")


@router.post("/register/request")
def register_request(body: RegisterBody, request: Request,
                     conn: sqlite3.Connection = Depends(get_db)):
    """Bước 1: nhận thông tin, gửi mã 6 số tới email (lưu tạm, chưa tạo tài khoản)."""
    ip = request.client.host if request.client else "unknown"
    _check_rate(_code_sends, ip, CODE_MAX, CODE_WINDOW,
               "Gửi mã quá nhiều lần — thử lại sau ít phút")
    email = body.email.strip().lower()
    _validate_register(conn, email, body.password)

    code = f"{secrets.randbelow(1000000):06d}"
    name = body.display_name.strip() or email.split("@")[0]
    expires = (datetime.now(timezone.utc) + timedelta(seconds=EMAIL_CODE_TTL)
               ).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO email_codes(email,code_hash,password_hash,display_name,purpose,"
        "attempts,expires_at,created_at) VALUES(?,?,?,?,?,0,?,datetime('now')) "
        "ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, "
        "password_hash=excluded.password_hash, display_name=excluded.display_name, "
        "attempts=0, expires_at=excluded.expires_at, created_at=datetime('now')",
        (email, _hash_code(email, code), hash_password(body.password), name,
         "register", expires))
    _code_sends[ip].append(time.time())
    try:
        # Tên brand lấy từ cấu hình Admin để email hiển thị đúng thương hiệu
        sent = send_verification_code(email, code,
                                      brand_name=get_brand(conn)["brand_name"])
    except RuntimeError:
        # SMTP đã cấu hình nhưng gửi thất bại → dọn mã, báo lỗi rõ ràng
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        raise HTTPException(502, "Không gửi được email xác thực — thử lại sau ít phút")
    return {"email_sent": sent, "email": email,
            "ttl_seconds": EMAIL_CODE_TTL,
            "dev_hint": None if (sent or EMAIL_ENABLED)
            else "Chưa cấu hình SMTP — xem mã ở console server (.env để bật email)"}


@router.post("/register/confirm")
def register_confirm(body: ConfirmBody, conn: sqlite3.Connection = Depends(get_db)):
    """Bước 2: kiểm tra mã, tạo tài khoản, trả token."""
    email = body.email.strip().lower()
    code = re.sub(r"\D", "", body.code or "")
    # chỉ nhận mã purpose='register' — mã đặt lại mật khẩu không tạo được tài khoản
    row = conn.execute(
        "SELECT * FROM email_codes WHERE email=? AND purpose='register'",
        (email,)).fetchone()
    if not row:
        raise HTTPException(400, "Chưa yêu cầu mã hoặc mã đã dùng — hãy gửi lại mã")
    if row["expires_at"] < datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"):
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        raise HTTPException(400, "Mã đã hết hạn — hãy gửi lại mã")
    if row["attempts"] >= EMAIL_CODE_MAX_ATTEMPTS:
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        raise HTTPException(429, "Nhập sai mã quá nhiều lần — hãy gửi lại mã")
    if not hmac.compare_digest(row["code_hash"], _hash_code(email, code)):
        conn.execute("UPDATE email_codes SET attempts=attempts+1 WHERE email=?", (email,))
        raise HTTPException(400, "Mã xác thực không đúng")

    # mã đúng → tạo tài khoản (chống trùng nếu người khác vừa đăng ký cùng email,
    # kể cả race double-submit → trả 409 sạch thay vì 500 IntegrityError)
    uid = new_id()
    try:
        conn.execute(
            "INSERT INTO users(id,email,password_hash,display_name,email_verified) "
            "VALUES(?,?,?,?,1)",
            (uid, email, row["password_hash"], row["display_name"]))
    except sqlite3.IntegrityError:
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        raise HTTPException(409, "Email đã được đăng ký")
    conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
    user = dict(conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())
    return _user_payload(user, create_token(uid, user["role"], user.get("token_version") or 0))

# Lưu ý: KHÔNG mở endpoint đăng ký trực tiếp (bỏ qua email). Mọi đăng ký đi qua
# /register/request → /register/confirm (dev-mode vẫn chạy, mã in ra console).


@router.post("/login")
def login(body: LoginBody, request: Request,
          conn: sqlite3.Connection = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    _check_login_rate(ip)
    email = body.email.strip().lower()
    row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        _record_login_fail(ip)
        raise HTTPException(401, "Email hoặc mật khẩu không đúng")
    _login_fails.pop(ip, None)
    user = dict(row)
    # Bật 2FA → chưa cấp access token; trả token trung gian chờ mã TOTP
    if user.get("totp_enabled") and user.get("totp_secret"):
        return {"requires_2fa": True,
                "pending": create_pending_2fa_token(user["id"]),
                "email": user["email"]}
    return _user_payload(user, create_token(user["id"], user["role"], user.get("token_version") or 0))


class TwoFABody(BaseModel):
    pending: str
    code: str


@router.post("/2fa/verify")
def login_2fa_verify(body: TwoFABody, request: Request,
                     conn: sqlite3.Connection = Depends(get_db)):
    """Bước 2 đăng nhập khi bật 2FA: token trung gian + mã Google Authenticator."""
    payload = decode_token(body.pending)
    if not payload or payload.get("typ") != "2fa":
        raise HTTPException(401, "Phiên xác thực đã hết hạn — đăng nhập lại")
    uid = payload["sub"]
    # bộ đếm theo TÀI KHOẢN — chặn brute-force mã 6 số dù đã có mật khẩu đúng
    _check_rate(_twofa_fails, uid, TWOFA_MAX_FAILS, TWOFA_WINDOW,
               "Nhập sai mã xác thực quá nhiều lần — thử lại sau ít phút")
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row or not row["totp_enabled"] or not row["totp_secret"]:
        raise HTTPException(401, "Tài khoản không bật 2FA")
    if not verify_totp(row["totp_secret"], body.code):
        _twofa_fails[uid].append(time.time())
        raise HTTPException(401, "Mã xác thực không đúng")
    _twofa_fails.pop(uid, None)
    user = dict(row)
    return _user_payload(user, create_token(user["id"], user["role"], user.get("token_version") or 0))


# --------------------------------------------------------------------------
# QUÊN MẬT KHẨU: gửi mã qua email → xác nhận mã + mật khẩu mới
# --------------------------------------------------------------------------
class ForgotBody(BaseModel):
    email: str


class ResetBody(BaseModel):
    email: str
    code: str
    new_password: str


@router.post("/password/forgot")
def password_forgot(body: ForgotBody, request: Request,
                    conn: sqlite3.Connection = Depends(get_db)):
    """Gửi mã đặt lại mật khẩu. LUÔN trả 200 — không lộ email nào đã đăng ký."""
    ip = request.client.host if request.client else "unknown"
    _check_rate(_code_sends, ip, CODE_MAX, CODE_WINDOW,
               "Gửi mã quá nhiều lần — thử lại sau ít phút")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Email không hợp lệ")
    _code_sends[ip].append(time.time())

    row = conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
    if row:
        code = f"{secrets.randbelow(1000000):06d}"
        expires = (datetime.now(timezone.utc) + timedelta(seconds=EMAIL_CODE_TTL)
                   ).strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "INSERT INTO email_codes(email,code_hash,password_hash,display_name,purpose,"
            "attempts,expires_at,created_at) VALUES(?,?,NULL,NULL,'reset',0,?,datetime('now')) "
            "ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, "
            "password_hash=NULL, display_name=NULL, purpose='reset', "
            "attempts=0, expires_at=excluded.expires_at, created_at=datetime('now')",
            (email, _hash_code(email, code), expires))
        try:
            send_reset_code(email, code, brand_name=get_brand(conn)["brand_name"])
        except RuntimeError:
            conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
            raise HTTPException(502, "Không gửi được email — thử lại sau ít phút")
    # phản hồi giống hệt nhau dù email có tồn tại hay không
    return {"ok": True, "ttl_seconds": EMAIL_CODE_TTL,
            "message": "Nếu email đã đăng ký, mã đặt lại mật khẩu sẽ được gửi tới."}


@router.post("/password/reset")
def password_reset(body: ResetBody, conn: sqlite3.Connection = Depends(get_db)):
    email = body.email.strip().lower()
    if len(body.new_password) < 6:
        raise HTTPException(400, "Mật khẩu tối thiểu 6 ký tự")
    row = conn.execute(
        "SELECT * FROM email_codes WHERE email=? AND purpose='reset'",
        (email,)).fetchone()
    if not row:
        raise HTTPException(400, "Chưa yêu cầu đặt lại mật khẩu hoặc mã đã dùng")
    if row["expires_at"] < datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"):
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        raise HTTPException(400, "Mã đã hết hạn — yêu cầu mã mới")
    if row["attempts"] >= EMAIL_CODE_MAX_ATTEMPTS:
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        raise HTTPException(429, "Nhập sai quá nhiều lần — yêu cầu mã mới")
    if not hmac.compare_digest(row["code_hash"], _hash_code(email, body.code.strip())):
        conn.execute("UPDATE email_codes SET attempts=attempts+1 WHERE email=?", (email,))
        raise HTTPException(400, "Mã xác thực không đúng")
    # tăng token_version → mọi phiên/token cũ (kể cả của kẻ tấn công) hết hiệu lực
    conn.execute(
        "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE email=?",
        (hash_password(body.new_password), email))
    conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
    return {"ok": True, "message": "Đã đổi mật khẩu — đăng nhập bằng mật khẩu mới"}
