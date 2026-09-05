"""Chuyển row DB → JSON cho client (kèm nghệ sĩ, album, trạng thái thích)."""
import sqlite3
from typing import Iterable, Optional


def _liked_set(conn: sqlite3.Connection, user_id: Optional[str],
               entity_type: str, ids: list) -> set:
    if not user_id or not ids:
        return set()
    q = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT entity_id FROM favorites WHERE user_id=? AND entity_type=? AND entity_id IN ({q})",
        [user_id, entity_type, *ids]).fetchall()
    return {r["entity_id"] for r in rows}


def serialize_tracks(conn: sqlite3.Connection, rows: Iterable,
                     user_id: Optional[str] = None) -> list:
    """rows: iterable sqlite3.Row từ bảng tracks (có thể kèm cột phụ)."""
    tracks = [dict(r) for r in rows]
    if not tracks:
        return []
    ids = [t["id"] for t in tracks]
    q = ",".join("?" * len(ids))

    artist_rows = conn.execute(
        f"""SELECT ta.track_id, ta.role, ta.sequence, a.id, a.name, a.image_url
            FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
            WHERE ta.track_id IN ({q}) AND ta.role IN ('MainArtist','FeaturedArtist')
            ORDER BY ta.sequence""", ids).fetchall()
    artists_by_track: dict = {}
    for r in artist_rows:
        artists_by_track.setdefault(r["track_id"], []).append(
            {"id": r["id"], "name": r["name"], "role": r["role"]})

    release_rows = conn.execute(
        f"""SELECT rt.track_id, rt.track_no, r.id, r.title, r.cover_url, r.accent, r.release_type,
                   r.label_name, r.upc
            FROM release_tracks rt JOIN releases r ON r.id = rt.release_id
            WHERE rt.track_id IN ({q})
            ORDER BY r.created_at, r.id""", ids).fetchall()
    release_by_track = {}
    for r in release_rows:
        release_by_track.setdefault(r["track_id"], {
            "id": r["id"], "title": r["title"], "cover_url": r["cover_url"],
            "accent": r["accent"], "track_no": r["track_no"],
            "label_name": r["label_name"], "upc": r["upc"],
        })

    liked = _liked_set(conn, user_id, "track", ids)

    out = []
    for t in tracks:
        rel = release_by_track.get(t["id"], {})
        out.append({
            "id": t["id"],
            "title": t["title"],
            "subtitle": t.get("subtitle"),
            "isrc": t.get("isrc"),
            "duration_ms": t.get("duration_ms", 0),
            "genre": t.get("genre"),
            "explicit": t.get("parental_warning") == "Explicit",
            "play_count": t.get("play_count", 0),
            "status": t.get("status"),
            "has_lyrics": bool(t.get("lyrics_lrc") or t.get("lyrics")),
            "has_audio": bool(t.get("audio_path")),
            "artists": artists_by_track.get(t["id"], []),
            "release": {k: rel.get(k) for k in ("id", "title", "cover_url", "accent",
                                                "label_name", "upc")} if rel else None,
            "track_no": rel.get("track_no"),
            "cover_url": rel.get("cover_url"),
            "accent": rel.get("accent"),
            "liked": t["id"] in liked,
        })
    return out


def serialize_releases(conn: sqlite3.Connection, rows: Iterable,
                       user_id: Optional[str] = None) -> list:
    releases = [dict(r) for r in rows]
    if not releases:
        return []
    ids = [r["id"] for r in releases]
    q = ",".join("?" * len(ids))
    artist_rows = conn.execute(
        f"""SELECT ra.release_id, a.id, a.name FROM release_artists ra
            JOIN artists a ON a.id = ra.artist_id
            WHERE ra.release_id IN ({q}) AND ra.role='MainArtist' ORDER BY ra.sequence""",
        ids).fetchall()
    by_release: dict = {}
    for r in artist_rows:
        by_release.setdefault(r["release_id"], []).append({"id": r["id"], "name": r["name"]})
    counts = dict(conn.execute(
        f"SELECT release_id, COUNT(*) FROM release_tracks WHERE release_id IN ({q}) GROUP BY release_id",
        ids).fetchall())
    liked = _liked_set(conn, user_id, "release", ids)
    return [{
        "id": r["id"], "title": r["title"], "upc": r.get("upc"),
        "release_type": r.get("release_type"), "genre": r.get("genre"),
        "cover_url": r.get("cover_url"), "accent": r.get("accent"),
        "label_name": r.get("label_name"),
        "release_date": r.get("platform_release_date") or r.get("original_release_date"),
        "status": r.get("status"),
        "artists": by_release.get(r["id"], []),
        "track_count": counts.get(r["id"], 0),
        "liked": r["id"] in liked,
    } for r in releases]


def serialize_artists(conn: sqlite3.Connection, rows: Iterable,
                      user_id: Optional[str] = None) -> list:
    artists = [dict(r) for r in rows]
    if not artists:
        return []
    ids = [a["id"] for a in artists]
    q = ",".join("?" * len(ids))
    followers = dict(conn.execute(
        f"SELECT artist_id, COUNT(*) FROM follows WHERE artist_id IN ({q}) GROUP BY artist_id",
        ids).fetchall())
    following = set()
    if user_id:
        rows2 = conn.execute(
            f"SELECT artist_id FROM follows WHERE user_id=? AND artist_id IN ({q})",
            [user_id, *ids]).fetchall()
        following = {r["artist_id"] for r in rows2}
    return [{
        "id": a["id"], "name": a["name"], "type": a.get("type"),
        "country": a.get("country"), "bio": a.get("bio"),
        "image_url": a.get("image_url"), "accent": a.get("accent"),
        "isni": a.get("isni"), "ipi": a.get("ipi"),
        "followers": followers.get(a["id"], 0),
        "following": a["id"] in following,
    } for a in artists]


def serialize_playlists(conn: sqlite3.Connection, rows: Iterable) -> list:
    playlists = [dict(r) for r in rows]
    if not playlists:
        return []
    ids = [p["id"] for p in playlists]
    q = ",".join("?" * len(ids))
    counts = dict(conn.execute(
        f"SELECT playlist_id, COUNT(*) FROM playlist_tracks WHERE playlist_id IN ({q}) GROUP BY playlist_id",
        ids).fetchall())
    owners = dict(conn.execute(
        f"""SELECT p.id, u.display_name FROM playlists p JOIN users u ON u.id=p.owner_id
            WHERE p.id IN ({q})""", ids).fetchall())
    return [{
        "id": p["id"], "title": p["title"], "description": p.get("description"),
        "cover_url": p.get("cover_url"), "accent": p.get("accent"),
        "visibility": p.get("visibility"),
        "is_editorial": bool(p.get("is_editorial")),
        "owner_id": p.get("owner_id"),
        "owner_name": owners.get(p["id"]),
        "track_count": counts.get(p["id"], 0),
    } for p in playlists]
