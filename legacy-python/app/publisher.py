"""Phát hành theo lịch: release ở trạng thái 'scheduled' tự lên 'live'
khi tới platform_release_date (chạy nền mỗi 60s + lazy khi có request trang chủ).
"""
import sqlite3


def run_publisher(conn: sqlite3.Connection) -> int:
    """Flip scheduled → live khi tới giờ. Trả về số release được phát hành."""
    due = conn.execute(
        "SELECT id FROM releases WHERE status='scheduled' "
        "AND platform_release_date <= datetime('now')").fetchall()
    if not due:
        return 0
    ids = [r["id"] for r in due]
    q = ",".join("?" * len(ids))
    conn.execute(
        f"""UPDATE tracks SET status='live'
            WHERE audio_path IS NOT NULL AND status='draft'
              AND id IN (SELECT track_id FROM release_tracks WHERE release_id IN ({q}))""",
        ids)
    conn.execute(f"UPDATE releases SET status='live' WHERE id IN ({q})", ids)
    return len(ids)
