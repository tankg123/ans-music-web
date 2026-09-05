"""Kho mã định danh UPC/ISRC — label nhập dải mã thật (tay hoặc file .txt),
hệ thống cấp phát dần khi phát hành; hết kho thì tự sinh nếu được bật.
"""
import sqlite3
from typing import List, Optional, Set

from fastapi import HTTPException

from .db import get_setting, new_id

AUTO_KEYS = {"isrc": "auto_generate_isrc", "upc": "auto_generate_upc"}


def auto_enabled(conn: sqlite3.Connection, kind: str) -> bool:
    return get_setting(conn, AUTO_KEYS[kind], "1") == "1"


def pool_counts(conn: sqlite3.Connection, kind: str) -> dict:
    row = conn.execute(
        "SELECT SUM(status='available') AS avail, SUM(status='used') AS used "
        "FROM id_pool WHERE kind=?", (kind,)).fetchone()
    return {"available": row["avail"] or 0, "used": row["used"] or 0}


def pool_take(conn: sqlite3.Connection, kind: str, count: int,
              exclude: Optional[Set[str]] = None) -> List[str]:
    """Lấy tối đa `count` mã available từ kho (đánh dấu used ngay trong txn).

    Mã trùng exclude hoặc đã lỡ tồn tại trong catalog sẽ bị đánh dấu used
    (dọn kho) và bỏ qua.
    """
    exclude = exclude or set()
    taken: List[str] = []
    rows = conn.execute(
        "SELECT id, code FROM id_pool WHERE kind=? AND status='available' "
        "ORDER BY added_at, code", (kind,)).fetchall()
    table, col = ("tracks", "isrc") if kind == "isrc" else ("releases", "upc")
    for r in rows:
        if len(taken) >= count:
            break
        code = r["code"]
        if code in exclude:
            continue
        if conn.execute(f"SELECT 1 FROM {table} WHERE {col}=?", (code,)).fetchone():
            # mã trong kho nhưng catalog đã dùng (nhập tay trước đó) → dọn
            conn.execute(
                "UPDATE id_pool SET status='used', used_at=datetime('now') WHERE id=?",
                (r["id"],))
            continue
        conn.execute(
            "UPDATE id_pool SET status='used', used_at=datetime('now') WHERE id=?",
            (r["id"],))
        taken.append(code)
    return taken


def mark_code_used(conn: sqlite3.Connection, kind: str, code: str,
                   used_by: str) -> None:
    """Bất kỳ mã nào được gán vào catalog (kể cả nhập tay/tự sinh) nếu nằm
    trong kho thì cập nhật trạng thái — kho luôn phản ánh đúng thực tế."""
    conn.execute(
        "UPDATE id_pool SET status='used', used_at=datetime('now'), used_by=? "
        "WHERE kind=? AND code=?", (used_by, kind, code))


def pool_exhausted_error(kind: str) -> HTTPException:
    label = "ISRC" if kind == "isrc" else "UPC"
    return HTTPException(
        409, f"Kho mã {label} đã hết và chế độ tự sinh đang TẮT — "
             f"thêm mã trong Admin → Kho mã, hoặc bật tự sinh.")
