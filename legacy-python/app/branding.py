"""Cấu hình thương hiệu (brand) — lưu trong app_settings, sửa được ở Admin.

Được tiêm thẳng vào HTML (window.ANS_CFG.brand) nên áp dụng tức thì lúc tải
trang, không tốn request phụ và không nháy giao diện mặc định.
"""
import sqlite3

from .db import get_setting

BRAND_DEFAULTS = {
    "brand_name": "ANS Music",
    "brand_short": "ANS",              # phần trước, tô đậm màu accent
    "brand_suffix": "Music",           # phần sau
    "brand_tagline": "Nghe nhạc trực tuyến",
    "brand_accent": "#7c5cff",
    "brand_logo_url": "/static/img/logo.svg",
}

# Chỉ các key này được phép ghi qua Admin (whitelist)
EDITABLE = set(BRAND_DEFAULTS.keys())


def get_brand(conn: sqlite3.Connection) -> dict:
    return {k: get_setting(conn, k, default) for k, default in BRAND_DEFAULTS.items()}
