"""Distribution SFTP (DDEX delivery kiểu YouTube).

Mỗi distribution có 1 cặp SSH key. Server chỉ giữ PUBLIC key (authorized) để
xác thực; PRIVATE key sinh ra chỉ trả về 1 LẦN cho admin đưa cho đối tác.
Đối tác dùng private key push DDEX (XML + audio) lên SFTP dropbox của mình.
"""
import hashlib
import re

import asyncssh

from . import config


def generate_keypair() -> dict:
    """Sinh cặp SSH Ed25519. Trả public (OpenSSH 1 dòng), private (OpenSSH PEM),
    fingerprint SHA256 — server chỉ lưu public + fingerprint."""
    key = asyncssh.generate_private_key("ssh-ed25519")
    public = key.export_public_key().decode().strip()
    private = key.export_private_key().decode()
    return {"public_key": public, "private_key": private,
            "fingerprint": fingerprint_of(public)}


def fingerprint_of(public_openssh: str) -> str:
    """Fingerprint SHA256 chuẩn OpenSSH (SHA256:base64) từ public key."""
    try:
        key = asyncssh.import_public_key(public_openssh)
        return key.get_fingerprint()      # dạng 'SHA256:....'
    except (asyncssh.KeyImportError, ValueError, Exception):
        return ""


def normalize_public_key(raw: str) -> str:
    """Chuẩn hóa + kiểm tra public key OpenSSH đối tác dán vào. Lỗi → ValueError."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Public key rỗng")
    try:
        key = asyncssh.import_public_key(raw)
    except Exception:
        raise ValueError("Public key không hợp lệ (cần định dạng OpenSSH: 'ssh-ed25519 AAAA…' hoặc 'ssh-rsa …')")
    return key.export_public_key().decode().strip()


def make_sftp_username(name: str, suffix: str) -> str:
    """Tên tài khoản SFTP an toàn từ tên distribution + hậu tố ngẫu nhiên."""
    slug = re.sub(r"[^a-z0-9]+", "", (name or "dist").lower())[:16] or "dist"
    return f"dist_{slug}_{suffix}"


def host_key():
    """Host key CỐ ĐỊNH của SFTP server (sinh 1 lần, lưu data/sftp_host_key) →
    fingerprint không đổi để đối tác pin an toàn. File rỗng/hỏng → tự tái sinh."""
    path = config.SFTP_HOST_KEY
    if path.exists() and path.stat().st_size > 0:
        try:
            return asyncssh.read_private_key(str(path))
        except (asyncssh.KeyImportError, ValueError, OSError):
            # file cắt cụt/hỏng (đứt giữa lần ghi đầu, disk đầy…) → sinh lại
            pass
    key = asyncssh.generate_private_key("ssh-ed25519")
    path.write_bytes(key.export_private_key())
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return key


def host_key_fingerprint() -> str:
    try:
        return host_key().get_fingerprint()
    except Exception:
        return ""


# ---- Ánh xạ vai trò DDEX → vai trò contributor trên web (khớp ALL_ROLES) ----
# ALL_ROLES = MainArtist, Composer, Lyricist, MusicPublisher, Producer, Mixer,
#             FeaturedArtist, Remixer, Performer
DDEX_ROLE_MAP = {
    # DisplayArtist / performers
    "mainartist": "MainArtist", "artist": "MainArtist", "primaryartist": "MainArtist",
    "featuredartist": "FeaturedArtist", "featuring": "FeaturedArtist", "featured": "FeaturedArtist",
    "performer": "Performer", "musician": "Performer", "orchestra": "Performer",
    "conductor": "Performer", "soloist": "Performer",
    # Sáng tác (IndirectContributor)
    "composer": "Composer", "writer": "Composer", "songwriter": "Composer",
    "composerlyricist": "Composer",
    "lyricist": "Lyricist", "author": "Lyricist", "wordwriter": "Lyricist",
    "musicpublisher": "MusicPublisher", "publisher": "MusicPublisher",
    "originalpublisher": "MusicPublisher",
    # Sản xuất / kỹ thuật
    "producer": "Producer", "executiveproducer": "Producer", "coproducer": "Producer",
    "arranger": "Producer", "recordingengineer": "Producer",
    "mixer": "Mixer", "mixingengineer": "Mixer", "masteringengineer": "Mixer",
    "remixer": "Remixer", "remixerartist": "Remixer",
}


def map_ddex_role(ddex_role: str, default: str = "Performer") -> str:
    """DDEX role (bất kỳ hoa/thường/khoảng trắng) → role web hợp lệ."""
    key = re.sub(r"[^a-z]", "", (ddex_role or "").lower())
    return DDEX_ROLE_MAP.get(key, default)
