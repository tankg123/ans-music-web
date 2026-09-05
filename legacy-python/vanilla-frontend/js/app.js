/* ANS Music — SPA: router, views, player UI, context menu, modals */
import { api, auth, getProfile, updateProfile, uploadAvatar, changePassword,
         twofaSetup, twofaEnable, twofaDisable } from './api.js?v=2.1.0';
import { player } from './player.js?v=2.1.0';
import { getPeaks, peaksInCache, drawWave, drawWavePlaceholder,
         fractionFromEvent } from './waveform.js?v=2.1.0';

const view = document.getElementById('view');

/* ============================================================
   I18N — song ngữ VI/EN (nút chuyển ở góc trái dưới sidebar)
   ============================================================ */
const I18N = {
  vi: {
    nav_home: 'Trang chủ', nav_home_s: 'Trang chủ', nav_search: 'Tìm kiếm',
    nav_charts: 'Bảng xếp hạng', nav_charts_s: 'BXH', nav_albums: 'Album mới',
    nav_tracks: 'Tất cả bài hát', nav_genres: 'Thể loại', nav_library: 'Thư viện',
    my_playlists: 'Playlist của tôi', queue: 'Hàng đợi phát',
    search_ph: 'Bài hát, nghệ sĩ, album… (Ctrl+K)',
    greet_m: 'Chào buổi sáng', greet_a: 'Chào buổi chiều', greet_e: 'Chào buổi tối',
    hero_tag: 'Phát hành mới nổi bật', listen_now: 'Nghe ngay', view_album: 'Xem album',
    recently: 'Nghe gần đây', new_releases: 'Mới phát hành', trending: 'Thịnh hành tuần này',
    view_chart: 'Xem BXH →', editors: 'Playlist tuyển chọn', hot_artists: 'Nghệ sĩ nổi bật',
    genres: 'Thể loại', songs: 'Bài hát', albums: 'Album', artists: 'Nghệ sĩ',
    playlists: 'Playlist', tracks_unit: 'bài hát', login: 'Đăng nhập',
    charts_title: '🏆 Bảng xếp hạng', charts_sub: 'Những bài hát được nghe nhiều nhất trên ANS Music.',
    period_week: 'Tuần này', period_month: 'Tháng này', period_all: 'Mọi thời đại',
    library: 'Thư viện', tab_playlists: 'Playlist', tab_liked: 'Đã thích',
    tab_albums: 'Album', tab_artists: 'Nghệ sĩ', tab_history: 'Lịch sử nghe',
    all_albums: '💿 Album mới', albums_sub: 'album — mới phát hành xếp trước.',
    all_tracks: '🎵 Tất cả bài hát', genres_title: '🏷 Thể loại',
    genres_sub: 'Duyệt kho nhạc theo thể loại yêu thích của bạn.',
    sort_new: 'Mới nhất', sort_top: 'Nghe nhiều', sort_az: 'A–Z',
    dl_album: 'Tải album', follow: 'Theo dõi', following: '✓ Đang theo dõi',
    listens: 'lượt nghe', followers: 'người theo dõi',
    search_title: 'Tìm kiếm', search_sub: 'Nhập tên bài hát, nghệ sĩ, album… Hỗ trợ tiếng Việt không dấu.',
    browse_genres: 'Duyệt theo thể loại', no_results: 'Không tìm thấy kết quả cho',
    no_results_sub: 'Kiểm tra chính tả hoặc thử từ khóa khác.',
    login_next: 'Đăng nhập để tiếp tục',
    login_next_sub: 'Thích bài hát, tạo playlist, theo dõi nghệ sĩ và đồng bộ lịch sử nghe trên mọi thiết bị.',
    create_account: 'Tạo tài khoản miễn phí', later: 'Để sau',
    lib_login: 'Đăng nhập để xem thư viện',
    lib_login_sub: 'Lưu bài hát yêu thích, album, nghệ sĩ và playlist của riêng bạn.',
    det_title: 'Thông tin chi tiết', det_label: 'Hãng phát hành',
    det_release_date: 'Ngày phát hành', det_genre: 'Thể loại',
    det_duration: 'Thời lượng', det_language: 'Ngôn ngữ',
    det_plays: 'Lượt nghe', det_album: 'Album',
    det_type: 'Loại phát hành', det_main_artist: 'Nghệ sĩ chính',
    det_error: 'Không tải được thông tin bài hát', close: 'Đóng',
    profile_title: 'Hồ sơ của tôi',
    profile_login: 'Đăng nhập để xem hồ sơ',
    profile_verified: 'Đã xác thực',
    profile_member_since: 'Thành viên từ',
    profile_role_user: 'Người nghe', profile_role_uploader: 'Uploader',
    profile_role_manager: 'Manager', profile_role_admin: 'Admin',
    profile_stat_playlists: 'Playlist', profile_stat_likes: 'Bài đã thích',
    profile_stat_follows: 'Đang theo dõi', profile_stat_plays: 'Lượt nghe',
    profile_edit_name: 'Sửa tên hiển thị',
    profile_name_saved: 'Đã cập nhật tên hiển thị',
    profile_name_empty: 'Tên hiển thị không được để trống',
    profile_avatar_btn: 'Đổi ảnh đại diện',
    profile_avatar_saved: 'Đã cập nhật ảnh đại diện',
    profile_avatar_max: 'Ảnh tối đa 5MB',
    profile_save: 'Lưu', profile_cancel: 'Hủy',
    profile_change_pass: 'Đổi mật khẩu',
    profile_cur_pass: 'Mật khẩu hiện tại', profile_new_pass: 'Mật khẩu mới',
    profile_new_pass2: 'Nhập lại mật khẩu mới',
    profile_pass_min: 'Mật khẩu mới tối thiểu 6 ký tự',
    profile_pass_mismatch: 'Mật khẩu nhập lại không khớp',
    profile_pass_saved: 'Đã đổi mật khẩu',
    profile_2fa_title: 'Bảo mật — Xác thực 2 lớp (2FA)',
    profile_2fa_desc: 'Bảo vệ tài khoản bằng mã 6 số từ ứng dụng Google Authenticator mỗi khi đăng nhập.',
    profile_2fa_setup: 'Thiết lập 2FA',
    profile_2fa_on: 'Đang bật',
    profile_2fa_active_desc: 'Tài khoản của bạn đang được bảo vệ 2 lớp. Mỗi lần đăng nhập cần thêm mã 6 số từ ứng dụng xác thực.',
    profile_2fa_off_btn: 'Tắt 2FA',
    profile_2fa_off_desc: 'Nhập mật khẩu và mã 6 số hiện tại để tắt xác thực 2 lớp.',
    profile_2fa_step1: 'Cài ứng dụng Google Authenticator (hoặc Authy, 1Password…) trên điện thoại.',
    profile_2fa_step2: 'Quét mã QR bên dưới — hoặc nhập mã bí mật thủ công vào ứng dụng.',
    profile_2fa_step3: 'Nhập mã 6 số hiện trong ứng dụng rồi bấm “Kích hoạt”.',
    profile_2fa_shown_in_app: 'Tên hiển thị trong ứng dụng',
    profile_2fa_secret: 'Mã bí mật (nhập tay)',
    profile_2fa_copy: 'Sao chép', profile_2fa_copied: 'Đã sao chép mã bí mật',
    profile_2fa_code_ph: 'Mã 6 số',
    profile_2fa_activate: 'Kích hoạt',
    profile_2fa_enabled_toast: 'Đã bật xác thực 2 lớp',
    profile_2fa_disabled_toast: 'Đã tắt xác thực 2 lớp',
  },
  en: {
    nav_home: 'Home', nav_home_s: 'Home', nav_search: 'Search',
    nav_charts: 'Charts', nav_charts_s: 'Charts', nav_albums: 'New Albums',
    nav_tracks: 'All Tracks', nav_genres: 'Genres', nav_library: 'Library',
    my_playlists: 'My Playlists', queue: 'Play Queue',
    search_ph: 'Songs, artists, albums… (Ctrl+K)',
    greet_m: 'Good morning', greet_a: 'Good afternoon', greet_e: 'Good evening',
    hero_tag: 'Featured new release', listen_now: 'Listen now', view_album: 'View album',
    recently: 'Recently played', new_releases: 'New releases', trending: 'Trending this week',
    view_chart: 'View charts →', editors: "Editor's picks", hot_artists: 'Featured artists',
    genres: 'Genres', songs: 'Songs', albums: 'Albums', artists: 'Artists',
    playlists: 'Playlists', tracks_unit: 'tracks', login: 'Log in',
    charts_title: '🏆 Charts', charts_sub: 'The most played songs on ANS Music.',
    period_week: 'This week', period_month: 'This month', period_all: 'All time',
    library: 'Library', tab_playlists: 'Playlists', tab_liked: 'Liked',
    tab_albums: 'Albums', tab_artists: 'Artists', tab_history: 'History',
    all_albums: '💿 New Albums', albums_sub: 'albums — newest first.',
    all_tracks: '🎵 All Tracks', genres_title: '🏷 Genres',
    genres_sub: 'Browse the catalog by your favorite genre.',
    sort_new: 'Newest', sort_top: 'Most played', sort_az: 'A–Z',
    dl_album: 'Download', follow: 'Follow', following: '✓ Following',
    listens: 'plays', followers: 'followers',
    search_title: 'Search', search_sub: 'Type a song, artist or album name…',
    browse_genres: 'Browse by genre', no_results: 'No results for',
    no_results_sub: 'Check the spelling or try another keyword.',
    login_next: 'Log in to continue',
    login_next_sub: 'Like songs, build playlists, follow artists and sync your history everywhere.',
    create_account: 'Create a free account', later: 'Maybe later',
    lib_login: 'Log in to see your library',
    lib_login_sub: 'Save your favorite songs, albums, artists and playlists.',
    det_title: 'Track details', det_label: 'Record Label',
    det_release_date: 'Release date', det_genre: 'Genre',
    det_duration: 'Duration', det_language: 'Language',
    det_plays: 'Plays', det_album: 'Album',
    det_type: 'Release type', det_main_artist: 'Main artist',
    det_error: "Couldn't load track details", close: 'Close',
    profile_title: 'My Profile',
    profile_login: 'Log in to view your profile',
    profile_verified: 'Verified',
    profile_member_since: 'Member since',
    profile_role_user: 'Listener', profile_role_uploader: 'Uploader',
    profile_role_manager: 'Manager', profile_role_admin: 'Admin',
    profile_stat_playlists: 'Playlists', profile_stat_likes: 'Liked songs',
    profile_stat_follows: 'Following', profile_stat_plays: 'Plays',
    profile_edit_name: 'Edit display name',
    profile_name_saved: 'Display name updated',
    profile_name_empty: 'Display name cannot be empty',
    profile_avatar_btn: 'Change avatar',
    profile_avatar_saved: 'Avatar updated',
    profile_avatar_max: 'Image must be 5MB or less',
    profile_save: 'Save', profile_cancel: 'Cancel',
    profile_change_pass: 'Change password',
    profile_cur_pass: 'Current password', profile_new_pass: 'New password',
    profile_new_pass2: 'Confirm new password',
    profile_pass_min: 'New password must be at least 6 characters',
    profile_pass_mismatch: 'Passwords do not match',
    profile_pass_saved: 'Password changed',
    profile_2fa_title: 'Security — Two-factor authentication (2FA)',
    profile_2fa_desc: 'Protect your account with a 6-digit code from the Google Authenticator app every time you log in.',
    profile_2fa_setup: 'Set up 2FA',
    profile_2fa_on: 'Enabled',
    profile_2fa_active_desc: 'Your account is protected with two-factor authentication. Each login requires an extra 6-digit code from your authenticator app.',
    profile_2fa_off_btn: 'Disable 2FA',
    profile_2fa_off_desc: 'Enter your password and the current 6-digit code to disable 2FA.',
    profile_2fa_step1: 'Install Google Authenticator (or Authy, 1Password…) on your phone.',
    profile_2fa_step2: 'Scan the QR code below — or type the secret key into the app manually.',
    profile_2fa_step3: 'Enter the 6-digit code shown in the app and press “Activate”.',
    profile_2fa_shown_in_app: 'Shown in the app as',
    profile_2fa_secret: 'Secret key (manual entry)',
    profile_2fa_copy: 'Copy', profile_2fa_copied: 'Secret key copied',
    profile_2fa_code_ph: '6-digit code',
    profile_2fa_activate: 'Activate',
    profile_2fa_enabled_toast: 'Two-factor authentication enabled',
    profile_2fa_disabled_toast: 'Two-factor authentication disabled',
  },
};
let lang = localStorage.getItem('ans_lang') || 'vi';
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.vi[k] || k;

/* nhãn vai trò nghệ sĩ (DDEX role) → tên hiển thị song ngữ */
const ROLE_LABELS = {
  vi: {
    MainArtist: 'Nghệ sĩ chính', FeaturedArtist: 'Nghệ sĩ hợp tác',
    Composer: 'Sáng tác', Lyricist: 'Viết lời', Producer: 'Sản xuất',
    Arranger: 'Hòa âm phối khí', Remixer: 'Phối lại', Conductor: 'Chỉ huy',
  },
  en: {
    MainArtist: 'Main artist', FeaturedArtist: 'Featured artist',
    Composer: 'Composer', Lyricist: 'Lyricist', Producer: 'Producer',
    Arranger: 'Arranger', Remixer: 'Remixer', Conductor: 'Conductor',
  },
};
const roleLabel = (r) => (ROLE_LABELS[lang] && ROLE_LABELS[lang][r]) || ROLE_LABELS.vi[r] || r;

/* tên ngôn ngữ bản địa hóa từ mã ISO ('vi' → 'Tiếng Việt') — lỗi thì trả nguyên giá trị */
function langName(code) {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([lang === 'vi' ? 'vi' : 'en'], { type: 'language' }).of(code) || code;
  } catch { return code; }
}

function applyLangChrome() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  const lbl = lang.toUpperCase();
  const l1 = document.getElementById('lang-label');
  const l2 = document.getElementById('lang-label-m');
  if (l1) l1.textContent = lbl;
  if (l2) l2.textContent = lbl;
}

function toggleLang() {
  lang = lang === 'vi' ? 'en' : 'vi';
  localStorage.setItem('ans_lang', lang);
  applyLangChrome();
  renderAuthArea();
  route();               // render lại trang hiện tại bằng ngôn ngữ mới
}

/* ============================================================
   TIỆN ÍCH
   ============================================================ */
const h = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const fmtDur = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtLong = (ms) => {
  const m = Math.floor((ms || 0) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
};
const fmtCount = (n) => (n || 0).toLocaleString('vi-VN');
/* 'YYYY-MM-DD' → ngày dạng dài theo ngôn ngữ UI; không parse được thì trả nguyên chuỗi.
   Parse thủ công theo GIỜ ĐỊA PHƯƠNG — new Date('YYYY-MM-DD') hiểu là UTC nên
   người xem ở múi giờ âm sẽ thấy lệch -1 ngày. */
const fmtDate = (d) => {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
  return isNaN(dt) ? String(d)
    : dt.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB',
        { day: 'numeric', month: 'long', year: 'numeric' });
};

const artistLinks = (artists) => (artists || [])
  .map(a => `<a href="#/artist/${a.id}" data-stop>${h(a.name)}</a>`).join(', ')
  || '<span>Không rõ</span>';

function toast(msg, isErr = false) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function icon(name, size = 17) {
  return `<svg style="width:${size}px;height:${size}px"><use href="#${name}"/></svg>`;
}

/* icon ⓘ inline (sprite index.html chưa có i-info — không sửa file ngoài phạm vi) */
function infoIconSvg(size = 17) {
  return `<svg viewBox="0 0 24 24" style="width:${size}px;height:${size}px">
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-1 3.2h2v2.1h-2V7.2zm0 3.9h2V17h-2v-5.9z"/></svg>`;
}

/* ============================================================
   BRAND — tiêm từ server (window.ANS_CFG.brand), áp dụng ngay khi tải
   ============================================================ */
const BRAND = (window.ANS_CFG && window.ANS_CFG.brand) || {};

function applyBrand() {
  const b = BRAND;
  const name = b.brand_name || 'ANS Music';
  const logo = b.brand_logo_url || '/static/img/logo.svg';
  // màu accent thương hiệu = màu nền mặc định (per-track vẫn override khi phát)
  if (b.brand_accent && /^#[0-9a-fA-F]{6}$/.test(b.brand_accent)) {
    document.documentElement.style.setProperty('--accent', b.brand_accent);
    document.documentElement.style.setProperty('--accent-soft', hexSoft(b.brand_accent));
  }
  document.title = `${name} — ${b.brand_tagline || 'Nghe nhạc trực tuyến'}`;
  const brandEl = document.querySelector('#sidebar .brand');
  if (brandEl) {
    brandEl.innerHTML =
      `<img src="${logo}" alt="${h(name)}" width="34" height="34">` +
      `<span>${b.brand_short ? `${h(b.brand_short)} <b>${h(b.brand_suffix || '')}</b>` : h(name)}</span>`;
  }
  const fav = document.querySelector('link[rel="icon"]');
  if (fav && logo) fav.href = logo;
}

/* ============================================================
   REGISTRY DANH SÁCH TRACK (cho play-from-list & context menu)
   ============================================================ */
const listRegistry = new Map();
let listSeq = 0;
function registerList(tracks, source) {
  const id = `L${++listSeq}`;
  listRegistry.set(id, { tracks, source });
  return id;
}

/* ============================================================
   RENDER TRACK LIST
   ============================================================ */
function trackListHtml(tracks, opts = {}) {
  const { showAlbum = true, showPlays = false, rank = false, source = null,
          playlistId = null, isOwner = false, showDetails = false } = opts;
  const listId = registerList(tracks, source);
  const infoTitle = t('det_title');   // tính trước — trong map() biến t là track
  const head = `
    <div class="tl-head">
      <span style="text-align:center">#</span><span>Tiêu đề</span>
      ${showAlbum ? '<span class="th-album">Album</span>'
                  : `<span class="th-album">${showDetails ? 'ISRC' : ''}</span>`}
      <span class="th-wave"></span>
      <span class="th-plays" style="text-align:right">${showPlays ? 'Lượt nghe' : ''}</span>
      <span class="th-clock" style="text-align:right">${icon('i-clock', 15)}</span>
    </div>`;
  const rows = tracks.map((t, i) => {
    const cur = player.current && player.current.id === t.id;
    const num = rank
      ? `<span class="rank-num ${i < 3 ? 'top' : ''}">${i + 1}</span>`
      : `<span>${t.track_no || i + 1}</span>`;
    return `
    <div class="track-row ${cur ? 'playing' : ''}" data-list="${listId}" data-idx="${i}" data-track="${t.id}">
      <div class="tr-idx">
        ${cur && player.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : num}
        <span class="tr-play-hover">${icon('i-play')}</span>
      </div>
      <div class="tr-main">
        <img src="${t.cover_url || '/static/img/logo.svg'}" alt="" loading="lazy">
        <div class="tr-text">
          <div class="tr-title">${h(t.title)}${t.explicit ? '<span class="badge-e">E</span>' : ''}</div>
          <div class="tr-artists">${artistLinks(t.artists)}</div>
        </div>
      </div>
      <div class="tr-album">${showAlbum && t.release
        ? `<a href="#/album/${t.release.id}" data-stop>${h(t.release.title)}</a>`
        : (showDetails && t.isrc ? `<span class="tr-isrc" title="ISRC">${h(t.isrc)}</span>` : '')}</div>
      <canvas class="tr-wave${t.has_audio ? '' : ' empty'}" data-track="${t.id}" title="Bấm vào sóng để phát từ vị trí đó"></canvas>
      <div class="tr-plays">${showPlays ? fmtCount(t.period_plays ?? t.play_count) : ''}</div>
      <div class="tr-end">
        <button class="icon-btn tr-like ${t.liked ? 'on like-btn' : ''}" data-stop title="Thích">
          ${icon(t.liked ? 'i-heart-f' : 'i-heart')}
        </button>
        ${showDetails ? `<button class="icon-btn tr-info" data-stop title="${h(infoTitle)}">${infoIconSvg()}</button>` : ''}
        ${t.has_audio ? `<button class="icon-btn tr-dl" data-stop title="Tải WAV">${icon('i-download')}</button>` : ''}
        <span class="tr-dur">${fmtDur(t.duration_ms)}</span>
        <button class="icon-btn tr-more" data-stop data-playlist="${playlistId || ''}" data-owner="${isOwner ? 1 : ''}" title="Tùy chọn khác">${icon('i-dots')}</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="tracklist">${head}${rows}</div>`;
}

/* ============================================================
   CARDS
   ============================================================ */
const releaseCard = (r) => `
  <div class="card" data-href="#/album/${r.id}">
    <div class="card-cover">
      <img src="${r.cover_url || '/static/img/logo.svg'}" alt="" loading="lazy">
      <button class="card-play" data-play-release="${r.id}" data-stop title="Phát">${icon('i-play', 20)}</button>
    </div>
    <div class="card-title">${h(r.title)}</div>
    <div class="card-sub">${h(r.release_type)} · ${(r.artists || []).map(a => h(a.name)).join(', ')}</div>
  </div>`;

const playlistCard = (p) => `
  <div class="card" data-href="#/playlist/${p.id}">
    <div class="card-cover">
      <img src="${p.cover_url || '/static/img/logo.svg'}" alt="" loading="lazy">
      <button class="card-play" data-play-playlist="${p.id}" data-stop title="Phát">${icon('i-play', 20)}</button>
    </div>
    <div class="card-title">${h(p.title)}</div>
    <div class="card-sub">Playlist · ${p.track_count} bài</div>
  </div>`;

const artistCard = (a) => `
  <div class="card" data-href="#/artist/${a.id}">
    <div class="card-cover round">
      <img src="${a.image_url || '/static/img/logo.svg'}" alt="" loading="lazy">
      <button class="card-play" data-play-artist="${a.id}" data-stop title="Phát">${icon('i-play', 20)}</button>
    </div>
    <div class="card-title">${h(a.name)}</div>
    <div class="card-sub">Nghệ sĩ</div>
  </div>`;

const skeletonCards = (n = 6) =>
  `<div class="card-row">${Array(n).fill('<div class="skeleton sk-card"></div>').join('')}</div>`;
const skeletonRows = (n = 8) =>
  Array(n).fill('<div class="skeleton sk-row"></div>').join('');

/* ============================================================
   ROUTER
   ============================================================ */
const routes = {
  home: renderHome, search: renderSearch, charts: renderCharts,
  album: renderAlbum, artist: renderArtist, playlist: renderPlaylist,
  genre: renderGenre, genres: renderGenres, albums: renderAlbums,
  tracks: renderTracks, library: renderLibrary, profile: renderProfile,
};

let navToken = 0;
async function route() {
  const hash = location.hash.slice(2) || '';
  const [name, ...rest] = hash.split('/');
  const routeName = name || 'home';
  const fn = routes[routeName] || renderHome;
  const token = ++navToken;

  document.querySelectorAll('[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === routeName);
  });
  listRegistry.clear();
  listSeq = 0;
  view.scrollTop = 0;

  try {
    await fn(rest.map(decodeURIComponent), token);
  } catch (e) {
    if (token !== navToken) return;
    view.innerHTML = `<div class="empty-state">${icon('i-music', 52)}
      <h3>Có lỗi xảy ra</h3><p>${h(e.message)}</p></div>`;
  }
}
const stale = (token) => token !== navToken;

/* ============================================================
   VIEW: TRANG CHỦ
   ============================================================ */
async function renderHome(_, token) {
  view.innerHTML = `<div class="skeleton sk-hero"></div><div class="section">${skeletonCards()}</div>`;
  const data = await api.get('/v1/home');
  if (stale(token)) return;

  const hour = new Date().getHours();
  const greet = hour < 12 ? t('greet_m') : hour < 18 ? t('greet_a') : t('greet_e');
  const userName = auth.user ? `, ${auth.user.display_name}` : '';

  // ---------- HERO 3D: release nổi bật + vòng xoay album ----------
  const featured = data.new_releases[0];
  const ringItems = data.new_releases.slice(0, 8);
  const angleStep = 360 / Math.max(ringItems.length, 1);
  let html = '';
  if (featured) {
    html += `
    <section class="hero3d" style="--accent:${featured.accent || 'var(--accent)'};--accent-soft:${hexSoft(featured.accent)}">
      <div class="hero3d-info">
        <span class="hero3d-tag">${t('hero_tag')}</span>
        <h1>${h(featured.title)}</h1>
        <div class="hero3d-artists">${artistLinks(featured.artists)}
          · ${h(featured.release_type)} · ${featured.track_count} ${t('tracks_unit')}</div>
        <div class="hero3d-actions">
          <button class="play-big" data-play-release="${featured.id}" title="${t('listen_now')}">${icon('i-play', 24)}</button>
          <a class="btn btn-ghost" href="#/album/${featured.id}">${t('view_album')}</a>
        </div>
      </div>
      <div class="carousel3d" aria-hidden="false">
        <div class="ring">
          ${ringItems.map((r, i) => `
            <a href="#/album/${r.id}" style="--a:${Math.round(i * angleStep)}deg" title="${h(r.title)}">
              <img src="${r.cover_url}" alt="${h(r.title)}" loading="lazy">
            </a>`).join('')}
        </div>
      </div>
    </section>`;

    // dải bìa chạy ngang vô tận (nhân đôi để nối liền mạch)
    const mq = [...data.new_releases, ...data.new_releases];
    html += `
    <div class="cover-marquee" aria-hidden="true">
      <div class="mq-track">
        ${mq.map(r => `<a href="#/album/${r.id}" tabindex="-1"><img src="${r.cover_url}" alt="" loading="lazy"></a>`).join('')}
      </div>
    </div>`;
  }

  html += `<h1 class="page-title" style="margin-top:30px">${greet}${h(userName)} 👋</h1>`;

  if (data.recently_played.length) {
    html += `<div class="section"><div class="section-head"><h2>${t('recently')}</h2></div>
      ${trackListHtml(data.recently_played.slice(0, 5), { source: 'recent' })}</div>`;
  }

  html += `<div class="section"><div class="section-head"><h2>${t('new_releases')}</h2>
      <a href="#/albums">${t('nav_albums')} →</a></div>
    <div class="card-row">${data.new_releases.map(releaseCard).join('')}</div></div>`;

  html += `<div class="section"><div class="section-head"><h2>${t('trending')}</h2>
      <a href="#/charts">${t('view_chart')}</a></div>
    ${trackListHtml(data.top_tracks.slice(0, 5), { showPlays: true, rank: true, source: 'home_top' })}</div>`;

  if (data.editorial_playlists.length) {
    html += `<div class="section"><div class="section-head"><h2>${t('editors')}</h2></div>
      <div class="card-row">${data.editorial_playlists.map(playlistCard).join('')}</div></div>`;
  }

  html += `<div class="section"><div class="section-head"><h2>${t('hot_artists')}</h2></div>
    <div class="card-row">${data.popular_artists.slice(0, 6).map(artistCard).join('')}</div></div>`;

  html += `<div class="section"><div class="section-head"><h2>${t('genres')}</h2></div>
    <div class="chip-row">${data.genres.map(g =>
      `<button class="chip" data-href="#/genre/${encodeURIComponent(g.name)}">${h(g.name)}</button>`).join('')}
    </div></div>`;

  view.innerHTML = html;
}

/* ============================================================
   VIEW: TẤT CẢ BÀI HÁT
   ============================================================ */
async function renderTracks(params, token) {
  const sort = params[0] || 'new';
  view.innerHTML = skeletonRows(10);
  const data = await api.get(`/v1/tracks?sort=${sort}&limit=200`);
  if (stale(token)) return;
  const sorts = { new: t('sort_new'), top: t('sort_top'), az: t('sort_az') };
  view.innerHTML = `
    <h1 class="page-title">${t('all_tracks')}</h1>
    <p class="page-sub">${fmtCount(data.total)} ${t('tracks_unit')}</p>
    <div class="sort-tabs">${Object.entries(sorts).map(([k, v]) =>
      `<button class="${k === sort ? 'on' : ''}" data-href="#/tracks/${k}">${v}</button>`).join('')}
    </div>
    ${trackListHtml(data.items, { showPlays: true, source: 'all_tracks' })}`;
}

/* ============================================================
   VIEW: TÌM KIẾM
   ============================================================ */
let searchTimer = null;
async function renderSearch(params, token) {
  const q = params[0] || '';
  const input = document.getElementById('global-search');
  // không ghi đè khi người dùng đang gõ/sửa trong ô tìm kiếm
  if (document.activeElement !== input && input.value !== q) input.value = q;

  if (!q) {
    const data = await api.get('/v1/home');
    if (stale(token)) return;
    view.innerHTML = `
      <h1 class="page-title">${t('search_title')}</h1>
      <p class="page-sub">${t('search_sub')}</p>
      <div class="section"><div class="section-head"><h2>${t('browse_genres')}</h2></div>
      <div class="chip-row">${data.genres.map(g =>
        `<button class="chip" data-href="#/genre/${encodeURIComponent(g.name)}">${h(g.name)}</button>`).join('')}</div></div>`;
    return;
  }

  view.innerHTML = skeletonRows(6);
  const data = await api.get(`/v1/search?q=${encodeURIComponent(q)}&limit=8`);
  if (stale(token)) return;

  const empty = !data.tracks.length && !data.releases.length
    && !data.artists.length && !data.playlists.length;
  if (empty) {
    view.innerHTML = `<div class="empty-state">${icon('i-search', 52)}
      <h3>${t('no_results')} “${h(q)}”</h3>
      <p>${t('no_results_sub')}</p></div>`;
    return;
  }

  let html = '';
  if (data.tracks.length) {
    html += `<div class="section"><div class="section-head"><h2>${t('songs')}</h2></div>
      ${trackListHtml(data.tracks, { source: 'search' })}</div>`;
  }
  if (data.artists.length) {
    html += `<div class="section"><div class="section-head"><h2>${t('artists')}</h2></div>
      <div class="card-row">${data.artists.map(artistCard).join('')}</div></div>`;
  }
  if (data.releases.length) {
    html += `<div class="section"><div class="section-head"><h2>${t('albums')}</h2></div>
      <div class="card-row">${data.releases.map(releaseCard).join('')}</div></div>`;
  }
  if (data.playlists.length) {
    html += `<div class="section"><div class="section-head"><h2>${t('playlists')}</h2></div>
      <div class="card-row">${data.playlists.map(playlistCard).join('')}</div></div>`;
  }
  view.innerHTML = html;
}

/* ============================================================
   VIEW: BXH
   ============================================================ */
async function renderCharts(params, token) {
  const period = params[0] || 'week';
  view.innerHTML = skeletonRows(10);
  const data = await api.get(`/v1/charts?period=${period}`);
  if (stale(token)) return;
  const labels = { week: t('period_week'), month: t('period_month'), all: t('period_all') };
  view.innerHTML = `
    <h1 class="page-title">${t('charts_title')}</h1>
    <p class="page-sub">${t('charts_sub')}</p>
    <div class="tabs">${Object.entries(labels).map(([k, v]) =>
      `<button class="${k === period ? 'on' : ''}" data-href="#/charts/${k}">${v}</button>`).join('')}
    </div>
    ${trackListHtml(data.items, { showPlays: true, rank: true, source: 'chart' })}`;
}

/* ============================================================
   VIEW: ALBUM
   ============================================================ */
async function renderAlbum(params, token) {
  view.innerHTML = '<div class="skeleton sk-hero"></div>' + skeletonRows(5);
  const r = await api.get(`/v1/albums/${params[0]}`);
  if (stale(token)) return;
  const year = (r.release_date || '').slice(0, 4);

  // ---- khối metadata chi tiết (nhãn–giá trị) dưới tiêu đề album ----
  const metaRow = (label, valueHtml, mono = false) => valueHtml
    ? `<div class="am-item"><span class="am-k">${h(label)}</span>
       <span class="am-v${mono ? ' mono' : ''}">${valueHtml}</span></div>`
    : '';
  const pcLine = [
    r.p_line ? (String(r.p_line).trim().startsWith('℗') ? r.p_line : `℗ ${r.p_line}`) : '',
    r.c_line ? (String(r.c_line).trim().startsWith('©') ? r.c_line : `© ${r.c_line}`) : '',
  ].filter(Boolean).join('  ·  ');
  const metaItems =
    metaRow(t('det_type'), r.release_type ? h(r.release_type) : '') +
    metaRow(t('det_main_artist'), (r.artists || []).length ? artistLinks(r.artists) : '') +
    metaRow(t('det_label'), r.label_name ? h(r.label_name) : '') +
    metaRow('UPC', r.upc ? h(r.upc) : '', true) +
    metaRow(t('det_release_date'), r.release_date ? h(fmtDate(r.release_date)) : '') +
    metaRow(t('det_genre'), r.genre ? h(r.genre) : '');
  const metaBlock = (metaItems || pcLine) ? `
    <div class="album-meta">${metaItems}
      ${pcLine ? `<div class="am-lines">${h(pcLine)}</div>` : ''}
    </div>` : '';

  view.innerHTML = `
    <div class="hero" style="--accent:${r.accent || 'var(--accent)'};--accent-soft:${hexSoft(r.accent)}">
      <img class="hero-cover" src="${r.cover_url}" alt="">
      <div class="hero-info">
        <div class="hero-type">${h(r.release_type)}</div>
        <h1>${h(r.title)}</h1>
        <div class="hero-meta">
          <b>${artistLinks(r.artists)}</b><span>·</span>
          <span>${year}</span><span>·</span>
          <span>${r.tracks.length} bài, ${fmtLong(r.total_duration_ms)}</span>
        </div>
        <div class="hero-actions">
          <button class="play-big" data-play-here title="Phát">${icon('i-play', 24)}</button>
          <button class="icon-btn like-btn ${r.liked ? 'on' : ''}" data-like-release="${r.id}" title="Lưu album">
            ${icon(r.liked ? 'i-heart-f' : 'i-heart', 22)}</button>
          <button class="btn btn-ghost" data-dl-album="${r.id}" title="ZIP WAV 44.1kHz">
            ${icon('i-download', 16)} ${t('dl_album')}</button>
        </div>
      </div>
    </div>
    ${metaBlock}
    ${trackListHtml(r.tracks, { showAlbum: false, showPlays: true, source: 'album', showDetails: true })}`;
  bindHeroPlay(r.tracks, 'album');
}

/* ============================================================
   VIEW: NGHỆ SĨ
   ============================================================ */
async function renderArtist(params, token) {
  view.innerHTML = '<div class="skeleton sk-hero"></div>' + skeletonRows(5);
  const a = await api.get(`/v1/artists/${params[0]}`);
  if (stale(token)) return;
  let html = `
    <div class="hero" style="--accent:${a.accent || 'var(--accent)'};--accent-soft:${hexSoft(a.accent)}">
      <img class="hero-cover round" src="${a.image_url}" alt="">
      <div class="hero-info">
        <div class="hero-type">Nghệ sĩ</div>
        <h1>${h(a.name)}</h1>
        <div class="hero-meta">
          <span><b>${fmtCount(a.total_plays)}</b> ${t('listens')}</span><span>·</span>
          <span><b>${fmtCount(a.followers)}</b> ${t('followers')}</span>
        </div>
        <div class="hero-actions">
          <button class="play-big" data-play-here title="Play">${icon('i-play', 24)}</button>
          <button class="btn btn-ghost" id="btn-follow">${a.following ? t('following') : t('follow')}</button>
        </div>
      </div>
    </div>`;

  if (a.top_tracks.length) {
    html += `<div class="section"><div class="section-head"><h2>Bài hát nổi bật</h2></div>
      ${trackListHtml(a.top_tracks, { showPlays: true, rank: true, source: 'artist' })}</div>`;
  }
  if (a.releases.length) {
    html += `<div class="section"><div class="section-head"><h2>Đĩa nhạc</h2></div>
      <div class="card-row">${a.releases.map(releaseCard).join('')}</div></div>`;
  }
  if (a.appears_on.length) {
    html += `<div class="section"><div class="section-head"><h2>Xuất hiện trong</h2></div>
      <div class="card-row">${a.appears_on.map(releaseCard).join('')}</div></div>`;
  }
  if (a.similar_artists.length) {
    html += `<div class="section"><div class="section-head"><h2>Nghệ sĩ tương tự</h2></div>
      <div class="card-row">${a.similar_artists.map(artistCard).join('')}</div></div>`;
  }
  if (a.bio) {
    html += `<div class="section"><div class="section-head"><h2>Giới thiệu</h2></div>
      <p class="page-sub" style="max-width:640px;line-height:1.7">${h(a.bio)}</p></div>`;
  }
  view.innerHTML = html;
  bindHeroPlay(a.top_tracks, 'artist');

  const followBtn = document.getElementById('btn-follow');
  if (followBtn) followBtn.onclick = async () => {
    if (!requireAuth()) return;
    try {
      if (a.following) { await api.del(`/v1/me/follows/${a.id}`); a.following = false; }
      else { await api.post(`/v1/me/follows/${a.id}`); a.following = true; }
      followBtn.textContent = a.following ? t('following') : t('follow');
      toast(a.following ? `Đang theo dõi ${a.name}` : `Đã bỏ theo dõi ${a.name}`);
    } catch (e) { toast(e.message, true); }
  };
}

/* ============================================================
   VIEW: PLAYLIST
   ============================================================ */
async function renderPlaylist(params, token) {
  view.innerHTML = '<div class="skeleton sk-hero"></div>' + skeletonRows(5);
  const p = await api.get(`/v1/playlists/${params[0]}`);
  if (stale(token)) return;
  const visLabel = { public: 'Công khai', private: 'Riêng tư', unlisted: 'Không công khai' }[p.visibility] || '';
  view.innerHTML = `
    <div class="hero" style="--accent:${p.accent || 'var(--accent)'};--accent-soft:${hexSoft(p.accent)}">
      <img class="hero-cover" src="${p.cover_url}" alt="">
      <div class="hero-info">
        <div class="hero-type">${p.is_editorial ? 'Playlist tuyển chọn' : 'Playlist'} · ${visLabel}</div>
        <h1>${h(p.title)}</h1>
        ${p.description ? `<p class="page-sub">${h(p.description)}</p>` : ''}
        <div class="hero-meta">
          <b>${h(p.owner_name || '')}</b><span>·</span>
          <span>${p.tracks.length} bài, ${fmtLong(p.total_duration_ms)}</span>
        </div>
        <div class="hero-actions">
          <button class="play-big" data-play-here title="Phát">${icon('i-play', 24)}</button>
          ${p.is_owner && !p.is_editorial ? `
            <button class="icon-btn" id="btn-pl-edit" title="Sửa playlist">${icon('i-edit', 20)}</button>
            <button class="icon-btn" id="btn-pl-del" title="Xóa playlist">${icon('i-trash', 20)}</button>` : ''}
        </div>
      </div>
    </div>
    ${p.tracks.length
      ? trackListHtml(p.tracks, { source: 'playlist', playlistId: p.id, isOwner: p.is_owner })
      : `<div class="empty-state">${icon('i-music', 52)}<h3>Playlist trống</h3>
         <p>Tìm bài hát và chọn “Thêm vào playlist” để bắt đầu.</p></div>`}`;
  bindHeroPlay(p.tracks, 'playlist');

  const editBtn = document.getElementById('btn-pl-edit');
  if (editBtn) editBtn.onclick = () => openPlaylistModal(p);
  const delBtn = document.getElementById('btn-pl-del');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`Xóa playlist “${p.title}”?`)) return;
    await api.del(`/v1/me/playlists/${p.id}`);
    toast('Đã xóa playlist');
    await loadMyPlaylists();
    location.hash = '#/library';
  };
}

/* ============================================================
   VIEW: ALBUM MỚI (toàn bộ album, mới nhất trước)
   ============================================================ */
async function renderAlbums(_, token) {
  view.innerHTML = `<div class="section">${skeletonCards(12)}</div>`;
  const data = await api.get('/v1/albums?limit=60');
  if (stale(token)) return;
  view.innerHTML = `
    <h1 class="page-title">${t('all_albums')}</h1>
    <p class="page-sub">${data.items.length} ${t('albums_sub')}</p>
    <div class="card-row" style="margin-top:16px">${data.items.map(releaseCard).join('')}</div>`;
}

/* ============================================================
   VIEW: TẤT CẢ THỂ LOẠI
   ============================================================ */
const GENRE_GRADIENTS = [
  ['#7c3aed', '#db2777'], ['#2563eb', '#06b6d4'], ['#059669', '#84cc16'],
  ['#ea580c', '#f59e0b'], ['#dc2626', '#7c3aed'], ['#0ea5e9', '#6366f1'],
  ['#d946ef', '#f43f5e'], ['#14b8a6', '#0ea5e9'],
];

async function renderGenres(_, token) {
  view.innerHTML = `<div class="section">${skeletonCards(8)}</div>`;
  const data = await api.get('/v1/home');
  if (stale(token)) return;
  view.innerHTML = `
    <h1 class="page-title">${t('genres_title')}</h1>
    <p class="page-sub">${t('genres_sub')}</p>
    <div class="genre-grid">${data.genres.map((g, i) => {
      const [c1, c2] = GENRE_GRADIENTS[i % GENRE_GRADIENTS.length];
      return `<div class="genre-card" data-href="#/genre/${encodeURIComponent(g.name)}"
        style="--g1:${c1};--g2:${c2}">
        <b>${h(g.name)}</b><span>${g.track_count} ${t('tracks_unit')}</span></div>`;
    }).join('')}</div>`;
}

/* ============================================================
   VIEW: THỂ LOẠI
   ============================================================ */
async function renderGenre(params, token) {
  const name = params[0];
  view.innerHTML = skeletonRows(8);
  const data = await api.get(`/v1/genres/${encodeURIComponent(name)}/tracks`);
  if (stale(token)) return;
  view.innerHTML = `
    <h1 class="page-title">${h(name)}</h1>
    <p class="page-sub">${data.items.length} bài hát</p>
    ${trackListHtml(data.items, { showPlays: true, source: 'genre' })}`;
}

/* ============================================================
   VIEW: THƯ VIỆN
   ============================================================ */
async function renderLibrary(params, token) {
  if (!auth.loggedIn) {
    view.innerHTML = `<div class="empty-state">${icon('i-library', 52)}
      <h3>${t('lib_login')}</h3>
      <p>${t('lib_login_sub')}</p>
      <p style="margin-top:16px"><button class="btn btn-primary" data-open-auth>${t('login')}</button></p></div>`;
    return;
  }
  const tab = params[0] || 'playlists';
  const tabs = {
    playlists: t('tab_playlists'), liked: t('tab_liked'), albums: t('tab_albums'),
    artists: t('tab_artists'), history: t('tab_history'),
  };
  let body = skeletonRows(6);
  view.innerHTML = `
    <h1 class="page-title">${t('library')}</h1>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) =>
      `<button class="${k === tab ? 'on' : ''}" data-href="#/library/${k}">${v}</button>`).join('')}
    </div><div id="lib-body">${body}</div>`;
  const libBody = document.getElementById('lib-body');

  if (tab === 'playlists') {
    const data = await api.get('/v1/me/playlists');
    if (stale(token)) return;
    libBody.innerHTML = data.items.length
      ? `<div class="card-row">${data.items.map(playlistCard).join('')}
          <div class="card" id="card-new-pl" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:210px;color:var(--muted)">
            ${icon('i-plus', 34)}<div style="margin-top:10px;font-weight:700">Tạo playlist</div></div></div>`
      : `<div class="empty-state">${icon('i-music', 52)}<h3>Chưa có playlist nào</h3>
         <p style="margin-top:14px"><button class="btn btn-primary" id="btn-lib-new-pl">＋ Tạo playlist đầu tiên</button></p></div>`;
    const newCard = document.getElementById('card-new-pl') || document.getElementById('btn-lib-new-pl');
    if (newCard) newCard.onclick = () => openPlaylistModal();
  } else if (tab === 'liked') {
    const data = await api.get('/v1/me/favorites?type=track');
    if (stale(token)) return;
    libBody.innerHTML = data.items.length
      ? trackListHtml(data.items, { source: 'liked' })
      : `<div class="empty-state">${icon('i-heart', 52)}<h3>Chưa thích bài nào</h3>
         <p>Bấm ♥ ở bất kỳ bài hát nào để lưu vào đây.</p></div>`;
  } else if (tab === 'albums') {
    const data = await api.get('/v1/me/favorites?type=release');
    if (stale(token)) return;
    libBody.innerHTML = data.items.length
      ? `<div class="card-row">${data.items.map(releaseCard).join('')}</div>`
      : `<div class="empty-state">${icon('i-music', 52)}<h3>Chưa lưu album nào</h3>
         <p>Bấm ♥ trên trang album để lưu.</p></div>`;
  } else if (tab === 'artists') {
    const data = await api.get('/v1/me/follows');
    if (stale(token)) return;
    libBody.innerHTML = data.items.length
      ? `<div class="card-row">${data.items.map(artistCard).join('')}</div>`
      : `<div class="empty-state">${icon('i-user', 52)}<h3>Chưa theo dõi nghệ sĩ nào</h3></div>`;
  } else if (tab === 'history') {
    const data = await api.get('/v1/me/history');
    if (stale(token)) return;
    libBody.innerHTML = data.items.length
      ? trackListHtml(data.items, { source: 'history' })
      : `<div class="empty-state">${icon('i-clock', 52)}<h3>Chưa có lịch sử nghe</h3></div>`;
  }
}

/* ============================================================
   VIEW: HỒ SƠ CÁ NHÂN (#/profile)
   ============================================================ */
/* icon máy ảnh inline (sprite index.html chưa có — không sửa file ngoài phạm vi) */
function cameraIconSvg(size = 15) {
  return `<svg viewBox="0 0 24 24" style="width:${size}px;height:${size}px">
    <path d="M9.2 3h5.6l1.3 2.2H20a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7.2a2 2 0 0 1 2-2h3.9L9.2 3zM12 8.3a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4zm0 2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z"/></svg>`;
}

/* nhãn chip vai trò tài khoản (user/uploader/manager/admin) */
function accountRoleText(role) {
  const key = `profile_role_${role || 'user'}`;
  return (I18N[lang] && I18N[lang][key]) || I18N.vi[key] || role;
}

async function renderProfile(_, token) {
  if (!auth.loggedIn) {
    // chưa đăng nhập (kể cả khi VỪA đăng xuất khỏi trang này) → chỉ hiện trang
    // trống + nút đăng nhập; KHÔNG tự bung modal (bấm Đăng xuất mà bị ép mở login
    // ngay là khó chịu). Người dùng chủ động bấm nút mới mở.
    view.innerHTML = `<div class="empty-state">${icon('i-user', 52)}
      <h3>${t('profile_login')}</h3>
      <p>${t('login_next_sub')}</p>
      <p style="margin-top:16px"><button class="btn btn-primary" data-open-auth>${t('login')}</button></p></div>`;
    return;
  }
  view.innerHTML = '<div class="skeleton sk-hero"></div>' + skeletonRows(4);
  const p = await getProfile();
  if (stale(token)) return;

  const initial = (p.display_name || p.email || '?').trim()[0].toUpperCase();
  const stats = p.stats || {};
  const statTile = (val, label) =>
    `<div class="pf-stat"><b>${fmtCount(val)}</b><span>${h(label)}</span></div>`;

  view.innerHTML = `
    <h1 class="page-title">${t('profile_title')}</h1>

    <section class="profile-hero">
      <div class="pf-avatar-wrap">
        <div class="pf-avatar">${p.avatar_url
          ? `<img src="${h(p.avatar_url)}" alt="">`
          : `<span>${h(initial)}</span>`}</div>
        <button class="pf-cam" id="pf-cam" title="${h(t('profile_avatar_btn'))}">${cameraIconSvg()}</button>
        <input type="file" id="pf-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      </div>
      <div class="pf-info">
        <div class="pf-name-row" id="pf-name-row">
          <h2>${h(p.display_name || '')}</h2>
          <button class="icon-btn" id="pf-name-edit" title="${h(t('profile_edit_name'))}">${icon('i-edit', 16)}</button>
        </div>
        <div class="pf-email">${h(p.email)}
          ${p.email_verified ? `<span class="pf-verified">${icon('i-check', 12)} ${t('profile_verified')}</span>` : ''}
        </div>
        <div class="pf-chips">
          <span class="pf-chip pf-role">${h(accountRoleText(p.role))}</span>
          <span class="pf-chip pf-plan${p.plan === 'premium' ? ' premium' : ''}">${p.plan === 'premium' ? 'Premium' : 'Free'}</span>
        </div>
        ${p.created_at ? `<div class="pf-since">${t('profile_member_since')} ${h(fmtDate(p.created_at))}</div>` : ''}
      </div>
    </section>

    <div class="pf-stats">
      ${statTile(stats.playlists, t('profile_stat_playlists'))}
      ${statTile(stats.favorites, t('profile_stat_likes'))}
      ${statTile(stats.follows, t('profile_stat_follows'))}
      ${statTile(stats.plays, t('profile_stat_plays'))}
    </div>

    <div class="pf-panels">
      <section class="pf-panel">
        <h3>${t('profile_change_pass')}</h3>
        <form id="pf-pass-form">
          <div class="field"><label>${t('profile_cur_pass')}</label>
            <input name="current" type="password" required autocomplete="current-password"></div>
          <div class="field"><label>${t('profile_new_pass')}</label>
            <input name="new1" type="password" required minlength="6" autocomplete="new-password"></div>
          <div class="field"><label>${t('profile_new_pass2')}</label>
            <input name="new2" type="password" required minlength="6" autocomplete="new-password"></div>
          <div class="form-error" id="pf-pass-err"></div>
          <button type="submit" class="btn btn-primary">${t('profile_change_pass')}</button>
        </form>
      </section>

      <section class="pf-panel">
        <h3>${t('profile_2fa_title')}
          ${p.totp_enabled ? `<span class="pf-badge-on">${icon('i-check', 12)} ${t('profile_2fa_on')}</span>` : ''}</h3>
        ${p.totp_enabled ? `
          <p class="pf-desc">${t('profile_2fa_active_desc')}</p>
          <button class="btn btn-ghost" id="pf-2fa-off">${t('profile_2fa_off_btn')}</button>
          <form id="pf-2fa-off-form" hidden>
            <p class="pf-desc">${t('profile_2fa_off_desc')}</p>
            <div class="field"><label>${t('profile_cur_pass')}</label>
              <input name="password" type="password" required autocomplete="current-password"></div>
            <div class="field"><label>${t('profile_2fa_code_ph')}</label>
              <input name="code" inputmode="numeric" pattern="\\d{6}" maxlength="6" required autocomplete="one-time-code"></div>
            <div class="form-error" id="pf-2fa-off-err"></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="submit" class="btn btn-danger">${t('profile_2fa_off_btn')}</button>
              <button type="button" class="btn btn-ghost" id="pf-2fa-off-cancel">${t('profile_cancel')}</button>
            </div>
          </form>`
        : `
          <p class="pf-desc">${t('profile_2fa_desc')}</p>
          <button class="btn btn-primary" id="pf-2fa-setup">${t('profile_2fa_setup')}</button>
          <div id="pf-2fa-setup-box"></div>`}
      </section>
    </div>`;

  bindProfileHero(p);
  bindProfilePassword();
  bindProfileTwofa(p);
}

/* avatar + tên hiển thị inline trên hero hồ sơ */
function bindProfileHero(p) {
  // nút camera → chọn ảnh → upload → cập nhật auth để topbar đổi theo
  $('pf-cam').onclick = () => $('pf-avatar-file').click();
  $('pf-avatar-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast(t('profile_avatar_max'), true); return; }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await uploadAvatar(fd);
      toast(t('profile_avatar_saved'));
      // auth.set phát 'auth:change' → topbar + trang hồ sơ tự render lại với ảnh mới
      auth.set(auth.token, { ...auth.user, avatar_url: res.avatar_url });
    } catch (err) { toast(err.message, true); }
  };

  // bút chì → input sửa tên inline → updateProfile
  $('pf-name-edit').onclick = () => {
    const row = $('pf-name-row');
    const current = p.display_name || '';
    row.innerHTML = `
      <input id="pf-name-input" maxlength="80" value="${h(current)}">
      <button class="btn btn-primary" id="pf-name-save">${t('profile_save')}</button>
      <button class="btn btn-ghost" id="pf-name-cancel">${t('profile_cancel')}</button>`;
    const input = $('pf-name-input');
    input.focus();
    input.select();
    const save = async () => {
      const name = input.value.trim();
      if (!name) { toast(t('profile_name_empty'), true); return; }
      if (name === current) { route(); return; }   // không đổi gì → render lại
      try {
        await updateProfile({ display_name: name });
        toast(t('profile_name_saved'));
        auth.set(auth.token, { ...auth.user, display_name: name }); // render lại qua auth:change
      } catch (err) { toast(err.message, true); }
    };
    $('pf-name-save').onclick = save;
    $('pf-name-cancel').onclick = () => route();
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
      if (ev.key === 'Escape') route();
    };
  };
}

/* panel đổi mật khẩu: kiểm tra khớp + độ dài trước khi gọi API */
function bindProfilePassword() {
  const form = $('pf-pass-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const errBox = $('pf-pass-err');
    errBox.textContent = '';
    const fd = new FormData(form);
    const cur = String(fd.get('current') || '');
    const nw = String(fd.get('new1') || '');
    const nw2 = String(fd.get('new2') || '');
    if (nw.length < 6) { errBox.textContent = t('profile_pass_min'); return; }
    if (nw !== nw2) { errBox.textContent = t('profile_pass_mismatch'); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await changePassword(cur, nw);
      toast(t('profile_pass_saved'));
      form.reset();
    } catch (err) { errBox.textContent = err.message; }
    btn.disabled = false;
  };
}

/* panel 2FA: thiết lập / kích hoạt / tắt */
function bindProfileTwofa(p) {
  if (p.totp_enabled) {
    const offBtn = $('pf-2fa-off');
    const offForm = $('pf-2fa-off-form');
    offBtn.onclick = () => {
      offBtn.hidden = true;
      offForm.hidden = false;
      offForm.querySelector('input').focus();
    };
    $('pf-2fa-off-cancel').onclick = () => { offForm.hidden = true; offBtn.hidden = false; };
    offForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(offForm);
      try {
        await twofaDisable(String(fd.get('password') || ''), String(fd.get('code') || '').trim());
        toast(t('profile_2fa_disabled_toast'));
        route();               // render lại trang với trạng thái 2FA mới
      } catch (err) { $('pf-2fa-off-err').textContent = err.message; }
    };
    return;
  }

  const setupBtn = $('pf-2fa-setup');
  setupBtn.onclick = async () => {
    setupBtn.disabled = true;
    try {
      const res = await twofaSetup();
      setupBtn.hidden = true;
      renderTwofaSetupBox(res);
    } catch (err) {
      toast(err.message, true);
      setupBtn.disabled = false;
    }
  };
}

/* khối QR + secret + xác nhận mã sau khi bấm 'Thiết lập 2FA' */
function renderTwofaSetupBox(res) {
  const box = $('pf-2fa-setup-box');
  box.innerHTML = `
    <ol class="twofa-steps">
      <li>${t('profile_2fa_step1')}</li>
      <li>${t('profile_2fa_step2')}</li>
      <li>${t('profile_2fa_step3')}</li>
    </ol>
    <div class="twofa-grid">
      <div class="twofa-qr" id="pf-2fa-qr"></div>
      <div class="twofa-manual">
        ${res.issuer_label ? `<div class="twofa-issuer">
          <span>${t('profile_2fa_shown_in_app')}</span><b>${h(res.issuer_label)}</b></div>` : ''}
        <div class="twofa-label">${t('profile_2fa_secret')}</div>
        <div class="twofa-secret">
          <code>${h(res.secret || '')}</code>
          <button type="button" class="btn btn-ghost" id="pf-2fa-copy">${t('profile_2fa_copy')}</button>
        </div>
        <form id="pf-2fa-enable-form" class="twofa-verify">
          <input name="code" inputmode="numeric" pattern="\\d{6}" maxlength="6" required
                 autocomplete="one-time-code" placeholder="${h(t('profile_2fa_code_ph'))}">
          <button type="submit" class="btn btn-primary">${t('profile_2fa_activate')}</button>
        </form>
        <div class="form-error" id="pf-2fa-en-err"></div>
      </div>
    </div>`;
  // SVG QR do server sinh (nội dung tin cậy, nền trắng bo góc) → chèn thẳng innerHTML
  $('pf-2fa-qr').innerHTML = res.qr_svg || '';
  $('pf-2fa-copy').onclick = () => {
    navigator.clipboard.writeText(res.secret || '').then(() => toast(t('profile_2fa_copied')));
  };
  $('pf-2fa-enable-form').onsubmit = async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code') || '').trim();
    try {
      await twofaEnable(code);
      toast(t('profile_2fa_enabled_toast'));
      route();                 // render lại: badge 'Đang bật' + nút tắt
    } catch (err) { $('pf-2fa-en-err').textContent = err.message; }
  };
}

/* ============================================================
   MÀU ACCENT
   ============================================================ */
function hexSoft(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 'rgba(124,92,255,.18)';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},.16)`;
}
function applyTrackAccent(track) {
  const root = document.documentElement;
  if (track && track.accent) {
    root.style.setProperty('--accent', track.accent);
    root.style.setProperty('--accent-soft', hexSoft(track.accent));
  }
}

/* ============================================================
   WAVEFORM (kiểu Audition) — player bar, Now Playing, track rows
   ============================================================ */
let pbPeaks = null;            // peaks của bài đang phát
let pbHover = null;            // 0..1 khi rê chuột trên seekbar
let npHover = null;
let seekPreviewFrac = null;    // vị trí xem trước khi đang kéo
let lastWaveTrackId = null;

// lazy-load peaks cho các sóng mini khi cuộn tới
const waveObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const canvas = en.target;
    waveObserver.unobserve(canvas);
    const tid = canvas.dataset.track;
    if (!tid || canvas.classList.contains('empty')) continue;
    drawWavePlaceholder(canvas);
    getPeaks(tid).then(peaks => {
      if (!canvas.isConnected) return;
      if (!peaks) { canvas.classList.add('empty'); drawWavePlaceholder(canvas); return; }
      canvas._peaks = peaks;
      const cur = player.current;
      const prog = (cur && cur.id === tid && player.audio.duration)
        ? player.audio.currentTime / player.audio.duration : 0;
      drawWave(canvas, peaks, prog);
    });
  }
}, { rootMargin: '300px' });

function observeWaves() {
  document.querySelectorAll('.tr-wave:not([data-wobs])').forEach(c => {
    c.dataset.wobs = '1';
    waveObserver.observe(c);
  });
}
new MutationObserver(() => requestAnimationFrame(observeWaves))
  .observe(view, { childList: true, subtree: true });

function drawRowWaves(trackId, progress) {
  if (!trackId) return;
  document.querySelectorAll(`.tr-wave[data-track="${trackId}"]`).forEach(c => {
    if (c._peaks) drawWave(c, c._peaks, progress);
  });
}

/* nạp peaks cho bài đang phát (player bar + Now Playing) */
async function loadCurrentWave() {
  const t = player.current;
  const seek = $('pb-seek');
  pbPeaks = null;
  if (!t) { seek.classList.remove('has-wave'); return; }
  const peaks = await getPeaks(t.id);
  if (!player.current || player.current.id !== t.id) return;
  pbPeaks = peaks;
  seek.classList.toggle('has-wave', !!peaks);
  $('np-wave-wrap').hidden = !peaks;
}

/* vòng vẽ 60fps — sóng chạy mượt, không giật theo timeupdate */
function waveLoop() {
  requestAnimationFrame(waveLoop);
  if (!pbPeaks || !player.current) return;
  const dur = player.audio.duration || (player.current.duration_ms / 1000) || 1;
  const prog = (seeking && seekPreviewFrac != null)
    ? seekPreviewFrac
    : (player.audio.currentTime || 0) / dur;
  const pbCanvas = $('pb-wave');
  if (pbCanvas.offsetParent) drawWave(pbCanvas, pbPeaks, prog, pbHover);
  if (!$('now-playing').hidden) {
    drawWave($('np-wave'), pbPeaks, prog, npHover);
    const shownSec = (seeking && seekPreviewFrac != null)
      ? seekPreviewFrac * dur : (player.audio.currentTime || 0);
    $('np-cur').textContent = fmtDur(shownSec * 1000);
    $('np-total').textContent = fmtDur(dur * 1000);
  }
}

function bindWaveInteractions() {
  const seek = $('pb-seek');
  seek.addEventListener('mousemove', (e) => {
    if (seek.classList.contains('has-wave')) pbHover = fractionFromEvent(seek, e);
  });
  seek.addEventListener('mouseleave', () => { pbHover = null; });

  const npWave = $('np-wave');
  npWave.addEventListener('click', (e) => player.seek(fractionFromEvent(npWave, e)));
  npWave.addEventListener('mousemove', (e) => { npHover = fractionFromEvent(npWave, e); });
  npWave.addEventListener('mouseleave', () => { npHover = null; });
}

/* ============================================================
   HIỆU ỨNG 3D TILT — card nghiêng theo con trỏ
   ============================================================ */
function bindTiltEffect() {
  view.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.card, .genre-card');
    if (!card || e.pointerType === 'touch') return;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    card.classList.add('tilting');
    card.style.setProperty('--ry', `${(px * 9).toFixed(2)}deg`);
    card.style.setProperty('--rx', `${(-py * 9).toFixed(2)}deg`);
  });
  view.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.card, .genre-card');
    if (!card) return;
    card.classList.remove('tilting');
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

/* ============================================================
   AUTH UI
   ============================================================ */
function loginUrl(mode = 'login') {
  const next = encodeURIComponent(location.hash || '#/');
  return `/login?${mode === 'register' ? 'mode=register&' : ''}next=${next}`;
}

function requireAuth() {
  if (auth.loggedIn) return true;
  openLoginPrompt();
  return false;
}

function openLoginPrompt() {
  openModal(`
    <h2>${t('login_next')}</h2>
    <p class="modal-sub">${t('login_next_sub')}</p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
      <a class="btn btn-primary" style="justify-content:center" href="${loginUrl()}">${t('login')}</a>
      <a class="btn btn-ghost" style="justify-content:center" href="${loginUrl('register')}">${t('create_account')}</a>
    </div>
    <div class="switch-auth" style="margin-top:14px"><a data-close style="cursor:pointer;color:var(--muted)">${t('later')}</a></div>`);
}

function renderAuthArea() {
  const area = document.getElementById('auth-area');
  if (auth.loggedIn) {
    const u = auth.user;
    const initial = (u.display_name || u.email || '?').trim()[0].toUpperCase();
    // có avatar thì hiện ảnh, chưa có thì chữ cái đầu tên
    const avatarHtml = u.avatar_url
      ? `<img class="avatar" src="${h(u.avatar_url)}" alt="">`
      : `<span class="avatar">${h(initial)}</span>`;
    area.innerHTML = `
      <button class="user-chip" id="user-chip">
        ${avatarHtml}
        <span>${h(u.display_name || u.email)}</span>
        ${u.plan === 'premium' ? '<span class="plan-tag">Premium</span>' : ''}
      </button>`;
    document.getElementById('user-chip').onclick = (e) => {
      openCtxMenu(e.clientX, e.clientY, [
        { label: u.email, disabled: true },
        { label: t('profile_title'), icon: 'i-user', onClick: () => { location.hash = '#/profile'; } },
        ...(u.role === 'admin' ? [{ label: 'Trang quản trị', icon: 'i-edit', onClick: () => window.open('/admin', '_blank') }] : []),
        { label: 'Đăng xuất', icon: 'i-logout', onClick: () => { auth.clear(); toast('Đã đăng xuất'); } },
      ]);
    };
  } else {
    // trang đăng nhập riêng — handler data-open-auth tính hash hiện tại lúc bấm
    area.innerHTML = `<button class="btn btn-primary" data-open-auth>${t('login')}</button>`;
  }
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(innerHtml) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  const backdrop = root.firstElementChild;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  backdrop.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  const firstInput = backdrop.querySelector('input');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);
  return backdrop;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function openPlaylistModal(existing = null) {
  if (!requireAuth()) return;
  const modal = openModal(`
    <h2>${existing ? 'Sửa playlist' : 'Tạo playlist mới'}</h2>
    <form id="pl-form">
      <div class="field"><label>Tên playlist</label>
        <input name="title" required maxlength="120" value="${existing ? h(existing.title) : ''}" placeholder="Playlist của tôi"></div>
      <div class="field"><label>Mô tả (tùy chọn)</label>
        <textarea name="description" rows="2" maxlength="500">${existing ? h(existing.description || '') : ''}</textarea></div>
      <div class="field"><label>Hiển thị</label>
        <select name="visibility">
          <option value="private" ${existing?.visibility === 'private' ? 'selected' : ''}>Riêng tư — chỉ mình tôi</option>
          <option value="public" ${existing?.visibility === 'public' ? 'selected' : ''}>Công khai — ai cũng xem được</option>
          <option value="unlisted" ${existing?.visibility === 'unlisted' ? 'selected' : ''}>Không công khai — ai có link đều xem được</option>
        </select></div>
      <div class="form-error" id="pl-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Lưu' : 'Tạo playlist'}</button>
      </div>
    </form>`);
  modal.querySelector('#pl-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'), description: fd.get('description'),
      visibility: fd.get('visibility'),
    };
    try {
      if (existing) {
        await api.patch(`/v1/me/playlists/${existing.id}`, body);
        toast('Đã cập nhật playlist');
      } else {
        const p = await api.post('/v1/me/playlists', body);
        toast('Đã tạo playlist');
        location.hash = `#/playlist/${p.id}`;
      }
      closeModal();
      await loadMyPlaylists();
      route();
    } catch (err) { modal.querySelector('#pl-error').textContent = err.message; }
  };
}

async function openAddToPlaylist(track) {
  if (!requireAuth()) return;
  const data = await api.get('/v1/me/playlists');
  const items = data.items.filter(p => !p.is_editorial);
  const modal = openModal(`
    <h2>Thêm vào playlist</h2>
    <p class="modal-sub">“${h(track.title)}”</p>
    <div style="max-height:300px;overflow-y:auto;margin:0 -8px">
      ${items.map(p => `
        <button class="ctx-like-row" data-pl="${p.id}" style="display:flex;align-items:center;gap:12px;width:100%;padding:9px 12px;border-radius:10px;text-align:left">
          <img src="${p.cover_url}" style="width:42px;height:42px;border-radius:7px">
          <span style="flex:1;font-weight:600;font-size:14px">${h(p.title)}</span>
          <span style="color:var(--muted);font-size:12px">${p.track_count} bài</span>
        </button>`).join('')
      || '<p class="page-sub" style="padding:0 10px">Bạn chưa có playlist nào.</p>'}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Đóng</button>
      <button class="btn btn-primary" id="btn-new-from-add">＋ Playlist mới</button>
    </div>`);
  modal.querySelectorAll('[data-pl]').forEach(b => {
    b.addEventListener('mouseenter', () => b.style.background = 'var(--bg-hover)');
    b.addEventListener('mouseleave', () => b.style.background = '');
    b.onclick = async () => {
      try {
        await api.post(`/v1/me/playlists/${b.dataset.pl}/tracks`, { track_id: track.id });
        toast('Đã thêm vào playlist');
        closeModal();
        await loadMyPlaylists();
      } catch (err) { toast(err.message, true); }
    };
  });
  modal.querySelector('#btn-new-from-add').onclick = async () => {
    closeModal();
    openPlaylistModal();
  };
}

/* ============================================================
   CONTEXT MENU
   ============================================================ */
function openCtxMenu(x, y, items) {
  closeCtxMenu();
  const root = document.getElementById('ctx-root');
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  items.forEach(it => {
    if (it === 'hr') { menu.appendChild(document.createElement('hr')); return; }
    if (it.disabled) {
      const d = document.createElement('div');
      d.className = 'ctx-label';
      d.textContent = it.label;
      menu.appendChild(d);
      return;
    }
    const btn = document.createElement('button');
    // iconHtml: SVG inline (không có trong sprite) — icon: tên symbol trong sprite
    btn.innerHTML = `${it.iconHtml || (it.icon ? icon(it.icon) : '')}<span>${h(it.label)}</span>`;
    btn.onclick = () => { closeCtxMenu(); it.onClick && it.onClick(); };
    menu.appendChild(btn);
  });
  root.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 12) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 12) + 'px';
  setTimeout(() => {
    document.addEventListener('mousedown', closeCtxOnOutside);
    document.addEventListener('scroll', closeCtxMenu, { capture: true, once: true });
  }, 0);
}
function closeCtxOnOutside(e) {
  if (!e.target.closest('.ctx-menu')) closeCtxMenu();
}
function closeCtxMenu() {
  document.getElementById('ctx-root').innerHTML = '';
  document.removeEventListener('mousedown', closeCtxOnOutside);
}

function trackCtxItems(track, opts = {}) {
  const items = [
    { label: 'Phát tiếp theo', icon: 'i-next', onClick: () => { player.addNext(track); toast('Sẽ phát tiếp theo'); } },
    { label: 'Thêm vào hàng đợi', icon: 'i-queue', onClick: () => { player.addToQueue(track); toast('Đã thêm vào hàng đợi'); } },
    'hr',
    {
      label: track.liked ? 'Bỏ thích' : 'Thích', icon: track.liked ? 'i-heart-f' : 'i-heart',
      onClick: () => toggleLikeTrack(track),
    },
    { label: 'Thêm vào playlist…', icon: 'i-plus', onClick: () => openAddToPlaylist(track) },
    ...(track.has_audio ? [{ label: 'Tải xuống (WAV)', icon: 'i-download', onClick: () => downloadTrack(track) }] : []),
  ];
  if (opts.playlistId && opts.isOwner) {
    items.push({
      label: 'Xóa khỏi playlist này', icon: 'i-trash',
      onClick: async () => {
        try {
          await api.del(`/v1/me/playlists/${opts.playlistId}/tracks/${track.id}`);
          toast('Đã xóa khỏi playlist');
          route();
        } catch (e) { toast(e.message, true); }
      },
    });
  }
  items.push('hr');
  items.push({ label: t('det_title'), iconHtml: infoIconSvg(), onClick: () => openTrackDetails(track) });
  if (track.release) items.push({ label: 'Đến album', icon: 'i-music', onClick: () => location.hash = `#/album/${track.release.id}` });
  if (track.artists && track.artists[0]) items.push({ label: `Đến nghệ sĩ ${track.artists[0].name}`, icon: 'i-user', onClick: () => location.hash = `#/artist/${track.artists[0].id}` });
  // chỉ hiện khi track có album — không thì copy ra URL chết '/#/album/'
  if (track.release && track.release.id) items.push({
    label: 'Sao chép liên kết', icon: 'i-share',
    onClick: () => {
      const url = `${location.origin}/#/album/${track.release.id}`;
      navigator.clipboard.writeText(url).then(() => toast('Đã sao chép liên kết'));
    },
  });
  return items;
}

/* ============================================================
   MODAL THÔNG TIN CHI TIẾT BÀI HÁT
   ============================================================ */
async function openTrackDetails(track) {
  const modal = openModal(`
    <button class="icon-btn modal-x" data-close title="${h(t('close'))}">${icon('i-close', 17)}</button>
    <h2>${t('det_title')}</h2>
    <div id="det-body" class="det-body">
      <div class="skeleton sk-row"></div>
      <div class="skeleton sk-row"></div>
      <div class="skeleton sk-row"></div>
    </div>`);
  const body = modal.querySelector('#det-body');

  let d;
  try {
    d = await api.get(`/v1/tracks/${track.id}`);   // credits đầy đủ + p_line + language
  } catch (err) {
    if (body.isConnected) {
      body.innerHTML = `<p class="modal-sub" style="margin:0">${h(err.message || t('det_error'))}</p>`;
    }
    return;
  }
  if (!body.isConnected) return;                   // người dùng đã đóng modal trong lúc tải

  const rel = d.release || {};
  const row = (label, valueHtml, mono = false) => valueHtml
    ? `<div class="det-row"><span class="det-k">${h(label)}</span>
       <span class="det-v${mono ? ' mono' : ''}">${valueHtml}</span></div>`
    : '';

  // gom credits theo vai trò, giữ thứ tự sequence từ API
  const byRole = new Map();
  (d.credits || []).forEach(c => {
    if (!byRole.has(c.role)) byRole.set(c.role, []);
    byRole.get(c.role).push(c);
  });
  let creditRows = '';
  byRole.forEach((list, role) => {
    creditRows += row(roleLabel(role),
      list.map(a => `<a href="#/artist/${a.id}" data-close>${h(a.name)}</a>`).join(', '));
  });

  const pLine = d.p_line
    ? (String(d.p_line).trim().startsWith('℗') ? d.p_line : `℗ ${d.p_line}`) : '';

  body.innerHTML = `
    <div class="det-head">
      <img src="${d.cover_url || '/static/img/logo.svg'}" alt="">
      <div class="det-head-text">
        <div class="det-title">${h(d.title)}${d.explicit ? '<span class="badge-e">E</span>' : ''}</div>
        ${d.subtitle ? `<div class="det-sub">${h(d.subtitle)}</div>` : ''}
      </div>
    </div>
    <div class="det-rows">
      ${creditRows}
      ${row(t('det_album'), rel.id ? `<a href="#/album/${rel.id}" data-close>${h(rel.title)}</a>` : '')}
      ${row(t('det_label'), rel.label_name ? h(rel.label_name) : '')}
      ${row('ISRC', d.isrc ? h(d.isrc) : '', true)}
      ${row('UPC', rel.upc ? h(rel.upc) : '', true)}
      ${row(t('det_genre'), d.genre ? h(d.genre) : '')}
      ${row(t('det_duration'), d.duration_ms ? h(fmtDur(d.duration_ms)) : '')}
      ${row(t('det_language'), d.language ? h(langName(d.language)) : '')}
      ${row(t('det_plays'), h(fmtCount(d.play_count)))}
      ${pLine ? `<div class="det-lines">${h(pLine)}</div>` : ''}
    </div>`;
  // liên kết render sau openModal → tự gắn đóng modal khi điều hướng
  body.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
}

/* ============================================================
   DOWNLOAD (bản gốc WAV 44.1kHz)
   ============================================================ */
async function downloadTrack(track) {
  if (!requireAuth()) return;
  try {
    const { url } = await api.get(`/v1/tracks/${track.id}/download`);
    toast('Đang tải xuống bản WAV…');
    location.href = url;                  // Content-Disposition: attachment
  } catch (e) { toast(e.message, true); }
}

async function downloadAlbum(releaseId) {
  if (!requireAuth()) return;
  try {
    const { url, track_count } = await api.get(`/v1/albums/${releaseId}/download`);
    toast(`Đang đóng gói ${track_count} bài (ZIP WAV)…`);
    location.href = url;
  } catch (e) { toast(e.message, true); }
}

/* ============================================================
   LIKE
   ============================================================ */
async function toggleLikeTrack(track) {
  if (!requireAuth()) return;
  const target = !track.liked;
  try {
    if (target) await api.put(`/v1/me/favorites/track/${track.id}`);
    else await api.del(`/v1/me/favorites/track/${track.id}`);
    track.liked = target;
    player.patchTrack(track.id, { liked: target });
    // cập nhật mọi row đang hiển thị
    document.querySelectorAll(`.track-row[data-track="${track.id}"] .tr-like`).forEach(b => {
      b.classList.toggle('on', target);
      b.classList.toggle('like-btn', target);
      b.innerHTML = icon(target ? 'i-heart-f' : 'i-heart');
    });
    updatePlayerLikeUI();
    toast(target ? 'Đã thêm vào Bài hát đã thích' : 'Đã bỏ thích');
  } catch (e) { toast(e.message, true); }
}

/* ============================================================
   SIDEBAR PLAYLISTS
   ============================================================ */
async function loadMyPlaylists() {
  const box = document.getElementById('sidebar-playlists');
  if (!auth.loggedIn) {
    box.innerHTML = `<div class="empty-hint">Đăng nhập để tạo playlist và lưu nhạc yêu thích.</div>`;
    return;
  }
  try {
    const data = await api.get('/v1/me/playlists');
    box.innerHTML = `
      <a href="#/library/liked">
        <span style="width:34px;height:34px;border-radius:6px;background:linear-gradient(135deg,#7c5cff,#38bdf8);display:flex;align-items:center;justify-content:center">${icon('i-heart-f', 15)}</span>
        <span>Bài hát đã thích</span></a>
      ${data.items.map(p => `
        <a href="#/playlist/${p.id}"><img src="${p.cover_url}" alt=""><span>${h(p.title)}</span></a>`).join('')}`;
  } catch { box.innerHTML = ''; }
}

/* ============================================================
   PLAYER BAR UI
   ============================================================ */
const $ = (id) => document.getElementById(id);

function updatePlayerTrackUI() {
  const t = player.current;
  const bar = $('playerbar');
  if (!t) { bar.classList.add('empty'); return; }
  bar.classList.remove('empty');
  $('pb-cover').src = t.cover_url || '/static/img/logo.svg';
  $('pb-title').textContent = t.title;
  $('pb-title').href = t.release ? `#/album/${t.release.id}` : '#/';
  $('pb-artists').innerHTML = artistLinks(t.artists);
  $('pb-dur').textContent = fmtDur(t.duration_ms);
  applyTrackAccent(t);
  updatePlayerLikeUI();
  updateNowPlayingUI();
  refreshPlayingRows();
  renderQueuePanel();
  // waveform: reset sóng của bài trước, nạp sóng bài mới
  if (lastWaveTrackId && lastWaveTrackId !== t.id) drawRowWaves(lastWaveTrackId, 0);
  lastWaveTrackId = t.id;
  loadCurrentWave();
}

function updatePlayerLikeUI() {
  const t = player.current;
  ['pb-like', 'np-like'].forEach(id => {
    const btn = $(id);
    if (!btn) return;
    btn.classList.toggle('on', !!(t && t.liked));
    btn.innerHTML = icon(t && t.liked ? 'i-heart-f' : 'i-heart', id === 'np-like' ? 20 : 17);
  });
}

function updatePlayerStateUI() {
  document.body.classList.toggle('is-playing', player.playing);   // vinyl/hiệu ứng
  $('pb-play-ico').innerHTML = `<use href="#${player.playing ? 'i-pause' : 'i-play'}"/>`;
  $('pb-shuffle').classList.toggle('on', player.shuffle);
  const rep = $('pb-repeat');
  rep.classList.toggle('on', player.repeat !== 'off');
  rep.classList.toggle('mode-one', player.repeat === 'one');
  refreshPlayingRows();
}

function refreshPlayingRows() {
  document.querySelectorAll('.track-row').forEach(row => {
    const isCur = player.current && row.dataset.track === player.current.id;
    row.classList.toggle('playing', !!isCur);
    const idx = row.querySelector('.tr-idx');
    if (!idx) return;
    const numEl = idx.querySelector('span:not(.tr-play-hover)');
    if (isCur && player.playing) {
      if (!idx.querySelector('.eq')) {
        if (numEl) numEl.outerHTML = '<span class="eq"><i></i><i></i><i></i></span>';
      }
    } else if (idx.querySelector('.eq')) {
      const listData = listRegistry.get(row.dataset.list);
      const i = Number(row.dataset.idx);
      const t = listData ? listData.tracks[i] : null;
      idx.querySelector('.eq').outerHTML = `<span>${(t && t.track_no) || i + 1}</span>`;
    }
  });
}

let seeking = false;
function updateTimeUI() {
  const a = player.audio;
  if (!seeking) {
    const frac = a.duration ? a.currentTime / a.duration : 0;
    $('pb-fill').style.width = `${frac * 100}%`;
    $('pb-knob').style.left = `${frac * 100}%`;
    $('pb-cur').textContent = fmtDur(a.currentTime * 1000);
    if (a.duration) $('pb-dur').textContent = fmtDur(a.duration * 1000);
  }
  try {
    if (a.buffered.length && a.duration) {
      const end = a.buffered.end(a.buffered.length - 1);
      $('pb-buffer').style.width = `${(end / a.duration) * 100}%`;
    }
  } catch { /* ignore */ }
  syncLyrics();
  // sóng mini trong danh sách của bài đang phát (4fps là đủ mượt cho row)
  if (player.current && a.duration && !seeking) {
    drawRowWaves(player.current.id, a.currentTime / a.duration);
  }
}

function updateVolumeUI() {
  const muted = player.muted || player.volume === 0;
  $('pb-vol-ico').innerHTML = `<use href="#${muted ? 'i-mute' : 'i-volume'}"/>`;
  $('pb-volfill').style.width = `${muted ? 0 : player.volume * 100}%`;
}

function bindPlayerBar() {
  $('pb-play').onclick = () => player.toggle();
  $('pb-next').onclick = () => player.next();
  $('pb-prev').onclick = () => player.prev();
  $('pb-shuffle').onclick = () => player.toggleShuffle();
  $('pb-repeat').onclick = () => player.cycleRepeat();
  $('pb-mute').onclick = () => player.toggleMute();
  $('pb-like').onclick = () => { if (player.current) toggleLikeTrack(player.current); };
  $('pb-cover').onclick = () => openNowPlaying();
  $('pb-expand').onclick = () => openNowPlaying();
  $('pb-lyrics').onclick = () => openNowPlaying(true);
  $('pb-queue').onclick = () => toggleQueuePanel();
  $('btn-queue-close').onclick = () => toggleQueuePanel(false);

  // seekbar: click + drag
  const seek = $('pb-seek');
  const seekFromEvent = (e) => {
    const rect = seek.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.min(1, Math.max(0, x / rect.width));
  };
  const onSeekMove = (e) => {
    const f = seekFromEvent(e);
    seekPreviewFrac = f;
    $('pb-fill').style.width = `${f * 100}%`;
    $('pb-knob').style.left = `${f * 100}%`;
    $('pb-cur').textContent = fmtDur(f * (player.audio.duration || 0) * 1000);
  };
  const onSeekEnd = (e) => {
    player.seek(seekFromEvent(e));
    seeking = false;
    seekPreviewFrac = null;
    document.removeEventListener('mousemove', onSeekMove);
    document.removeEventListener('mouseup', onSeekEnd);
  };
  seek.addEventListener('mousedown', (e) => {
    if (!player.current) return;
    seeking = true;
    onSeekMove(e);
    document.addEventListener('mousemove', onSeekMove);
    document.addEventListener('mouseup', onSeekEnd);
  });
  seek.addEventListener('touchstart', (e) => {
    if (!player.current) return;
    seeking = true; onSeekMove(e);
  }, { passive: true });
  seek.addEventListener('touchmove', (e) => { if (seeking) onSeekMove(e); }, { passive: true });
  seek.addEventListener('touchend', (e) => {
    if (!seeking) return;
    const rect = seek.getBoundingClientRect();
    const x = e.changedTouches[0].clientX - rect.left;
    player.seek(Math.min(1, Math.max(0, x / rect.width)));
    seeking = false;
    seekPreviewFrac = null;
  });
  seek.addEventListener('touchcancel', () => { seeking = false; seekPreviewFrac = null; });

  // volume
  const vol = $('pb-volbar');
  const volFrom = (e) => {
    const rect = vol.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };
  let volDrag = false;
  vol.addEventListener('mousedown', (e) => {
    volDrag = true;
    player.setVolume(volFrom(e));
    const mv = (ev) => { if (volDrag) player.setVolume(volFrom(ev)); };
    const up = () => { volDrag = false; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
}

/* ============================================================
   QUEUE PANEL
   ============================================================ */
function toggleQueuePanel(force) {
  const panel = $('queue-panel');
  const show = force !== undefined ? force : panel.hidden;
  panel.hidden = !show;
  $('pb-queue').classList.toggle('on', show);
  if (show) renderQueuePanel();
}

function renderQueuePanel() {
  const panel = $('queue-panel');
  if (panel.hidden) return;
  const list = $('queue-list');
  if (!player.queue.length) {
    list.innerHTML = `<div class="empty-state" style="padding:40px 16px">${icon('i-queue', 40)}
      <h3 style="font-size:15px">Hàng đợi trống</h3></div>`;
    return;
  }
  const cur = player.index;
  let html = '';
  player.queue.forEach((t, i) => {
    if (i === cur) html += `<div class="q-group">Đang phát</div>`;
    if (i === cur + 1) html += `<div class="q-group">Tiếp theo</div>`;
    html += `
      <div class="q-item ${i === cur ? 'current' : ''}" data-qidx="${i}">
        <img src="${t.cover_url || '/static/img/logo.svg'}" alt="">
        <div class="q-text">
          <div class="q-title">${h(t.title)}</div>
          <div class="q-artist">${(t.artists || []).map(a => h(a.name)).join(', ')}</div>
        </div>
        ${i !== cur ? `<button class="icon-btn q-remove" data-qremove="${i}" title="Xóa khỏi hàng đợi">${icon('i-close', 15)}</button>` : ''}
      </div>`;
  });
  list.innerHTML = html;
  list.querySelectorAll('.q-item').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('.q-remove')) return;
      player.playAt(Number(el.dataset.qidx));
    };
  });
  list.querySelectorAll('.q-remove').forEach(b => {
    b.onclick = () => { player.removeFromQueue(Number(b.dataset.qremove)); };
  });
}

/* ============================================================
   NOW PLAYING + LYRICS
   ============================================================ */
let lyricsData = null;   // { trackId, lines: [{t, text}] }

function openNowPlaying(focusLyrics = false) {
  if (!player.current) return;
  $('now-playing').hidden = false;
  updateNowPlayingUI();
  loadLyrics();
  if (focusLyrics) setTimeout(() => $('np-lyrics-wrap').scrollIntoView({ behavior: 'smooth' }), 100);
}

function closeNowPlaying() { $('now-playing').hidden = true; }

function updateNowPlayingUI() {
  if ($('now-playing').hidden) return;
  const t = player.current;
  if (!t) { closeNowPlaying(); return; }
  $('np-cover').src = t.cover_url || '/static/img/logo.svg';
  $('np-title').textContent = t.title;
  $('np-artists').innerHTML = artistLinks(t.artists);
  loadLyrics();
}

async function loadLyrics() {
  const t = player.current;
  if (!t || $('now-playing').hidden) return;
  if (lyricsData && lyricsData.trackId === t.id) return;
  lyricsData = { trackId: t.id, lines: [] };
  const box = $('np-lyrics');
  box.innerHTML = '<div class="no-lyrics">Đang tải lời bài hát…</div>';
  try {
    const data = await api.get(`/v1/tracks/${t.id}/lyrics`);
    if (!player.current || player.current.id !== t.id) return;
    if (data.lrc) {
      lyricsData.lines = parseLrc(data.lrc);
      box.innerHTML = lyricsData.lines.map((l, i) =>
        `<div class="lyric-line" data-lt="${l.t}" data-li="${i}">${h(l.text)}</div>`).join('');
      box.querySelectorAll('.lyric-line').forEach(el => {
        el.onclick = () => { player.audio.currentTime = Number(el.dataset.lt); };
      });
    } else if (data.lyrics) {
      box.innerHTML = data.lyrics.split('\n').map(l => `<div class="lyric-line">${h(l)}</div>`).join('');
    } else {
      box.innerHTML = '<div class="no-lyrics">Bài hát này chưa có lời.</div>';
    }
  } catch {
    box.innerHTML = '<div class="no-lyrics">Không tải được lời bài hát.</div>';
  }
}

function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return lines.sort((a, b) => a.t - b.t);
}

function syncLyrics() {
  if ($('now-playing').hidden || !lyricsData || !lyricsData.lines.length) return;
  const cur = player.audio.currentTime;
  let active = -1;
  for (let i = 0; i < lyricsData.lines.length; i++) {
    if (lyricsData.lines[i].t <= cur + 0.2) active = i; else break;
  }
  const box = $('np-lyrics');
  box.querySelectorAll('.lyric-line').forEach((el) => {
    const on = Number(el.dataset.li) === active;
    if (on && !el.classList.contains('active')) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (!on) el.classList.remove('active');
  });
}

/* ============================================================
   PHÁT TỪ CARD / HERO
   ============================================================ */
function bindHeroPlay(tracks, source) {
  const btn = view.querySelector('[data-play-here]');
  if (btn) btn.onclick = () => {
    const playable = tracks.filter(t => t.has_audio);
    if (!playable.length) return toast('Chưa có bài nào phát được', true);
    player.playQueue(playable, 0, source);
  };
}

async function playRelease(id) {
  const r = await api.get(`/v1/albums/${id}`);
  const tracks = r.tracks.filter(t => t.has_audio);
  if (!tracks.length) return toast('Album chưa có bài phát được', true);
  player.playQueue(tracks, 0, 'album');
}
async function playPlaylist(id) {
  const p = await api.get(`/v1/playlists/${id}`);
  const tracks = p.tracks.filter(t => t.has_audio);
  if (!tracks.length) return toast('Playlist trống', true);
  player.playQueue(tracks, 0, 'playlist');
}
async function playArtist(id) {
  const a = await api.get(`/v1/artists/${id}`);
  const tracks = a.top_tracks.filter(t => t.has_audio);
  if (!tracks.length) return toast('Nghệ sĩ chưa có bài phát được', true);
  player.playQueue(tracks, 0, 'artist');
}

/* ============================================================
   DELEGATED EVENTS
   ============================================================ */
document.addEventListener('click', async (e) => {
  const openAuthBtn = e.target.closest('[data-open-auth]');
  if (openAuthBtn) { location.href = loginUrl(); return; }

  const navEl = e.target.closest('[data-href]');
  if (navEl && !e.target.closest('[data-stop]')) {
    location.hash = navEl.dataset.href;
    return;
  }

  const playRel = e.target.closest('[data-play-release]');
  if (playRel) { e.preventDefault(); playRelease(playRel.dataset.playRelease).catch(err => toast(err.message, true)); return; }
  const playPl = e.target.closest('[data-play-playlist]');
  if (playPl) { e.preventDefault(); playPlaylist(playPl.dataset.playPlaylist).catch(err => toast(err.message, true)); return; }
  const playAr = e.target.closest('[data-play-artist]');
  if (playAr) { e.preventDefault(); playArtist(playAr.dataset.playArtist).catch(err => toast(err.message, true)); return; }

  const dlAlbumBtn = e.target.closest('[data-dl-album]');
  if (dlAlbumBtn) { downloadAlbum(dlAlbumBtn.dataset.dlAlbum); return; }

  const likeRelBtn = e.target.closest('[data-like-release]');
  if (likeRelBtn) {
    if (!requireAuth()) return;
    const id = likeRelBtn.dataset.likeRelease;
    const on = likeRelBtn.classList.contains('on');
    try {
      if (on) await api.del(`/v1/me/favorites/release/${id}`);
      else await api.put(`/v1/me/favorites/release/${id}`);
      likeRelBtn.classList.toggle('on', !on);
      likeRelBtn.innerHTML = icon(!on ? 'i-heart-f' : 'i-heart', 22);
      toast(!on ? 'Đã lưu album vào thư viện' : 'Đã bỏ lưu album');
    } catch (err) { toast(err.message, true); }
    return;
  }

  // bấm vào sóng mini → phát từ đúng vị trí đó (kể cả bài chưa phát)
  const waveEl = e.target.closest('.tr-wave');
  if (waveEl && !waveEl.classList.contains('empty')) {
    const row = waveEl.closest('.track-row');
    const listData = row && listRegistry.get(row.dataset.list);
    if (listData) {
      const frac = fractionFromEvent(waveEl, e);
      const track = listData.tracks[Number(row.dataset.idx)];
      if (player.current && player.current.id === track.id) {
        player.seek(frac);
        if (!player.playing) player.toggle();
      } else if (track.has_audio) {
        const playable = listData.tracks.filter(t => t.has_audio);
        player.playQueue(playable, playable.findIndex(t => t.id === track.id),
                         listData.source, frac);
      }
    }
    return;
  }

  // track row interactions
  const row = e.target.closest('.track-row');
  if (row) {
    const listData = listRegistry.get(row.dataset.list);
    if (!listData) return;
    const idx = Number(row.dataset.idx);
    const track = listData.tracks[idx];

    if (e.target.closest('.tr-like')) { toggleLikeTrack(track); return; }
    if (e.target.closest('.tr-dl')) { downloadTrack(track); return; }
    if (e.target.closest('.tr-info')) { openTrackDetails(track); return; }
    if (e.target.closest('.tr-more')) {
      const btn = e.target.closest('.tr-more');
      const rect = btn.getBoundingClientRect();
      openCtxMenu(rect.left, rect.bottom + 4, trackCtxItems(track, {
        playlistId: btn.dataset.playlist || null,
        isOwner: !!btn.dataset.owner,
      }));
      return;
    }
    if (e.target.closest('a')) return; // link nghệ sĩ/album

    if (player.current && player.current.id === track.id) { player.toggle(); return; }
    if (!track.has_audio) return toast('Bài hát chưa có file audio', true);
    const playable = listData.tracks.filter(t => t.has_audio);
    player.playQueue(playable, playable.findIndex(t => t.id === track.id), listData.source);
  }
});

// chuột phải trên track row → context menu
document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.track-row');
  if (!row) return;
  const listData = listRegistry.get(row.dataset.list);
  if (!listData) return;
  e.preventDefault();
  const track = listData.tracks[Number(row.dataset.idx)];
  const moreBtn = row.querySelector('.tr-more');
  openCtxMenu(e.clientX, e.clientY, trackCtxItems(track, {
    playlistId: moreBtn ? moreBtn.dataset.playlist || null : null,
    isOwner: moreBtn ? !!moreBtn.dataset.owner : false,
  }));
});

/* ============================================================
   PHÍM TẮT
   ============================================================ */
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('global-search').focus();
    $('global-search').select();
    return;
  }
  if (typing) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  switch (e.key) {
    case ' ': e.preventDefault(); player.toggle(); break;
    case 'ArrowRight': if (player.audio.duration) player.audio.currentTime = Math.min(player.audio.duration, player.audio.currentTime + 5); break;
    case 'ArrowLeft': player.audio.currentTime = Math.max(0, player.audio.currentTime - 5); break;
    case 'm': case 'M': player.toggleMute(); break;
    case 'Escape':
      if (!$('now-playing').hidden) closeNowPlaying();
      else { closeModal(); closeCtxMenu(); }
      break;
  }
});

/* ============================================================
   KHỞI ĐỘNG
   ============================================================ */
function bindChrome() {
  $('btn-back').onclick = () => history.back();
  $('btn-fwd').onclick = () => history.forward();
  $('btn-new-playlist').onclick = () => openPlaylistModal();
  $('np-close').onclick = closeNowPlaying;
  $('np-like').onclick = () => { if (player.current) toggleLikeTrack(player.current); };
  $('np-add-pl').onclick = () => { if (player.current) openAddToPlaylist(player.current); };
  $('np-share').onclick = () => {
    const t = player.current;
    if (!t) return;
    const url = `${location.origin}/#/album/${t.release ? t.release.id : ''}`;
    navigator.clipboard.writeText(url).then(() => toast('Đã sao chép liên kết'));
  };

  // ngôn ngữ VI/EN
  $('btn-lang').onclick = toggleLang;
  const langM = $('btn-lang-m');
  if (langM) langM.onclick = toggleLang;

  // theme
  const savedTheme = localStorage.getItem('ans_theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  $('btn-theme').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ans_theme', next);
  };

  // tìm kiếm global
  const input = $('global-search');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = input.value.trim();
      const target = q ? `#/search/${encodeURIComponent(q)}` : '#/search';
      if (location.hash !== target) {
        if (location.hash.startsWith('#/search')) {
          history.replaceState(null, '', target);
          route();
        } else location.hash = target;
      }
    }, 260);
  });
  input.addEventListener('focus', () => {
    if (!location.hash.startsWith('#/search')) {
      // giữ nguyên từ khóa đang có trong ô khi quay lại trang tìm kiếm
      const q = input.value.trim();
      location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/search';
    }
  });
}

player.addEventListener('track', updatePlayerTrackUI);
player.addEventListener('state', updatePlayerStateUI);
player.addEventListener('time', updateTimeUI);
player.addEventListener('volume', updateVolumeUI);
player.addEventListener('queue', renderQueuePanel);
player.addEventListener('error', (e) => toast(e.detail.message || 'Lỗi phát nhạc', true));

window.addEventListener('hashchange', route);
window.addEventListener('auth:change', () => {
  renderAuthArea();
  loadMyPlaylists();
  route();
});

applyBrand();
applyLangChrome();
bindChrome();
bindPlayerBar();
bindWaveInteractions();
bindTiltEffect();
waveLoop();
renderAuthArea();
loadMyPlaylists();
updateVolumeUI();
updatePlayerStateUI();
if (player.current) updatePlayerTrackUI();
route();
