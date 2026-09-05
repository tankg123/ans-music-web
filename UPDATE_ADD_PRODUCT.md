# UPDATE: Thay thế tính năng "Upload nhạc" bằng module "Product" (Add Product)

> **Tài liệu cập nhật tính năng cho trang Admin — Website nghe nhạc**
> Phiên bản: 1.0 · Ngày: 09/07/2026
> Phạm vi: Loại bỏ phần "đưa nhạc lên" (upload nhạc đơn lẻ) hiện tại, thay bằng module **Product** hoàn chỉnh (mô phỏng theo hệ thống LabelMaster trong ảnh tham khảo). Product là đơn vị phát hành (release) chứa metadata đầy đủ + danh sách track, dùng để import/đưa nhạc lên website.

---

## 1. Tổng quan

### 1.1. Vấn đề hiện tại
- Trang admin hiện chỉ có chức năng upload nhạc đơn giản (chọn file → đăng), thiếu metadata chuẩn ngành (UPC, ISRC, contributors, copyrights, release date…).
- Không quản lý được phát hành theo Album/EP/Single, không có quy trình kiểm tra chất lượng (QC) trước khi publish.

### 1.2. Giải pháp
Thay thế bằng module **Product** với đầy đủ:

| Thành phần | Mô tả |
|---|---|
| **Create Product** | Form khởi tạo product (Title, Release Type, Label) |
| **Product Detail** | Trang chi tiết gồm 4 tab: **Metadata · Tracks · QC Check · Releases** |
| **Metadata** | Thông tin phát hành, ngôn ngữ, parental advisory, ngày phát hành, contributors, copyrights, product details |
| **Tracks** | Danh sách track thuộc product, upload file audio (WAV/FLAC), quản lý ISRC, chi tiết từng track |
| **QC Check** | Kiểm tra tính hợp lệ trước khi publish |
| **Releases** | Lịch sử phát hành / đẩy product lên website (thay cho nút "đăng nhạc" cũ) |

### 1.3. Điều hướng (Sidebar admin)
Cập nhật sidebar theo nhóm:

```
Dashboard
Calendar
Catalogs
 ├─ Products      ← MỚI (thay thế "Upload nhạc")
 ├─ Tracks        ← danh sách tất cả track trong hệ thống
 ├─ Artists
 ├─ Labels
 └─ Tags
```

*(Các nhóm Deliveries / Ingestions / Tools trong ảnh gốc là của hệ thống phân phối DSP — **không bắt buộc** cho website nghe nhạc; có thể bỏ qua ở phase 1.)*

---

## 2. Luồng nghiệp vụ tổng thể

```
[Products list] → nút "Create Product"
      │
      ▼
[Create Product form]  ── Create ──▶  [Product Detail · tab Metadata]  (state: Draft)
      │                                        │
      │                                        ▼
      │                              Điền metadata đầy đủ → Save
      │                                        │
      │                                        ▼
      │                              [Tab Tracks] → thêm track + upload WAV/FLAC
      │                                        │
      │                                        ▼
      │                              [Tab QC Check] → pass toàn bộ rule
      │                                        │
      │                                        ▼
      │                              [Tab Releases] → Publish lên website
      │                                        │
      ▼                                        ▼
   Cancel                             state: Published (nhạc hiển thị cho người nghe)
```

---

## 3. Màn hình 1 — Create Product

**Route:** `/admin/products/create`
**Breadcrumb:** `Products > Create Product`

Form gồm 2 section, layout 1 cột giữa trang:

### 3.1. Section "Product Info"
> *"Enter the basic information for the new product."*

| Field | Loại | Bắt buộc | Ghi chú |
|---|---|---|---|
| **Title** | Text input | ✅ | Placeholder: "Product title" |
| **Title Version** | Text input | ❌ | Placeholder: "e.g. Deluxe Edition, Remastered" |
| **Release Type** | Select | ✅ | Mặc định: `Single`. Options: `Single / EP / Album / Compilation` |

### 3.2. Section "Label & Type"
> *"Select the label and type for this product."*

| Field | Loại | Bắt buộc | Ghi chú |
|---|---|---|---|
| **Label** | Select (searchable) | ✅ | Placeholder: "Select label". Nguồn: bảng `labels` |
| **Migrated network** | Checkbox | ❌ | Chế độ chuyển product từ hệ thống khác sang. Khi bật: **bắt buộc nhập ISRC thủ công cho từng track** (không auto-generate). Hiển thị mô tả ngay dưới checkbox. |

### 3.3. Hành động
- **Cancel** (secondary) → quay về danh sách Products.
- **Create** (primary, màu cam) → tạo product state `Draft`, redirect sang trang Product Detail.

---

## 4. Màn hình 2 — Product Detail (Header + Tabs)

**Route:** `/admin/products/{id}` · **Breadcrumb:** `Products > {Title}`

### 4.1. Header product (hiển thị ở mọi tab)

| Thành phần | Mô tả |
|---|---|
| **Cover art** | Ảnh bìa vuông + nút overlay **"Manage"** để upload/đổi ảnh (yêu cầu tối thiểu 3000×3000 JPG/PNG — chuẩn phát hành) |
| **Title + #ID** | Ví dụ: `Sonic Fever #3260` |
| **Status badge** | `Draft` (xám) / `Published` (xanh lá) — các state khác xem mục 9 |
| **Artist** | Main artist (icon 👤) |
| **Release Type** | Album / Single / EP |
| **Release Date** | `09/07/2026 16:30` (icon 📅) |
| **UPC** | `674445524157` (icon #) |
| **Genre** | Primary genre (icon 🎵) |
| **Track count** | `15 tracks` |
| **Tags** | Hiển thị `No tags` + icon bút chì để sửa nhanh (inline edit) |

Góc phải trên: nút **"Request Changes"** (đối với product đã Published — tạo yêu cầu chỉnh sửa thay vì sửa trực tiếp) + menu `⋯` (Delete, Duplicate, Export…).

Góc phải dưới thanh tab: cảnh báo tổng hợp, ví dụ `⚠ 1 warning` — click để nhảy đến tab QC Check.

### 4.2. Thanh Tab
`📄 Metadata` · `🎵 Tracks` · `✅ QC Check` · `🚀 Releases`

---

## 5. Tab Metadata

Layout **2 cột** (compact), có link *"Switch to the Comfortable layout for a roomier form"* để chuyển layout 1 cột rộng. Cuối trang có thanh **sticky action bar**: `Cancel` / `Save` (Save chỉ enable khi form dirty).

### 5.1. Release Information (cột trái)
> *"Basic product details like title, label, and release type"*

| Field | Loại | Bắt buộc |
|---|---|---|
| Title | Text | ✅ |
| Title Version | Text (placeholder "e.g. Deluxe Edition, Remix") | ❌ |
| Label | Select | ✅ |
| Release Type | Select | ✅ |
| Primary Genre | Select | ✅ |
| Secondary Genre | Select | ❌ |

### 5.2. Languages & Content Advisory (cột phải)
> *"Language settings and parental advisory rating"*

| Field | Loại | Bắt buộc |
|---|---|---|
| Metadata Language | Select (English, Vietnamese…) | ✅ |
| Audio Language | Select | ✅ |
| **Parental Advisory** | Radio card 3 lựa chọn | ✅ |

Parental Advisory — 3 card chọn 1 (card được chọn viền cam):
1. **None** — *No explicit content*
2. **Explicit** — *Contains explicit content*
3. **Explicit Content Edited** — *Edited version of explicit content*

### 5.3. Release Dates
> *"Scheduled release, original release, and pre-order dates"*

- Banner cấu hình: `🕐 Release timing: Global Timed Release (GMT)` + link **Configure** bên phải (chọn chế độ: Global Timed Release / theo timezone từng khu vực).

| Field | Loại | Bắt buộc | Ghi chú |
|---|---|---|---|
| Release Date | DateTime picker `dd/mm/yyyy, hh:mm` | ✅ | Hiển thị dạng đọc bên dưới: "9 July 2026 at 16:30" |
| Original Release Date | DateTime picker | ✅ | Cho nhạc tái phát hành |
| Pre-order Date | DateTime picker | ❌ | Phải **trước** Release Date |

### 5.4. Release Dates by Provider
> *"Per-provider dates from Distribution settings"* — nút **⚙ Manage** bên phải.

Bảng ngày phát hành riêng theo từng kênh (nếu website có nhiều nền tảng con / kênh phân phối):

| Provider | Release Date | Original Release | Pre-order |
|---|---|---|---|
| YouTube CID & YouTube Music | 09/07/2026 | 09/07/2026 | – |

*Phase 1 có thể chỉ có 1 provider là chính website; giữ cấu trúc bảng để mở rộng.*

### 5.5. Contributors
> *"Artists and their roles on this release"* — link **Expand all** bên phải.

Danh sách các **role group**, mỗi group là 1 card collapse/expand:

| Role | Bắt buộc | Ghi chú |
|---|---|---|
| **Main artist** | ✅ (≥1) | |
| Featured artist | ❌ | |
| **Composer** | ✅ (≥1) | Người sáng tác |
| **Lyricist** | ✅ (≥1) | Người viết lời |
| **Music publisher** | ✅ (≥1) | |
| **Producer** | ✅ (≥1) | |
| **Mixer** | ✅ (≥1) | |
| Remixer | ❌ | |
| Performer | ❌ | |

Mỗi role group có:
- **Badge số lượng** artist đã thêm (badge cam nhỏ cạnh tên role).
- Nút **+ Add** → mở modal tìm kiếm artist từ bảng `artists` (hoặc tạo nhanh artist mới).
- Menu `⋮` cấp group: xóa tất cả, copy từ role khác…
- Mỗi artist là 1 row: avatar + tên + handle kéo thả `⠿` (**drag & drop đổi thứ tự**) + menu `⋮` (Remove, xem profile).

### 5.6. Copyrights (cột trái)
> *"Copyright and rights holder information"*

| Field | Loại | Bắt buộc |
|---|---|---|
| C-Line Text (©) | Text | ✅ |
| C-Line Year | Number (4 chữ số) | ✅ |
| P-Line Text (℗) | Text | ✅ |
| P-Line Year | Number | ✅ |
| Right Holder | Text | ✅ |

### 5.7. Product Details (cột phải)
> *"Identifiers, pricing, and mastering information"*

| Field | Loại | Bắt buộc | Ghi chú |
|---|---|---|---|
| UPC Code | Text (12–13 số) | ❌ | Auto-generate nếu để trống khi publish |
| Catalog Number | Text | ❌ | |
| Release Price Tier | Select có nút clear `×` | ❌ | Ví dụ: `Digital45` |
| Track Price Tier | Select có nút clear `×` | ❌ | Ví dụ: `Front` |
| Mastered By | Text | ❌ | |

### 5.8. Tùy chọn cuối form

| Checkbox | Mô tả |
|---|---|
| **Compilation (Multiartist)** | *"This Release is a multiartist compilation"* — bật khi album tổng hợp nhiều nghệ sĩ |
| **Migrated network** | Giống mục 3.2 — bật = nhập ISRC thủ công từng track |

---

## 6. Tab Tracks

**Route:** `/admin/products/{id}/tracks`

### 6.1. Danh sách track (table)

Toolbar phía trên: ô **Search…** (lọc theo title) + góc phải: nút 🔄 refresh, ⛶ fullscreen, ⚙ tùy chỉnh cột.

| Cột | Nội dung | Sort |
|---|---|---|
| **Title** | Tên track (đậm) + tên artist (nhỏ, xám, dòng dưới) | ↕ |
| **ISRC** | Mã ISRC, ví dụ `QT2WN2603106` | ↕ |
| **Type** | Badge định dạng file: `WAV` | ↕ |
| **Duration** | `3:12` | ↕ |
| **Size** | `48.501 MB` | ↕ |
| **State** | Badge trạng thái: `Uploaded` (xanh) / `Processing` / `Error` / `Missing file` | ↕ |
| (actions) | Nút **▶ Play** (preview audio ngay trong admin) + dropdown `▾` (Edit, Download, Replace file, Remove) | |

Footer: `Showing 1 to 15 of 15`.

### 6.2. Thêm track
- Nút **Add Track** (hoặc kéo-thả nhiều file audio vào vùng danh sách).
- Upload chấp nhận: **WAV** (bắt buộc, 16-bit/44.1kHz trở lên), kèm **FLAC** tùy chọn.
- ISRC: auto-generate theo prefix của label (ví dụ `QT2WN26xxxxx`) — trừ khi bật *Migrated network* thì nhập tay.
- Thứ tự track = số thứ tự trên tracklist, kéo thả để sắp xếp lại.

### 6.3. Track Detail (drill-down)

**Route:** `/admin/products/{id}/tracks/{trackId}`

Layout: **sidebar Tracklist bên trái** (danh sách 15 track, đánh số thứ tự, track đang chọn highlight cam, có nút thu gọn `‹`) + **panel chi tiết bên phải**.

Header panel chi tiết:
- Nút điều hướng `←` `→` chuyển track trước/sau + badge số thứ tự + Title + Artist + ISRC.
- Góc phải: indicator `1/15 ▾` (jump nhanh) · nút **▶ Play** · nút **🎬 Media Assets** · nút **🎤 Lyrics**.

#### a) Track Info
| Field | Loại | Ghi chú |
|---|---|---|
| Title | Text | |
| Title Version | Text ("e.g. Radio Edit") | |
| ISRC Code | Text | Readonly nếu auto-generate |
| Secondary ISRC | Text (Optional) | |
| Primary Genre | Select có clear `×` | Mặc định kế thừa từ product |
| Secondary Genre | Select | |
| Clip Start Time (seconds) | Number | Giây bắt đầu đoạn preview (mặc định 30) |

#### b) Languages & Content Advisory
- Audio Language (Select, clear được).
- Parental Advisory: 3 radio card giống product (None / Explicit / Explicit Content Edited).

#### c) Contributors (cấp track)
Giống hệt cấu trúc mục 5.5 nhưng áp dụng riêng cho track: Main artist* · Featured artist · Composer* · Lyricist* · Music publisher* · Producer* · Mixer* · Remixer · Performer. Mặc định **kế thừa từ product**, có thể override từng track.

#### d) Copyrights (cấp track)
C-Line Text (©) + Year · P-Line Text (℗) + Year · Right Holder — mặc định kế thừa từ product.

#### e) Instant Gratification
> *"Stream and download dates for pre-order instant grat tracks"* — track được nghe/tải trước ngày phát hành khi user pre-order.

- **Stream Date** (date picker) · **Download Date** (date picker).
- Banner cảnh báo khi chưa đủ điều kiện: `⚠ Instant Grat requires a pre-order date and future release date to be set in product metadata.` (2 field bị disable).

#### f) Media Assets
Card tóm tắt: `🎵 Media Assets — 2 files` + badge từng file `Wav ✓` `Flac ✓` + trạng thái `✓ All valid`. Click mở panel quản lý file: upload/replace/download từng định dạng, xem kết quả validate (sample rate, bit depth, silence check…).

#### g) Lyrics
Card màu vàng khi chưa có: `🎤 Lyrics — No lyrics added yet` → click mở editor nhập lời bài hát (plain text; mở rộng: synced lyrics LRC).

#### Hành động
Thanh sticky cuối trang: `Cancel` / **`Update`** (enable khi dirty).

---

## 7. Tab QC Check

Chạy bộ rule kiểm tra trước khi cho phép Publish. Hiển thị danh sách rule theo nhóm, mỗi rule có trạng thái ✅ Pass / ⚠ Warning / ❌ Error.

Rule tối thiểu:

| Nhóm | Rule | Mức |
|---|---|---|
| Metadata | Thiếu field bắt buộc (title, label, genre, dates, copyrights…) | ❌ |
| Metadata | Pre-order date ≥ Release date | ❌ |
| Cover art | Thiếu ảnh bìa / sai kích thước tối thiểu | ❌ |
| Contributors | Thiếu role bắt buộc (Main artist, Composer, Lyricist, Publisher, Producer, Mixer) | ❌ |
| Tracks | Product không có track nào | ❌ |
| Tracks | Track thiếu file audio / file invalid | ❌ |
| Tracks | Track thiếu ISRC (khi Migrated network) | ❌ |
| Tracks | Track chưa có lyrics | ⚠ |
| Tracks | Title trùng lặp trong tracklist | ⚠ |

- **Error (❌)** → chặn publish. **Warning (⚠)** → cho publish nhưng hiện đếm cảnh báo trên header (`⚠ 1 warning`).

## 8. Tab Releases

- Nút **Publish** (khi QC pass): đưa product hiển thị lên website nghe nhạc — đây là bước thay thế thao tác "đăng nhạc" cũ.
- Lịch sử phát hành: bảng các lần publish/update/takedown (thời gian, người thao tác, provider, trạng thái).
- Hành động: **Update release** (đẩy lại metadata sau khi sửa), **Takedown** (gỡ khỏi website).

---

## 9. Trạng thái Product (State machine)

```
Draft ──(QC pass + Publish)──▶ Published ──(Takedown)──▶ Taken Down
  ▲                                │
  └────────(Unpublish/sửa)─────────┘  (Published sửa qua "Request Changes")
```

| State | Badge | Ý nghĩa |
|---|---|---|
| `draft` | Xám | Đang soạn, chưa hiển thị trên web |
| `published` | Xanh lá | Đang hiển thị cho người nghe |
| `taken_down` | Đỏ | Đã gỡ |

---

## 10. Database Schema (gợi ý, SQL chuẩn chung)

```sql
-- Nhãn phát hành
CREATE TABLE labels (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(255) NOT NULL,
  isrc_prefix   VARCHAR(7),           -- ví dụ 'QT2WN'
  created_at    DATETIME, updated_at DATETIME
);

-- Nghệ sĩ
CREATE TABLE artists (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(255) NOT NULL,
  avatar_url    VARCHAR(500),
  spotify_id    VARCHAR(64) NULL,     -- mở rộng
  created_at    DATETIME, updated_at DATETIME
);

-- Product (đơn vị phát hành)
CREATE TABLE products (
  id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
  title                 VARCHAR(255) NOT NULL,
  title_version         VARCHAR(255) NULL,
  release_type          ENUM('single','ep','album','compilation') NOT NULL DEFAULT 'single',
  label_id              BIGINT NOT NULL REFERENCES labels(id),
  state                 ENUM('draft','published','taken_down') NOT NULL DEFAULT 'draft',
  cover_art_url         VARCHAR(500) NULL,
  primary_genre_id      BIGINT NULL,
  secondary_genre_id    BIGINT NULL,
  metadata_language     VARCHAR(10) NOT NULL DEFAULT 'en',
  audio_language        VARCHAR(10) NOT NULL DEFAULT 'en',
  parental_advisory     ENUM('none','explicit','explicit_edited') NOT NULL DEFAULT 'none',
  release_timing_mode   ENUM('global_gmt','per_timezone') DEFAULT 'global_gmt',
  release_date          DATETIME NOT NULL,
  original_release_date DATETIME NOT NULL,
  preorder_date         DATETIME NULL,
  c_line_text           VARCHAR(255), c_line_year SMALLINT,
  p_line_text           VARCHAR(255), p_line_year SMALLINT,
  right_holder          VARCHAR(255),
  upc_code              VARCHAR(14) NULL UNIQUE,
  catalog_number        VARCHAR(64) NULL,
  release_price_tier    VARCHAR(64) NULL,
  track_price_tier      VARCHAR(64) NULL,
  mastered_by           VARCHAR(255) NULL,
  is_compilation        BOOLEAN NOT NULL DEFAULT FALSE,
  is_migrated_network   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME, updated_at DATETIME, published_at DATETIME NULL
);

-- Track
CREATE TABLE tracks (
  id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position            INT NOT NULL,               -- thứ tự trong tracklist
  title               VARCHAR(255) NOT NULL,
  title_version       VARCHAR(255) NULL,
  isrc                VARCHAR(15) NULL UNIQUE,
  secondary_isrc      VARCHAR(15) NULL,
  primary_genre_id    BIGINT NULL,
  secondary_genre_id  BIGINT NULL,
  audio_language      VARCHAR(10) NULL,
  parental_advisory   ENUM('none','explicit','explicit_edited') DEFAULT 'none',
  clip_start_seconds  INT DEFAULT 30,
  duration_seconds    INT NULL,                   -- lấy từ file audio
  c_line_text VARCHAR(255), c_line_year SMALLINT,
  p_line_text VARCHAR(255), p_line_year SMALLINT,
  right_holder VARCHAR(255),
  instant_grat_stream_date   DATE NULL,
  instant_grat_download_date DATE NULL,
  lyrics              TEXT NULL,
  state               ENUM('pending','uploaded','processing','error') DEFAULT 'pending',
  created_at DATETIME, updated_at DATETIME
);

-- File audio của track (WAV/FLAC…)
CREATE TABLE track_media_assets (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  track_id     BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  format       ENUM('wav','flac','mp3') NOT NULL,
  file_url     VARCHAR(500) NOT NULL,
  file_size    BIGINT,                 -- bytes
  sample_rate  INT, bit_depth INT,
  is_valid     BOOLEAN DEFAULT NULL,   -- kết quả validate
  created_at   DATETIME,
  UNIQUE KEY uq_track_format (track_id, format)
);

-- Contributors dùng chung cho product & track (polymorphic)
CREATE TABLE contributors (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_type   ENUM('product','track') NOT NULL,
  owner_id     BIGINT NOT NULL,
  artist_id    BIGINT NOT NULL REFERENCES artists(id),
  role         ENUM('main_artist','featured_artist','composer','lyricist',
                    'music_publisher','producer','mixer','remixer','performer') NOT NULL,
  position     INT NOT NULL DEFAULT 0, -- thứ tự hiển thị (drag & drop)
  INDEX idx_owner (owner_type, owner_id)
);

-- Ngày phát hành theo provider/kênh
CREATE TABLE product_provider_dates (
  id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id            BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider              VARCHAR(100) NOT NULL,   -- 'website', 'youtube_music'…
  release_date          DATE, original_release_date DATE, preorder_date DATE NULL
);

-- Genre & Tag
CREATE TABLE genres (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100) NOT NULL);
CREATE TABLE tags   (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100) NOT NULL);
CREATE TABLE product_tags (
  product_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
  tag_id     BIGINT REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (product_id, tag_id)
);

-- Lịch sử phát hành
CREATE TABLE product_releases (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  action      ENUM('publish','update','takedown') NOT NULL,
  provider    VARCHAR(100) NOT NULL DEFAULT 'website',
  status      ENUM('pending','success','failed') NOT NULL,
  actor_id    BIGINT NULL,             -- admin user thực hiện
  created_at  DATETIME
);
```

---

## 11. API Endpoints (REST, gợi ý)

### Products
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/admin/products` | Danh sách + filter (state, label, search) + phân trang |
| POST | `/api/admin/products` | Tạo product (body: title, title_version, release_type, label_id, is_migrated_network) |
| GET | `/api/admin/products/{id}` | Chi tiết đầy đủ (kèm contributors, provider dates) |
| PATCH | `/api/admin/products/{id}` | Cập nhật metadata |
| DELETE | `/api/admin/products/{id}` | Xóa (chỉ khi `draft`) |
| POST | `/api/admin/products/{id}/cover` | Upload ảnh bìa (multipart) |
| GET | `/api/admin/products/{id}/qc` | Chạy & trả kết quả QC Check |
| POST | `/api/admin/products/{id}/publish` | Publish (chặn nếu QC error) |
| POST | `/api/admin/products/{id}/takedown` | Gỡ khỏi website |
| GET | `/api/admin/products/{id}/releases` | Lịch sử phát hành |

### Tracks
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/admin/products/{id}/tracks` | Danh sách track (sort, search) |
| POST | `/api/admin/products/{id}/tracks` | Tạo track (metadata) |
| PATCH | `/api/admin/tracks/{trackId}` | Cập nhật track |
| DELETE | `/api/admin/tracks/{trackId}` | Xóa track |
| PUT | `/api/admin/products/{id}/tracks/reorder` | Body: mảng track_id theo thứ tự mới |
| POST | `/api/admin/tracks/{trackId}/assets` | Upload file audio (multipart, format=wav\|flac) → validate + trích duration |
| GET | `/api/admin/tracks/{trackId}/assets` | Danh sách media assets + trạng thái valid |
| GET | `/api/admin/tracks/{trackId}/stream` | Stream preview trong admin (nút Play) |
| PUT | `/api/admin/tracks/{trackId}/lyrics` | Lưu lyrics |

### Contributors / Danh mục
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/admin/artists?search=` | Tìm artist cho modal Add contributor |
| POST | `/api/admin/artists` | Tạo nhanh artist |
| POST | `/api/admin/{product\|track}/{id}/contributors` | Thêm contributor (artist_id, role) |
| DELETE | `/api/admin/contributors/{id}` | Xóa contributor |
| PUT | `/api/admin/{product\|track}/{id}/contributors/reorder` | Đổi thứ tự |
| GET | `/api/admin/labels`, `/api/admin/genres`, `/api/admin/tags` | Danh mục cho select |

---

## 12. Validation Rules (tổng hợp)

1. **Create Product:** `title` ≠ rỗng; `release_type` ∈ enum; `label_id` tồn tại.
2. **Metadata Save:** đủ các field có dấu `*` ở mục 5; `c_line_year`/`p_line_year` là năm hợp lệ (1900–năm hiện tại+1); UPC nếu nhập phải 12–13 chữ số và unique.
3. **Dates:** `preorder_date < release_date`; `original_release_date ≤ release_date` (cho phép bằng).
4. **Contributors:** mỗi role bắt buộc ≥ 1; không trùng (artist, role) trong cùng owner.
5. **ISRC:** format `CC-XXX-YY-NNNNN` (bỏ dấu gạch khi lưu, 12 ký tự); unique toàn hệ thống; auto-generate từ `labels.isrc_prefix` + năm 2 số + số tăng dần, trừ khi `is_migrated_network = true`.
6. **Audio:** WAV bắt buộc trước khi publish; validate sample rate ≥ 44.1kHz, bit depth ≥ 16; `duration_seconds` trích tự động từ file.
7. **Instant Grat:** chỉ cho nhập khi product có `preorder_date` và `release_date` trong tương lai; `stream/download date` nằm trong khoảng [preorder_date, release_date].
8. **Publish:** toàn bộ QC rule mức Error phải pass.

---

## 13. Ghi chú UI/UX

- **Màu chủ đạo action:** nút primary màu cam (`Create`, `Save`, `Update`, `Publish`); state được chọn (radio card, sidebar item, track active) highlight nền cam nhạt + viền/chữ cam.
- **Sticky action bar** (Cancel/Save) nổi cố định dưới cùng khi form dirty; Save/Update disable khi chưa có thay đổi.
- Field bắt buộc đánh dấu `*` đỏ; dưới date input hiển thị dòng human-readable ("9 July 2026 at 16:30").
- Select có icon `×` để clear giá trị + `▾` mở dropdown; select dài (label, artist, genre) hỗ trợ search.
- Collapse/expand cho từng role group Contributors + link "Expand all".
- Toggle layout **Compact ↔ Comfortable** (2 cột ↔ 1 cột) lưu theo preference user.
- Warning tổng (`⚠ 1 warning`) luôn hiển thị cạnh thanh tab, click điều hướng tới QC Check.
- Track detail có phím điều hướng `←/→` chuyển track nhanh không cần quay lại danh sách.

---

## 14. Kế hoạch triển khai (đề xuất)

| Phase | Nội dung | Ưu tiên |
|---|---|---|
| **1** | Schema DB + CRUD Product (Create form, Metadata tab, Save) + sidebar mới | Cao |
| **2** | Tab Tracks: upload WAV/FLAC, auto ISRC, track detail, play preview, reorder | Cao |
| **3** | Contributors + Copyrights (product & track) + cover art manage | Cao |
| **4** | QC Check + state machine + tab Releases (Publish/Takedown lên website) | Cao |
| **5** | Instant Gratification, Lyrics, Release Dates by Provider, Tags, Request Changes | Trung bình |
| **6** | Gỡ bỏ hoàn toàn module "Upload nhạc" cũ, migrate dữ liệu nhạc cũ thành Products (mỗi bài cũ → 1 product `single` + 1 track, bật cờ `is_migrated_network` nếu cần giữ ISRC) | Sau khi 1–4 ổn định |

---

*Hết tài liệu. Mọi field/section trong spec được đối chiếu trực tiếp từ ảnh chụp hệ thống tham khảo (LabelMaster — Ohene Media).*
