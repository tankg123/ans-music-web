"""SFTP server nhúng cho DDEX delivery (kiểu YouTube).

Đối tác kết nối bằng SSH KEY (public đã add trong Admin), được chroot vào đúng
dropbox của mình rồi push XML + audio. Watcher (sftp_watcher.py) tự nạp về web.

Cổng riêng (mặc định 2222) — KHÔNG đụng SSH hệ thống (22). Bật bằng
ANS_SFTP_ENABLED=true trong .env.
"""
import asyncio

import asyncssh

from . import config
from .db import connect
from .distributions import host_key


def _authorized_key_for(username: str):
    """Trả SSHKey đã authorize cho tài khoản SFTP, hoặc None."""
    conn = connect()
    try:
        row = conn.execute(
            "SELECT ssh_public_key FROM delivery_partners "
            "WHERE sftp_username=? AND delivery_channel='sftp'", (username,)).fetchone()
    finally:
        conn.close()
    if not row or not row["ssh_public_key"]:
        return None
    try:
        return asyncssh.import_public_key(row["ssh_public_key"])
    except Exception:
        return None


class _DistServer(asyncssh.SSHServer):
    """Chỉ cho auth bằng public key khớp distribution; cấm password/shell."""

    def connection_made(self, conn):
        self._conn = conn

    def connection_lost(self, exc):
        pass

    def begin_auth(self, username: str) -> bool:
        return True                       # luôn bắt buộc xác thực

    def password_auth_supported(self) -> bool:
        return False

    def public_key_auth_supported(self) -> bool:
        return True

    def validate_public_key(self, username: str, key) -> bool:
        authorized = _authorized_key_for(username)
        if authorized is None:
            return False
        # asyncssh đã xác minh chữ ký (client giữ private key); ở đây chỉ đối chiếu
        # key có nằm trong authorized không → so fingerprint cho chắc.
        try:
            return key.get_fingerprint() == authorized.get_fingerprint()
        except Exception:
            return False


def _sftp_factory(chan):
    """Chroot mỗi đối tác vào dropbox riêng: media/sftp/{username}/ (incoming…)."""
    username = chan.get_extra_info("username") or "unknown"
    root = config.SFTP_ROOT / username
    for sub in ("incoming", "processed", "failed"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return asyncssh.SFTPServer(chan, chroot=str(root))


_server = None


async def start_sftp_server():
    """Mở SFTP server. Trả server object (hoặc None nếu tắt/không mở được)."""
    global _server
    if not config.SFTP_ENABLED:
        return None
    try:
        _server = await asyncssh.create_server(
            _DistServer, config.SFTP_BIND, config.SFTP_PORT,
            server_host_keys=[host_key()],
            sftp_factory=_sftp_factory,
            allow_scp=True,
            # chỉ SFTP — không cấp shell/exec
            process_factory=None,
        )
        print(f"[sftp] SFTP DDEX server đang chạy tại cổng {config.SFTP_PORT} "
              f"(bind {config.SFTP_BIND})")
        return _server
    except Exception as e:      # noqa: BLE001 — lỗi SFTP KHÔNG được làm sập cả app web
        print(f"[sftp] KHÔNG mở được SFTP cổng {config.SFTP_PORT}: "
              f"{type(e).__name__}: {e} (web vẫn chạy; đổi ANS_SFTP_PORT trong .env "
              f"hoặc kiểm tra quyền/cổng bận). SFTP ingestion tạm tắt.")
        return None


def stop_sftp_server():
    global _server
    if _server is not None:
        _server.close()
        _server = None
