"""Seed dữ liệu demo: nghệ sĩ hư cấu + album + bài hát WAV tự sinh + playlist
biên tập + lịch sử nghe (nguồn BXH). Idempotent — chạy lại không nhân đôi.
"""
import json
import random

from .config import AUDIO_DIR, COVER_DIR
from .covers import generate_avatar, generate_cover
from .db import get_conn, new_id
from .security import hash_password
from .synth import synthesize_track
from .utils import normalize_text

import os

# Production: đặt ANS_ADMIN_EMAIL / ANS_ADMIN_PASSWORD trước lần chạy đầu
# thay vì dùng mật khẩu mặc định (chỉ dành cho demo local).
ADMIN_EMAIL = os.environ.get("ANS_ADMIN_EMAIL", "admin@amnhacso.com")
ADMIN_PASSWORD = os.environ.get("ANS_ADMIN_PASSWORD", "Admin@123")
DEMO_EMAIL = "demo@amnhacso.com"
DEMO_PASSWORD = "Demo@123"


def _upc(prefix: str) -> str:
    """Sinh UPC 12 số hợp lệ checksum GTIN từ 11 số đầu."""
    digits = [int(c) for c in prefix[:11]]
    rev = digits[::-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(rev))
    return prefix[:11] + str((10 - total % 10) % 10)


ARTISTS = [
    ("Hà Phương Linh", "person", "VN", "Giọng ca V-Pop thế hệ mới với chất giọng trong trẻo, giàu cảm xúc."),
    ("Minh Triết", "person", "VN", "Ca sĩ – nhạc sĩ, tác giả nhiều bản hit city-pop mang màu sắc Sài Gòn."),
    ("Lam Nguyên", "person", "VN", "Nhà sản xuất lo-fi/chillhop, âm nhạc dành cho những giờ làm việc sâu."),
    ("DJ Sóng Xanh", "person", "VN", "DJ/producer EDM hàng đầu các lễ hội âm nhạc biển."),
    ("Thảo My", "person", "VN", "Nữ hoàng ballad với những bản tình ca sâu lắng."),
    ("The Đông Kinh", "group", "VN", "Ban nhạc indie-acoustic lấy cảm hứng từ phố cổ Hà Nội."),
    ("Kỳ Anh", "person", "VN", "Nghệ sĩ trẻ pha trộn pop và R&B đầy năng lượng."),
    ("Ban nhạc Gió Mùa", "group", "VN", "Nhóm acoustic mộc mạc, những giai điệu của mùa gió về."),
]

# (title, type, artist, genre, style, [track titles], featured: {track_idx: artist})
RELEASES = [
    ("Thanh Xuân Vội Vã", "Album", "Hà Phương Linh", "V-Pop", "pop",
     ["Thanh Xuân Vội Vã", "Ngày Nắng Trong Veo", "Điều Chưa Kịp Nói", "Hẹn Ước Mùa Hạ", "Tạm Biệt Tháng Sáu"], {}),
    ("Đêm Sài Gòn", "EP", "Minh Triết", "City Pop", "pop",
     ["Đêm Sài Gòn", "Đèn Vàng Quận 3", "Cafe Không Đường"], {}),
    ("Café Sáng", "Album", "Lam Nguyên", "Lo-fi", "lofi",
     ["Café Sáng", "Mưa Ngoài Hiên", "Trang Sách Cũ", "Chậm Lại Một Chút", "Phím Đàn Đêm"], {}),
    ("Neon Nights", "Single", "DJ Sóng Xanh", "EDM", "edm",
     ["Neon Nights", "Neon Nights (Extended Mix)"], {}),
    ("Lá Rơi Bên Hiên", "Album", "Thảo My", "Ballad", "ballad",
     ["Lá Rơi Bên Hiên", "Người Cũ Còn Thương", "Giấc Mơ Trưa Muộn", "Thư Chưa Gửi"], {}),
    ("Phố Cổ Acoustic", "Album", "The Đông Kinh", "Acoustic", "acoustic",
     ["Phố Cổ Mùa Thu", "Tàu Điện Leng Keng", "Hàng Cây Cửa Bắc", "Chiều Hồ Gươm"], {}),
    ("Chạy Về Phía Mặt Trời", "Single", "Kỳ Anh", "V-Pop", "pop",
     ["Chạy Về Phía Mặt Trời"], {}),
    ("Gió Mùa Về", "EP", "Ban nhạc Gió Mùa", "Acoustic", "acoustic",
     ["Gió Mùa Về", "Áo Len Của Mẹ", "Ngõ Nhỏ Có Hoa"], {}),
    ("Mưa Trên Cửa Kính", "Single", "Thảo My", "Ballad", "ballad",
     ["Mưa Trên Cửa Kính"], {0: "Minh Triết"}),
    ("Bình Minh Radio", "Album", "Lam Nguyên", "Lo-fi", "lofi",
     ["Bình Minh Radio", "Sương Sớm", "Tan Ca", "Đêm Không Ngủ"], {}),
]

STYLE_BARS = {"pop": 18, "ballad": 13, "lofi": 15, "edm": 24, "acoustic": 15}

LYRIC_LINES = [
    "Ngày em đến bên anh trời xanh ngát xanh",
    "Con phố quen bỗng hóa dịu dàng",
    "Từng nhịp tim ngân nga theo câu hát",
    "Mình cứ thế đi qua thanh xuân",
    "Nắng rơi trên vai em rất khẽ",
    "Giữ lấy phút giây này mãi thôi",
    "Dẫu mai xa cách nhau phương trời",
    "Kỷ niệm vẫn sáng như ban đầu",
    "Hát lên cho quên đi muộn phiền",
    "Bình minh đang chờ ta phía trước",
]

EDITORIAL_PLAYLISTS = [
    ("V-Pop Tuyển Chọn", "Những bản V-Pop đáng nghe nhất tuần, cập nhật bởi đội ngũ biên tập ANS Music.", ["V-Pop", "City Pop"]),
    ("Chill & Lo-fi Làm Việc", "Beat lo-fi nhẹ nhàng cho những giờ tập trung sâu.", ["Lo-fi"]),
    ("Acoustic Chiều Mưa", "Guitar mộc và những giai điệu để dành cho ngày mưa.", ["Acoustic", "Ballad"]),
    ("EDM Party", "Năng lượng cực đại cho bữa tiệc của bạn.", ["EDM"]),
]


def _make_lrc(duration_ms: int, rng: random.Random) -> str:
    lines = []
    t = 2.0
    i = 0
    while t * 1000 < duration_ms - 4000:
        line = LYRIC_LINES[i % len(LYRIC_LINES)]
        lines.append(f"[{int(t // 60):02d}:{t % 60:05.2f}]{line}")
        t += rng.uniform(3.2, 5.2)
        i += 1
    return "\n".join(lines)


def seed_if_empty() -> None:
    with get_conn() as conn:
        if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            return
    print("[seed] Đang khởi tạo dữ liệu demo (sinh nhạc + ảnh bìa)...")
    _seed()
    print("[seed] Hoàn tất.")


def _seed() -> None:
    rng = random.Random(20260709)

    with get_conn() as conn:
        # Toàn bộ seed trong 1 transaction — crash giữa chừng thì DB sạch
        # nguyên trạng và lần chạy sau seed lại từ đầu. BEGIN IMMEDIATE nắm
        # write-lock ngay + re-check để nhiều worker khởi động cùng lúc
        # không seed trùng (get_conn sẽ COMMIT/ROLLBACK ở cuối).
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            conn.execute("ROLLBACK")
            return
        # ---- Users -------------------------------------------------------
        admin_id, demo_id = new_id(), new_id()
        conn.execute(
            "INSERT INTO users(id,email,password_hash,display_name,role,plan) VALUES(?,?,?,?,?,?)",
            (admin_id, ADMIN_EMAIL, hash_password(ADMIN_PASSWORD), "ANS Admin", "admin", "premium"),
        )
        conn.execute(
            "INSERT INTO users(id,email,password_hash,display_name,role,plan) VALUES(?,?,?,?,?,?)",
            (demo_id, DEMO_EMAIL, hash_password(DEMO_PASSWORD), "Người Nghe Demo", "user", "premium"),
        )

        # ---- Labels ------------------------------------------------------
        label_id = new_id()
        conn.execute(
            "INSERT INTO labels(id,name,dpid,isrc_prefix,c_line,p_line,right_holder) "
            "VALUES(?,?,?,?,?,?,?)",
            (label_id, "ANS Records", "PADPIDA2026ANSREC01", "VNA0D",
             "© 2026 ANS Records", "℗ 2026 ANS Records", "ANS Records"))

        # ---- Artists -----------------------------------------------------
        artist_ids = {}
        for i, (name, atype, country, bio) in enumerate(ARTISTS):
            aid = new_id()
            artist_ids[name] = aid
            img = COVER_DIR / f"artist_{aid}.svg"
            accent = generate_avatar(img, seed=1000 + i, name=name)
            conn.execute(
                "INSERT INTO artists(id,name,name_norm,sort_name,type,country,bio,image_url,accent) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (aid, name, normalize_text(name), name, atype, country, bio,
                 f"/media/covers/artist_{aid}.svg", accent),
            )

        # ---- Releases + Tracks ------------------------------------------
        isrc_seq = 1
        all_track_ids = []
        track_genre = {}
        for ri, (title, rtype, artist_name, genre, style, track_titles, featured) in enumerate(RELEASES):
            rid = new_id()
            upc = _upc(f"893{ri:03d}26{rng.randint(100, 999)}")
            cover = COVER_DIR / f"release_{rid}.svg"
            accent = generate_cover(cover, seed=2000 + ri, title=title, subtitle=artist_name)
            year = 2026
            rel_date = f"{year}-{rng.randint(1, 6):02d}-{rng.randint(1, 28):02d}"
            conn.execute(
                "INSERT INTO releases(id,upc,title,title_norm,release_type,label_id,label_name,"
                "genre,p_line,c_line,parental_warning,original_release_date,platform_release_date,"
                "cover_url,accent,status,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rid, upc, title, normalize_text(title), rtype, label_id, "ANS Records",
                 genre, f"℗ {year} ANS Records", f"© {year} ANS Records", "NotExplicit",
                 rel_date, rel_date, f"/media/covers/release_{rid}.svg", accent, "live", "seed"),
            )
            conn.execute(
                "INSERT INTO release_artists(release_id,artist_id,role,sequence) VALUES(?,?,?,?)",
                (rid, artist_ids[artist_name], "MainArtist", 1),
            )
            conn.execute(
                "INSERT INTO deals(id,release_id,territories,use_types,commercial_models,start_date) "
                "VALUES(?,?,?,?,?,?)",
                (new_id(), rid, "Worldwide", "OnDemandStream",
                 "SubscriptionModel,AdvertisementSupportedModel", rel_date),
            )

            for ti, t_title in enumerate(track_titles):
                tid = new_id()
                isrc = f"VNA0D26{isrc_seq:05d}"
                isrc_seq += 1
                audio_file = AUDIO_DIR / f"{tid}.wav"
                duration_ms = synthesize_track(
                    audio_file, seed=rng.randrange(10**9), style=style,
                    bars=STYLE_BARS.get(style, 16),
                )
                lrc = _make_lrc(duration_ms, rng) if rng.random() < 0.6 else None
                plain = "\n".join(LYRIC_LINES) if lrc else None
                conn.execute(
                    "INSERT INTO tracks(id,isrc,title,title_norm,duration_ms,language,genre,"
                    "parental_warning,p_line,audio_path,lyrics,lyrics_lrc,play_count,status) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (tid, isrc, t_title, normalize_text(t_title), duration_ms, "vi", genre,
                     "NotExplicit", f"℗ 2026 ANS Records", str(audio_file.name),
                     plain, lrc, rng.randint(1200, 250000), "live"),
                )
                conn.execute(
                    "INSERT INTO release_tracks(release_id,track_id,disc_no,track_no) VALUES(?,?,1,?)",
                    (rid, tid, ti + 1),
                )
                conn.execute(
                    "INSERT INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)",
                    (tid, artist_ids[artist_name], "MainArtist", 1),
                )
                if ti in featured:
                    conn.execute(
                        "INSERT INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)",
                        (tid, artist_ids[featured[ti]], "FeaturedArtist", 2),
                    )
                all_track_ids.append(tid)
                track_genre[tid] = genre
                print(f"[seed]   ♪ {t_title} ({duration_ms // 1000}s)")

        # ---- Playlist biên tập -------------------------------------------
        for pi, (p_title, p_desc, genres) in enumerate(EDITORIAL_PLAYLISTS):
            pid = new_id()
            cover = COVER_DIR / f"playlist_{pid}.svg"
            accent = generate_cover(cover, seed=3000 + pi, title=p_title, subtitle="ANS Music")
            conn.execute(
                "INSERT INTO playlists(id,owner_id,title,description,cover_url,accent,visibility,is_editorial) "
                "VALUES(?,?,?,?,?,?,?,1)",
                (pid, admin_id, p_title, p_desc, f"/media/covers/playlist_{pid}.svg", accent, "public"),
            )
            members = [t for t in all_track_ids if track_genre[t] in genres]
            rng.shuffle(members)
            for pos, tid in enumerate(members[:12]):
                conn.execute(
                    "INSERT INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)",
                    (pid, tid, pos),
                )

        # ---- Lịch sử nghe (nguồn BXH 7 ngày) ------------------------------
        weights = {tid: rng.random() ** 2 + 0.05 for tid in all_track_ids}
        tracks_list = list(weights.keys())
        w = [weights[t] for t in tracks_list]
        for _ in range(2500):
            tid = rng.choices(tracks_list, weights=w, k=1)[0]
            days_ago = rng.uniform(0, 13.5)
            conn.execute(
                "INSERT INTO play_history(user_id,track_id,played_at,ms_played,source) "
                "VALUES(?,?,datetime('now', ?),?,?)",
                (demo_id if rng.random() < 0.12 else None, tid,
                 f"-{days_ago:.3f} days", rng.randint(30000, 240000), "seed"),
            )

        # ---- Demo user: thích + theo dõi ----------------------------------
        for tid in rng.sample(all_track_ids, 8):
            conn.execute(
                "INSERT INTO favorites(user_id,entity_type,entity_id) VALUES(?,?,?)",
                (demo_id, "track", tid),
            )
        for name in ("Hà Phương Linh", "Lam Nguyên", "Thảo My"):
            conn.execute(
                "INSERT INTO follows(user_id,artist_id) VALUES(?,?)",
                (demo_id, artist_ids[name]),
            )
