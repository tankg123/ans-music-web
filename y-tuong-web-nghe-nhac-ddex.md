# 🎵 Ý TƯỞNG XÂY DỰNG NỀN TẢNG NGHE NHẠC TRỰC TUYẾN CHUYÊN NGHIỆP
### Tích hợp chuẩn metadata quốc tế DDEX + Server nhận Delivery qua DDEX XML (mô hình YouTube)

> **Phiên bản:** 1.0 — Tháng 07/2026
> **Phạm vi:** Web nghe nhạc (streaming), Web Admin quản trị, DDEX Ingestion Server nhận nội dung từ các nhà phân phối (distributor/label)

---

## MỤC LỤC

1. [Tổng quan & Mục tiêu](#1-tổng-quan--mục-tiêu)
2. [Kiến trúc hệ thống tổng thể](#2-kiến-trúc-hệ-thống-tổng-thể)
3. [Tính năng phía người nghe (Web App)](#3-tính-năng-phía-người-nghe-web-app)
4. [Web Admin — Quản trị & Upload metadata chuẩn DDEX](#4-web-admin--quản-trị--upload-metadata-chuẩn-ddex)
5. [Mô hình dữ liệu (Database Schema)](#5-mô-hình-dữ-liệu-database-schema)
6. [DDEX Ingestion Server — Nhận bài hát từ Distributor (như YouTube)](#6-ddex-ingestion-server--nhận-bài-hát-từ-distributor-như-youtube)
7. [Pipeline xử lý Audio & Streaming](#7-pipeline-xử-lý-audio--streaming)
8. [Thiết kế API](#8-thiết-kế-api)
9. [Giao diện UI/UX](#9-giao-diện-uiux)
10. [Tối ưu hiệu năng — Web chạy nhanh](#10-tối-ưu-hiệu-năng--web-chạy-nhanh)
11. [Tech Stack đề xuất](#11-tech-stack-đề-xuất)
12. [Bảo mật & Bản quyền](#12-bảo-mật--bản-quyền)
13. [Lộ trình triển khai (Roadmap)](#13-lộ-trình-triển-khai-roadmap)

---

## 1. TỔNG QUAN & MỤC TIÊU

Xây dựng một **nền tảng nghe nhạc trực tuyến chuyên nghiệp** (kiểu Spotify / Apple Music / Zing MP3) gồm **3 khối chính**:

| Khối | Vai trò |
|---|---|
| **🎧 Web App người nghe** | Nghe nhạc trực tiếp (streaming), tìm kiếm, playlist, album, thư viện cá nhân, theo dõi nghệ sĩ |
| **🛠️ Web Admin (CMS)** | Upload & quản lý track/album/artist với **metadata chuẩn quốc tế DDEX** (ISRC, UPC, contributors, territories, deal…) |
| **📦 DDEX Ingestion Server** | Nhận nội dung tự động từ các **dashboard delivery của distributor/label** qua **DDEX ERN XML** — giống cách YouTube nhận feed DDEX ([tài liệu tham chiếu](https://support.google.com/youtube/answer/3503737)) |

### Mục tiêu chất lượng

- ✅ Metadata **chuẩn quốc tế DDEX ERN** (hỗ trợ ERN 3.8.2 và ERN 4.3 — cùng dải phiên bản YouTube chấp nhận: 3.4–3.8 và 4.3)
- ✅ Định danh đầy đủ: **ISRC** (bản ghi âm), **UPC/EAN** (release/album), **ISNI/IPI** (nghệ sĩ), **GRid**, **DPID** (định danh bên gửi/nhận)
- ✅ Streaming **HLS adaptive bitrate**, phát tức thì < 300ms
- ✅ Giao diện đẹp, thân thiện, dark mode, responsive mobile-first
- ✅ Tối ưu tốc độ: Core Web Vitals đạt "Good" (LCP < 2.5s, INP < 200ms, CLS < 0.1)

---

## 2. KIẾN TRÚC HỆ THỐNG TỔNG THỂ

```
                          ┌──────────────────────────────────────────────┐
                          │                  CDN (CloudFront/Cloudflare)  │
                          │        HLS segments · ảnh bìa · static assets │
                          └──────────────▲───────────────────────────────┘
                                         │
┌─────────────┐   HTTPS   ┌──────────────┴──────────────┐
│  Web App    │◄─────────►│      API Gateway / BFF      │
│ (Next.js)   │           │  (REST + GraphQL, JWT auth) │
└─────────────┘           └──────┬──────────┬───────────┘
┌─────────────┐                  │          │
│  Web Admin  │◄────────────────►│          │
│  (CMS)      │           ┌──────▼───┐  ┌───▼──────────┐   ┌──────────────┐
└─────────────┘           │ Core API │  │ Search API   │   │ Analytics    │
                          │ Service  │  │(Meilisearch/ │   │ Service      │
┌──────────────────┐      └──────┬───┘  │Elasticsearch)│   │(plays,charts)│
│ Distributor A    │             │      └──────────────┘   └──────────────┘
│ Distributor B    │  SFTP/S3    │
│ (FUGA, Believe,  │──────────┐  │      ┌──────────────────────────────┐
│  CD Baby, ...)   │  DDEX XML│  │      │        Hạ tầng dữ liệu        │
└──────────────────┘          │  │      │ PostgreSQL · Redis · S3/Minio │
                     ┌────────▼──▼──┐   │ RabbitMQ/Kafka (queue)        │
                     │ DDEX Ingestion│──►│                              │
                     │    Server     │   └──────────────────────────────┘
                     └──────┬────────┘
                            │            ┌──────────────────────────────┐
                            └───────────►│ Transcoding Workers (FFmpeg) │
                                         │ WAV/FLAC → HLS AAC/Opus      │
                                         └──────────────────────────────┘
```

**Nguyên tắc kiến trúc:**

- **Modular monolith → microservices dần**: khởi đầu 1 codebase chia module rõ (catalog, user, playback, ingestion), tách service khi cần scale.
- **Hàng đợi (message queue)** cho mọi việc nặng: transcode, import DDEX, đếm lượt nghe, gửi email.
- **Đọc nhiều – ghi ít** → cache tầng Redis + CDN mạnh tay cho catalog.
- **Object Storage (S3)** là "nguồn sự thật" của file audio gốc (WAV/FLAC) + ảnh bìa; HLS output đẩy ra CDN.

---

## 3. TÍNH NĂNG PHÍA NGƯỜI NGHE (WEB APP)

### 3.1. Phát nhạc trực tiếp (Streaming)

- **HLS adaptive bitrate**: tự chọn 64/128/256/320 kbps (AAC) hoặc Opus theo băng thông.
- **Player toàn cục (persistent player)**: chuyển trang không ngắt nhạc (SPA), thanh player cố định dưới màn hình.
- **Đầy đủ điều khiển**: play/pause, next/prev, seek, volume, repeat (one/all), shuffle, tốc độ phát.
- **Queue (hàng đợi phát)**: xem/sửa/kéo thả thứ tự, "Phát tiếp theo", "Thêm vào hàng đợi".
- **Gapless & crossfade** (tùy chọn 0–12s).
- **Media Session API**: hiện bìa + điều khiển trên lock-screen/notification, phím media bàn phím.
- **Lời bài hát (lyrics)**: tĩnh + đồng bộ thời gian (LRC), karaoke highlight.
- **Tiếp tục nghe (resume)**: nhớ vị trí đang nghe giữa các thiết bị.

### 3.2. Khám phá & Tìm kiếm

- **Trang chủ cá nhân hóa**: Mới phát hành, Nghe gần đây, Gợi ý theo gu, Top thịnh hành, BXH theo tuần.
- **Tìm kiếm tức thì (instant search)**: gõ đến đâu ra kết quả đến đó (< 50ms với Meilisearch), tab kết quả: Bài hát / Album / Nghệ sĩ / Playlist; hỗ trợ tiếng Việt không dấu, sửa lỗi chính tả.
- **Duyệt theo thể loại / tâm trạng / thập niên**.
- **Trang Album**: bìa, năm, UPC, tracklist, tổng thời lượng, credits đầy đủ (nhạc sĩ, producer…).
- **Trang Nghệ sĩ**: ảnh, tiểu sử, bài nổi bật, discography (album/single/EP/xuất hiện trong), nghệ sĩ tương tự, nút Theo dõi.

### 3.3. Playlist & Thư viện cá nhân

- Tạo/sửa/xóa playlist, ảnh bìa tự động ghép 4 bìa hoặc tự upload.
- Playlist **công khai / riêng tư / không công khai (unlisted)**; chia sẻ bằng link.
- **Cộng tác (collaborative playlist)**: mời bạn cùng thêm bài.
- Kéo-thả sắp xếp bài; thêm bài từ mọi ngữ cảnh (menu ⋯).
- **Thư viện**: Bài hát đã thích ❤️, Album đã lưu, Nghệ sĩ theo dõi, Playlist của tôi, Lịch sử nghe.
- **Playlist hệ thống tự sinh**: Daily Mix, Nghe lại tuần qua, Radio theo bài hát/nghệ sĩ.

### 3.4. Tài khoản người dùng

- Đăng ký/đăng nhập: email + mật khẩu, OAuth (Google, Facebook, Apple), OTP.
- Hồ sơ công khai: avatar, tên hiển thị, playlist công khai, đang theo dõi ai.
- Gói tài khoản: **Free** (128kbps, quảng cáo/giới hạn skip) và **Premium** (320kbps/lossless, không quảng cáo, nghe offline PWA) — bật/tắt theo mô hình kinh doanh.
- Cài đặt: chất lượng phát, ngôn ngữ, chặn nội dung explicit, quản lý thiết bị, xóa tài khoản (GDPR).

### 3.5. Tính năng xã hội & khác

- Thích / chia sẻ bài hát, album, playlist (Open Graph card đẹp khi share).
- Bình luận (tùy chọn bật/tắt), số lượt nghe hiển thị công khai.
- Thông báo: nghệ sĩ theo dõi ra bài mới.
- **PWA**: cài như app, nghe offline (Premium), push notification.

---

## 4. WEB ADMIN — QUẢN TRỊ & UPLOAD METADATA CHUẨN DDEX

Admin CMS là nơi đội nội dung upload thủ công và **kiểm duyệt nội dung đến từ DDEX feed**. Mọi form nhập liệu bám theo từ vựng chuẩn DDEX (Release / Resource / Party / Deal).

### 4.1. Phân quyền (RBAC)

| Vai trò | Quyền |
|---|---|
| **Super Admin** | Toàn quyền, quản lý user admin, cấu hình hệ thống, quản lý DPID đối tác |
| **Content Manager** | CRUD catalog (track/album/artist), duyệt ingestion, lên lịch phát hành |
| **Moderator** | Duyệt bình luận, báo cáo vi phạm, quản lý user nghe nhạc |
| **Analyst** | Chỉ xem dashboard thống kê, xuất báo cáo |
| **Partner (Label/Distributor)** | Dashboard riêng: xem catalog đã delivery, trạng thái ingest, báo cáo lượt nghe |

### 4.2. Quản lý Nghệ sĩ (Party/Artist)

- Trường: tên chính thức, tên khác (aliases), loại (solo/nhóm/dàn nhạc), **ISNI**, **IPI**, quốc gia, tiểu sử đa ngôn ngữ, ảnh, liên kết mạng xã hội.
- Phân biệt **DisplayArtist** (nghệ sĩ hiển thị) và **Contributor** (vai trò: Composer, Lyricist, Producer, Mixer, FeaturedArtist, Remixer… theo danh mục vai trò của DDEX).
- Gộp trùng nghệ sĩ (merge duplicates) — rất quan trọng khi nhận feed từ nhiều distributor.

### 4.3. Quản lý Release (Album/Single/EP) — chuẩn DDEX

Form tạo Release với đầy đủ trường chuẩn:

- **Định danh**: **UPC/EAN** (bắt buộc, validate checksum), GRid (nếu có), Catalog Number, Release ID nội bộ.
- **Loại release**: Album / Single / EP / Compilation (ReleaseType theo DDEX).
- **Thông tin chính**: tiêu đề (Title + SubTitle), DisplayArtist, nhãn đĩa (Label), năm & chủ sở hữu **℗ (PLine)** và **© (CLine)**, thể loại (Genre/SubGenre), ngôn ngữ, parental warning (Explicit/Clean/NotExplicit).
- **Ngày**: ngày phát hành gốc (OriginalReleaseDate), ngày phát hành trên nền tảng (ReleaseDate), hỗ trợ **lên lịch phát hành đúng 0h theo múi giờ** + pre-save.
- **Ảnh bìa**: tối thiểu 3000×3000 JPG/PNG (FrontCoverImage), validate kích thước/tỉ lệ.
- **Tracklist**: kéo thả thứ tự, số đĩa (disc number), liên kết tới Sound Recording.

### 4.4. Quản lý Track (SoundRecording) — chuẩn DDEX

- **ISRC** (bắt buộc, validate định dạng `CC-XXX-YY-NNNNN`, ví dụ `VNA0D2600001`) — khóa định danh bản ghi âm toàn cầu.
- Tiêu đề (TitleText + SubTitle — ví dụ "(Remix)", "(Live)"), phiên bản.
- DisplayArtist + danh sách Contributor kèm vai trò.
- Thời lượng (tự đọc từ file), ngôn ngữ lời hát, thể loại, parental warning.
- ℗ PLine của bản ghi âm; ISWC của tác phẩm (work) nếu quản lý sâu về publishing.
- **File audio**: nhận WAV/FLAC (16/24-bit, ≥44.1kHz) — validate bằng ffprobe, tự tính hash MD5/SHA-256 chống trùng, lưu bản gốc vào S3, đẩy job transcode.
- Lyrics (plain + LRC), preview clip (30s) tự cắt.

### 4.5. Quản lý Deal (quyền phát hành theo lãnh thổ)

Theo mô hình **DealList** của DDEX:

- **Territory**: danh sách quốc gia được phát (ISO 3166, hỗ trợ `Worldwide` và loại trừ).
- **UseType**: OnDemandStream / ConditionalDownload / PermanentDownload…
- **CommercialModelType**: FreeOfChargeModel / AdvertisementSupportedModel / SubscriptionModel.
- **Thời hạn**: StartDate / EndDate → hệ thống tự ẩn/hiện nội dung đúng hạn (geo-blocking + time-window tự động).

### 4.6. Công cụ vận hành

- **Dashboard tổng quan**: lượt nghe realtime, bài mới ingest, job transcode đang chạy, lỗi ingestion cần xử lý.
- **Hàng chờ duyệt (Review Queue)**: nội dung từ DDEX feed vào trạng thái `pending_review` (hoặc auto-publish theo cấu hình từng đối tác).
- **Import/Export CSV** hàng loạt; audit log mọi thao tác (ai sửa gì, khi nào, giá trị cũ/mới).
- **Trang quản lý Delivery**: xem từng gói DDEX đã nhận, XML gốc, kết quả validate, file ACK đã trả.
- Quản lý banner/trang chủ, playlist editorial, BXH.

---

## 5. MÔ HÌNH DỮ LIỆU (DATABASE SCHEMA)

PostgreSQL — các bảng chính (rút gọn):

```sql
-- ĐỊNH DANH & CATALOG ------------------------------------------------
artists (
  id UUID PK, name TEXT, sort_name TEXT, isni TEXT, ipi TEXT,
  type TEXT,            -- person | group | orchestra ...
  country CHAR(2), bio JSONB, image_url TEXT,
  created_at, updated_at
)

releases (                -- Album / Single / EP (DDEX Release)
  id UUID PK,
  upc VARCHAR(14) UNIQUE NOT NULL,        -- UPC/EAN
  grid TEXT, catalog_number TEXT,
  title TEXT NOT NULL, subtitle TEXT,
  release_type TEXT,                       -- Album|Single|EP|Compilation
  label_id UUID FK, genre TEXT, subgenre TEXT,
  p_line TEXT, c_line TEXT,                -- ℗ / ©
  parental_warning TEXT,                   -- Explicit|NotExplicit|Edited
  original_release_date DATE, platform_release_date TIMESTAMPTZ,
  cover_art_url TEXT, status TEXT,         -- draft|pending_review|live|taken_down
  source TEXT,                             -- admin_upload | ddex_feed
  delivery_id UUID FK NULL                 -- gói DDEX sinh ra release này
)

tracks (                  -- DDEX SoundRecording
  id UUID PK,
  isrc CHAR(12) UNIQUE NOT NULL,
  title TEXT NOT NULL, subtitle TEXT,
  duration_ms INT, language CHAR(2),
  genre TEXT, parental_warning TEXT, p_line TEXT,
  audio_master_key TEXT,                   -- S3 key file gốc WAV/FLAC
  audio_hash_sha256 TEXT,                  -- chống trùng file
  hls_manifest_url TEXT, preview_url TEXT,
  lyrics TEXT, lyrics_lrc TEXT,
  play_count BIGINT DEFAULT 0, status TEXT
)

release_tracks (release_id FK, track_id FK, disc_no INT, track_no INT,
                PRIMARY KEY(release_id, track_id))

track_artists (track_id FK, artist_id FK,
  role TEXT,              -- MainArtist|FeaturedArtist|Composer|Lyricist|Producer...
  sequence INT)
release_artists (tương tự cho release)

labels (id UUID PK, name TEXT, dpid TEXT, parent_label_id FK NULL)

deals (                   -- DDEX DealList
  id UUID PK, release_id FK,
  territories TEXT[],                      -- ['Worldwide'] hoặc ['VN','US',...]
  excluded_territories TEXT[],
  use_types TEXT[],                        -- OnDemandStream,...
  commercial_models TEXT[],
  start_date DATE, end_date DATE NULL
)

-- NGƯỜI DÙNG ----------------------------------------------------------
users (id UUID PK, email CITEXT UNIQUE, password_hash TEXT,
       display_name TEXT, avatar_url TEXT, plan TEXT,   -- free|premium
       settings JSONB, created_at)

playlists (id UUID PK, owner_id FK, title TEXT, description TEXT,
           cover_url TEXT, visibility TEXT,  -- public|private|unlisted
           is_collaborative BOOL, created_at)
playlist_tracks (playlist_id FK, track_id FK, position INT, added_by FK, added_at)

favorites (user_id FK, entity_type TEXT, entity_id UUID, created_at,
           PRIMARY KEY(user_id, entity_type, entity_id))
follows (user_id FK, artist_id FK, created_at)
play_history (id BIGSERIAL, user_id FK, track_id FK,
              played_at TIMESTAMPTZ, ms_played INT, source TEXT)
              -- partition theo tháng, nguồn tính BXH & royalty report

-- DDEX INGESTION -------------------------------------------------------
delivery_partners (      -- mỗi distributor/label được cấp kênh riêng
  id UUID PK, name TEXT, dpid TEXT UNIQUE,   -- DDEX Party ID
  sftp_username TEXT, ssh_public_key TEXT,
  ern_versions TEXT[],                        -- ['3.8.2','4.3']
  auto_publish BOOL DEFAULT false, contact_email TEXT
)

deliveries (             -- mỗi batch/gói nhận được
  id UUID PK, partner_id FK,
  batch_folder TEXT, message_id TEXT,         -- MessageId trong XML
  message_type TEXT,                          -- NewRelease|Update|Takedown(PurgeRelease)
  ern_version TEXT, xml_s3_key TEXT,
  status TEXT,   -- received|validating|validated|importing|imported|failed|acknowledged
  error_log JSONB, received_at, processed_at
)

delivery_files (delivery_id FK, file_name TEXT, file_type TEXT, -- audio|image|xml
                expected_hash TEXT, actual_hash TEXT, s3_key TEXT, status TEXT)
```

**Chỉ mục quan trọng**: `tracks(isrc)`, `releases(upc)`, GIN cho tìm kiếm phụ trợ, `play_history(track_id, played_at)` phục vụ BXH; bảng `play_history` partition theo tháng.

---

## 6. DDEX INGESTION SERVER — NHẬN BÀI HÁT TỪ DISTRIBUTOR (NHƯ YOUTUBE)

Đây là điểm khác biệt lớn nhất của hệ thống: **hoạt động như một DSP thực thụ** — distributor (FUGA, Believe, The Orchard, CD Baby, DistroKid…) chỉ cần thêm nền tảng của bạn vào dashboard delivery của họ và bắn nội dung qua **DDEX ERN XML**, giống hệt cách họ delivery cho YouTube.

### 6.1. Chuẩn hỗ trợ

- **DDEX ERN 3.8.2** (phổ biến nhất hiện nay ở các distributor) và **ERN 4.3** (chuẩn mới) — tương đương dải YouTube chấp nhận (ERN 3.4–3.8 & 4.3).
- **Profile**: Audio Album + Audio Single (giống YouTube yêu cầu).
- Mỗi đối tác được cấp **DPID** (DDEX Party ID) hoặc dùng DPID thật của họ; nền tảng của bạn cũng nên **đăng ký DPID riêng với DDEX** để làm `MessageRecipient` chuẩn.

### 6.2. Kênh tiếp nhận (Delivery Channels)

| Kênh | Mô tả |
|---|---|
| **SFTP (chuẩn ngành — bắt buộc có)** | Mỗi partner 1 tài khoản SFTP (chroot riêng), xác thực SSH key. Distributor đẩy batch vào thư mục của họ |
| **S3 bucket** | Cấp IAM credential giới hạn prefix `s3://ingest/{partner}/` — nhiều distributor lớn hỗ trợ đẩy thẳng S3 |
| **API upload** | REST endpoint `POST /ingestion/v1/deliveries` (multipart/resumable) cho đối tác nhỏ |

### 6.3. Cấu trúc batch nhận vào (theo convention DDEX/YouTube)

```
/{partner_sftp_root}/
└── 20260709103000123/              ← batch folder: timestamp YYYYMMDDhhmmssnnn
    ├── 0827969279321/              ← thư mục theo UPC của release
    │   ├── 0827969279321.xml       ← ERN NewReleaseMessage (tên file = Release ID/UPC)
    │   ├── resources/
    │   │   ├── 0827969279321_01_001.wav   ← audio (đặt tên theo XML)
    │   │   ├── 0827969279321_01_002.wav
    │   │   └── 0827969279321.jpg          ← ảnh bìa 3000×3000
    │   └── BatchComplete_0827969279321.xml (tùy chọn)
    └── BatchComplete.xml           ← file báo hiệu batch đã upload xong
```

> **Quy tắc quan trọng** (học từ YouTube DDEX feed): chỉ bắt đầu xử lý khi thấy **file báo hiệu hoàn tất** (`BatchComplete.xml` / semaphore file) hoặc batch "im lặng" đủ N phút — tránh đọc batch đang upload dở.

### 6.4. Pipeline xử lý (7 bước)

```
[1] WATCH      SFTP/S3 event (hoặc cron scan) phát hiện batch mới có semaphore
[2] LOCK+COPY  Khóa batch, copy nguyên trạng vào S3 (immutable), ghi bảng deliveries
[3] VALIDATE   ① XSD schema đúng phiên bản ERN khai báo
               ② Business rules: ISRC/UPC hợp lệ, đủ DealList, đủ ảnh bìa,
                  audio khớp MD5 hash khai trong XML, đủ file như ResourceList
[4] PARSE+MAP  ERN XML → model nội bộ:
               PartyList/DisplayArtist → artists (match theo ISNI/tên, tạo mới nếu chưa có)
               SoundRecording → tracks (upsert theo ISRC)
               Release → releases (upsert theo UPC)
               Deal → deals (territory, thời hạn, use type)
[5] MEDIA      Đẩy audio vào pipeline transcode (mục 7), xử lý ảnh bìa đa kích thước
[6] PUBLISH    auto_publish=true → lên thẳng catalog đúng ReleaseDate/Deal
               auto_publish=false → vào Review Queue cho Content Manager duyệt
[7] ACK        Sinh file/thông điệp Acknowledgement trả về thư mục /outbox của partner
               + email/webhook thông báo kết quả (imported | failed + chi tiết lỗi)
```

### 6.5. Xử lý theo loại message

- **NewReleaseMessage (mới)**: tạo mới toàn bộ release + track + deal.
- **Update (full-replace theo UPC/ISRC)**: DDEX là chuẩn *full description* — bản update thay thế toàn bộ metadata cũ; giữ nguyên play_count & liên kết playlist nhờ khớp ISRC.
- **Takedown**: ERN 3.x — `NewReleaseMessage` với Deal `TakeDown`/hết hạn; ERN 4.3 — `PurgeReleaseMessage`. Hệ thống gỡ khỏi catalog (track trong playlist người dùng hiển thị "không khả dụng"), lưu lại bản ghi để phục hồi nếu re-delivery.

### 6.6. Chống lỗi & vận hành

- **Idempotent**: xử lý lại cùng `MessageId` không tạo bản ghi trùng (unique theo `partner + message_id`).
- **Dead-letter queue**: batch lỗi vào hàng riêng, admin xem XML + log lỗi từng dòng ngay trên CMS, bấm "Re-process" sau khi partner sửa.
- **Báo cáo cho partner**: dashboard partner (mục 4.1) + ACK file + webhook — minh bạch như YouTube trả report cho label.
- **Giám sát**: cảnh báo nếu batch kẹt > 30 phút, tỉ lệ lỗi > ngưỡng, dung lượng SFTP.

---

## 7. PIPELINE XỬ LÝ AUDIO & STREAMING

### 7.1. Transcoding (FFmpeg workers, chạy qua queue)

```
Input: WAV/FLAC gốc (S3)
  ├── HLS AAC  64 kbps   (data saver)
  ├── HLS AAC  128 kbps  (free mặc định)
  ├── HLS AAC  256 kbps  (premium)
  ├── HLS AAC  320 kbps / FLAC (premium lossless - tùy chọn)
  ├── Preview MP3 30s (public, cho share card & user chưa đăng nhập)
  └── Waveform JSON + loudness (EBU R128 → chuẩn hóa -14 LUFS khi phát)
Output: HLS segments 4-6s + master.m3u8 → S3 → CDN
```

### 7.2. Phát nhạc an toàn & nhanh

- **Signed URL / signed cookie** cho manifest + segment (hết hạn ngắn), chống hotlink; user free không lấy được luồng 320kbps.
- **Đếm lượt nghe chuẩn**: client gửi heartbeat; 1 play hợp lệ khi nghe ≥ 30s (chuẩn ngành) → ghi vào queue → `play_history` (nguồn cho BXH + báo cáo royalty theo ISRC/UPC cho label).
- **Prefetch thông minh**: preload manifest + segment đầu của bài kế tiếp trong queue → chuyển bài tức thì.

---

## 8. THIẾT KẾ API

REST (kèm GraphQL cho web app nếu muốn), version hóa `/v1`:

```
# Auth
POST /v1/auth/register | /login | /refresh | /oauth/{provider}

# Catalog (public, cache mạnh)
GET  /v1/tracks/{id}            GET /v1/tracks/{id}/stream   → trả signed HLS manifest
GET  /v1/albums/{id}            GET /v1/artists/{id}         GET /v1/artists/{id}/top-tracks
GET  /v1/search?q=&type=track,album,artist,playlist
GET  /v1/charts/{period}        GET /v1/home                 → feed cá nhân hóa

# Người dùng
GET/POST/PATCH/DELETE /v1/me/playlists /v1/me/playlists/{id}/tracks
PUT/DELETE /v1/me/favorites/{type}/{id}     POST /v1/me/follows/{artistId}
POST /v1/playback/heartbeat                 GET /v1/me/history

# Admin (RBAC + audit log)
CRUD /admin/v1/releases /tracks /artists /labels /deals
POST /admin/v1/tracks/{id}/audio            → upload master, trả job transcode
GET  /admin/v1/deliveries?status=failed     POST /admin/v1/deliveries/{id}/reprocess
GET  /admin/v1/review-queue                 POST /admin/v1/review-queue/{id}/approve

# Ingestion (cho partner API)
POST /ingestion/v1/deliveries               GET /ingestion/v1/deliveries/{id}/status
```

Chuẩn chung: JWT (access 15' + refresh), rate-limit, idempotency-key cho POST quan trọng, phân trang cursor, ETag/If-None-Match cho catalog.

---

## 9. GIAO DIỆN UI/UX

### 9.1. Định hướng thiết kế

- **Dark mode mặc định** (chuẩn app nhạc — làm bìa album nổi bật), có light mode.
- **Màu nhấn (accent) trích từ bìa album đang phát** (dominant color) → player & background gradient đổi theo bài hát, cảm giác "sống".
- Font: Inter / Be Vietnam Pro (đẹp với tiếng Việt); bo góc 12–16px, glassmorphism nhẹ cho player.
- **Layout 3 vùng** (desktop): Sidebar trái (điều hướng + thư viện) · Nội dung chính · Player bar cố định dưới; mobile: bottom tab + mini-player vuốt lên thành full-screen "Now Playing".

### 9.2. Trang "Now Playing" full-screen

Bìa lớn xoay/ambient glow, lyrics đồng bộ cuộn theo, waveform seekbar, queue trượt bên phải, nút thích/thêm playlist/chia sẻ ngay tầm ngón cái (mobile).

### 9.3. Trải nghiệm thân thiện

- Skeleton loading (không giật layout), infinite scroll có virtual list.
- Phím tắt: Space (play/pause), ←/→ (seek), Ctrl+K (search)…
- Context menu chuột phải/⋯ nhất quán ở mọi nơi có bài hát.
- Accessibility: ARIA đầy đủ, focus ring, contrast WCAG AA; hỗ trợ đa ngôn ngữ (vi/en) qua i18n.
- Onboarding chọn thể loại/nghệ sĩ yêu thích ngay lần đầu để cá nhân hóa lập tức.

---

## 10. TỐI ƯU HIỆU NĂNG — WEB CHẠY NHANH

| Tầng | Kỹ thuật |
|---|---|
| **Rendering** | Next.js: SSR/SSG + ISR cho trang catalog (album/artist SEO tốt, TTFB thấp); RSC giảm JS gửi xuống; route prefetch |
| **JS/CSS** | Code-splitting theo route, tree-shaking, lazy-load player module nặng (hls.js) khi bấm play lần đầu; bundle < 200KB gzip cho first load |
| **Ảnh** | AVIF/WebP, `srcset` đa kích thước (64/300/640/3000), lazy-load, blur-up placeholder, CDN resize on-the-fly |
| **Audio** | HLS segment 4s, preload segment đầu, adaptive bitrate; CDN edge cache toàn bộ segment |
| **API** | Redis cache catalog (TTL + invalidation khi update), HTTP cache CDN cho endpoint public, GraphQL persisted queries |
| **Database** | Index đúng truy vấn, read-replica, connection pool (PgBouncer), materialized view cho BXH (refresh 5–15') |
| **Search** | Meilisearch/Typesense — kết quả < 50ms, đồng bộ qua CDC/queue |
| **Đo lường** | Lighthouse CI + RUM (Web Vitals thật của user), budget: LCP < 2.5s · INP < 200ms · CLS < 0.1 · bắt đầu phát nhạc < 300ms |

---

## 11. TECH STACK ĐỀ XUẤT

| Thành phần | Lựa chọn chính | Lý do |
|---|---|---|
| Frontend Web + Admin | **Next.js 15 (React, TypeScript)** + Tailwind CSS + shadcn/ui + Zustand + TanStack Query + **hls.js** | SSR/ISR nhanh, hệ sinh thái lớn, 1 stack cho cả 2 web |
| Backend API | **NestJS (Node.js/TypeScript)** — hoặc Go (Fiber/Echo) cho service streaming/ingestion | Cấu trúc module rõ, dễ tách microservice |
| Database | **PostgreSQL 16** + **Redis** | Quan hệ phức tạp catalog + cache/queue nhẹ |
| Search | **Meilisearch** (hoặc Elasticsearch khi rất lớn) | Instant search, typo-tolerance, nhẹ vận hành |
| Queue | **RabbitMQ** (hoặc Kafka khi cần throughput lớn) | Transcode, ingestion, đếm play |
| Storage + CDN | **S3/Cloudflare R2** + **CloudFront/Cloudflare CDN** | Chuẩn ngành, rẻ, nhanh toàn cầu |
| Transcode | **FFmpeg** workers (container, autoscale theo queue) | Miễn phí, mạnh nhất |
| DDEX Ingestion | Service riêng (NestJS/Go) + **SFTPGo** (SFTP server cấp account per-partner, event webhook) + XSD validator (libxml2) | SFTPGo production-ready, hook thẳng vào pipeline |
| Hạ tầng | Docker + Kubernetes (hoặc ECS), Terraform, GitHub Actions CI/CD | Chuẩn hóa, autoscale |
| Giám sát | Prometheus + Grafana, Sentry, OpenTelemetry | Theo dõi lỗi + hiệu năng end-to-end |

---

## 12. BẢO MẬT & BẢN QUYỀN

- **Auth**: bcrypt/argon2, JWT ngắn hạn + refresh rotation, 2FA cho admin, khóa IP/SSO cho CMS.
- **Streaming**: signed URL hết hạn ngắn, kiểm tra quyền theo gói + Deal territory (geo-IP) trước khi cấp manifest; watermark session (tùy chọn) chống rip hàng loạt.
- **Ingestion**: SSH key per-partner, chroot SFTP, validate hash mọi file, quét virus (ClamAV) file nhận vào, không bao giờ thực thi nội dung upload.
- **Dữ liệu**: mã hóa at-rest (S3 SSE, PG TDE) + in-transit (TLS 1.3), backup PITR, phân quyền RBAC + audit log bất biến.
- **Pháp lý**: điều khoản sử dụng, DMCA/takedown flow, báo cáo usage theo ISRC/UPC cho label (nền tảng cho đối soát royalty), GDPR (xóa tài khoản, xuất dữ liệu).

---

## 13. LỘ TRÌNH TRIỂN KHAI (ROADMAP)

### 🚀 Giai đoạn 1 — MVP (8–10 tuần)
- Catalog cơ bản (track/album/artist + ISRC/UPC), Admin CRUD + upload audio.
- Pipeline transcode HLS + player web (play/pause/queue/seek), auth user, playlist, favorites, search.
- Deploy hạ tầng cơ bản (1 region), CDN, monitoring.

### 📦 Giai đoạn 2 — DDEX Ingestion (6–8 tuần)
- SFTP server per-partner + pipeline 7 bước (validate XSD ERN 3.8.2 → parse → import → ACK).
- Review Queue trên admin, dashboard partner, xử lý Update/Takedown.
- Chạy thử end-to-end với 1–2 distributor thật (test feed), sau đó hỗ trợ ERN 4.3.

### 🌟 Giai đoạn 3 — Trải nghiệm & tăng trưởng (liên tục)
- Lyrics đồng bộ, Daily Mix/gợi ý (collaborative filtering), BXH, trang biên tập.
- Premium (lossless, offline PWA), app mobile (React Native — tái dùng API).
- Analytics & royalty report cho label, A/B testing, scale đa region.

---

## PHỤ LỤC A — VÍ DỤ RÚT GỌN DDEX ERN 3.8.2 (NewReleaseMessage)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ern:NewReleaseMessage xmlns:ern="http://ddex.net/xml/ern/382"
    MessageSchemaVersionId="ern/382" LanguageAndScriptCode="en">
  <MessageHeader>
    <MessageThreadId>MT-2026-000123</MessageThreadId>
    <MessageId>MSG-2026-000123</MessageId>
    <MessageSender><PartyId>PADPIDA2026DISTRIB01</PartyId>
      <PartyName><FullName>Distributor A</FullName></PartyName></MessageSender>
    <MessageRecipient><PartyId>PADPIDA2026YOURDSP1</PartyId>
      <PartyName><FullName>Your Music Platform</FullName></PartyName></MessageRecipient>
    <MessageCreatedDateTime>2026-07-09T10:30:00Z</MessageCreatedDateTime>
  </MessageHeader>

  <ResourceList>
    <SoundRecording>
      <SoundRecordingType>MusicalWorkSoundRecording</SoundRecordingType>
      <SoundRecordingId><ISRC>VNA0D2600001</ISRC></SoundRecordingId>
      <ResourceReference>A1</ResourceReference>
      <ReferenceTitle><TitleText>Tên Bài Hát</TitleText></ReferenceTitle>
      <Duration>PT3M45S</Duration>
      <SoundRecordingDetailsByTerritory>
        <TerritoryCode>Worldwide</TerritoryCode>
        <DisplayArtist>
          <PartyName><FullName>Tên Nghệ Sĩ</FullName></PartyName>
          <ArtistRole>MainArtist</ArtistRole>
        </DisplayArtist>
        <PLine><Year>2026</Year><PLineText>℗ 2026 Label Name</PLineText></PLine>
        <TechnicalSoundRecordingDetails>
          <TechnicalResourceDetailsReference>T1</TechnicalResourceDetailsReference>
          <AudioCodecType>PCM</AudioCodecType>
          <File><FileName>0827969279321_01_001.wav</FileName>
            <HashSum><HashSum>9e107d9d...</HashSum>
              <HashSumAlgorithmType>MD5</HashSumAlgorithmType></HashSum></File>
        </TechnicalSoundRecordingDetails>
      </SoundRecordingDetailsByTerritory>
    </SoundRecording>
    <Image>
      <ImageType>FrontCoverImage</ImageType>
      <ImageId><ProprietaryId Namespace="DPID:...">IMG001</ProprietaryId></ImageId>
      <ResourceReference>A2</ResourceReference>
    </Image>
  </ResourceList>

  <ReleaseList>
    <Release IsMainRelease="true">
      <ReleaseId><ICPN IsEan="false">0827969279321</ICPN></ReleaseId>  <!-- UPC -->
      <ReferenceTitle><TitleText>Tên Album</TitleText></ReferenceTitle>
      <ReleaseResourceReferenceList>
        <ReleaseResourceReference ReleaseResourceType="PrimaryResource">A1</ReleaseResourceReference>
        <ReleaseResourceReference ReleaseResourceType="SecondaryResource">A2</ReleaseResourceReference>
      </ReleaseResourceReferenceList>
      <ReleaseType>Single</ReleaseType>
    </Release>
  </ReleaseList>

  <DealList>
    <ReleaseDeal>
      <DealReleaseReference>R0</DealReleaseReference>
      <Deal><DealTerms>
        <CommercialModelType>SubscriptionModel</CommercialModelType>
        <Usage><UseType>OnDemandStream</UseType></Usage>
        <TerritoryCode>Worldwide</TerritoryCode>
        <ValidityPeriod><StartDate>2026-08-01</StartDate></ValidityPeriod>
      </DealTerms></Deal>
    </ReleaseDeal>
  </DealList>
</ern:NewReleaseMessage>
```

## PHỤ LỤC B — CHECKLIST VALIDATE KHI NHẬN DELIVERY

- [ ] XML parse được + đúng XSD phiên bản ERN khai báo
- [ ] `MessageId` chưa từng xử lý (idempotent)
- [ ] UPC hợp lệ (12–14 số, checksum GTIN) — ISRC đúng format 12 ký tự
- [ ] Mọi file trong `ResourceList` tồn tại trong batch, hash khớp
- [ ] Audio: WAV/FLAC, ≥16-bit/44.1kHz, thời lượng khớp ±2s so với khai báo
- [ ] Ảnh bìa ≥3000×3000, vuông, JPG/PNG, không watermark
- [ ] Có ít nhất 1 Deal hợp lệ (territory + use type + start date)
- [ ] PLine/CLine, Genre, DisplayArtist đầy đủ
- [ ] Parental warning được khai báo
- [ ] Sinh ACK + ghi log dù thành công hay thất bại

---

*Tài liệu tham chiếu: [DDEX Knowledge Base](https://kb.ddex.net) · [Understanding the YouTube DDEX feed](https://support.google.com/youtube/answer/3503737) · [DDEX ERN 4.3 Standard](https://ern.ddex.net)*
