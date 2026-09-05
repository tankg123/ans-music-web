"""DDEX ERN Ingestion — parse NewReleaseMessage (ERN 3.x / 4.x) và import vào catalog.

Triển khai theo pipeline mục 6 của tài liệu ý tưởng (bản rút gọn chạy qua Admin CMS):
  VALIDATE (định dạng ISRC/UPC, MessageId idempotent) → PARSE+MAP → PUBLISH (review queue) → ACK log.
Production bổ sung: XSD validation đầy đủ, SFTP watcher, kiểm tra hash file audio.
"""
import re
import sqlite3
import xml.etree.ElementTree as ET
from typing import Optional

from .config import DELIVERY_DIR, COVER_DIR
from .covers import generate_cover
from .db import new_id
from .utils import clean_isrc, normalize_text, stable_seed, validate_isrc, validate_upc


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _find(el: ET.Element, path: str) -> Optional[ET.Element]:
    """Tìm phần tử theo tên local (bỏ namespace), path dạng 'A/B/C'."""
    parts = path.split("/")
    current = [el]
    for p in parts:
        nxt = []
        for c in current:
            nxt.extend(ch for ch in c if _strip_ns(ch.tag) == p)
        if not nxt:
            return None
        current = nxt
    return current[0]


def _findall(el: ET.Element, name: str) -> list:
    """Tìm mọi phần tử con trực tiếp có tên local = name."""
    return [ch for ch in el if _strip_ns(ch.tag) == name]


def _find_deep(el: ET.Element, name: str) -> Optional[ET.Element]:
    """Tìm phần tử đầu tiên tên local = name ở bất kỳ độ sâu nào."""
    for ch in el.iter():
        if _strip_ns(ch.tag) == name:
            return ch
    return None


def _findall_deep(el: ET.Element, name: str) -> list:
    return [ch for ch in el.iter() if _strip_ns(ch.tag) == name]


def _text(el: Optional[ET.Element]) -> str:
    return (el.text or "").strip() if el is not None else ""


def _parse_duration_iso(value: str) -> int:
    """ISO-8601 PT3M45S → ms."""
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$", value or "")
    if not m:
        return 0
    h, mi, s = (float(g) if g else 0 for g in m.groups())
    return int((h * 3600 + mi * 60 + s) * 1000)


def parse_ern(xml_bytes: bytes) -> dict:
    """Parse ERN XML → cấu trúc trung gian. Raise ValueError nếu không hợp lệ."""
    # ERN hợp lệ không bao giờ cần DTD — chặn luôn để loại trừ
    # entity-expansion DoS (billion laughs) mà không cần defusedxml
    head = xml_bytes[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise ValueError("XML chứa DOCTYPE/ENTITY — không được phép")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        raise ValueError(f"XML không parse được: {e}")

    root_tag = _strip_ns(root.tag)
    if root_tag not in ("NewReleaseMessage", "PurgeReleaseMessage"):
        raise ValueError(f"Loại message không hỗ trợ: {root_tag}")

    ns = root.tag[1:].split("}")[0] if root.tag.startswith("{") else ""
    version = "unknown"
    m = re.search(r"/ern/(\d+)", ns)
    if m:
        raw = m.group(1)
        version = ".".join(raw) if len(raw) <= 3 else raw
    schema_attr = root.get("MessageSchemaVersionId", "")
    if schema_attr:
        version = schema_attr.replace("ern/", "").strip() or version

    header = _find_deep(root, "MessageHeader")
    if header is None:
        raise ValueError("Thiếu MessageHeader")
    message_id = _text(_find(header, "MessageId"))
    if not message_id:
        raise ValueError("Thiếu MessageId")
    sender = _find(header, "MessageSender")
    sender_dpid = _text(_find_deep(sender, "PartyId")) if sender is not None else ""
    sender_name = _text(_find_deep(sender, "FullName")) if sender is not None else ""

    result = {
        "message_type": root_tag,
        "ern_version": version,
        "message_id": message_id,
        "sender_dpid": sender_dpid or "UNKNOWN_DPID",
        "sender_name": sender_name or "Unknown Partner",
        "recordings": [],
        "releases": [],
        "deals": [],
    }

    if root_tag == "PurgeReleaseMessage":
        for icpn in _findall_deep(root, "ICPN"):
            result["releases"].append({"upc": _text(icpn), "purge": True})
        return result

    # ---- PartyList (ERN 4.x): PartyReference → tên -----------------------
    party_names = {}
    party_list = _find_deep(root, "PartyList")
    if party_list is not None:
        for party in _findall(party_list, "Party"):
            ref = _text(_find(party, "PartyReference"))
            name = _text(_find_deep(party, "FullName"))
            if ref and name:
                party_names[ref] = name

    # ---- ResourceList / SoundRecording --------------------------------
    from .distributions import map_ddex_role
    for sr in _findall_deep(root, "SoundRecording"):
        isrc = _text(_find_deep(sr, "ISRC"))
        ref = _text(_find_deep(sr, "ResourceReference"))
        title = _text(_find_deep(sr, "TitleText"))
        duration_ms = _parse_duration_iso(_text(_find_deep(sr, "Duration")))

        def _party_name(el, name_tag="FullName", ref_tags=("ArtistPartyReference", "PartyReference")):
            full = _text(_find_deep(el, name_tag))
            if not full:
                for rt in ref_tags:
                    pref = _text(_find_deep(el, rt))
                    if pref and pref in party_names:
                        return party_names[pref]
            return full

        artists = []
        seen_roles = set()   # (name, role) — tránh trùng khi 1 người nhiều block

        def _add(name, role_web):
            name = (name or "").strip()
            if name and (name, role_web) not in seen_roles:
                seen_roles.add((name, role_web))
                artists.append({"name": name, "role": role_web})

        # 1) DisplayArtist → MainArtist / FeaturedArtist (giữ mặc định MainArtist)
        for da in _findall_deep(sr, "DisplayArtist"):
            full = _party_name(da)
            raw = (_text(_find_deep(da, "ArtistRole"))
                   or _text(_find_deep(da, "DisplayArtistRole")) or "MainArtist")
            _add(full, map_ddex_role(raw, default="MainArtist"))
        # 2) Contributor (nhạc công, producer, mixer, remixer…) → theo Role
        for c in (_findall_deep(sr, "ResourceContributor")
                  + _findall_deep(sr, "Contributor")):
            full = _party_name(c, ref_tags=("PartyReference", "ContributorPartyReference"))
            raw = (_text(_find_deep(c, "ResourceContributorRole"))
                   or _text(_find_deep(c, "Role")) or "Performer")
            _add(full, map_ddex_role(raw, default="Performer"))
        # 3) IndirectContributor (composer, lyricist, publisher…) → theo Role
        for c in _findall_deep(sr, "IndirectResourceContributor") + \
                 _findall_deep(sr, "IndirectContributor"):
            full = _party_name(c, ref_tags=("PartyReference", "ContributorPartyReference"))
            raw = (_text(_find_deep(c, "IndirectResourceContributorRole"))
                   or _text(_find_deep(c, "Role")) or "Composer")
            _add(full, map_ddex_role(raw, default="Composer"))

        # đảm bảo có ít nhất 1 MainArtist (release cần nghệ sĩ chính)
        if not any(a["role"] == "MainArtist" for a in artists) and artists:
            artists[0]["role"] = "MainArtist"

        # file audio tham chiếu trong TechnicalDetails (để watcher SFTP đính kèm)
        file_uri = ""
        for tag in ("URI", "FileName", "URL"):
            file_uri = _text(_find_deep(sr, tag))
            if file_uri:
                break

        pline_el = _find_deep(sr, "PLineText")
        genre = _text(_find_deep(sr, "GenreText"))
        pw = _text(_find_deep(sr, "ParentalWarningType")) or "NotExplicit"
        result["recordings"].append({
            "isrc": isrc, "ref": ref, "title": title, "duration_ms": duration_ms,
            "artists": artists, "p_line": _text(pline_el), "genre": genre,
            "parental_warning": pw, "file_uri": file_uri,
        })

    # ---- ReleaseList ----------------------------------------------------
    for rel in _findall_deep(root, "Release"):
        upc = _text(_find_deep(rel, "ICPN"))
        title = _text(_find_deep(rel, "TitleText"))
        rtype = _text(_find_deep(rel, "ReleaseType")) or "Album"
        refs = [_text(r) for r in _findall_deep(rel, "ReleaseResourceReference")]
        label = _text(_find_deep(rel, "LabelName"))
        genre = _text(_find_deep(rel, "GenreText"))
        # ERN 4.x: Release không có ICPN → là TrackRelease, bỏ qua
        is_main = rel.get("IsMainRelease", "").lower() == "true" or upc
        if not is_main:
            continue
        result["releases"].append({
            "upc": upc, "title": title, "release_type": rtype,
            "resource_refs": refs, "label": label, "genre": genre, "purge": False,
        })

    # ---- DealList -------------------------------------------------------
    for deal in _findall_deep(root, "DealTerms"):
        territories = [_text(t) for t in _findall_deep(deal, "TerritoryCode")]
        use_types = [_text(u) for u in _findall_deep(deal, "UseType")]
        models = [_text(c) for c in _findall_deep(deal, "CommercialModelType")]
        # chuẩn hóa StartDate về YYYY-MM-DD (loại '2026-07-10T00:00:00Z'…) —
        # publisher so sánh chuỗi với datetime('now') nên format phải sạch
        raw_start = _text(_find_deep(deal, "StartDate"))
        m_start = re.match(r"^(\d{4}-\d{2}-\d{2})", raw_start)
        start = m_start.group(1) if m_start else ""
        result["deals"].append({
            "territories": territories or ["Worldwide"],
            "use_types": use_types or ["OnDemandStream"],
            "commercial_models": models or ["SubscriptionModel"],
            "start_date": start,
        })

    return result


def _validate(parsed: dict) -> list:
    """Business rules — trả về danh sách lỗi (rỗng = hợp lệ)."""
    errors = []
    if parsed["message_type"] == "PurgeReleaseMessage":
        if not parsed["releases"]:
            errors.append("PurgeReleaseMessage không có UPC nào")
        return errors
    if not parsed["releases"]:
        errors.append("Không tìm thấy Release (thiếu ICPN/UPC)")
    for r in parsed["releases"]:
        if not r["upc"]:
            errors.append(f"Release '{r['title']}' thiếu UPC/ICPN")
        elif not validate_upc(r["upc"]):
            errors.append(f"UPC không hợp lệ (checksum GTIN): {r['upc']}")
        if not r["title"]:
            errors.append(f"Release UPC {r['upc']} thiếu tiêu đề")
    if not parsed["recordings"]:
        errors.append("Không có SoundRecording nào trong ResourceList")
    for t in parsed["recordings"]:
        if not t["isrc"]:
            errors.append(f"Track '{t['title']}' thiếu ISRC")
        elif not validate_isrc(t["isrc"]):
            errors.append(f"ISRC sai định dạng: {t['isrc']}")
        if not t["title"]:
            errors.append(f"SoundRecording {t['isrc']} thiếu TitleText")
    if not parsed["deals"]:
        errors.append("Thiếu DealList — cần ít nhất 1 Deal (territory + use type)")
    return errors


def _get_or_create_artist(conn: sqlite3.Connection, name: str) -> str:
    norm = normalize_text(name)
    row = conn.execute("SELECT id FROM artists WHERE name_norm = ?", (norm,)).fetchone()
    if row:
        return row["id"]
    aid = new_id()
    from .covers import generate_avatar
    img = COVER_DIR / f"artist_{aid}.svg"
    accent = generate_avatar(img, seed=stable_seed(norm), name=name)
    conn.execute(
        "INSERT INTO artists(id,name,name_norm,sort_name,image_url,accent) VALUES(?,?,?,?,?,?)",
        (aid, name, norm, name, f"/media/covers/artist_{aid}.svg", accent),
    )
    return aid


def import_delivery(conn: sqlite3.Connection, xml_bytes: bytes,
                    auto_publish: bool = False,
                    partner: Optional[dict] = None) -> dict:
    """Pipeline đầy đủ cho 1 gói delivery. Trả về report dict.

    partner: đối tác ĐÃ XÁC THỰC qua API key (id, name, dpid) — khi có,
    idempotency tính theo partner thật, không tin DPID tự khai trong XML.
    """
    delivery_id = new_id()
    log: list = []
    report = {"delivery_id": delivery_id, "status": "failed", "log": log,
              "releases": [], "tracks": []}
    partner_id = partner["id"] if partner else None
    channel = "partner_api" if partner else "admin_upload"

    # [1-2] LƯU GÓI ------------------------------------------------------
    xml_path = DELIVERY_DIR / f"{delivery_id}.xml"
    xml_path.write_bytes(xml_bytes)

    try:
        parsed = parse_ern(xml_bytes)
    except ValueError as e:
        conn.execute(
            "INSERT INTO deliveries(id,partner_id,partner_name,dpid,message_id,message_type,"
            "ern_version,xml_path,status,log,channel,processed_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))",
            (delivery_id, partner_id, partner["name"] if partner else None,
             None, None, None, None, xml_path.name, "failed", str(e), channel),
        )
        log.append(f"LỖI: {e}")
        return report

    # Idempotent: theo đối tác xác thực nếu có, không thì theo dpid trong XML
    if partner:
        dup = conn.execute(
            "SELECT id, status FROM deliveries WHERE partner_id = ? AND message_id = ?",
            (partner_id, parsed["message_id"])).fetchone()
    else:
        dup = conn.execute(
            "SELECT id, status FROM deliveries WHERE partner_id IS NULL "
            "AND dpid = ? AND message_id = ?",
            (parsed["sender_dpid"], parsed["message_id"])).fetchone()
    if dup:
        log.append(f"MessageId '{parsed['message_id']}' đã xử lý trước đó "
                   f"(delivery {dup['id']}, status={dup['status']}) — bỏ qua (idempotent).")
        report["status"] = "duplicate"
        return report

    # [3] VALIDATE ---------------------------------------------------------
    errors = _validate(parsed)
    status = "failed" if errors else "validated"
    display_name = partner["name"] if partner else parsed["sender_name"]
    conn.execute(
        "INSERT INTO deliveries(id,partner_id,partner_name,dpid,message_id,message_type,"
        "ern_version,xml_path,status,log,channel) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (delivery_id, partner_id, display_name, parsed["sender_dpid"],
         parsed["message_id"], parsed["message_type"], parsed["ern_version"],
         xml_path.name, status, "", channel),
    )
    log.append(f"Nhận {parsed['message_type']} ERN {parsed['ern_version']} "
               f"từ {display_name} ({parsed['sender_dpid']})")
    if errors:
        log.extend(f"LỖI VALIDATE: {e}" for e in errors)
        conn.execute("UPDATE deliveries SET log = ?, processed_at = datetime('now') WHERE id = ?",
                     ("\n".join(log), delivery_id))
        return report

    # ---- Takedown --------------------------------------------------------
    if parsed["message_type"] == "PurgeReleaseMessage":
        for r in parsed["releases"]:
            row = conn.execute("SELECT id, title FROM releases WHERE upc = ?", (r["upc"],)).fetchone()
            if row:
                conn.execute("UPDATE releases SET status = 'taken_down' WHERE id = ?", (row["id"],))
                # chỉ gỡ track KHÔNG còn nằm trong release live nào khác
                # (track dùng chung ISRC giữa nhiều release)
                conn.execute(
                    """UPDATE tracks SET status = 'taken_down' WHERE id IN (
                         SELECT rt.track_id FROM release_tracks rt
                         WHERE rt.release_id = ?
                           AND NOT EXISTS (
                             SELECT 1 FROM release_tracks rt2
                             JOIN releases r2 ON r2.id = rt2.release_id
                             WHERE rt2.track_id = rt.track_id
                               AND r2.id != ? AND r2.status = 'live'))""",
                    (row["id"], row["id"]))
                log.append(f"TAKEDOWN: đã gỡ release '{row['title']}' (UPC {r['upc']})")
                report["releases"].append({"upc": r["upc"], "action": "taken_down"})
            else:
                log.append(f"TAKEDOWN: không tìm thấy UPC {r['upc']} — bỏ qua")
        report["status"] = "imported"
        conn.execute(
            "UPDATE deliveries SET status='imported', log=?, processed_at=datetime('now') WHERE id=?",
            ("\n".join(log), delivery_id))
        return report

    # [4] PARSE + MAP → catalog ---------------------------------------------
    rec_by_ref = {t["ref"]: t for t in parsed["recordings"] if t["ref"]}
    deal = parsed["deals"][0]
    if auto_publish:
        # StartDate của Deal ở tương lai → hẹn giờ, publisher tự phát hành đúng hạn
        from datetime import date
        start = (deal.get("start_date") or "")[:10]
        publish_status = "scheduled" if start > date.today().isoformat() else "live"
    else:
        publish_status = "pending_review"

    part_id = partner["id"] if partner else None
    for r in parsed["releases"]:
        existing = conn.execute(
            "SELECT id, source_partner_id FROM releases WHERE upc = ?", (r["upc"],)).fetchone()
        # CÁCH LY ĐA ĐỐI TÁC: đối tác chỉ được sửa release do CHÍNH MÌNH đưa vào.
        # UPC đã thuộc đối tác khác (hoặc do admin quản lý) → TỪ CHỐI, không ghi đè.
        if existing and part_id and existing["source_partner_id"] not in (None, part_id):
            log.append(f"TỪ CHỐI: UPC {r['upc']} thuộc đối tác khác — bỏ qua (không ghi đè)")
            continue
        rid = existing["id"] if existing else new_id()
        action = "updated" if existing else "created"

        cover_path = COVER_DIR / f"release_{rid}.svg"
        accent = generate_cover(cover_path, seed=stable_seed(r["upc"]),
                                title=r["title"], subtitle=r["label"] or parsed["sender_name"])
        if existing:
            # DDEX là chuẩn full-replace: update thay toàn bộ metadata
            conn.execute(
                "UPDATE releases SET title=?, title_norm=?, release_type=?, label_name=?, genre=?, "
                "status=?, source='ddex_feed', delivery_id=?, source_partner_id=COALESCE(source_partner_id,?), "
                "platform_release_date=COALESCE(?, platform_release_date) WHERE id=?",
                (r["title"], normalize_text(r["title"]), r["release_type"], r["label"],
                 r["genre"], publish_status, delivery_id, part_id,
                 deal.get("start_date"), rid))
            conn.execute("DELETE FROM release_tracks WHERE release_id=?", (rid,))
            conn.execute("DELETE FROM release_artists WHERE release_id=?", (rid,))
        else:
            conn.execute(
                "INSERT INTO releases(id,upc,title,title_norm,release_type,label_name,genre,"
                "cover_url,accent,status,source,delivery_id,source_partner_id,platform_release_date) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rid, r["upc"], r["title"], normalize_text(r["title"]), r["release_type"],
                 r["label"], r["genre"], f"/media/covers/release_{rid}.svg", accent,
                 publish_status, "ddex_feed", delivery_id, part_id, deal.get("start_date") or None))

        # DDEX là full-replace: deal mới thay toàn bộ deal cũ của release
        conn.execute("DELETE FROM deals WHERE release_id=?", (rid,))
        conn.execute(
            "INSERT INTO deals(id,release_id,territories,use_types,commercial_models,start_date) "
            "VALUES(?,?,?,?,?,?)",
            (new_id(), rid, ",".join(deal["territories"]), ",".join(deal["use_types"]),
             ",".join(deal["commercial_models"]), deal.get("start_date")))

        refs = r["resource_refs"] or list(rec_by_ref.keys())
        track_no = 0
        release_artist_added = set()
        for ref in refs:
            rec = rec_by_ref.get(ref)
            if not rec:
                continue  # ảnh bìa hoặc resource khác
            track_no += 1
            isrc = clean_isrc(rec["isrc"])
            t_existing = conn.execute(
                "SELECT id, status, audio_path FROM tracks WHERE isrc=?", (isrc,)).fetchone()
            # CÁCH LY: track (ISRC) đã thuộc release của đối tác KHÁC → không cho
            # đối tác này ghi đè metadata/audio (chống cướp ISRC). Bỏ qua track đó.
            if t_existing and part_id:
                other = conn.execute(
                    """SELECT 1 FROM release_tracks rt JOIN releases r2 ON r2.id=rt.release_id
                       WHERE rt.track_id=? AND r2.source_partner_id IS NOT NULL
                         AND r2.source_partner_id != ? LIMIT 1""",
                    (t_existing["id"], part_id)).fetchone()
                if other:
                    log.append(f"  ⚠ ISRC {isrc} thuộc đối tác khác — bỏ qua track (không ghi đè)")
                    track_no -= 1
                    continue
            tid = t_existing["id"] if t_existing else new_id()
            if t_existing:
                # full-replace metadata, giữ play_count + audio hiện có.
                # status: chỉ nâng lên live khi publish live + có audio;
                # còn lại giữ nguyên (track có thể đang live ở release khác).
                if publish_status == "live":
                    t_status = "live" if t_existing["audio_path"] else "draft"
                else:
                    t_status = t_existing["status"]
                conn.execute(
                    "UPDATE tracks SET title=?, title_norm=?, duration_ms=?, genre=?, "
                    "parental_warning=?, p_line=?, status=? WHERE id=?",
                    (rec["title"], normalize_text(rec["title"]),
                     rec["duration_ms"], rec["genre"] or r["genre"],
                     rec["parental_warning"], rec["p_line"], t_status, tid))
                conn.execute("DELETE FROM track_artists WHERE track_id=?", (tid,))
            else:
                conn.execute(
                    "INSERT INTO tracks(id,isrc,title,title_norm,duration_ms,genre,"
                    "parental_warning,p_line,status) VALUES(?,?,?,?,?,?,?,?,?)",
                    (tid, isrc, rec["title"], normalize_text(rec["title"]),
                     rec["duration_ms"], rec["genre"] or r["genre"],
                     rec["parental_warning"], rec["p_line"],
                     "draft"))  # draft: chưa có file audio (chờ upload/batch media)
            conn.execute(
                "INSERT OR REPLACE INTO release_tracks(release_id,track_id,disc_no,track_no) "
                "VALUES(?,?,1,?)", (rid, tid, track_no))
            for seq, a in enumerate(rec["artists"], start=1):
                aid = _get_or_create_artist(conn, a["name"])
                conn.execute(
                    "INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) "
                    "VALUES(?,?,?,?)", (tid, aid, a["role"], seq))
                if a["role"] == "MainArtist" and aid not in release_artist_added:
                    release_artist_added.add(aid)
                    conn.execute(
                        "INSERT OR IGNORE INTO release_artists(release_id,artist_id,role,sequence) "
                        "VALUES(?,?,?,?)", (rid, aid, "MainArtist", len(release_artist_added)))
            from .idpool import mark_code_used
            mark_code_used(conn, "isrc", isrc, tid)
            log.append(f"  ♪ Track {rec['title']} (ISRC {isrc}) — "
                       f"{'cập nhật' if t_existing else 'tạo mới, chờ file audio'}")
            # id để watcher đính audio ĐÚNG track đã tạo/sửa (không dò lại theo ISRC
            # → không chạm track đối tác khác)
            report["tracks"].append({"isrc": isrc, "title": rec["title"], "id": tid})

        from .idpool import mark_code_used
        mark_code_used(conn, "upc", r["upc"], rid)
        log.append(f"Release '{r['title']}' (UPC {r['upc']}) — {action}, "
                   f"trạng thái: {publish_status}")
        report["releases"].append({"upc": r["upc"], "id": rid, "action": action,
                                   "status": publish_status})

    # [6-7] PUBLISH + ACK ---------------------------------------------------
    report["status"] = "imported"
    log.append("ACK: import thành công" +
               ("" if auto_publish else " — chờ duyệt trong Review Queue"))
    conn.execute(
        "UPDATE deliveries SET status='imported', log=?, processed_at=datetime('now') WHERE id=?",
        ("\n".join(log), delivery_id))
    return report
