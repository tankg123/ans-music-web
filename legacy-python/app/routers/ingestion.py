"""Kênh ingestion cho đối tác (distributor/label) — mục 6.2 tài liệu ý tưởng.

Đối tác được cấp API key trong Admin CMS → bắn DDEX ERN XML thẳng vào:
    POST /ingestion/v1/deliveries   (header X-API-Key, body = XML)
    GET  /ingestion/v1/deliveries/{id}/status
Auto-publish hay vào Review Queue tùy cấu hình từng đối tác.
Production bổ sung kênh SFTP/S3 per-partner đổ vào cùng pipeline này.
"""
import hashlib
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from ..db import get_db
from ..ddex import import_delivery

router = APIRouter(prefix="/ingestion/v1", tags=["ingestion"])

MAX_XML_BYTES = 20 * 1024 * 1024


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _auth_partner(conn: sqlite3.Connection, api_key: Optional[str]) -> dict:
    if not api_key:
        raise HTTPException(401, "Thiếu header X-API-Key")
    # chỉ đối tác kênh API — SFTP distribution KHÔNG dùng api_key (cột chỉ để NOT NULL)
    row = conn.execute(
        "SELECT * FROM delivery_partners WHERE api_key_hash=? "
        "AND (delivery_channel IS NULL OR delivery_channel='api')",
        (hash_api_key(api_key),)).fetchone()
    if not row:
        raise HTTPException(401, "API key không hợp lệ")
    return dict(row)


@router.post("/deliveries", status_code=201)
async def receive_delivery(request: Request,
                           x_api_key: Optional[str] = Header(None),
                           conn: sqlite3.Connection = Depends(get_db)):
    partner = _auth_partner(conn, x_api_key)
    xml_bytes = await request.body()
    if not xml_bytes:
        raise HTTPException(400, "Body rỗng — gửi DDEX ERN XML trực tiếp trong body")
    if len(xml_bytes) > MAX_XML_BYTES:
        raise HTTPException(413, "XML quá lớn (tối đa 20MB)")

    report = import_delivery(conn, xml_bytes,
                             auto_publish=bool(partner["auto_publish"]),
                             partner=partner)
    return {
        "delivery_id": report["delivery_id"],
        "status": report["status"],
        "releases": report.get("releases", []),
        "tracks": report.get("tracks", []),
        "log": report.get("log", []),
    }


@router.get("/deliveries/{delivery_id}/status")
def delivery_status(delivery_id: str,
                    x_api_key: Optional[str] = Header(None),
                    conn: sqlite3.Connection = Depends(get_db)):
    partner = _auth_partner(conn, x_api_key)
    row = conn.execute(
        "SELECT id, message_id, message_type, ern_version, status, log, "
        "received_at, processed_at FROM deliveries WHERE id=? AND partner_id=?",
        (delivery_id, partner["id"])).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy delivery của bạn")
    return dict(row)
