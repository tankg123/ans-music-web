/* ANS Music — Admin CMS */
import { api, auth, uploadWithProgress } from './api.js?v=2.1.0';

const main = document.getElementById('a-main');
const h = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fmtCount = (n) => (n || 0).toLocaleString('vi-VN');
const fmtDur = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- Widget tiến độ upload (góc dưới phải, #upload-tray) ----------
   uploadTray.add(name) -> uid; .progress(uid,percent); .done(uid,ok,msg).
   Hiển thị từng file + % + progress bar và % tổng. File xong tự ẩn sau ~2s,
   lỗi thì giữ lại + đỏ. Có nút đóng để dọn toàn bộ. */
const uploadTray = (() => {
  const root = () => document.getElementById('upload-tray');
  let seq = 0;
  const rows = new Map(); // uid -> { name, percent, state:'up'|'ok'|'err', msg }

  function render() {
    const el = root();
    if (!el) return;
    if (rows.size === 0) { el.innerHTML = ''; el.classList.remove('show'); return; }
    // % tổng = trung bình các file (file xong tính 100)
    let sum = 0;
    for (const r of rows.values()) sum += r.state === 'ok' ? 100 : r.percent;
    const total = Math.round(sum / rows.size);
    const active = [...rows.values()].filter(r => r.state === 'up').length;
    const rowsHtml = [...rows.entries()].map(([uid, r]) => `
      <div class="ut-row ${r.state}" data-uid="${uid}">
        <div class="ut-row-top">
          <span class="ut-name" title="${h(r.name)}">${h(r.name)}</span>
          <span class="ut-pct">${r.state === 'err' ? '✕' : r.state === 'ok' ? '✓' : r.percent + '%'}</span>
        </div>
        <div class="ut-bar"><i style="width:${r.state === 'ok' ? 100 : r.percent}%"></i></div>
        ${r.msg ? `<div class="ut-msg">${h(r.msg)}</div>` : ''}
      </div>`).join('');
    el.innerHTML = `
      <div class="ut-panel">
        <div class="ut-head">
          <span class="ut-title">${active > 0 ? `Đang tải ${active} file…` : 'Tải lên'}</span>
          <span class="ut-total">${total}%</span>
          <button class="ut-close" title="Đóng">✕</button>
        </div>
        <div class="ut-total-bar"><i style="width:${total}%"></i></div>
        <div class="ut-rows">${rowsHtml}</div>
      </div>`;
    el.classList.add('show');
    el.querySelector('.ut-close').onclick = () => { rows.clear(); render(); };
  }

  return {
    add(name) {
      const uid = 'u' + (++seq);
      rows.set(uid, { name, percent: 0, state: 'up', msg: '' });
      render();
      return uid;
    },
    progress(uid, percent) {
      const r = rows.get(uid);
      if (!r || r.state !== 'up') return;
      r.percent = Math.max(0, Math.min(100, Math.round(percent)));
      render();
    },
    done(uid, ok, msg) {
      const r = rows.get(uid);
      if (!r) return;
      r.state = ok ? 'ok' : 'err';
      if (ok) r.percent = 100;
      r.msg = ok ? '' : (msg || 'Lỗi');
      render();
      if (ok) setTimeout(() => { rows.delete(uid); render(); }, 2000);
    },
  };
})();

function badge(status) {
  const labels = {
    live: 'Đang phát hành', draft: 'Nháp', pending_review: 'Chờ duyệt',
    scheduled: 'Hẹn giờ', taken_down: 'Đã gỡ', received: 'Đã nhận',
    validated: 'Đã validate', imported: 'Đã import', failed: 'Lỗi',
  };
  return `<span class="badge ${h(status)}">${labels[status] || h(status)}</span>`;
}

/* ---------- Brand: áp dụng ngay khi tải trang admin ---------- */
const BRAND = (window.ANS_CFG && window.ANS_CFG.brand) || {};
function applyAdminBrand() {
  const b = BRAND;
  const name = b.brand_name || 'ANS Music';
  const logo = b.brand_logo_url || '/static/img/logo.svg';
  if (b.brand_accent && /^#[0-9a-fA-F]{6}$/.test(b.brand_accent)) {
    document.documentElement.style.setProperty('--accent', b.brand_accent);
    document.documentElement.style.setProperty('--accent-soft', b.brand_accent + '22');
  }
  document.title = `${name} — Quản trị`;
  const el = document.getElementById('a-brand');
  if (el) el.innerHTML =
    `<img src="${logo}" width="30" height="30" alt=""><span>${h(name)} <b>Admin</b></span>`;
}
applyAdminBrand();

/* ---------- modal ---------- */
function openModal(html) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  const bd = root.firstElementChild;
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) closeModal(); });
  bd.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  return bd;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

/* ---------- validate helpers (khớp backend) ---------- */
const isrcOk = (v) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(v.replaceAll('-', '').toUpperCase());
function upcOk(v) {
  if (!/^\d{12,14}$/.test(v)) return false;
  const d = v.split('').map(Number);
  const chk = d.pop();
  d.reverse();
  const total = d.reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - total % 10) % 10 === chk;
}

/* ============================================================
   AUTH GATE — trang đăng nhập riêng tại /admin/login
   ============================================================ */
function gotoLogin() {
  location.replace('/admin/login');
}

// Các role được vào CMS (khớp STAFF_ROLES backend)
const STAFF_ROLES = ['admin', 'manager', 'uploader'];
// Trang đầu tiên sau đăng nhập theo role: uploader chỉ làm việc với Products
const landingFor = (role) => (role === 'uploader' ? 'products' : 'dashboard');
// manager trở lên (admin|manager) — quyền duyệt/phát hành trên GIAO DIỆN
// (backend vẫn là chốt chặn cuối qua require_manager)
const isManagerRole = () => ['admin', 'manager'].includes(auth.user?.role);

async function boot() {
  const checking = document.getElementById('auth-checking');
  const app = document.getElementById('admin-app');
  const enter = (role) => {
    checking.hidden = true;
    app.hidden = false;
    applyRoleNav(role);
    show(landingFor(role));
    // uploader không có quyền xem stats → khỏi gọi (nút review cũng đã ẩn)
    if (role !== 'uploader') refreshReviewPill();
  };
  // Render lạc quan: có phiên staff trong localStorage → hiện UI ngay, không chờ mạng
  if (auth.loggedIn && auth.user && STAFF_ROLES.includes(auth.user.role)) {
    const cachedRole = auth.user.role;
    enter(cachedRole);
    // Xác thực token chạy NỀN, không chặn giao diện:
    // - 401 → api.js tự auth.clear() + bắn 'auth:change' → listener cuối file gotoLogin()
    // - tài khoản không còn quyền staff → clear phiên + về trang đăng nhập
    // - lỗi mạng tạm thời → giữ nguyên phiên, KHÔNG đá user ra
    api.get('/v1/me').then((me) => {
      auth.set(auth.token, me);            // đồng bộ role mới nhất từ server
      if (!STAFF_ROLES.includes(me.role)) { auth.clear(); gotoLogin(); return; }
      if (me.role !== cachedRole) {
        // role vừa đổi trên server → dựng lại nav; nếu đang đứng ở section
        // vừa bị ẩn thì đưa về trang landing của role mới
        applyRoleNav(me.role);
        const act = document.querySelector('#a-nav button.active');
        if (!act || act.hidden) show(landingFor(me.role));
      }
    }).catch(() => { /* lỗi mạng tạm thời — bỏ qua */ });
    return;
  }
  // Có token nhưng role trong localStorage cũ/thiếu → hỏi server TRƯỚC khi đá về
  // trang đăng nhập (nếu redirect ngay sẽ tạo vòng lặp /admin ↔ /admin/login
  // khi tài khoản vừa được nâng quyền staff trong DB)
  if (auth.loggedIn) {
    try {
      const me = await api.get('/v1/me');
      auth.set(auth.token, me);
      if (STAFF_ROLES.includes(me.role)) { enter(me.role); return; }
    } catch { /* 401 → api.js đã clear; lỗi mạng → rơi xuống login */ }
  }
  gotoLogin();
}

document.getElementById('btn-logout').onclick = () => {
  auth.clear();
  gotoLogin();
};

/* ============================================================
   NAV
   ============================================================ */
const sections = {};
document.querySelectorAll('#a-nav button').forEach(b => {
  b.onclick = () => show(b.dataset.sec);
});

/* Phân quyền GIAO DIỆN theo role (backend vẫn là chốt chặn cuối):
   - uploader: chỉ thấy Products
   - manager:  ẩn Tài khoản, Cài đặt thương hiệu, Đối tác, Distributions (đặc quyền admin)
   - admin:    thấy tất cả */
const NAV_HIDDEN_BY_ROLE = {
  admin: [],
  manager: ['users', 'settings', 'partners', 'distributions'],
};
function applyRoleNav(role) {
  document.querySelectorAll('#a-nav button').forEach(b => {
    const sec = b.dataset.sec;
    b.hidden = role === 'uploader'
      ? sec !== 'products'
      : (NAV_HIDDEN_BY_ROLE[role] || []).includes(sec);
  });
  // Nhãn nhóm chỉ hiện khi còn ít nhất 1 nút hiển thị phía dưới nó
  document.querySelectorAll('#a-nav .nav-group-label').forEach(lb => {
    let el = lb.nextElementSibling, hasVisible = false;
    while (el && !el.classList.contains('nav-group-label')) {
      if (el.tagName === 'BUTTON' && !el.hidden) { hasVisible = true; break; }
      el = el.nextElementSibling;
    }
    lb.hidden = !hasVisible;
  });
  // Footer sidebar: ai đang đăng nhập — email + role
  const sf = document.getElementById('sf-user');
  if (sf && auth.user) sf.textContent = `${auth.user.email} — ${role}`;
}
function show(name) {
  document.querySelectorAll('#a-nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.sec === name));
  // section lỗi (server down/mất mạng) → báo rõ + nút thử lại, không đứng câm ở "Đang tải…"
  Promise.resolve(sections[name]()).catch((err) => {
    main.innerHTML = `
      <div class="sec-head"><h1>⚠ Không tải được dữ liệu</h1></div>
      <p class="empty-note">${h(err && err.message || 'Lỗi kết nối máy chủ')} —
        <a href="#" id="sec-retry">bấm để thử lại</a></p>`;
    const r = document.getElementById('sec-retry');
    if (r) r.onclick = (e) => { e.preventDefault(); show(name); };
  });
}

async function refreshReviewPill() {
  try {
    const s = await api.get('/admin/v1/stats');
    const pill = document.getElementById('pill-review');
    pill.textContent = s.pending_review;
    pill.classList.toggle('show', s.pending_review > 0);
  } catch { /* ignore */ }
}

/* ============================================================
   DASHBOARD
   ============================================================ */
sections.dashboard = async () => {
  main.innerHTML = '<div class="sec-head"><h1>📊 Tổng quan</h1></div><p class="empty-note">Đang tải…</p>';
  const s = await api.get('/admin/v1/stats');
  main.innerHTML = `
    <div class="sec-head"><h1>📊 Tổng quan</h1></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${fmtCount(s.plays_7d)}</div><div class="lbl">Lượt nghe 7 ngày</div></div>
      <div class="stat-card"><div class="num">${fmtCount(s.tracks_live)}/${fmtCount(s.tracks)}</div><div class="lbl">Bài hát đang phát hành</div></div>
      <div class="stat-card"><div class="num">${fmtCount(s.releases)}</div><div class="lbl">Release</div></div>
      <div class="stat-card"><div class="num">${fmtCount(s.artists)}</div><div class="lbl">Nghệ sĩ</div></div>
      <div class="stat-card"><div class="num">${fmtCount(s.users)}</div><div class="lbl">Người dùng</div></div>
      <div class="stat-card ${s.pending_review ? 'warn' : ''}"><div class="num">${s.pending_review}</div><div class="lbl">Chờ duyệt</div></div>
      <div class="stat-card ${s.failed_deliveries ? 'danger' : ''}"><div class="num">${s.failed_deliveries}</div><div class="lbl">Delivery lỗi</div></div>
    </div>
    <div class="two-col">
      <div class="panel">
        <h3>🔥 Top bài hát tuần</h3>
        <div class="tbl-wrap" style="border:none">
        <table><thead><tr><th>#</th><th>Bài hát</th><th style="text-align:right">Lượt nghe tuần</th></tr></thead>
        <tbody>${s.top_tracks_week.map((t, i) => `
          <tr><td>${i + 1}</td>
          <td><div class="cell-main"><img class="thumb" src="${t.cover_url || '/static/img/logo.svg'}">
            <div>${h(t.title)}<div class="sub">${(t.artists || []).map(a => h(a.name)).join(', ')}</div></div></div></td>
          <td style="text-align:right">${fmtCount(t.week_plays)}</td></tr>`).join('')
          || '<tr><td colspan="3" class="empty-note">Chưa có dữ liệu</td></tr>'}</tbody></table>
        </div>
      </div>
      <div class="panel">
        <h3>📦 Delivery gần đây</h3>
        <div class="tbl-wrap" style="border:none">
        <table><thead><tr><th>Đối tác</th><th>Loại</th><th>Trạng thái</th></tr></thead>
        <tbody>${s.recent_deliveries.map(d => `
          <tr><td>${h(d.partner_name || '—')}<div class="sub mono">${h(d.message_id || '')}</div></td>
          <td>${h(d.message_type || '—')}<div class="sub">ERN ${h(d.ern_version || '?')}</div></td>
          <td>${badge(d.status)}</td></tr>`).join('')
          || '<tr><td colspan="3" class="empty-note">Chưa nhận delivery nào — thử import ở mục DDEX Ingestion</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
  refreshReviewPill();
};

/* ============================================================
   BÀI HÁT
   ============================================================ */
sections.tracks = async (q = '') => {
  main.innerHTML = `
    <div class="sec-head"><h1>🎵 Bài hát</h1>
      <div class="tools">
        <input type="search" id="tr-search" placeholder="Tìm theo tên / ISRC…" value="${h(q)}">
        <button class="btn btn-primary" id="btn-new-track">＋ Thêm bài hát</button>
      </div></div>
    <div id="tr-table"><p class="empty-note">Đang tải…</p></div>`;

  document.getElementById('btn-new-track').onclick = () => openTrackModal();
  let timer;
  document.getElementById('tr-search').oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => renderTrackTable(e.target.value), 300);
  };
  await renderTrackTable(q);
};

async function renderTrackTable(q = '') {
  const box = document.getElementById('tr-table');
  const data = await api.get(`/admin/v1/tracks?q=${encodeURIComponent(q)}`);
  if (!box.isConnected) return;
  box.innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Bài hát</th><th>ISRC</th><th>Thời lượng</th><th>Audio</th><th>Lượt nghe</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${data.items.map(t => `
        <tr>
          <td><div class="cell-main"><img class="thumb" src="${t.cover_url || '/static/img/logo.svg'}">
            <div>${h(t.title)}<div class="sub">${(t.artists || []).map(a => h(a.name)).join(', ') || '—'}</div></div></div></td>
          <td class="mono">${h(t.isrc || '—')}</td>
          <td>${fmtDur(t.duration_ms)}</td>
          <td>${t.has_audio ? '✅' : '<span style="color:var(--warn)">✗ chưa có</span>'}</td>
          <td>${fmtCount(t.play_count)}</td>
          <td>${badge(t.status)}</td>
          <td class="actions">
            <button class="btn btn-ghost btn-sm" data-audio="${t.id}">⬆ Audio</button>
            <button class="btn btn-ghost btn-sm" data-edit="${t.id}">Sửa</button>
            <button class="btn btn-danger btn-sm" data-del="${t.id}">Xóa</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty-note">Không có bài hát nào</td></tr>'}
      </tbody></table></div>`;

  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const t = data.items.find(x => x.id === b.dataset.edit);
    openTrackModal(t);
  });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const t = data.items.find(x => x.id === b.dataset.del);
    if (!confirm(`Xóa vĩnh viễn “${t.title}”?`)) return;
    try {
      await api.del(`/admin/v1/tracks/${t.id}`);
      toast('Đã xóa bài hát');
      renderTrackTable(q);
    } catch (e) { toast(e.message, true); }
  });
  box.querySelectorAll('[data-audio]').forEach(b => b.onclick = () => {
    const t = data.items.find(x => x.id === b.dataset.audio);
    openAudioUpload(t, () => renderTrackTable(q));
  });
}

async function openTrackModal(track = null) {
  const [artists, releases] = await Promise.all([
    api.get('/admin/v1/artists'), api.get('/admin/v1/releases'),
  ]);
  const detail = track ? await api.get(`/v1/tracks/${track.id}`) : null;
  const lyricsData = track ? await api.get(`/v1/tracks/${track.id}/lyrics`).catch(() => ({})) : {};
  const selectedArtists = detail ? (detail.artists || []).map(a => a.id) : [];

  const modal = openModal(`
    <h2>${track ? 'Sửa bài hát' : 'Thêm bài hát (SoundRecording)'}</h2>
    <form id="track-form">
      <div class="field"><label>Tiêu đề *</label>
        <input name="title" required value="${h(track?.title || '')}"></div>
      <div class="grid2">
        <div class="field" id="f-isrc"><label>ISRC *</label>
          <input name="isrc" required placeholder="VNA0D2600001" value="${h(track?.isrc || '')}"
            style="text-transform:uppercase">
          <div class="help">Định dạng CC-XXX-YY-NNNNN (12 ký tự)</div></div>
        <div class="field"><label>Thể loại</label>
          <input name="genre" value="${h(track?.genre || '')}" placeholder="V-Pop, Ballad…"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Ngôn ngữ</label>
          <select name="language">
            <option value="vi">Tiếng Việt</option>
            <option value="en" ${detail?.language === 'en' ? 'selected' : ''}>English</option>
            <option value="ko" ${detail?.language === 'ko' ? 'selected' : ''}>한국어</option>
            <option value="ja" ${detail?.language === 'ja' ? 'selected' : ''}>日本語</option>
          </select></div>
        <div class="field"><label>Cảnh báo nội dung</label>
          <select name="parental_warning">
            <option value="NotExplicit">NotExplicit</option>
            <option value="Explicit" ${detail?.parental_warning === 'Explicit' ? 'selected' : ''}>Explicit</option>
            <option value="Edited" ${detail?.parental_warning === 'Edited' ? 'selected' : ''}>Edited (Clean)</option>
          </select></div>
      </div>
      <div class="field"><label>℗ P-Line</label>
        <input name="p_line" value="${h(detail?.p_line || '')}" placeholder="℗ 2026 Label Name"></div>
      <div class="grid2">
        <div class="field"><label>Nghệ sĩ (Ctrl+click để chọn nhiều — người đầu = MainArtist)</label>
          <select name="artist_ids" multiple size="5">
            ${artists.items.map(a => `<option value="${a.id}" ${selectedArtists.includes(a.id) ? 'selected' : ''}>${h(a.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Thuộc Release</label>
          <select name="release_id" ${track ? 'disabled' : ''}>
            <option value="">— Không gắn —</option>
            ${releases.items.map(r => `<option value="${r.id}" ${detail?.release?.id === r.id ? 'selected' : ''}>${h(r.title)} (${h(r.release_type)})</option>`).join('')}
          </select>
          <div class="help">${track ? 'Đổi tracklist trong trang Release' : ''}</div></div>
      </div>
      <div class="field"><label>Lời bài hát (LRC đồng bộ hoặc plain text)</label>
        <textarea name="lyrics_lrc" rows="3" placeholder="[00:12.00]Câu hát đầu tiên…">${h(lyricsData.lrc || '')}</textarea>
        <div class="help">Để trống nếu chưa có; định dạng [mm:ss.xx] cho karaoke</div></div>
      ${track ? `<div class="field"><label>Trạng thái</label>
        <select name="status">
          <option value="draft" ${track.status === 'draft' ? 'selected' : ''}>Nháp</option>
          <option value="live" ${track.status === 'live' ? 'selected' : ''}>Phát hành</option>
          <option value="taken_down" ${track.status === 'taken_down' ? 'selected' : ''}>Gỡ xuống</option>
        </select></div>` : ''}
      <div class="form-error" id="track-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">${track ? 'Lưu thay đổi' : 'Tạo bài hát'}</button>
      </div>
    </form>`);

  const isrcInput = modal.querySelector('[name=isrc]');
  isrcInput.oninput = () => {
    modal.querySelector('#f-isrc').classList.toggle('invalid',
      !!isrcInput.value && !isrcOk(isrcInput.value));
  };

  modal.querySelector('#track-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'), isrc: fd.get('isrc'),
      genre: fd.get('genre') || null, language: fd.get('language'),
      parental_warning: fd.get('parental_warning'), p_line: fd.get('p_line') || null,
      lyrics_lrc: fd.get('lyrics_lrc') || null,
      lyrics: lyricsData.lyrics || null,   // giữ nguyên plain lyrics khi sửa
      subtitle: detail?.subtitle || null,  // giữ nguyên subtitle khi sửa
      artist_ids: [...e.target.querySelector('[name=artist_ids]').selectedOptions].map(o => o.value),
      release_id: fd.get('release_id') || null,
      status: fd.get('status') || 'draft',
    };
    try {
      if (track) await api.patch(`/admin/v1/tracks/${track.id}`, body);
      else await api.post('/admin/v1/tracks', body);
      toast(track ? 'Đã lưu' : 'Đã tạo bài hát — upload audio để phát hành');
      closeModal();
      renderTrackTable(document.getElementById('tr-search')?.value || '');
    } catch (err) { modal.querySelector('#track-error').textContent = err.message; }
  };
}

function openAudioUpload(track, onDone, productId) {
  const modal = openModal(`
    <h2>⬆ Upload audio — ${h(track.title)}</h2>
    <div class="dropzone" id="dz">Kéo thả file vào đây hoặc <b>chọn file</b><br>
      <span style="font-size:12px">WAV / FLAC / MP3 / M4A / OGG — khuyến nghị WAV/FLAC ≥16-bit 44.1kHz</span></div>
    <input type="file" id="audio-file" accept=".wav,.flac,.mp3,.m4a,.ogg,.opus" hidden>
    <div class="form-error" id="up-error"></div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Đóng</button></div>`);
  const dz = modal.querySelector('#dz');
  const fileInput = modal.querySelector('#audio-file');
  dz.onclick = () => fileInput.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]);
  };
  fileInput.onchange = () => { if (fileInput.files[0]) doUpload(fileInput.files[0]); };

  async function doUpload(file) {
    dz.textContent = `Đang upload ${file.name}…`;
    const fd = new FormData();
    fd.append('file', file);
    try {
      // endpoint scoped theo product (mức staff) khi có productId → uploader dùng được;
      // không thì endpoint global (chỉ manager/admin — dùng ở section Bài hát)
      const url = productId
        ? `/admin/v1/products/${productId}/tracks/${track.id}/audio`
        : `/admin/v1/tracks/${track.id}/audio`;
      const res = await api.upload(url, fd);
      toast(`Đã upload — thời lượng ${fmtDur(res.duration_ms)}`);
      if (res.duplicate_of) toast(`⚠ File trùng hash với “${res.duplicate_of.title}”`, true);
      closeModal();
      onDone && onDone();
    } catch (e) {
      modal.querySelector('#up-error').textContent = e.message;
      dz.innerHTML = 'Kéo thả file vào đây hoặc <b>chọn file</b>';
    }
  }
}

/* ============================================================
   RELEASE
   ============================================================ */
sections.releases = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>💿 Release (Album / Single / EP)</h1>
      <div class="tools">
        <input type="search" id="rl-search" placeholder="Tìm release…">
        <button class="btn btn-primary" id="btn-new-release">＋ Tạo release</button>
      </div></div>
    <div id="rl-table"><p class="empty-note">Đang tải…</p></div>`;
  document.getElementById('btn-new-release').onclick = () => openReleaseModal();
  let timer;
  document.getElementById('rl-search').oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => renderReleaseTable(e.target.value), 300);
  };
  await renderReleaseTable();
};

async function renderReleaseTable(q = '') {
  const box = document.getElementById('rl-table');
  const data = await api.get(`/admin/v1/releases?q=${encodeURIComponent(q)}`);
  if (!box.isConnected) return;
  box.innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Release</th><th>UPC</th><th>Loại</th><th>Số bài</th><th>Nguồn</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${data.items.map(r => `
        <tr>
          <td><div class="cell-main"><img class="thumb" src="${r.cover_url || '/static/img/logo.svg'}">
            <div>${h(r.title)}<div class="sub">${(r.artists || []).map(a => h(a.name)).join(', ') || '—'}</div></div></div></td>
          <td class="mono">${h(r.upc || '—')}</td>
          <td>${h(r.release_type)}</td>
          <td>${r.track_count}</td>
          <td class="sub">${r.status === 'pending_review' || r.liked === undefined ? '' : ''}${h(r.label_name || '—')}</td>
          <td>${badge(r.status)}</td>
          <td class="actions">
            <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Sửa</button>
            <button class="btn btn-danger btn-sm" data-del="${r.id}">Xóa</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty-note">Chưa có release nào</td></tr>'}
      </tbody></table></div>`;

  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const r = data.items.find(x => x.id === b.dataset.edit);
    openReleaseModal(r);
  });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const r = data.items.find(x => x.id === b.dataset.del);
    if (!confirm(`Xóa release “${r.title}”? (Bài hát bên trong không bị xóa)`)) return;
    try {
      await api.del(`/admin/v1/releases/${r.id}`);
      toast('Đã xóa release');
      renderReleaseTable(q);
    } catch (e) { toast(e.message, true); }
  });
}

async function openReleaseModal(release = null) {
  const artists = await api.get('/admin/v1/artists');
  const detail = release ? await api.get(`/v1/albums/${release.id}`) : null;
  const selected = detail ? (detail.artists || []).map(a => a.id) : [];

  const modal = openModal(`
    <h2>${release ? 'Sửa release' : 'Tạo release mới'}</h2>
    <form id="rl-form">
      <div class="field"><label>Tiêu đề *</label>
        <input name="title" required value="${h(release?.title || '')}"></div>
      <div class="grid2">
        <div class="field" id="f-upc"><label>UPC/EAN *</label>
          <input name="upc" required placeholder="0827969279321" value="${h(release?.upc || '')}">
          <div class="help">12–14 số, có checksum GTIN</div></div>
        <div class="field"><label>Loại</label>
          <select name="release_type">
            ${['Album', 'Single', 'EP', 'Compilation'].map(t =>
              `<option ${release?.release_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Hãng đĩa (Label)</label>
          <input name="label_name" value="${h(release?.label_name || '')}"></div>
        <div class="field"><label>Thể loại</label>
          <input name="genre" value="${h(release?.genre || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>℗ P-Line</label>
          <input name="p_line" value="${h(detail?.p_line || '')}" placeholder="℗ 2026 Label"></div>
        <div class="field"><label>© C-Line</label>
          <input name="c_line" value="${h(detail?.c_line || '')}" placeholder="© 2026 Label"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Ngày phát hành gốc</label>
          <input name="original_release_date" type="date" value="${h(detail?.original_release_date || '')}"></div>
        <div class="field"><label>Ngày lên nền tảng</label>
          <input name="platform_release_date" type="date" value="${h((detail?.platform_release_date || '').slice(0, 10))}"></div>
      </div>
      <div class="field"><label>Cảnh báo nội dung (release)</label>
        <select name="parental_warning">
          <option value="NotExplicit">NotExplicit</option>
          <option value="Explicit" ${detail?.parental_warning === 'Explicit' ? 'selected' : ''}>Explicit</option>
          <option value="Edited" ${detail?.parental_warning === 'Edited' ? 'selected' : ''}>Edited (Clean)</option>
        </select></div>
      <div class="grid2">
        <div class="field"><label>Nghệ sĩ chính</label>
          <select name="artist_ids" multiple size="4">
            ${artists.items.map(a => `<option value="${a.id}" ${selected.includes(a.id) ? 'selected' : ''}>${h(a.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Trạng thái</label>
          <select name="status">
            <option value="draft" ${(!release || release.status === 'draft') ? 'selected' : ''}>Nháp</option>
            <option value="pending_review" ${release?.status === 'pending_review' ? 'selected' : ''}>Chờ duyệt</option>
            <option value="live" ${release?.status === 'live' ? 'selected' : ''}>Phát hành</option>
            <option value="scheduled" ${release?.status === 'scheduled' ? 'selected' : ''}>Hẹn giờ (theo ngày lên nền tảng)</option>
            <option value="taken_down" ${release?.status === 'taken_down' ? 'selected' : ''}>Gỡ xuống</option>
          </select></div>
      </div>
      ${release ? `<div class="field"><label>Ảnh bìa (JPG/PNG ≥3000×3000 khuyến nghị)</label>
        <input type="file" name="cover" accept=".jpg,.jpeg,.png,.webp,.svg"></div>` : ''}
      <div class="form-error" id="rl-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">${release ? 'Lưu' : 'Tạo release'}</button>
      </div>
    </form>`);

  const upcInput = modal.querySelector('[name=upc]');
  upcInput.oninput = () => {
    modal.querySelector('#f-upc').classList.toggle('invalid',
      !!upcInput.value && !upcOk(upcInput.value));
  };

  modal.querySelector('#rl-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'), upc: fd.get('upc'),
      release_type: fd.get('release_type'), label_name: fd.get('label_name') || null,
      genre: fd.get('genre') || null,
      p_line: fd.get('p_line') || null, c_line: fd.get('c_line') || null,
      parental_warning: fd.get('parental_warning') || 'NotExplicit',
      original_release_date: fd.get('original_release_date') || null,
      platform_release_date: fd.get('platform_release_date') || null,
      artist_ids: [...e.target.querySelector('[name=artist_ids]').selectedOptions].map(o => o.value),
      status: fd.get('status'),
    };
    try {
      let rid = release?.id;
      if (release) await api.patch(`/admin/v1/releases/${release.id}`, body);
      else rid = (await api.post('/admin/v1/releases', body)).id;
      const cover = fd.get('cover');
      if (cover && cover.size) {
        const cfd = new FormData();
        cfd.append('file', cover);
        await api.upload(`/admin/v1/releases/${rid}/cover`, cfd);
      }
      toast(release ? 'Đã lưu' : 'Đã tạo release');
      closeModal();
      renderReleaseTable();
    } catch (err) { modal.querySelector('#rl-error').textContent = err.message; }
  };
}

/* ============================================================
   NGHỆ SĨ — grid card + trang chi tiết (v2.0)
   ============================================================ */
// màu accent an toàn cho avatar chữ cái (fallback màu tím brand)
const artistColor = (a) =>
  /^#[0-9a-fA-F]{6}$/.test(a.accent || '') ? a.accent : '#7c5cff';
// avatar tròn: ảnh nếu có, không thì chữ cái đầu trên nền accent
function artistAvatarHtml(a, cls = 'artist-photo') {
  if (a.image_url) return `<img class="${cls}" src="${h(a.image_url)}" alt="" loading="lazy">`;
  const c = artistColor(a);
  return `<span class="${cls} letter" style="background:${c}26;color:${c}">${
    h((a.name || '?').trim().charAt(0).toUpperCase())}</span>`;
}

sections.artists = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>🎤 Nghệ sĩ</h1>
      <div class="tools">
        <input type="search" id="ar-search" placeholder="Tìm nghệ sĩ…">
        <button class="btn btn-primary" id="btn-new-artist">＋ Thêm nghệ sĩ</button>
      </div></div>
    <div id="ar-grid"><p class="empty-note">Đang tải…</p></div>`;
  document.getElementById('btn-new-artist').onclick = () => openArtistModal();
  let timer;
  document.getElementById('ar-search').oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => renderArtistGrid(e.target.value), 300);
  };
  await renderArtistGrid();
};

async function renderArtistGrid(q = '') {
  const box = document.getElementById('ar-grid');
  const data = await api.get(`/admin/v1/artists?q=${encodeURIComponent(q)}`);
  if (!box || !box.isConnected) return;
  box.innerHTML = data.items.length ? `
    <div class="artist-grid">${data.items.map(a => `
      <div class="artist-card" data-open="${a.id}">
        ${artistAvatarHtml(a)}
        <div class="a-name" title="${h(a.name)}">${h(a.name)}</div>
        <div class="a-sub">${a.type === 'group' ? 'Nhóm nhạc' : 'Cá nhân'}${a.country ? ` · ${h(a.country)}` : ''}</div>
        <div class="a-counts">${fmtCount(a.track_count)} bài · ${fmtCount(a.release_count)} release · ${fmtCount(a.followers)} follower</div>
      </div>`).join('')}</div>`
    : `<div class="panel empty-note">Chưa có nghệ sĩ nào${q ? ' khớp tìm kiếm' : ''}</div>`;
  box.querySelectorAll('[data-open]').forEach(c =>
    c.onclick = () => showArtist(c.dataset.open));
}

/* ---------- Trang chi tiết nghệ sĩ: ảnh + hồ sơ + top tracks/releases ---------- */
async function showArtist(id) {
  document.querySelectorAll('#a-nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.sec === 'artists'));
  main.innerHTML = '<p class="empty-note">Đang tải nghệ sĩ…</p>';
  let a;
  try { a = await api.get(`/admin/v1/artists/${id}`); }
  catch (err) {
    main.innerHTML = `<div class="sec-head"><h1>⚠ Không mở được nghệ sĩ</h1></div>
      <p class="empty-note">${h(err.message || 'Lỗi kết nối')} — <a href="#" id="ar-back">quay lại</a></p>`;
    const b = document.getElementById('ar-back');
    if (b) b.onclick = (e) => { e.preventDefault(); show('artists'); };
    return;
  }
  main.innerHTML = `
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:10px">
      <a href="javascript:void 0" id="bc-artists" style="color:var(--accent)">Nghệ sĩ</a> › ${h(a.name)}</p>
    <div class="artist-layout">
      <div class="panel" style="text-align:center">
        <div class="artist-photo-wrap" id="ar-photo-wrap"
          title="Bấm hoặc kéo thả ảnh vào đây để đổi (PNG/JPG/WebP ≤5MB)">
          ${artistAvatarHtml(a, 'artist-photo lg')}
          <div class="overlay">⬆ Đổi ảnh</div>
        </div>
        <input type="file" id="ar-photo-file" accept=".png,.jpg,.jpeg,.webp" hidden>
        <div class="artist-stats">
          <div><div class="n">${fmtCount(a.track_count)}</div><div class="l">Bài hát</div></div>
          <div><div class="n">${fmtCount(a.release_count)}</div><div class="l">Release</div></div>
          <div><div class="n">${fmtCount(a.followers)}</div><div class="l">Follower</div></div>
        </div>
        <p style="color:var(--muted);font-size:11.5px;margin:6px 0 14px">
          Tạo lúc ${h((a.created_at || '').slice(0, 10) || '—')}</p>
        <button class="btn btn-danger btn-sm" id="ar-del">🗑 Xóa nghệ sĩ</button>
      </div>
      <div>
        <div class="panel">
          <h3>Hồ sơ nghệ sĩ</h3>
          <div class="field"><label>Tên *</label><input id="af-name" value="${h(a.name)}"></div>
          <div class="grid2">
            <div class="field"><label>Loại</label>
              <select id="af-type">
                <option value="person" ${a.type !== 'group' ? 'selected' : ''}>Cá nhân (Person)</option>
                <option value="group" ${a.type === 'group' ? 'selected' : ''}>Nhóm nhạc (Group)</option>
              </select></div>
            <div class="field"><label>Quốc gia (ISO-2)</label>
              <input id="af-country" maxlength="2" placeholder="VN" value="${h(a.country || '')}" style="text-transform:uppercase"></div>
          </div>
          <div class="grid2">
            <div class="field"><label>ISNI</label>
              <input id="af-isni" placeholder="0000 0001 2345 6789" value="${h(a.isni || '')}"></div>
            <div class="field"><label>IPI</label><input id="af-ipi" value="${h(a.ipi || '')}"></div>
          </div>
          <div class="field"><label>Màu accent (tô điểm trang nghệ sĩ trên web nghe nhạc)</label>
            <div style="display:flex;gap:10px;align-items:center">
              <input type="color" id="af-accent" value="${h(artistColor(a))}" style="width:52px;height:38px;padding:2px">
              <span class="mono" id="af-accent-hex">${h(artistColor(a))}</span>
            </div></div>
          <div class="field"><label>Tiểu sử</label>
            <textarea id="af-bio" rows="4">${h(a.bio || '')}</textarea></div>
          <div class="form-error" id="af-error"></div>
          <button class="btn btn-primary" id="af-save">Lưu thay đổi</button>
        </div>
        <div class="two-col">
          <div class="panel">
            <h3>🔥 Top bài hát</h3>
            ${(a.top_tracks || []).length ? `<div class="tbl-wrap" style="border:none"><table>
              <thead><tr><th>Bài hát</th><th>ISRC</th><th style="text-align:right">Lượt nghe</th></tr></thead>
              <tbody>${a.top_tracks.map(t => `
                <tr><td>${h(t.title)}</td>
                <td class="mono">${h(t.isrc || '—')}</td>
                <td style="text-align:right">${fmtCount(t.play_count)}</td></tr>`).join('')}</tbody></table></div>`
            : '<p class="empty-note">Chưa có bài hát nào</p>'}
          </div>
          <div class="panel">
            <h3>💿 Releases</h3>
            ${(a.releases || []).length ? `<div class="tbl-wrap" style="border:none"><table>
              <thead><tr><th>Release</th><th>Trạng thái</th></tr></thead>
              <tbody>${a.releases.map(r => `
                <tr><td>${h(r.title)}</td><td>${badge(r.status)}</td></tr>`).join('')}</tbody></table></div>`
            : '<p class="empty-note">Chưa gắn release nào</p>'}
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('bc-artists').onclick = () => show('artists');

  // upload ảnh: click hoặc kéo thả — cập nhật ngay tại chỗ, không reload trang
  const wrap = document.getElementById('ar-photo-wrap');
  const fileInput = document.getElementById('ar-photo-file');
  wrap.onclick = () => fileInput.click();
  wrap.ondragover = (e) => { e.preventDefault(); wrap.classList.add('over'); };
  wrap.ondragleave = () => wrap.classList.remove('over');
  wrap.ondrop = (e) => {
    e.preventDefault();
    wrap.classList.remove('over');
    if (e.dataTransfer.files[0]) uploadPhoto(e.dataTransfer.files[0]);
  };
  fileInput.onchange = () => {
    if (fileInput.files[0]) uploadPhoto(fileInput.files[0]);
    fileInput.value = '';
  };
  async function uploadPhoto(f) {
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await api.upload(`/admin/v1/artists/${id}/image`, fd);
      // tên file server có token ngẫu nhiên → gán src mới là thấy ảnh mới ngay
      wrap.innerHTML = `<img class="artist-photo lg" src="${h(res.image_url)}" alt="">
        <div class="overlay">⬆ Đổi ảnh</div>`;
      toast('Đã cập nhật ảnh nghệ sĩ');
    } catch (e) { toast(e.message, true); }
  }

  // đồng bộ mã hex hiển thị cạnh color picker
  const accentInput = document.getElementById('af-accent');
  accentInput.oninput = () => {
    document.getElementById('af-accent-hex').textContent = accentInput.value;
  };

  document.getElementById('af-save').onclick = async () => {
    const g = (i) => document.getElementById(i).value.trim();
    const errEl = document.getElementById('af-error');
    errEl.textContent = '';
    try {
      await api.patch(`/admin/v1/artists/${id}`, {
        name: g('af-name'),
        type: document.getElementById('af-type').value,
        country: g('af-country').toUpperCase() || null,
        isni: g('af-isni') || null,
        ipi: g('af-ipi') || null,
        bio: g('af-bio') || null,
        accent: accentInput.value,
      });
      toast('Đã lưu hồ sơ nghệ sĩ');
      showArtist(id);
    } catch (e) { errEl.textContent = e.message; }
  };

  document.getElementById('ar-del').onclick = async () => {
    if (!confirm(`Xóa nghệ sĩ “${a.name}”? Không thể hoàn tác.`)) return;
    try {
      await api.del(`/admin/v1/artists/${id}`);
      toast('Đã xóa nghệ sĩ');
      show('artists');
    } catch (e) {
      // 409: còn gắn track/release — server nêu rõ số lượng để gỡ trước
      toast(e.message, true);
    }
  };
}

/* ---------- Modal thêm nghệ sĩ mới (sửa chi tiết làm trong trang hồ sơ) ---------- */
function openArtistModal() {
  const modal = openModal(`
    <h2>Thêm nghệ sĩ (Party)</h2>
    <form id="ar-form">
      <div class="field"><label>Tên *</label><input name="name" required></div>
      <div class="grid2">
        <div class="field"><label>Loại</label>
          <select name="type">
            <option value="person">Cá nhân (Person)</option>
            <option value="group">Nhóm nhạc (Group)</option>
          </select></div>
        <div class="field"><label>Quốc gia (ISO-2)</label>
          <input name="country" maxlength="2" placeholder="VN" style="text-transform:uppercase"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>ISNI</label>
          <input name="isni" placeholder="0000 0001 2345 6789"></div>
        <div class="field"><label>IPI</label>
          <input name="ipi"></div>
      </div>
      <div class="field"><label>Tiểu sử</label>
        <textarea name="bio" rows="3"></textarea></div>
      <div class="form-error" id="ar-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">Thêm nghệ sĩ</button>
      </div>
    </form>`);
  modal.querySelector('#ar-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api.post('/admin/v1/artists', {
        name: fd.get('name'), type: fd.get('type'),
        country: (fd.get('country') || '').toUpperCase() || null,
        isni: fd.get('isni') || null, ipi: fd.get('ipi') || null,
        bio: fd.get('bio') || null,
      });
      toast('Đã thêm nghệ sĩ');
      closeModal();
      showArtist(res.id);   // mở luôn hồ sơ để upload ảnh + bổ sung field
    } catch (err) { modal.querySelector('#ar-error').textContent = err.message; }
  };
}

/* ============================================================
   REVIEW QUEUE
   ============================================================ */
sections.review = async () => {
  main.innerHTML = `<div class="sec-head"><h1>✅ Hàng chờ duyệt</h1></div>
    <p class="empty-note">Đang tải…</p>`;
  const data = await api.get('/admin/v1/review-queue');
  main.innerHTML = `
    <div class="sec-head"><h1>✅ Hàng chờ duyệt</h1></div>
    <p style="color:var(--muted);font-size:13.5px;margin:-12px 0 18px">
      Nội dung từ DDEX feed (đối tác chưa bật auto-publish) chờ Content Manager phê duyệt.</p>
    ${data.items.length ? `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Release</th><th>UPC</th><th>Loại</th><th>Số bài</th><th>Label</th><th></th></tr></thead>
      <tbody>${data.items.map(r => `
        <tr>
          <td><div class="cell-main"><img class="thumb" src="${r.cover_url}">
            <div>${h(r.title)}<div class="sub">${(r.artists || []).map(a => h(a.name)).join(', ') || '—'}</div></div></div></td>
          <td class="mono">${h(r.upc || '—')}</td>
          <td>${h(r.release_type)}</td>
          <td>${r.track_count}</td>
          <td>${h(r.label_name || '—')}</td>
          <td class="actions">
            <button class="btn btn-ok btn-sm" data-ok="${r.id}">✓ Duyệt</button>
            <button class="btn btn-danger btn-sm" data-no="${r.id}">✗ Từ chối</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="panel empty-note">🎉 Không có nội dung nào chờ duyệt</div>'}`;

  main.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
    try {
      await api.post(`/admin/v1/review-queue/${b.dataset.ok}/approve`);
      toast('Đã duyệt — release lên catalog');
      sections.review();
      refreshReviewPill();
    } catch (e) { toast(e.message, true); }
  });
  main.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => {
    if (!confirm('Từ chối release này?')) return;
    try {
      await api.post(`/admin/v1/review-queue/${b.dataset.no}/reject`);
      toast('Đã từ chối');
      sections.review();
      refreshReviewPill();
    } catch (e) { toast(e.message, true); }
  });
};

/* ============================================================
   DDEX INGESTION
   ============================================================ */
sections.ddex = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>📦 DDEX Ingestion</h1></div>
    <div class="two-col">
      <div class="panel">
        <h3>Import gói DDEX ERN (NewReleaseMessage / PurgeReleaseMessage)</h3>
        <p style="color:var(--muted);font-size:13px;margin-bottom:14px;line-height:1.6">
          Nhận file <b>ERN 3.8.2 / 4.3 XML</b> từ distributor — giống pipeline YouTube.
          Trong production, kênh nhận là SFTP/S3 per-partner; ở đây upload trực tiếp để demo/kiểm thử.
          File mẫu có sẵn tại <span class="mono">samples/ddex/</span> trong thư mục dự án.</p>
        <div class="dropzone" id="ddex-dz">Kéo thả file <b>.xml</b> vào đây hoặc <b>chọn file</b></div>
        <input type="file" id="ddex-file" accept=".xml" hidden>
        <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:var(--muted)">
          <input type="checkbox" id="ddex-autopub" style="width:auto"> Auto-publish (bỏ qua Review Queue)
        </label>
        <div id="ddex-result" style="margin-top:16px"></div>
      </div>
      <div class="panel">
        <h3>Lịch sử delivery</h3>
        <div id="ddex-table"><p class="empty-note">Đang tải…</p></div>
      </div>
    </div>`;

  const dz = document.getElementById('ddex-dz');
  const fi = document.getElementById('ddex-file');
  dz.onclick = () => fi.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files[0]) doImport(e.dataTransfer.files[0]);
  };
  fi.onchange = () => { if (fi.files[0]) doImport(fi.files[0]); };

  async function doImport(file) {
    const auto = document.getElementById('ddex-autopub').checked;
    const result = document.getElementById('ddex-result');
    result.innerHTML = '<p class="empty-note">Đang xử lý delivery…</p>';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const rep = await api.upload(`/admin/v1/ddex/import?auto_publish=${auto}`, fd);
      const cls = rep.status === 'imported' ? '' : 'err';
      result.innerHTML = `
        <div style="margin-bottom:8px">${badge(rep.status === 'duplicate' ? 'received' : rep.status)}
          ${rep.status === 'duplicate' ? '(đã xử lý trước đó — idempotent)' : ''}</div>
        <div class="logbox">${rep.log.map(l =>
          `<div class="${l.startsWith('LỖI') ? 'err' : ''}">${h(l)}</div>`).join('')}</div>`;
      if (rep.status === 'imported') toast('Import thành công');
      renderDeliveryTable();
      refreshReviewPill();
    } catch (e) {
      result.innerHTML = `<div class="logbox"><div class="err">${h(e.message)}</div></div>`;
    }
    fi.value = '';
  }

  renderDeliveryTable();
};

async function renderDeliveryTable() {
  const box = document.getElementById('ddex-table');
  if (!box) return;
  const data = await api.get('/admin/v1/deliveries');
  if (!box.isConnected) return;
  box.innerHTML = data.items.length ? `
    <div class="tbl-wrap" style="border:none"><table>
      <thead><tr><th>Đối tác / MessageId</th><th>Loại</th><th>Nhận lúc</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${data.items.map(d => `
        <tr>
          <td>${h(d.partner_name || '—')}<div class="sub mono">${h(d.message_id || '')}</div></td>
          <td>${h((d.message_type || '—').replace('Message', ''))}<div class="sub">ERN ${h(d.ern_version || '?')}</div></td>
          <td class="sub">${h(d.received_at || '')}</td>
          <td>${badge(d.status)}</td>
          <td class="actions"><button class="btn btn-ghost btn-sm" data-log="${d.id}">Log</button></td>
        </tr>`).join('')}</tbody></table></div>`
    : '<p class="empty-note">Chưa nhận delivery nào</p>';
  box.querySelectorAll('[data-log]').forEach(b => b.onclick = async () => {
    const d = await api.get(`/admin/v1/deliveries/${b.dataset.log}`);
    openModal(`
      <h2>Delivery log</h2>
      <p class="mono" style="margin-bottom:12px">${h(d.id)} · ${h(d.message_type || '')} · ERN ${h(d.ern_version || '?')}</p>
      <div class="logbox">${h(d.log || '(trống)')}</div>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Đóng</button></div>`);
  });
}

/* ============================================================
   UPLOAD STUDIO — đưa nhạc lên trong một màn hình
   ============================================================ */
function extractAccent(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 40;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 40, 40);
        const d = ctx.getImageData(0, 0, 40, 40).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        const hex = '#' + [r, g, b].map(x => Math.round(x / n).toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch { resolve(null); }
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

let studioSession = 0;   // vô hiệu closure cũ khi rời trang / vào lại giữa lúc upload

sections.studio = async () => {
  const session = ++studioSession;
  const info = await api.get('/admin/v1/studio/info').catch(() => ({ ffmpeg: false, next_isrc: '' }));
  if (session !== studioSession) return;
  main.innerHTML = `
    <div class="sec-head"><h1>⬆ Đưa nhạc lên</h1>
      <div class="tools" style="font-size:12.5px;color:var(--muted)">
        ${info.ffmpeg ? '⚡ Chuẩn hóa WAV 44.1kHz + stream AAC: <b style="color:var(--ok)">bật</b>' : 'Chuẩn hóa: tắt (không có ffmpeg)'}
        &nbsp;·&nbsp; Kho ISRC: <b>${info.pool?.isrc?.available ?? 0}</b>
        &nbsp;·&nbsp; Kho UPC: <b>${info.pool?.upc?.available ?? 0}</b>
        &nbsp;·&nbsp; ISRC kế tiếp: <span class="mono">${h(info.next_isrc || '—')}</span>
      </div></div>

    <div class="panel">
      <div class="studio-step"><span class="num">1</span> Chọn file nhạc — khuyến nghị WAV 44.1kHz (nhận cả FLAC/MP3/M4A, hệ thống tự chuẩn hóa về WAV 44.1kHz)</div>
      <div class="dropzone" id="st-dz">Kéo thả file vào đây hoặc <b>chọn file</b></div>
      <input type="file" id="st-files" multiple accept=".wav,.flac,.mp3,.m4a,.ogg,.opus" hidden>
      <div id="st-filelist" style="margin-top:12px"></div>
    </div>

    <div id="st-rest" hidden>
      <div class="panel">
        <div class="studio-step"><span class="num">2</span> Thông tin release</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="flex:1;min-width:280px">
            <div class="field"><label>Tên release *</label><input id="st-title"></div>
            <div class="grid2">
              <div class="field"><label>Nghệ sĩ chính (cách nhau dấu phẩy)</label><input id="st-artists" placeholder="VD: Hà Phương Linh"></div>
              <div class="field"><label>Thể loại</label><input id="st-genre" placeholder="V-Pop, Ballad…"></div>
            </div>
            <div class="grid2">
              <div class="field"><label>UPC <span style="font-weight:400">(trống → tự sinh nội bộ)</span></label><input id="st-upc" placeholder="Tự sinh"></div>
              <div class="field"><label>Hãng đĩa</label><input id="st-label"></div>
            </div>
            <div class="grid2">
              <div class="field"><label>℗ P-Line</label><input id="st-pline" placeholder="℗ 2026 …"></div>
              <div class="field"><label>© C-Line</label><input id="st-cline" placeholder="© 2026 …"></div>
            </div>
          </div>
          <div>
            <div class="field"><label>Ảnh bìa (JPG/PNG, vuông ≥3000px)</label>
              <img class="cover-preview" id="st-cover-preview" alt="">
              <input type="file" id="st-cover" accept=".jpg,.jpeg,.png,.webp" style="margin-top:8px;width:190px">
              <div class="help">Trống → hệ thống tự sinh bìa</div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="studio-step"><span class="num">3</span> Danh sách bài (kéo lên/xuống để đổi thứ tự)</div>
        <div class="track-edit-row" style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em">
          <span></span><span>Tiêu đề</span><span>Nghệ sĩ (dấu phẩy)</span><span>ISRC (trống → tự sinh)</span>
          <span style="text-align:right">Dài</span><span></span>
        </div>
        <div id="st-tracks"></div>
      </div>

      <div class="panel">
        <div class="studio-step"><span class="num">4</span> Phát hành</div>
        <div class="radio-row">
          <label class="radio-card"><input type="radio" name="st-mode" value="draft"> 📝 Lưu nháp</label>
          <label class="radio-card"><input type="radio" name="st-mode" value="review" checked> ✅ Vào hàng chờ duyệt</label>
          <label class="radio-card"><input type="radio" name="st-mode" value="live"> 🚀 Phát hành ngay</label>
          <label class="radio-card"><input type="radio" name="st-mode" value="schedule"> ⏰ Hẹn giờ
            <input type="datetime-local" id="st-schedule" style="width:200px;margin-left:6px"></label>
        </div>
        <div class="form-error" id="st-error"></div>
        <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
          <button class="btn btn-primary" id="st-publish" style="padding:12px 28px;font-size:14.5px">⬆ Đưa nhạc lên</button>
          <span id="st-status" style="color:var(--muted);font-size:13px"></span>
        </div>
        <div id="st-result" style="margin-top:16px"></div>
      </div>
    </div>`;

  const uploads = [];             // {staging_id, filename, duration_ms, tags, title, artists, isrc}
  let coverStagingId = null, coverAccent = null;
  let inFlight = 0;               // số upload đang chạy — chặn publish giữa chừng
  let publishing = false;

  const dz = document.getElementById('st-dz');
  const fileInput = document.getElementById('st-files');
  dz.onclick = () => fileInput.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
  fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ''; };

  function updatePublishState() {
    const btn = document.getElementById('st-publish');
    if (!btn) return;
    btn.disabled = inFlight > 0 || publishing || !uploads.length;
    const st = document.getElementById('st-status');
    if (st && inFlight > 0) st.textContent = `Đang tải lên ${inFlight} file…`;
    else if (st && !publishing) st.textContent = '';
  }

  async function addFiles(files) {
    const list = document.getElementById('st-filelist');
    for (const f of files) {
      if (session !== studioSession) return;   // đã rời trang
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `<span class="fname">${h(f.name)}</span><span class="fmeta">đang tải lên…</span>`;
      list.appendChild(row);
      const fd = new FormData();
      fd.append('file', f);
      inFlight++;
      updatePublishState();
      try {
        const res = await api.upload('/admin/v1/studio/upload?kind=audio', fd);
        if (session !== studioSession) return;
        uploads.push({
          ...res,
          title: res.tags.title || f.name.replace(/\.[^.]+$/, ''),
          artists: res.tags.artist || '',
          isrc: '',
        });
        row.querySelector('.fmeta').innerHTML =
          `${fmtDur(res.duration_ms)}${res.duplicate_of ? ' · <span style="color:var(--warn)">trùng hash với bài đã có!</span>' : ' · ✓'}`;
        afterUpload();
      } catch (e) {
        if (session !== studioSession) return;
        row.querySelector('.fmeta').innerHTML = `<span style="color:var(--danger)">${h(e.message)}</span>`;
      } finally {
        inFlight--;
        if (session === studioSession) updatePublishState();
      }
    }
  }

  function afterUpload() {
    document.getElementById('st-rest').hidden = uploads.length === 0;
    updatePublishState();
    // prefill release info từ tag của file đầu
    if (uploads.length) {
      const first = uploads[0];
      const t = document.getElementById('st-title');
      const a = document.getElementById('st-artists');
      const g = document.getElementById('st-genre');
      if (!t.value) t.value = first.tags.album || '';
      if (!a.value) a.value = first.tags.artist || '';
      if (!g.value) g.value = first.tags.genre || '';
    }
    renderTrackRows();
  }

  function renderTrackRows() {
    const box = document.getElementById('st-tracks');
    box.innerHTML = uploads.map((u, i) => `
      <div class="track-edit-row" data-i="${i}">
        <span class="no">${i + 1}</span>
        <input name="title" value="${h(u.title)}" placeholder="Tiêu đề bài hát">
        <input name="artists" value="${h(u.artists)}" placeholder="Nghệ sĩ, Nghệ sĩ ft.">
        <input name="isrc" value="${h(u.isrc)}" placeholder="Tự sinh" style="text-transform:uppercase">
        <span class="dur">${fmtDur(u.duration_ms)}</span>
        <span class="row-actions">
          <button class="mini-btn" data-up="${i}" title="Lên">▲</button>
          <button class="mini-btn" data-down="${i}" title="Xuống">▼</button>
          <button class="mini-btn" data-rm="${i}" title="Bỏ">✕</button>
        </span>
      </div>`).join('');
    box.querySelectorAll('input').forEach(inp => {
      inp.oninput = () => {
        const i = Number(inp.closest('.track-edit-row').dataset.i);
        uploads[i][inp.name === 'artists' ? 'artists' : inp.name] = inp.value;
      };
    });
    box.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.up);
      if (i > 0) { [uploads[i - 1], uploads[i]] = [uploads[i], uploads[i - 1]]; renderTrackRows(); }
    });
    box.querySelectorAll('[data-down]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.down);
      if (i < uploads.length - 1) { [uploads[i + 1], uploads[i]] = [uploads[i], uploads[i + 1]]; renderTrackRows(); }
    });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      uploads.splice(Number(b.dataset.rm), 1);
      renderTrackRows();
      document.getElementById('st-rest').hidden = uploads.length === 0;
    });
  }

  let coverToken = 0;
  document.getElementById('st-cover').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const myToken = ++coverToken;          // chỉ lần chọn MỚI NHẤT được tính
    const preview = document.getElementById('st-cover-preview');
    preview.src = URL.createObjectURL(f);
    coverStagingId = null;
    const accent = await extractAccent(f);
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await api.upload('/admin/v1/studio/upload?kind=cover', fd);
      if (myToken !== coverToken || session !== studioSession) return;
      coverStagingId = res.staging_id;
      coverAccent = accent;
    } catch (err) {
      if (myToken !== coverToken) return;
      toast(err.message, true);
      coverStagingId = null;
      preview.removeAttribute('src');
    }
  };

  document.getElementById('st-publish').onclick = async () => {
    if (inFlight > 0 || publishing) return;
    const errEl = document.getElementById('st-error');
    const statusEl = document.getElementById('st-status');
    errEl.textContent = '';
    const mode = document.querySelector('[name=st-mode]:checked').value;
    const schedRaw = document.getElementById('st-schedule').value;
    const body = {
      title: document.getElementById('st-title').value.trim(),
      upc: document.getElementById('st-upc').value.trim() || null,
      label_name: document.getElementById('st-label').value.trim() || null,
      genre: document.getElementById('st-genre').value.trim() || null,
      p_line: document.getElementById('st-pline').value.trim() || null,
      c_line: document.getElementById('st-cline').value.trim() || null,
      publish_mode: mode,
      // datetime-local là giờ local → gửi UTC ISO để server so đúng với datetime('now')
      scheduled_at: mode === 'schedule' && schedRaw ? new Date(schedRaw).toISOString() : null,
      cover_staging_id: coverStagingId,
      cover_accent: coverAccent,
      artists: document.getElementById('st-artists').value.split(',').map(s => s.trim()).filter(Boolean),
      tracks: uploads.map(u => ({
        staging_id: u.staging_id,
        title: u.title,
        artists: (u.artists || '').split(',').map(s => s.trim()).filter(Boolean),
        isrc: u.isrc || null,
        genre: null,
      })),
    };
    if (!body.title) { errEl.textContent = 'Thiếu tên release'; return; }
    if (!body.tracks.length) { errEl.textContent = 'Chưa có bài hát nào'; return; }
    if (mode === 'schedule' && !body.scheduled_at) { errEl.textContent = 'Chọn thời điểm hẹn giờ'; return; }

    publishing = true;
    updatePublishState();
    statusEl.textContent = 'Đang xử lý (transcode + tạo catalog)…';
    try {
      const res = await api.post('/admin/v1/studio/publish', body);
      statusEl.textContent = '';
      const modeLabel = { draft: 'đã lưu nháp', pending_review: 'đã vào hàng chờ duyệt',
                          live: 'ĐÃ PHÁT HÀNH 🎉', scheduled: 'đã hẹn giờ phát hành ⏰' }[res.status] || res.status;
      document.getElementById('st-result').innerHTML = `
        <div class="logbox">
          <div>✅ Release "${h(body.title)}" ${modeLabel}</div>
          <div>UPC: ${h(res.upc)} · ${h(res.release_type)} · ${res.tracks.length} bài${res.transcoded ? ' · đã transcode AAC' : ''}</div>
          ${res.tracks.map(t => `<div>  ♪ ${h(t.title)} — ISRC ${h(t.isrc)}</div>`).join('')}
        </div>
        <div style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="st-goto">Xem trong mục Release →</button></div>`;
      document.getElementById('st-goto').onclick = () => show('releases');
      toast('Đưa nhạc lên thành công');
      refreshReviewPill();
      uploads.length = 0;
      coverStagingId = null;
      document.getElementById('st-filelist').innerHTML = '';
      document.getElementById('st-rest').hidden = true;
    } catch (e) {
      statusEl.textContent = '';
      errEl.textContent = e.message + (e.status === 409 ? ' — file vẫn còn, bấm publish lại.' : '');
    } finally {
      publishing = false;
      updatePublishState();
    }
  };
  updatePublishState();
};

/* ============================================================
   MODULE PRODUCT (UPDATE_ADD_PRODUCT.md)
   ============================================================ */
const fmtBytes = (b) => !b ? '—'
  : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';

const ROLE_LABELS = {
  MainArtist: 'Main artist', FeaturedArtist: 'Featured artist', Composer: 'Composer',
  Lyricist: 'Lyricist', MusicPublisher: 'Music publisher', Producer: 'Producer',
  Mixer: 'Mixer', Remixer: 'Remixer', Performer: 'Performer',
};
const REQUIRED_ROLES = ['MainArtist', 'Composer', 'Lyricist', 'MusicPublisher', 'Producer', 'Mixer'];

/* UTC "YYYY-MM-DD HH:MM:SS" ⇄ datetime-local */
function utcToInput(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function inputToUtc(v) {
  if (!v) return null;
  return new Date(v).toISOString().slice(0, 19).replace('T', ' ');
}
function humanDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? '' : d.toLocaleString('vi-VN', { dateStyle: 'long', timeStyle: 'short' });
}

/* ---------- Danh sách Products ---------- */
sections.products = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>📦 Products</h1>
      <div class="tools">
        <select id="pr-state" style="width:170px">
          <option value="">Tất cả trạng thái</option>
          <option value="draft">Draft</option>
          <option value="live">Published</option>
          <option value="scheduled">Hẹn giờ</option>
          <option value="pending_review">Chờ duyệt</option>
          <option value="taken_down">Taken down</option>
        </select>
        <input type="search" id="pr-search" placeholder="Tìm product…">
        <button class="btn btn-orange" id="btn-new-product">＋ Create Product</button>
      </div></div>
    <div id="pr-table"><p class="empty-note">Đang tải…</p></div>`;
  document.getElementById('btn-new-product').onclick = openCreateProduct;
  let timer;
  const refresh = () => renderProductTable(
    document.getElementById('pr-search').value,
    document.getElementById('pr-state').value);
  document.getElementById('pr-search').oninput = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };
  document.getElementById('pr-state').onchange = refresh;
  await renderProductTable('', '');
};

async function renderProductTable(q, state) {
  const box = document.getElementById('pr-table');
  const data = await api.get(`/admin/v1/products?q=${encodeURIComponent(q)}&state=${state}`);
  if (!box || !box.isConnected) return;
  // cột "Người tạo" chỉ hữu ích cho manager/admin (uploader chỉ thấy của mình)
  const showCreator = isManagerRole();
  box.innerHTML = data.items.length ? `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Product</th><th>Type</th><th>Label</th><th>UPC</th><th>Tracks</th><th>Release date</th>${showCreator ? '<th>Người tạo</th>' : ''}<th>State</th></tr></thead>
      <tbody>${data.items.map(p => `
        <tr data-open="${p.id}" style="cursor:pointer">
          <td><div class="cell-main"><img class="thumb" src="${p.cover_url || '/static/img/logo.svg'}">
            <div>${h(p.title)}${p.title_version ? ` <span class="sub">(${h(p.title_version)})</span>` : ''}
              <div class="sub">${h(p.main_artists || '—')}</div></div></div></td>
          <td>${h(p.release_type)}</td>
          <td>${h(p.label_display || p.label_name || '—')}</td>
          <td class="mono">${h(p.upc || '—')}</td>
          <td>${p.track_count}</td>
          <td class="sub">${h((p.platform_release_date || '').slice(0, 16) || '—')}</td>
          ${showCreator ? `<td class="sub">${h(p.creator_email || '—')}</td>` : ''}
          <td>${badge(p.status)}</td>
        </tr>`).join('')}</tbody></table></div>`
    : `<div class="panel empty-note">Chưa có product nào — bấm "＋ Create Product" để bắt đầu</div>`;
  box.querySelectorAll('[data-open]').forEach(tr =>
    tr.onclick = () => showProduct(tr.dataset.open));
}

/* ---------- Create Product ---------- */
async function openCreateProduct() {
  const labels = await api.get('/admin/v1/products/labels');
  const modal = openModal(`
    <h2>Create Product</h2>
    <p style="color:var(--muted);font-size:13px;margin:-8px 0 16px">Products › Create Product</p>
    <form id="cp-form">
      <div class="panel" style="margin-bottom:14px">
        <h3>Product Info</h3>
        <p style="color:var(--muted);font-size:12px;margin:-6px 0 12px">Enter the basic information for the new product.</p>
        <div class="field"><label>Title <span style="color:var(--danger)">*</span></label>
          <input name="title" required placeholder="Product title"></div>
        <div class="grid2">
          <div class="field"><label>Title Version</label>
            <input name="title_version" placeholder="e.g. Deluxe Edition, Remastered"></div>
          <div class="field"><label>Release Type <span style="color:var(--danger)">*</span></label>
            <select name="release_type">
              <option>Single</option><option>EP</option><option>Album</option><option>Compilation</option>
            </select></div>
        </div>
      </div>
      <div class="panel">
        <h3>Label & Type</h3>
        <p style="color:var(--muted);font-size:12px;margin:-6px 0 12px">Select the label and type for this product.</p>
        <div class="field"><label>Label <span style="color:var(--danger)">*</span></label>
          <select name="label_id" required>
            <option value="">Select label</option>
            ${labels.items.map(l => `<option value="${l.id}">${h(l.name)}${l.isrc_prefix ? ` (${h(l.isrc_prefix)})` : ''}</option>`).join('')}
          </select></div>
        <label style="display:flex;gap:9px;align-items:flex-start;font-size:13px;cursor:pointer">
          <input type="checkbox" name="is_migrated" style="width:auto;margin-top:2px">
          <span><b>Migrated network</b><br>
          <span style="color:var(--muted);font-size:12px">Chuyển product từ hệ thống khác — bắt buộc nhập ISRC thủ công cho từng track (không auto-generate).</span></span>
        </label>
      </div>
      <div class="form-error" id="cp-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-orange">Create</button>
      </div>
    </form>`);
  modal.querySelector('#cp-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('label_id')) { modal.querySelector('#cp-error').textContent = 'Chọn label'; return; }
    try {
      const res = await api.post('/admin/v1/products', {
        title: fd.get('title'), title_version: fd.get('title_version') || null,
        release_type: fd.get('release_type'), label_id: fd.get('label_id'),
        is_migrated: !!fd.get('is_migrated'),
      });
      closeModal();
      toast('Đã tạo product (Draft)');
      showProduct(res.id);
    } catch (err) { modal.querySelector('#cp-error').textContent = err.message; }
  };
}

/* ---------- Product Detail (header + 4 tab) ---------- */
async function showProduct(id, tab = 'metadata', trackId = null) {
  document.querySelectorAll('#a-nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.sec === 'products'));
  main.innerHTML = '<p class="empty-note">Đang tải product…</p>';
  let p;
  try {
    p = await api.get(`/admin/v1/products/${id}`);
  } catch (err) {
    main.innerHTML = `<div class="sec-head"><h1>⚠ Không mở được product</h1></div>
      <p class="empty-note">${h(err.message || 'Lỗi kết nối')} —
      <a href="#" onclick="return false" id="pp-back">quay lại danh sách</a></p>`;
    const b = document.getElementById('pp-back');
    if (b) b.onclick = () => { show('products'); return false; };
    return;
  }
  const mainArtists = (p.contributors.MainArtist || []).map(a => h(a.name)).join(', ') || '—';
  const canManage = isManagerRole();   // uploader: ẩn mọi nút phát hành/duyệt
  const qcChip = p.qc_errors
    ? `<span class="warn-chip err-chip" id="qc-chip">⛔ ${p.qc_errors} lỗi QC</span>`
    : p.qc_warnings
      ? `<span class="warn-chip" id="qc-chip">⚠ ${p.qc_warnings} cảnh báo</span>` : '';
  main.innerHTML = `
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:10px">
      <a href="javascript:void 0" id="bc-products" style="color:var(--accent)">Products</a> › ${h(p.title)}</p>
    <div class="prod-header">
      <div class="prod-cover">
        <img src="${p.cover_url || '/static/img/logo.svg'}" id="prod-cover-img">
        <div class="manage" id="btn-cover-manage">Manage</div>
        <input type="file" id="cover-file" accept=".jpg,.jpeg,.png,.webp" hidden>
      </div>
      <div class="prod-head-main">
        <div class="prod-title">${h(p.title)}
          ${p.title_version ? `<span class="sub">(${h(p.title_version)})</span>` : ''}
          <span class="pid">#${p.id.slice(0, 6)}</span> ${badge(p.status)}</div>
        <div class="prod-meta">
          <span>👤 <b>${mainArtists}</b></span>
          <span>💿 ${h(p.release_type)}</span>
          <span>📅 ${humanDate(p.platform_release_date) || 'Chưa đặt ngày'}</span>
          <span># ${h(p.upc || 'UPC: auto khi publish')}</span>
          <span>🎵 ${h(p.genre || '—')}</span>
          <span>${p.track_count} tracks</span>
          <span>🏷 ${h(p.tags || 'No tags')} <a href="javascript:void 0" id="btn-tags" title="Sửa tags">✏</a></span>
        </div>
      </div>
      <div class="prod-head-actions">${qcChip}
        ${!canManage && p.status === 'draft'
          ? `<button class="btn btn-orange btn-sm" id="btn-submit-review">📤 Gửi duyệt</button>` : ''}
        ${canManage && p.status === 'pending_review' ? `
          <button class="btn btn-ok btn-sm" id="btn-approve">✅ Duyệt &amp; phát hành</button>
          <button class="btn btn-danger btn-sm" id="btn-reject">❌ Từ chối</button>` : ''}
        <button class="btn btn-ghost btn-sm" id="btn-prod-del" title="Xóa (chỉ Draft)">🗑</button>
      </div>
    </div>
    ${p.status === 'pending_review' ? `
    <div class="flow-note pending">🕓 <b>Chờ duyệt</b> — Đã gửi duyệt${
      p.submitted_at ? ` ${h(humanDate(p.submitted_at) || p.submitted_at)}` : ''}${
      canManage ? '. Kiểm tra nội dung rồi Duyệt hoặc Từ chối ở góc phải.' : ', manager sẽ kiểm tra và phát hành.'}</div>` : ''}
    ${p.review_note && p.status === 'draft' ? `
    <div class="flow-note rejected">⚠ <b>Bị từ chối:</b> ${h(p.review_note)}
      <span class="hint">Sửa nội dung theo ghi chú rồi bấm “📤 Gửi duyệt” lại.</span></div>` : ''}
    <div class="prod-tabs">
      <button data-tab="metadata" class="${tab === 'metadata' ? 'on' : ''}">📄 Metadata</button>
      <button data-tab="tracks" class="${tab === 'tracks' || tab === 'trackdetail' ? 'on' : ''}">🎵 Tracks</button>
      <button data-tab="qc" class="${tab === 'qc' ? 'on' : ''}">✅ QC Check</button>
      <button data-tab="releases" class="${tab === 'releases' ? 'on' : ''}">🚀 Releases</button>
    </div>
    <div id="prod-body"></div>`;

  document.getElementById('bc-products').onclick = () => show('products');
  document.querySelectorAll('.prod-tabs [data-tab]').forEach(b =>
    b.onclick = () => showProduct(id, b.dataset.tab));
  const chip = document.getElementById('qc-chip');
  if (chip) chip.onclick = () => showProduct(id, 'qc');

  // nút luồng duyệt trên header (chỉ render theo role/status ở trên)
  const btnSubmit = document.getElementById('btn-submit-review');
  if (btnSubmit) btnSubmit.onclick = () => submitProductReview(p);
  const btnApprove = document.getElementById('btn-approve');
  if (btnApprove) btnApprove.onclick = () => approveProduct(p);
  const btnReject = document.getElementById('btn-reject');
  if (btnReject) btnReject.onclick = () => openRejectModal(p);

  document.getElementById('btn-prod-del').onclick = async () => {
    if (!confirm(`Xóa product "${p.title}"? (chỉ Draft/Taken down)`)) return;
    try {
      await api.del(`/admin/v1/products/${id}`);
      toast('Đã xóa product');
      show('products');
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('btn-tags').onclick = async () => {
    const v = prompt('Tags (cách nhau dấu phẩy):', p.tags || '');
    if (v === null) return;
    await api.patch(`/admin/v1/products/${id}`, { tags: v.trim() || null });
    showProduct(id, tab, trackId);
  };
  const coverBtn = document.getElementById('btn-cover-manage');
  const coverFile = document.getElementById('cover-file');
  coverBtn.onclick = () => coverFile.click();
  coverFile.onchange = async () => {
    const f = coverFile.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await api.upload(`/admin/v1/products/${id}/cover`, fd);
      document.getElementById('prod-cover-img').src = res.cover_url + '?t=' + Date.now();
      toast('Đã cập nhật ảnh bìa');
    } catch (e) { toast(e.message, true); }
  };

  const body = document.getElementById('prod-body');
  if (tab === 'metadata') renderProdMetadata(body, p);
  else if (tab === 'tracks') renderProdTracks(body, p);
  else if (tab === 'trackdetail') renderProdTrackDetail(body, p, trackId);
  else if (tab === 'qc') renderProdQC(body, p);
  else if (tab === 'releases') renderProdReleases(body, p);
}

/* ---------- Tab Metadata ---------- */
function genreOptionsHtml(list, current) {
  const names = list.map(g => g.name);
  let html = '';
  if (!current) html += '<option value="">— Chọn thể loại —</option>';
  if (current && !names.includes(current))
    html += `<option value="${h(current)}" selected>${h(current)}</option>`;
  html += list.map(g =>
    `<option value="${h(g.name)}" ${g.name === current ? 'selected' : ''}>${h(g.name)}</option>`).join('');
  html += '<option value="__new__">➕ Thêm thể loại mới…</option>';
  return html;
}

function bindGenreSelect(selectId, onChange) {
  const sel = document.getElementById(selectId);
  let prev = sel.value;
  sel.addEventListener('change', async () => {
    if (sel.value === '__new__') {
      const name = (prompt('Tên thể loại mới:') || '').trim();
      if (!name) { sel.value = prev; return; }
      try {
        const res = await api.post('/admin/v1/products/genres', { name });
        const opt = document.createElement('option');
        opt.value = res.name; opt.textContent = res.name;
        sel.insertBefore(opt, sel.querySelector('[value="__new__"]'));
        sel.value = res.name;
        prev = res.name;
        toast(res.existed ? 'Thể loại đã có' : 'Đã thêm thể loại');
      } catch (e) { toast(e.message, true); sel.value = prev; }
    } else {
      prev = sel.value;
    }
    onChange && onChange();
  });
}

async function renderProdMetadata(box, p) {
  const [labels, genres] = await Promise.all([
    api.get('/admin/v1/products/labels'),
    api.get('/admin/v1/products/genres'),
  ]);
  const adv = p.parental_warning || 'NotExplicit';
  box.innerHTML = `
    <div class="two-col">
      <div class="panel">
        <h3>Release Information</h3>
        <div class="field"><label>Title *</label><input id="m-title" value="${h(p.title)}"></div>
        <div class="field"><label>Title Version</label>
          <input id="m-title-version" value="${h(p.title_version || '')}" placeholder="e.g. Deluxe Edition, Remix"></div>
        <div class="grid2">
          <div class="field"><label>Label *</label>
            <select id="m-label">${labels.items.map(l =>
              `<option value="${l.id}" ${l.id === p.label_id ? 'selected' : ''}>${h(l.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Release Type *</label>
            <select id="m-type">${['Single', 'EP', 'Album', 'Compilation'].map(x =>
              `<option ${x === p.release_type ? 'selected' : ''} ${x === 'Single' && p.track_count > 1 ? 'disabled' : ''}>${x}${x === 'Single' && p.track_count > 1 ? ' (cần ≤1 track)' : ''}</option>`).join('')}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Primary Genre *</label>
            <select id="m-genre">${genreOptionsHtml(genres.items, p.genre || 'Pop')}</select></div>
          <div class="field"><label>Secondary Genre</label>
            <select id="m-subgenre">${genreOptionsHtml(genres.items, p.subgenre || '')}</select></div>
        </div>
      </div>
      <div class="panel">
        <h3>Languages & Content Advisory</h3>
        <div class="grid2">
          <div class="field"><label>Metadata Language *</label>
            <select id="m-mlang">${['vi', 'en', 'ko', 'ja'].map(x =>
              `<option value="${x}" ${x === (p.metadata_language || 'vi') ? 'selected' : ''}>${x.toUpperCase()}</option>`).join('')}</select></div>
          <div class="field"><label>Audio Language *</label>
            <select id="m-alang">${['vi', 'en', 'ko', 'ja'].map(x =>
              `<option value="${x}" ${x === (p.audio_language || 'vi') ? 'selected' : ''}>${x.toUpperCase()}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Parental Advisory *</label>
          <div class="radio-cards" id="m-advisory">
            <label><input type="radio" name="adv" value="NotExplicit" ${adv === 'NotExplicit' ? 'checked' : ''}>
              <b>None</b><span>No explicit content</span></label>
            <label><input type="radio" name="adv" value="Explicit" ${adv === 'Explicit' ? 'checked' : ''}>
              <b>Explicit</b><span>Contains explicit content</span></label>
            <label><input type="radio" name="adv" value="Edited" ${adv === 'Edited' ? 'checked' : ''}>
              <b>Explicit Content Edited</b><span>Edited version</span></label>
          </div></div>
      </div>
      <div class="panel">
        <h3>Release Dates</h3>
        <p style="font-size:12px;color:var(--muted);margin:-6px 0 12px">🕐 Release timing: Global Timed Release (UTC)</p>
        <div class="field"><label>Release Date *</label>
          <input type="datetime-local" id="m-reldate" value="${utcToInput(p.platform_release_date)}">
          <div class="help" id="m-reldate-h">${humanDate(p.platform_release_date)}</div></div>
        <div class="field"><label>Original Release Date *</label>
          <input type="datetime-local" id="m-origdate" value="${utcToInput(p.original_release_date && p.original_release_date.length === 10 ? p.original_release_date + ' 00:00:00' : p.original_release_date)}"></div>
        <div class="field"><label>Pre-order Date</label>
          <input type="datetime-local" id="m-predate" value="${utcToInput(p.preorder_date)}">
          <div class="help">Mặc định = lúc tạo product · không được sau Release Date</div></div>
      </div>
      <div class="panel">
        <h3>Copyrights</h3>
        <div class="grid2">
          <div class="field"><label>C-Line Text (©) *</label><input id="m-cline" value="${h(p.c_line || '')}"></div>
          <div class="field"><label>C-Line Year *</label><input id="m-cyear" type="number" min="1900" max="2100" value="${p.c_line_year || ''}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>P-Line Text (℗) *</label><input id="m-pline" value="${h(p.p_line || '')}"></div>
          <div class="field"><label>P-Line Year *</label><input id="m-pyear" type="number" min="1900" max="2100" value="${p.p_line_year || ''}"></div>
        </div>
        <div class="field"><label>Right Holder *</label><input id="m-rholder" value="${h(p.right_holder || '')}"></div>
      </div>
      <div class="panel">
        <h3>Product Details</h3>
        <div class="grid2">
          <div class="field"><label>UPC Code</label>
            <input id="m-upc" value="${h(p.upc || '')}" placeholder="Auto-generate khi publish"></div>
          <div class="field"><label>Catalog Number</label><input id="m-catno" value="${h(p.catalog_number || '')}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Release Price Tier</label><input id="m-rtier" value="${h(p.release_price_tier || '')}" placeholder="Digital45"></div>
          <div class="field"><label>Track Price Tier</label><input id="m-ttier" value="${h(p.track_price_tier || '')}" placeholder="Front"></div>
        </div>
        <div class="field"><label>Mastered By</label><input id="m-mastered" value="${h(p.mastered_by || '')}"></div>
        <label style="display:flex;gap:8px;font-size:13px;margin-bottom:8px;cursor:pointer">
          <input type="checkbox" id="m-compilation" style="width:auto" ${p.is_compilation ? 'checked' : ''}>
          <span><b>Compilation (Multiartist)</b> — album tổng hợp nhiều nghệ sĩ</span></label>
        <label style="display:flex;gap:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="m-migrated" style="width:auto" ${p.is_migrated ? 'checked' : ''}>
          <span><b>Migrated network</b> — nhập ISRC thủ công từng track</span></label>
      </div>
      <div class="panel" style="grid-column:1/-1">
        <h3>Contributors <span style="color:var(--muted);font-weight:500;font-size:12px">— vai trò trên toàn bộ release</span>
          <a href="javascript:void 0" id="roles-expand" style="float:right;font-size:12px;color:var(--accent)">Expand all</a></h3>
        <div id="prod-roles"></div>
      </div>
    </div>
    <div class="sticky-actions">
      <button class="btn btn-ghost" id="m-cancel">Cancel</button>
      <button class="btn btn-orange" id="m-save" disabled>Save</button>
    </div>`;

  renderRoleGroups(document.getElementById('prod-roles'), p.contributors,
    (payload) => api.put(`/admin/v1/products/${p.id}/contributors`, { contributors: payload })
      .then(() => toast('Đã lưu contributors'))
      .catch(e => toast(e.message, true)));
  document.getElementById('roles-expand').onclick = () =>
    document.querySelectorAll('#prod-roles .role-group').forEach(g => g.classList.add('open'));

  const saveBtn = document.getElementById('m-save');
  const enableSave = () => { saveBtn.disabled = false; };
  box.querySelectorAll('input, select').forEach(el =>
    el.addEventListener('input', enableSave));
  bindGenreSelect('m-genre', enableSave);
  bindGenreSelect('m-subgenre', enableSave);
  // đổi label → điền C-Line/P-Line/Right Holder mặc định của label đó,
  // NHƯNG chỉ khi ô đang trống (không ghi đè giá trị user đã nhập)
  document.getElementById('m-label').addEventListener('change', (e) => {
    const lb = labels.items.find(l => l.id === e.target.value);
    if (!lb) return;
    const fill = (id, val) => {
      const el = document.getElementById(id);
      if (val && !el.value.trim()) el.value = val;
    };
    fill('m-cline', lb.c_line);
    fill('m-pline', lb.p_line);
    fill('m-rholder', lb.right_holder);
    enableSave();
  });
  document.getElementById('m-reldate').addEventListener('input', (e) => {
    document.getElementById('m-reldate-h').textContent =
      e.target.value ? new Date(e.target.value).toLocaleString('vi-VN', { dateStyle: 'long', timeStyle: 'short' }) : '';
  });
  document.getElementById('m-cancel').onclick = () => showProduct(p.id, 'metadata');
  saveBtn.onclick = async () => {
    const g = (id) => document.getElementById(id).value.trim();
    const body = {
      title: g('m-title'), title_version: g('m-title-version') || null,
      label_id: document.getElementById('m-label').value,
      release_type: document.getElementById('m-type').value,
      genre: g('m-genre') || null, subgenre: g('m-subgenre') || null,
      metadata_language: document.getElementById('m-mlang').value,
      audio_language: document.getElementById('m-alang').value,
      parental_warning: document.querySelector('[name=adv]:checked').value,
      platform_release_date: inputToUtc(g('m-reldate')),
      original_release_date: inputToUtc(g('m-origdate')),
      preorder_date: inputToUtc(g('m-predate')),
      c_line: g('m-cline') || null,
      c_line_year: g('m-cyear') ? Number(g('m-cyear')) : null,
      p_line: g('m-pline') || null,
      p_line_year: g('m-pyear') ? Number(g('m-pyear')) : null,
      right_holder: g('m-rholder') || null,
      upc: g('m-upc') || null,
      catalog_number: g('m-catno') || null,
      release_price_tier: g('m-rtier') || null,
      track_price_tier: g('m-ttier') || null,
      mastered_by: g('m-mastered') || null,
      is_compilation: document.getElementById('m-compilation').checked,
      is_migrated: document.getElementById('m-migrated').checked,
    };
    try {
      await api.patch(`/admin/v1/products/${p.id}`, body);
      toast('Đã lưu metadata');
      showProduct(p.id, 'metadata');
    } catch (e) { toast(e.message, true); }
  };
}

/* Read-only render (Single track — dùng chung với product, không sửa) */
function renderRoleGroupsReadonly(box, contributors) {
  const rows = Object.keys(ROLE_LABELS)
    .filter(role => (contributors[role] || []).length)
    .map(role => `
      <div class="role-group open" style="opacity:.9">
        <div class="role-head" style="cursor:default">
          <b>${ROLE_LABELS[role]}</b>
          <span class="role-count">${contributors[role].length}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--muted)">🔒 khóa</span>
        </div>
        <div class="role-body">
          ${contributors[role].map(a => `
            <div class="role-row"><img src="${a.image_url || '/static/img/logo.svg'}">
              <span class="nm">${h(a.name)}</span></div>`).join('')}
        </div>
      </div>`).join('');
  box.innerHTML = rows ||
    '<div class="empty-note">Chưa có contributors — thêm ở tab Metadata của product</div>';
}

/* ---------- Contributors role groups (dùng chung product & track) ---------- */
function renderRoleGroups(box, contributors, onSave) {
  const state = {};
  Object.keys(ROLE_LABELS).forEach(r => { state[r] = [...(contributors[r] || [])]; });

  function save() {
    const payload = {};
    Object.keys(state).forEach(r => { payload[r] = state[r].map(a => a.artist_id); });
    onSave(payload);
  }

  function render() {
    box.innerHTML = Object.keys(ROLE_LABELS).map(role => {
      const req = REQUIRED_ROLES.includes(role);
      const list = state[role];
      return `
      <div class="role-group" data-role="${role}">
        <div class="role-head">
          <b>${ROLE_LABELS[role]}${req ? ' <span class="req">*</span>' : ''}</b>
          <span class="role-count ${list.length ? '' : 'zero'}">${list.length}</span>
          <button class="btn btn-ghost btn-sm" data-add="${role}" style="margin-left:8px">＋ Add</button>
          <span class="chev">▾</span>
        </div>
        <div class="role-body">
          ${list.map((a, i) => `
            <div class="role-row">
              <img src="${a.image_url || '/static/img/logo.svg'}">
              <span class="nm">${h(a.name)}</span>
              <button class="mini-btn" data-up="${role}:${i}" title="Lên">▲</button>
              <button class="mini-btn" data-down="${role}:${i}" title="Xuống">▼</button>
              <button class="mini-btn" data-rm="${role}:${i}" title="Remove">✕</button>
            </div>`).join('') || '<div class="empty-note" style="padding:8px">Chưa có nghệ sĩ</div>'}
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('.role-head').forEach(hd => {
      hd.onclick = (e) => {
        if (e.target.closest('[data-add]')) return;
        hd.closest('.role-group').classList.toggle('open');
      };
    });
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      openArtistPicker((artist) => {
        const role = b.dataset.add;
        if (state[role].some(x => x.artist_id === artist.id)) return toast('Nghệ sĩ đã có trong role này', true);
        state[role].push({ artist_id: artist.id, name: artist.name, image_url: artist.image_url });
        render();
        box.querySelector(`[data-role="${role}"]`).classList.add('open');
        save();
      });
    });
    const move = (role, i, d) => {
      const j = i + d;
      if (j < 0 || j >= state[role].length) return;
      [state[role][i], state[role][j]] = [state[role][j], state[role][i]];
      render();
      box.querySelector(`[data-role="${role}"]`).classList.add('open');
      save();
    };
    box.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const [r, i] = b.dataset.up.split(':');
      move(r, Number(i), -1);
    });
    box.querySelectorAll('[data-down]').forEach(b => b.onclick = () => {
      const [r, i] = b.dataset.down.split(':');
      move(r, Number(i), 1);
    });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      const [r, i] = b.dataset.rm.split(':');
      state[r].splice(Number(i), 1);
      render();
      box.querySelector(`[data-role="${r}"]`).classList.add('open');
      save();
    });
  }
  render();
}

function openArtistPicker(onPick) {
  const modal = openModal(`
    <h2>Thêm contributor</h2>
    <div class="field"><input id="ap-q" placeholder="Tìm nghệ sĩ…" autocomplete="off"></div>
    <div id="ap-list" style="max-height:280px;overflow-y:auto;margin:0 -6px"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Đóng</button>
      <button class="btn btn-orange" id="ap-new">＋ Tạo nghệ sĩ mới</button>
    </div>`);
  const listBox = modal.querySelector('#ap-list');
  const qInput = modal.querySelector('#ap-q');
  async function search() {
    // endpoint mức staff (products router) — uploader cũng tìm được nghệ sĩ
    const data = await api.get(`/admin/v1/products/artist-options?q=${encodeURIComponent(qInput.value)}`);
    listBox.innerHTML = data.items.slice(0, 30).map(a => `
      <button class="role-row" data-pick="${a.id}" style="width:100%;text-align:left">
        <img src="${a.image_url || '/static/img/logo.svg'}"><span class="nm">${h(a.name)}</span>
      </button>`).join('') || '<div class="empty-note">Không tìm thấy</div>';
    listBox.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      const a = data.items.find(x => x.id === b.dataset.pick);
      closeModal();
      onPick(a);
    });
  }
  let timer;
  qInput.oninput = () => { clearTimeout(timer); timer = setTimeout(search, 250); };
  qInput.focus();
  search();
  modal.querySelector('#ap-new').onclick = async () => {
    const name = qInput.value.trim() || prompt('Tên nghệ sĩ mới:');
    if (!name) return;
    try {
      const res = await api.post('/admin/v1/products/artist-options', { name, type: 'person' });
      closeModal();
      onPick({ id: res.id, name: res.name || name, image_url: null });
      toast(res.existed ? 'Nghệ sĩ đã có sẵn — dùng lại' : 'Đã tạo nghệ sĩ mới');
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- Tab Tracks ---------- */
let prodPreviewAudio = null;

async function renderProdTracks(box, p) {
  const data = await api.get(`/admin/v1/products/${p.id}/tracks`);
  const items = data.items;
  box.innerHTML = `
    <div class="sec-head" style="margin-bottom:12px">
      <input type="search" id="pt-q" placeholder="Search…" style="width:240px">
      <div class="tools">
        <button class="btn btn-ghost" id="pt-refresh">🔄</button>
        <button class="btn btn-orange" id="pt-pick">⬆ Chọn file nhạc</button>
        <button class="btn btn-ghost btn-sm" id="pt-manual">Nhập thủ công</button>
        <input type="file" id="pt-file" accept=".wav,.flac,.mp3,.m4a,.ogg,.opus" multiple hidden>
      </div></div>
    <div class="dropzone" id="pt-dz" style="padding:16px;margin-bottom:12px">
      Kéo thả file audio vào đây — mỗi file tự tạo 1 track (WAV khuyến nghị, tự chuẩn hóa 44.1kHz)</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>#</th><th>Title</th><th>ISRC</th><th>Type</th><th>Duration</th><th>Size</th><th>State</th><th></th></tr></thead>
      <tbody id="pt-body">${items.map((t, i) => `
        <tr data-tid="${t.id}" data-title="${h(t.title).toLowerCase()}">
          <td>${t.track_no}</td>
          <td><b>${h(t.title)}</b>${t.subtitle ? ` <span class="sub">(${h(t.subtitle)})</span>` : ''}
            <div class="sub">${t.artists.map(a => h(a.name)).join(', ') || '—'}</div></td>
          <td class="mono">${h(t.isrc || '—')}</td>
          <td>${t.file_format ? `<span class="badge live">${h(t.file_format)}</span>` : '—'}</td>
          <td>${fmtDur(t.duration_ms)}</td>
          <td>${fmtBytes(t.file_size)}</td>
          <td>${t.upload_state === 'uploaded'
            ? '<span class="badge live">Uploaded</span>'
            : '<span class="badge pending_review">Missing file</span>'}</td>
          <td class="actions" style="white-space:nowrap">
            <button class="mini-btn" data-mv="${t.id}:-1" title="Lên">▲</button>
            <button class="mini-btn" data-mv="${t.id}:1" title="Xuống">▼</button>
            ${t.upload_state === 'uploaded' ? `<button class="btn btn-ghost btn-sm" data-play="${t.id}">▶</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-upload="${t.id}">⬆ Audio</button>
            <button class="btn btn-ghost btn-sm" data-detail="${t.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-remove="${t.id}">✕</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty-note">Chưa có track — bấm Chọn file nhạc hoặc kéo thả file</td></tr>'}
      </tbody></table></div>
    <p class="empty-note" style="text-align:left;padding:8px 4px">Showing 1 to ${items.length} of ${items.length}</p>`;

  document.getElementById('pt-refresh').onclick = () => showProduct(p.id, 'tracks');
  document.getElementById('pt-q').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    box.querySelectorAll('#pt-body tr[data-tid]').forEach(tr =>
      tr.style.display = tr.dataset.title.includes(q) ? '' : 'none');
  };

  const ptFile = document.getElementById('pt-file');
  document.getElementById('pt-manual').onclick = () => openAddTrackModal(p);
  document.getElementById('pt-pick').onclick = () => {
    // Migrated network: ISRC bắt buộc → chặn chọn file, chỉ cho nhập thủ công
    if (p.is_migrated) return toast('Migrated network: thêm track thủ công để nhập ISRC', true);
    ptFile.click();
  };
  ptFile.onchange = () => {
    const files = [...ptFile.files];
    ptFile.value = ''; // reset để chọn lại cùng file vẫn kích hoạt onchange
    if (files.length) uploadTrackFiles(p, files);
  };

  const dz = document.getElementById('pt-dz');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    if (p.is_migrated) return toast('Migrated network: thêm track thủ công để nhập ISRC', true);
    const files = [...e.dataTransfer.files];
    if (files.length) uploadTrackFiles(p, files);
  };

  box.querySelectorAll('[data-play]').forEach(b => b.onclick = async () => {
    try {
      const { url } = await api.get(`/v1/tracks/${b.dataset.play}/stream`);
      if (!prodPreviewAudio) prodPreviewAudio = new Audio();
      if (prodPreviewAudio.src.includes(b.dataset.play) && !prodPreviewAudio.paused) {
        prodPreviewAudio.pause();
        b.textContent = '▶';
      } else {
        prodPreviewAudio.src = url;
        prodPreviewAudio.play();
        box.querySelectorAll('[data-play]').forEach(x => x.textContent = '▶');
        b.textContent = '⏸';
        prodPreviewAudio.onended = () => { b.textContent = '▶'; };
      }
    } catch (e) { toast(e.message, true); }
  });
  box.querySelectorAll('[data-upload]').forEach(b => b.onclick = () => {
    const t = items.find(x => x.id === b.dataset.upload);
    openAudioUpload(t, () => showProduct(p.id, 'tracks'), p.id);
  });
  box.querySelectorAll('[data-detail]').forEach(b =>
    b.onclick = () => showProduct(p.id, 'trackdetail', b.dataset.detail));
  box.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    const t = items.find(x => x.id === b.dataset.remove);
    if (!confirm(`Gỡ track "${t.title}" khỏi product?`)) return;
    try {
      await api.del(`/admin/v1/products/${p.id}/tracks/${t.id}`);
      toast('Đã gỡ track');
      showProduct(p.id, 'tracks');
    } catch (e) { toast(e.message, true); }
  });
  box.querySelectorAll('[data-mv]').forEach(b => b.onclick = async () => {
    const [tid, d] = b.dataset.mv.split(':');
    const ids = items.map(x => x.id);
    const i = ids.indexOf(tid);
    const j = i + Number(d);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api.put(`/admin/v1/products/${p.id}/tracks/reorder`, { track_ids: ids });
      showProduct(p.id, 'tracks');
    } catch (e) { toast(e.message, true); }
  });
}

/* Tạo track + upload audio cho từng file, có tiến độ qua widget uploadTray.
   Dùng chung cho nút "⬆ Chọn file nhạc" và vùng kéo-thả #pt-dz. Tuần tự để
   nhẹ server; mỗi file 1 dòng tiến độ. Xong thì làm mới bảng tracks. */
async function uploadTrackFiles(p, files) {
  for (const f of files) {
    const uid = uploadTray.add(f.name);
    try {
      const tr = await api.post(`/admin/v1/products/${p.id}/tracks`,
        { title: f.name.replace(/\.[^.]+$/, '') });
      const fd = new FormData();
      fd.append('file', f);
      await uploadWithProgress(
        `/admin/v1/products/${p.id}/tracks/${tr.id}/audio`, fd,
        (e) => uploadTray.progress(uid, e.percent));
      uploadTray.done(uid, true);
    } catch (err) {
      uploadTray.done(uid, false, err.message);
      toast(`${f.name}: ${err.message}`, true);
    }
  }
  showProduct(p.id, 'tracks');
}

function openAddTrackModal(p) {
  const modal = openModal(`
    <h2>Add Track</h2>
    <form id="at-form">
      <div class="field"><label>Title *</label><input name="title" required></div>
      <div class="field"><label>ISRC ${p.is_migrated
        ? '<span style="color:var(--danger)">* (Migrated network — bắt buộc)</span>'
        : '<span style="color:var(--muted)">(trống → tự cấp từ kho/prefix label)</span>'}</label>
        <input name="isrc" placeholder="VNA0D2600123" style="text-transform:uppercase"
          ${p.is_migrated ? 'required' : ''}></div>
      <div class="form-error" id="at-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-orange">Add</button>
      </div>
    </form>`);
  modal.querySelector('#at-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/admin/v1/products/${p.id}/tracks`,
        { title: fd.get('title'), isrc: fd.get('isrc') || null });
      closeModal();
      toast('Đã thêm track — upload audio để hoàn tất');
      showProduct(p.id, 'tracks');
    } catch (err) { modal.querySelector('#at-error').textContent = err.message; }
  };
}

/* ---------- Track Detail ---------- */
async function renderProdTrackDetail(box, p, trackId) {
  const data = await api.get(`/admin/v1/products/${p.id}/tracks`);
  const items = data.items;
  const idx = Math.max(0, items.findIndex(x => x.id === trackId));
  const tr = items[idx];
  if (!tr) { showProduct(p.id, 'tracks'); return; }
  const lyr = await api.get(`/v1/tracks/${tr.id}/lyrics`).catch(() => ({ lyrics: '', lrc: '' }));
  const igEnabled = p.preorder_date && p.platform_release_date
    && p.platform_release_date > new Date().toISOString().slice(0, 19).replace('T', ' ');
  const adv = tr.parental_warning || 'NotExplicit';

  box.innerHTML = `
    <div class="trackdetail">
      <div class="td-sidebar">
        <div style="padding:10px 13px;font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase">Tracklist</div>
        ${items.map((x) => `
          <div class="td-item ${x.id === tr.id ? 'on' : ''}" data-goto="${x.id}">
            <span class="no">${x.track_no}</span><span class="ttl">${h(x.title)}</span>
            ${x.upload_state !== 'uploaded' ? '<span title="Thiếu file">⚠</span>' : ''}
          </div>`).join('')}
      </div>
      <div>
        <div class="panel" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button class="mini-btn" id="td-prev" ${idx === 0 ? 'disabled' : ''}>←</button>
          <button class="mini-btn" id="td-next" ${idx === items.length - 1 ? 'disabled' : ''}>→</button>
          <b style="font-size:15px">#${tr.track_no} · ${h(tr.title)}</b>
          <span class="mono" style="color:var(--muted);font-size:12px">${h(tr.isrc || '')}</span>
          <span style="margin-left:auto;color:var(--muted);font-size:12px">${idx + 1}/${items.length}</span>
          ${tr.upload_state === 'uploaded' ? `<button class="btn btn-ghost btn-sm" id="td-play">▶ Play</button>` : ''}
        </div>
        <div class="two-col">
          <div class="panel">
            <h3>Track Info</h3>
            <div class="field"><label>Title *</label><input id="t-title" value="${h(tr.title)}"></div>
            <div class="field"><label>Title Version</label>
              <input id="t-version" value="${h(tr.subtitle || '')}" placeholder="e.g. Radio Edit"></div>
            <div class="grid2">
              <div class="field"><label>ISRC Code</label>
                <input id="t-isrc" value="${h(tr.isrc || '')}" style="text-transform:uppercase"></div>
              <div class="field"><label>Secondary ISRC</label>
                <input id="t-isrc2" value="${h(tr.secondary_isrc || '')}" placeholder="Optional"></div>
            </div>
            <div class="grid2">
              <div class="field"><label>Primary Genre</label>
                <input id="t-genre" value="${h(tr.genre || '')}"></div>
              <div class="field"><label>Secondary Genre</label>
                <input id="t-genre2" value="${h(tr.secondary_genre || '')}"></div>
            </div>
            <div class="field"><label>Clip Start Time (seconds)</label>
              <input id="t-clip" type="number" min="0" value="${tr.clip_start_seconds ?? 30}"></div>
          </div>
          <div class="panel">
            <h3>Languages & Content Advisory</h3>
            <div class="field"><label>Audio Language</label>
              <select id="t-lang">${['vi', 'en', 'ko', 'ja'].map(x =>
                `<option value="${x}" ${x === (tr.language || 'vi') ? 'selected' : ''}>${x.toUpperCase()}</option>`).join('')}</select></div>
            <div class="field"><label>Parental Advisory</label>
              <div class="radio-cards">
                <label><input type="radio" name="tadv" value="NotExplicit" ${adv === 'NotExplicit' ? 'checked' : ''}><b>None</b><span>No explicit content</span></label>
                <label><input type="radio" name="tadv" value="Explicit" ${adv === 'Explicit' ? 'checked' : ''}><b>Explicit</b><span>Explicit content</span></label>
                <label><input type="radio" name="tadv" value="Edited" ${adv === 'Edited' ? 'checked' : ''}><b>Edited</b><span>Edited version</span></label>
              </div></div>
            <h3 style="margin-top:16px">Instant Gratification</h3>
            ${igEnabled ? '' : `<p style="font-size:12px;color:var(--warn);margin:-4px 0 10px">⚠ Cần pre-order date + release date tương lai trong metadata product.</p>`}
            <div class="grid2">
              <div class="field"><label>Stream Date</label>
                <input id="t-igs" type="date" value="${h(tr.instant_grat_stream_date || '')}" ${igEnabled ? '' : 'disabled'}></div>
              <div class="field"><label>Download Date</label>
                <input id="t-igd" type="date" value="${h(tr.instant_grat_download_date || '')}" ${igEnabled ? '' : 'disabled'}></div>
            </div>
          </div>
          <div class="panel">
            <h3>Copyrights (track)</h3>
            <div class="grid2">
              <div class="field"><label>C-Line (©)</label><input id="t-cline" value="${h(tr.c_line || '')}"></div>
              <div class="field"><label>Year</label><input id="t-cyear" type="number" value="${tr.c_line_year || ''}"></div>
            </div>
            <div class="grid2">
              <div class="field"><label>P-Line (℗)</label><input id="t-pline" value="${h(tr.p_line || '')}"></div>
              <div class="field"><label>Year</label><input id="t-pyear" type="number" value="${tr.p_line_year || ''}"></div>
            </div>
            <div class="field"><label>Right Holder</label><input id="t-rholder" value="${h(tr.right_holder || '')}"></div>
            <h3 style="margin-top:14px">🎵 Media Assets</h3>
            <p style="font-size:12.5px;color:var(--muted)">
              ${tr.upload_state === 'uploaded'
                ? `<span class="badge live">${h(tr.file_format)}</span> ${tr.has_master ? '<span class="badge live">WAV master ✓</span>' : ''} · ${fmtBytes(tr.file_size)} · ✓ valid`
                : '<span class="badge pending_review">Chưa có file audio</span>'}</p>
            <button class="btn btn-ghost btn-sm" id="t-upload">⬆ ${tr.upload_state === 'uploaded' ? 'Replace file' : 'Upload audio'}</button>
          </div>
          <div class="panel">
            <h3>🎤 Lyrics ${!lyr.lyrics && !lyr.lrc ? '<span class="badge pending_review">No lyrics added yet</span>' : '<span class="badge live">✓</span>'}</h3>
            <div class="field"><label>Plain lyrics</label>
              <textarea id="t-lyrics" rows="4">${h(lyr.lyrics || '')}</textarea></div>
            <div class="field"><label>Synced lyrics (LRC)</label>
              <textarea id="t-lrc" rows="4" placeholder="[00:12.00]Câu hát…">${h(lyr.lrc || '')}</textarea></div>
          </div>
          <div class="panel" style="grid-column:1/-1">
            <h3>Contributors (track) <span style="color:var(--muted);font-size:12px;font-weight:500">${p.release_type === 'Single'
              ? '— Single dùng chung với product (khóa), sửa ở tab Metadata'
              : '— kế thừa từ product, có thể override riêng cho track này'}</span></h3>
            <div id="track-roles"></div>
          </div>
        </div>
        <div class="sticky-actions">
          <button class="btn btn-ghost" id="t-cancel">Cancel</button>
          <button class="btn btn-orange" id="t-update">Update</button>
        </div>
      </div>
    </div>`;

  box.querySelectorAll('[data-goto]').forEach(el =>
    el.onclick = () => showProduct(p.id, 'trackdetail', el.dataset.goto));
  document.getElementById('td-prev').onclick = () =>
    idx > 0 && showProduct(p.id, 'trackdetail', items[idx - 1].id);
  document.getElementById('td-next').onclick = () =>
    idx < items.length - 1 && showProduct(p.id, 'trackdetail', items[idx + 1].id);
  const playBtn = document.getElementById('td-play');
  if (playBtn) playBtn.onclick = async () => {
    const { url } = await api.get(`/v1/tracks/${tr.id}/stream`);
    if (!prodPreviewAudio) prodPreviewAudio = new Audio();
    prodPreviewAudio.src = url;
    prodPreviewAudio.play();
  };
  document.getElementById('t-upload').onclick = () =>
    openAudioUpload(tr, () => showProduct(p.id, 'trackdetail', tr.id), p.id);
  document.getElementById('t-cancel').onclick = () => showProduct(p.id, 'tracks');

  // Single: contributors khóa dùng chung với product (chỉ xem). Album: sửa được.
  if (p.release_type === 'Single') {
    renderRoleGroupsReadonly(document.getElementById('track-roles'), tr.contributors || {});
  } else {
    renderRoleGroups(document.getElementById('track-roles'), tr.contributors || {},
      (payload) => api.put(`/admin/v1/products/tracks/${tr.id}/contributors`, { contributors: payload })
        .then(() => toast('Đã lưu contributors (track)'))
        .catch(e => toast(e.message, true)));
  }

  document.getElementById('t-update').onclick = async () => {
    const g = (id) => document.getElementById(id).value.trim();
    try {
      await api.patch(`/admin/v1/products/tracks/${tr.id}`, {
        title: g('t-title'), subtitle: g('t-version') || null,
        isrc: g('t-isrc') || null, secondary_isrc: g('t-isrc2') || null,
        genre: g('t-genre') || null, secondary_genre: g('t-genre2') || null,
        language: document.getElementById('t-lang').value,
        parental_warning: document.querySelector('[name=tadv]:checked').value,
        clip_start_seconds: Number(g('t-clip') || 30),
        c_line: g('t-cline') || null,
        c_line_year: g('t-cyear') ? Number(g('t-cyear')) : null,
        p_line: g('t-pline') || null,
        p_line_year: g('t-pyear') ? Number(g('t-pyear')) : null,
        right_holder: g('t-rholder') || null,
        instant_grat_stream_date: g('t-igs') || null,
        instant_grat_download_date: g('t-igd') || null,
        lyrics: g('t-lyrics') || null,
        lyrics_lrc: g('t-lrc') || null,
      });
      toast('Đã cập nhật track');
      showProduct(p.id, 'trackdetail', tr.id);
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- Tab QC Check ---------- */
async function renderProdQC(box, p) {
  box.innerHTML = '<p class="empty-note">Đang chạy QC…</p>';
  const qc = await api.get(`/admin/v1/products/${p.id}/qc`);
  const st = { pass: '✅', warning: '⚠', error: '❌' };
  box.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(3,minmax(140px,1fr));max-width:560px">
      <div class="stat-card ${qc.errors ? 'danger' : ''}"><div class="num">${qc.errors}</div><div class="lbl">Errors (chặn publish)</div></div>
      <div class="stat-card ${qc.warnings ? 'warn' : ''}"><div class="num">${qc.warnings}</div><div class="lbl">Warnings</div></div>
      <div class="stat-card"><div class="num">${qc.can_publish ? '✓' : '✗'}</div><div class="lbl">Sẵn sàng publish</div></div>
    </div>
    ${qc.groups.map(g => `
      <div class="qc-group"><h4>${h(g.name)}</h4>
        ${g.rules.map(r => `
          <div class="qc-rule ${r.level}">
            <span class="st">${st[r.level]}</span>
            <span>${h(r.label)}</span>
            <span class="dt">${h(r.detail || '')}</span>
          </div>`).join('')}
      </div>`).join('')}
    ${qc.can_publish ? `<div class="sticky-actions">
      <button class="btn btn-orange" id="qc-goto-publish">🚀 Sang tab Releases để Publish</button></div>` : ''}`;
  const go = document.getElementById('qc-goto-publish');
  if (go) go.onclick = () => showProduct(p.id, 'releases');
}

/* ---------- Tab Releases — hành động theo role (uploader / manager) ---------- */
async function renderProdReleases(box, p) {
  const [qc, hist] = await Promise.all([
    api.get(`/admin/v1/products/${p.id}/qc`),
    api.get(`/admin/v1/products/${p.id}/releases`),
  ]);
  const canManage = isManagerRole();
  const isLive = p.status === 'live' || p.status === 'scheduled';
  const isPending = p.status === 'pending_review';
  // uploader: KHÔNG có publish/update/takedown — chỉ gửi duyệt khi Draft.
  // manager/admin: pending → Duyệt/Từ chối; draft/taken_down → Publish; live → Update/Takedown.
  let actions = '';
  if (!canManage) {
    if (p.status === 'draft') {
      actions = `<button class="btn btn-orange" id="rl-submit">📤 Gửi duyệt</button>
        <span class="flow-inline">Manager sẽ kiểm tra nội dung và phát hành sau khi duyệt</span>`;
    } else if (isPending) {
      actions = `<span class="flow-inline">🕓 Đang chờ manager duyệt${
        p.submitted_at ? ` — đã gửi ${h(humanDate(p.submitted_at) || p.submitted_at)}` : ''}</span>`;
    } else {
      actions = `<span class="flow-inline">Product đã ${isLive ? 'phát hành' : 'gỡ xuống'} — liên hệ manager nếu cần thay đổi</span>`;
    }
  } else if (isPending) {
    actions = `
      <button class="btn btn-ok" id="rl-approve" ${qc.can_publish ? '' : 'disabled'}
        title="${qc.can_publish ? '' : 'QC còn lỗi — kiểm tra tab QC Check'}">✅ Duyệt &amp; phát hành</button>
      <button class="btn btn-danger" id="rl-reject">❌ Từ chối</button>`;
  } else if (isLive) {
    actions = `<button class="btn btn-orange" id="rl-update">🔄 Update release</button>
      <button class="btn btn-danger" id="rl-takedown">⛔ Takedown</button>`;
  } else {
    actions = `<button class="btn btn-orange" id="rl-publish" ${qc.can_publish ? '' : 'disabled'}
      title="${qc.can_publish ? '' : 'QC còn lỗi — kiểm tra tab QC Check'}">🚀 Publish</button>`;
  }
  box.innerHTML = `
    <div class="panel">
      <h3>Phát hành lên website</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px">
        Trạng thái hiện tại: ${badge(p.status)} ·
        QC: ${qc.errors ? `<span style="color:var(--danger)">${qc.errors} lỗi</span>` : '✓ pass'}
        ${qc.warnings ? ` · ⚠ ${qc.warnings} cảnh báo` : ''}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${actions}</div>
    </div>
    <div class="panel">
      <h3>Lịch sử phát hành</h3>
      ${hist.items.length ? `<div class="tbl-wrap" style="border:none"><table>
        <thead><tr><th>Thời gian</th><th>Hành động</th><th>Provider</th><th>Người thao tác</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead>
        <tbody>${hist.items.map(x => `
          <tr><td class="sub">${h(x.created_at)}</td>
          <td><b>${h(x.action)}</b></td>
          <td>${h(x.provider)}</td>
          <td class="sub">${h(x.actor_email || '—')}</td>
          <td>${badge(x.status === 'success' ? 'imported' : 'failed')}</td>
          <td class="sub">${h(x.detail || '')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty-note">Chưa có lần phát hành nào</p>'}
    </div>`;

  const sub = document.getElementById('rl-submit');
  if (sub) sub.onclick = () => submitProductReview(p);
  const ap = document.getElementById('rl-approve');
  if (ap) ap.onclick = () => approveProduct(p);
  const rj = document.getElementById('rl-reject');
  if (rj) rj.onclick = () => openRejectModal(p);
  const pub = document.getElementById('rl-publish');
  if (pub) pub.onclick = async () => {
    try {
      const res = await api.post(`/admin/v1/products/${p.id}/publish`);
      toast(res.status === 'scheduled'
        ? '⏰ Đã hẹn giờ phát hành' : '🚀 ĐÃ PHÁT HÀNH — nhạc hiển thị trên website');
      refreshReviewPill();
      showProduct(p.id, 'releases');
    } catch (e) { toast(e.message, true); }
  };
  const upd = document.getElementById('rl-update');
  if (upd) upd.onclick = async () => {
    await api.post(`/admin/v1/products/${p.id}/update-release`);
    toast('Đã đẩy metadata mới nhất');
    showProduct(p.id, 'releases');
  };
  const tk = document.getElementById('rl-takedown');
  if (tk) tk.onclick = async () => {
    if (!confirm('Takedown — gỡ product khỏi website?')) return;
    try {
      await api.post(`/admin/v1/products/${p.id}/takedown`);
      toast('Đã gỡ khỏi website');
      showProduct(p.id, 'releases');
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- Luồng duyệt product theo role (v2.0) ---------- */
/* Lỗi HTTP có detail dạng object (api.js JSON.stringify) → tách message + errors */
function parseDetail(e) {
  try {
    const d = JSON.parse(e.message);
    if (d && typeof d === 'object') {
      return { message: d.message || e.message, errors: d.errors || [] };
    }
  } catch { /* detail là chuỗi thường */ }
  return { message: e.message, errors: [] };
}

/* Uploader gửi product Draft vào hàng đợi duyệt; QC lỗi → modal danh sách lỗi */
async function submitProductReview(p) {
  try {
    const res = await api.post(`/admin/v1/products/${p.id}/submit-review`);
    toast(res.warnings
      ? `📤 Đã gửi duyệt (QC có ${res.warnings} cảnh báo)`
      : '📤 Đã gửi duyệt — chờ manager phê duyệt');
    if (isManagerRole()) refreshReviewPill();   // uploader không gọi được /stats
    showProduct(p.id, 'releases');
  } catch (e) {
    const d = parseDetail(e);
    if (d.errors.length) {
      const modal = openModal(`
        <h2>⛔ Chưa gửi duyệt được</h2>
        <p style="font-size:13.5px;margin-bottom:12px">${h(d.message)}</p>
        <div class="logbox">${d.errors.map(x => `<div class="err">✗ ${h(x)}</div>`).join('')}</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>Đóng</button>
          <button class="btn btn-orange" id="qcerr-goto">Mở tab QC Check</button>
        </div>`);
      modal.querySelector('#qcerr-goto').onclick = () => {
        closeModal();
        showProduct(p.id, 'qc');
      };
    } else toast(d.message || e.message, true);
  }
}

/* Manager duyệt: chạy pipeline publish → live/scheduled */
async function approveProduct(p) {
  if (!confirm(`Duyệt & phát hành "${p.title}"?`)) return;
  try {
    const res = await api.post(`/admin/v1/products/${p.id}/approve`);
    toast(res.status === 'scheduled'
      ? '✅ Đã duyệt — hẹn giờ phát hành ⏰'
      : '✅ Đã duyệt — product ĐÃ PHÁT HÀNH');
    refreshReviewPill();
    showProduct(p.id, 'releases');
  } catch (e) { toast(e.message, true); }
}

/* Manager từ chối: bắt buộc nhập lý do để uploader biết đường sửa */
function openRejectModal(p) {
  const modal = openModal(`
    <h2>❌ Từ chối phát hành</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:14px">
      “${h(p.title)}” sẽ quay về <b>Draft</b> — uploader thấy lý do bên dưới và sửa lại.</p>
    <form id="rj-form">
      <div class="field"><label>Lý do từ chối *</label>
        <textarea name="note" rows="4" required
          placeholder="VD: Ảnh bìa sai kích thước, thiếu lyrics bài 2, sai P-Line…"></textarea></div>
      <div class="form-error" id="rj-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-danger">Từ chối</button>
      </div>
    </form>`);
  modal.querySelector('#rj-form').onsubmit = async (e) => {
    e.preventDefault();
    const note = String(new FormData(e.target).get('note') || '').trim();
    if (!note) {
      modal.querySelector('#rj-error').textContent = 'Cần ghi chú lý do từ chối';
      return;
    }
    try {
      await api.post(`/admin/v1/products/${p.id}/reject`, { note });
      toast('Đã từ chối — product quay về Draft kèm ghi chú');
      closeModal();
      refreshReviewPill();
      showProduct(p.id);
    } catch (err) { modal.querySelector('#rj-error').textContent = err.message; }
  };
}

/* ---------- Labels — bảng chuyên sâu + trang chi tiết (v2.0) ---------- */
sections.labels = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>🏷 Labels</h1>
      <div class="tools">
        <input type="search" id="lb-search" placeholder="Tìm label…">
        <button class="btn btn-orange" id="btn-new-label">＋ Thêm label</button>
      </div></div>
    <div id="lb-table"><p class="empty-note">Đang tải…</p></div>`;
  document.getElementById('btn-new-label').onclick = () => openLabelModal();
  let timer;
  document.getElementById('lb-search').oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => renderLabelTable(e.target.value), 300);
  };
  await renderLabelTable();
};

async function renderLabelTable(q = '') {
  const box = document.getElementById('lb-table');
  const data = await api.get(`/admin/v1/products/labels?q=${encodeURIComponent(q)}`);
  if (!box || !box.isConnected) return;
  box.innerHTML = data.items.length ? `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Label</th><th>DPID</th><th>ISRC prefix</th>
        <th>℗ / © / Right holder</th><th>Liên hệ</th><th>Products</th><th></th></tr></thead>
      <tbody>${data.items.map(l => `
        <tr data-open="${l.id}" style="cursor:pointer">
          <td><b>${h(l.name)}</b></td>
          <td class="mono">${h(l.dpid || '—')}</td>
          <td class="mono">${h(l.isrc_prefix || '—')}</td>
          <td class="lbl-lines">
            <div class="trunc" title="${h(l.p_line || '')}">${h(l.p_line || '—')}</div>
            <div class="sub trunc" title="${h(l.c_line || '')}">${h(l.c_line || '—')}</div>
            <div class="sub trunc" title="Right holder: ${h(l.right_holder || '')}">${h(l.right_holder || '—')}</div>
          </td>
          <td class="sub">${h(l.contact_email || '—')}</td>
          <td><b>${l.product_count}</b>
            ${l.live_count ? `<span class="cnt-chip live" title="Đang phát hành">${l.live_count} live</span>` : ''}
            ${l.draft_count ? `<span class="cnt-chip draft" title="Nháp">${l.draft_count} nháp</span>` : ''}
            ${l.pending_count ? `<span class="cnt-chip pending" title="Chờ duyệt">${l.pending_count} chờ duyệt</span>` : ''}
          </td>
          <td class="actions">
            <button class="btn btn-ghost btn-sm" data-edit="${l.id}">Sửa</button>
            <button class="btn btn-danger btn-sm" data-del="${l.id}">Xóa</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
    : `<div class="panel empty-note">Chưa có label nào${q ? ' khớp tìm kiếm' : ''} — bấm "＋ Thêm label"</div>`;

  box.querySelectorAll('[data-open]').forEach(tr =>
    tr.onclick = () => showLabel(tr.dataset.open));
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();   // đừng mở trang chi tiết khi bấm Sửa
    openLabelModal(data.items.find(x => x.id === b.dataset.edit));
  });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const l = data.items.find(x => x.id === b.dataset.del);
    if (!confirm(`Xóa label “${l.name}”?`)) return;
    try {
      await api.del(`/admin/v1/products/labels/${l.id}`);
      toast('Đã xóa label');
      renderLabelTable(q);
    } catch (err) {
      // 409: label còn product trỏ tới — server nêu rõ số lượng
      toast(err.message, true);
    }
  });
}

/* ---------- Trang chi tiết label: hồ sơ + stats + products thuộc label ---------- */
async function showLabel(id) {
  document.querySelectorAll('#a-nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.sec === 'labels'));
  main.innerHTML = '<p class="empty-note">Đang tải label…</p>';
  let l;
  try { l = await api.get(`/admin/v1/products/labels/${id}`); }
  catch (err) {
    main.innerHTML = `<div class="sec-head"><h1>⚠ Không mở được label</h1></div>
      <p class="empty-note">${h(err.message || 'Lỗi kết nối')} — <a href="#" id="lb-back">quay lại</a></p>`;
    const b = document.getElementById('lb-back');
    if (b) b.onclick = (e) => { e.preventDefault(); show('labels'); };
    return;
  }
  const s = l.stats || {};
  main.innerHTML = `
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:10px">
      <a href="javascript:void 0" id="bc-labels" style="color:var(--accent)">Labels</a> › ${h(l.name)}</p>
    <div class="label-layout">
      <div class="panel">
        <h3>Hồ sơ label</h3>
        <div class="field"><label>Tên label *</label><input id="lf-name" value="${h(l.name)}"></div>
        <div class="grid2">
          <div class="field"><label>DPID</label><input id="lf-dpid" value="${h(l.dpid || '')}"></div>
          <div class="field"><label>ISRC prefix (5 ký tự)</label>
            <input id="lf-prefix" maxlength="5" placeholder="VNA0D" value="${h(l.isrc_prefix || '')}" style="text-transform:uppercase"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>C-Line Text (©)</label>
            <input id="lf-cline" value="${h(l.c_line || '')}" placeholder="© 2026 Tên Label"></div>
          <div class="field"><label>P-Line Text (℗)</label>
            <input id="lf-pline" value="${h(l.p_line || '')}" placeholder="℗ 2026 Tên Label"></div>
        </div>
        <div class="field"><label>Right Holder</label>
          <input id="lf-rholder" value="${h(l.right_holder || '')}" placeholder="Chủ sở hữu quyền"></div>
        <div class="grid2">
          <div class="field"><label>Email liên hệ</label>
            <input id="lf-email" type="email" value="${h(l.contact_email || '')}" placeholder="label@example.com"></div>
          <div class="field"><label>Website</label>
            <input id="lf-website" value="${h(l.website || '')}" placeholder="https://…"></div>
        </div>
        <div class="field"><label>Ghi chú nội bộ</label>
          <textarea id="lf-notes" rows="3">${h(l.notes || '')}</textarea></div>
        <div class="form-error" id="lf-error"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" id="lf-save">Lưu thay đổi</button>
          <button class="btn btn-danger" id="lf-del">🗑 Xóa label</button>
        </div>
        <p style="color:var(--muted);font-size:11.5px;margin-top:12px">
          Tạo lúc ${h((l.created_at || '').slice(0, 16) || '—')}</p>
      </div>
      <div>
        <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">
          <div class="stat-card"><div class="num">${fmtCount(s.product_count)}</div><div class="lbl">Products</div></div>
          <div class="stat-card"><div class="num" style="color:var(--ok)">${fmtCount(s.live_count)}</div><div class="lbl">Đang phát hành</div></div>
          <div class="stat-card"><div class="num">${fmtCount(s.draft_count)}</div><div class="lbl">Nháp</div></div>
          <div class="stat-card ${s.pending_count ? 'warn' : ''}"><div class="num">${fmtCount(s.pending_count)}</div><div class="lbl">Chờ duyệt</div></div>
          <div class="stat-card"><div class="num">${fmtCount(s.track_count)}</div><div class="lbl">Tracks</div></div>
        </div>
        <div class="panel">
          <h3>Products thuộc label</h3>
          ${(l.products || []).length ? `<div class="tbl-wrap" style="border:none"><table>
            <thead><tr><th>Product</th><th>UPC</th><th>Type</th><th>Tracks</th><th>Trạng thái</th></tr></thead>
            <tbody>${l.products.map(pr => `
              <tr data-open="${pr.id}" style="cursor:pointer">
                <td><b>${h(pr.title)}</b></td>
                <td class="mono">${h(pr.upc || '—')}</td>
                <td>${h(pr.release_type || '—')}</td>
                <td>${pr.track_count}</td>
                <td>${badge(pr.status)}</td>
              </tr>`).join('')}</tbody></table></div>`
          : '<p class="empty-note">Chưa có product nào thuộc label này</p>'}
        </div>
      </div>
    </div>`;

  document.getElementById('bc-labels').onclick = () => show('labels');
  // click product → mở trang product detail có sẵn
  main.querySelectorAll('tr[data-open]').forEach(tr =>
    tr.onclick = () => showProduct(tr.dataset.open));

  document.getElementById('lf-save').onclick = async () => {
    const g = (i) => document.getElementById(i).value.trim();
    const errEl = document.getElementById('lf-error');
    errEl.textContent = '';
    try {
      await api.patch(`/admin/v1/products/labels/${id}`, {
        name: g('lf-name'),
        dpid: g('lf-dpid') || null,
        isrc_prefix: g('lf-prefix').toUpperCase() || null,
        c_line: g('lf-cline') || null,
        p_line: g('lf-pline') || null,
        right_holder: g('lf-rholder') || null,
        contact_email: g('lf-email') || null,
        website: g('lf-website') || null,
        notes: g('lf-notes') || null,
      });
      toast('Đã lưu label');
      showLabel(id);
    } catch (e) { errEl.textContent = e.message; }
  };
  document.getElementById('lf-del').onclick = async () => {
    if (!confirm(`Xóa label “${l.name}”?`)) return;
    try {
      await api.del(`/admin/v1/products/labels/${id}`);
      toast('Đã xóa label');
      show('labels');
    } catch (e) {
      // 409: còn product trỏ tới label — hiện thông báo server ngay dưới form
      document.getElementById('lf-error').textContent = e.message;
    }
  };
}

function openLabelModal(label = null) {
  const modal = openModal(`
    <h2>${label ? 'Sửa label' : 'Thêm label'}</h2>
    <form id="lb-form">
      <div class="field"><label>Tên label *</label><input name="name" required value="${h(label?.name || '')}"></div>
      <div class="grid2">
        <div class="field"><label>ISRC prefix (5 ký tự)</label>
          <input name="isrc_prefix" maxlength="5" placeholder="VNA0D" value="${h(label?.isrc_prefix || '')}" style="text-transform:uppercase">
          <div class="help">Dùng để auto-generate ISRC cho track của label này</div></div>
        <div class="field"><label>DPID</label><input name="dpid" value="${h(label?.dpid || '')}"></div>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:2px 0 8px">
        Bản quyền mặc định — product tạo bằng label này sẽ tự điền C-Line, P-Line, Right Holder từ đây (vẫn sửa được).</p>
      <div class="grid2">
        <div class="field"><label>C-Line Text (©)</label>
          <input name="c_line" value="${h(label?.c_line || '')}" placeholder="© 2026 Tên Label"></div>
        <div class="field"><label>P-Line Text (℗)</label>
          <input name="p_line" value="${h(label?.p_line || '')}" placeholder="℗ 2026 Tên Label"></div>
      </div>
      <div class="field"><label>Right Holder</label>
        <input name="right_holder" value="${h(label?.right_holder || '')}" placeholder="Chủ sở hữu quyền"></div>
      <div class="grid2">
        <div class="field"><label>Email liên hệ</label>
          <input name="contact_email" type="email" value="${h(label?.contact_email || '')}" placeholder="label@example.com"></div>
        <div class="field"><label>Website</label>
          <input name="website" value="${h(label?.website || '')}" placeholder="https://…"></div>
      </div>
      <div class="field"><label>Ghi chú nội bộ</label>
        <textarea name="notes" rows="2">${h(label?.notes || '')}</textarea></div>
      <div class="form-error" id="lb-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-orange">${label ? 'Lưu' : 'Thêm'}</button>
      </div>
    </form>`);
  modal.querySelector('#lb-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'),
      isrc_prefix: (fd.get('isrc_prefix') || '').toUpperCase() || null,
      dpid: fd.get('dpid') || null,
      c_line: fd.get('c_line') || null,
      p_line: fd.get('p_line') || null,
      right_holder: fd.get('right_holder') || null,
      contact_email: fd.get('contact_email') || null,
      website: fd.get('website') || null,
      notes: fd.get('notes') || null,
    };
    try {
      if (label) await api.patch(`/admin/v1/products/labels/${label.id}`, body);
      else await api.post('/admin/v1/products/labels', body);
      toast('Đã lưu label');
      closeModal();
      renderLabelTable();
    } catch (err) { modal.querySelector('#lb-error').textContent = err.message; }
  };
}

/* ============================================================
   KHO MÃ UPC / ISRC
   ============================================================ */
sections.idpool = async (kind = 'isrc') => {
  main.innerHTML = `
    <div class="sec-head"><h1>🔢 Kho mã UPC / ISRC</h1></div>
    <p style="color:var(--muted);font-size:13.5px;margin:-12px 0 16px;line-height:1.6">
      Nhập dải mã đã đăng ký (IFPI cấp ISRC, GS1 cấp UPC) — hệ thống <b>cấp phát tự động
      từ kho</b> khi phát hành; hết kho sẽ tự sinh mã nội bộ nếu được bật.</p>
    <div class="tabs" style="display:flex;gap:8px;margin-bottom:18px">
      <button class="btn ${kind === 'isrc' ? 'btn-primary' : 'btn-ghost'}" data-kind="isrc">ISRC (bài hát)</button>
      <button class="btn ${kind === 'upc' ? 'btn-primary' : 'btn-ghost'}" data-kind="upc">UPC (release)</button>
    </div>
    <div id="pool-body"><p class="empty-note">Đang tải…</p></div>`;
  main.querySelectorAll('[data-kind]').forEach(b =>
    b.onclick = () => sections.idpool(b.dataset.kind));
  await renderPool(kind);
};

async function renderPool(kind) {
  const box = document.getElementById('pool-body');
  const data = await api.get(`/admin/v1/idpool?kind=${kind}`);
  if (!box || !box.isConnected) return;
  const label = kind === 'isrc' ? 'ISRC' : 'UPC';
  const ph = kind === 'isrc' ? 'VNA0D2600101\nVNA0D2600102\n…' : '0827969279321\n0827969279338\n…';
  box.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="stat-card"><div class="num" style="color:var(--ok)">${fmtCount(data.available)}</div>
        <div class="lbl">Mã ${label} còn trong kho</div></div>
      <div class="stat-card"><div class="num">${fmtCount(data.used)}</div>
        <div class="lbl">Đã cấp phát</div></div>
      <div class="stat-card">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;font-weight:600">
          <input type="checkbox" id="pool-auto" style="width:auto" ${data.auto_generate ? 'checked' : ''}>
          Tự sinh mã khi kho hết
        </label>
        <div class="lbl" style="margin-top:6px">Tắt = bắt buộc dùng mã thật trong kho</div>
      </div>
    </div>
    <div class="two-col">
      <div class="panel">
        <h3>➕ Thêm mã ${label}</h3>
        <div class="field"><label>Nhập thủ công (mỗi dòng 1 mã, hoặc cách nhau dấu phẩy)</label>
          <textarea id="pool-codes" rows="5" placeholder="${ph}" style="font-family:Consolas,monospace"></textarea></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" id="pool-add">Thêm vào kho</button>
          <span style="color:var(--muted);font-size:12.5px">hoặc</span>
          <button class="btn btn-ghost" id="pool-import-btn">📄 Import file .txt</button>
          <input type="file" id="pool-file" accept=".txt,.csv" hidden>
        </div>
        <div id="pool-result" style="margin-top:14px"></div>
      </div>
      <div class="panel">
        <h3>Danh sách mã (${fmtCount(data.available + data.used)})</h3>
        <div class="tbl-wrap" style="border:none;max-height:420px;overflow-y:auto">
          <table><thead><tr><th>Mã</th><th>Trạng thái</th><th>Thêm lúc</th><th></th></tr></thead>
          <tbody>${data.items.map(c => `
            <tr>
              <td class="mono">${h(c.code)}</td>
              <td>${c.status === 'available'
                ? '<span class="badge live">Sẵn sàng</span>'
                : '<span class="badge draft">Đã dùng</span>'}</td>
              <td class="sub">${h((c.added_at || '').slice(0, 16))}</td>
              <td class="actions">${c.status === 'available'
                ? `<button class="btn btn-danger btn-sm" data-del="${c.id}">Xóa</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty-note">Kho trống — thêm mã ở khung bên trái</td></tr>'}
          </tbody></table>
        </div>
      </div>
    </div>`;

  document.getElementById('pool-auto').onchange = async (e) => {
    try {
      await api.patch('/admin/v1/idpool/settings',
        { kind, auto_generate: e.target.checked });
      toast(e.target.checked ? 'Đã bật tự sinh mã' : 'Đã tắt tự sinh — chỉ dùng mã trong kho');
    } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  };

  const showResult = (rep) => {
    document.getElementById('pool-result').innerHTML = `
      <div class="logbox">${[
        `✅ Đã thêm ${rep.added.length} mã`,
        ...rep.skipped.map(s => `<span class="err">✗ ${h(s.code)} — ${h(s.reason)}</span>`),
      ].join('<br>')}</div>`;
  };

  document.getElementById('pool-add').onclick = async () => {
    const raw = document.getElementById('pool-codes').value;
    const codes = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (!codes.length) return toast('Chưa nhập mã nào', true);
    try {
      const rep = await api.post('/admin/v1/idpool', { kind, codes });
      showResult(rep);
      toast(`Đã thêm ${rep.added.length} mã ${label}`);
      renderPool(kind);
    } catch (e) { toast(e.message, true); }
  };

  const fileInput = document.getElementById('pool-file');
  document.getElementById('pool-import-btn').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const rep = await api.upload(`/admin/v1/idpool/import?kind=${kind}`, fd);
      showResult(rep);
      toast(`Import: +${rep.added.length} mã, bỏ qua ${rep.skipped.length}`);
      renderPool(kind);
    } catch (e) { toast(e.message, true); }
    fileInput.value = '';
  };

  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    try {
      await api.del(`/admin/v1/idpool/${b.dataset.del}`);
      toast('Đã xóa mã khỏi kho');
      renderPool(kind);
    } catch (e) { toast(e.message, true); }
  });
}

/* ============================================================
   ĐỐI TÁC DELIVERY
   ============================================================ */
sections.partners = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>🤝 Đối tác delivery</h1>
      <button class="btn btn-primary" id="btn-new-partner">＋ Thêm đối tác</button></div>
    <p style="color:var(--muted);font-size:13.5px;margin:-12px 0 18px;line-height:1.6">
      Mỗi distributor/label được cấp <b>API key</b> để bắn DDEX ERN XML thẳng vào
      <span class="mono">POST /ingestion/v1/deliveries</span> (header <span class="mono">X-API-Key</span>).
      Bật <b>auto-publish</b> để bỏ qua hàng chờ duyệt.</p>
    <div id="pt-table"><p class="empty-note">Đang tải…</p></div>`;
  document.getElementById('btn-new-partner').onclick = () => openPartnerModal();
  await renderPartnerTable();
};

async function renderPartnerTable() {
  const box = document.getElementById('pt-table');
  const data = await api.get('/admin/v1/partners');
  if (!box || !box.isConnected) return;
  box.innerHTML = data.items.length ? `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Đối tác</th><th>DPID</th><th>Auto-publish</th><th>Deliveries</th><th>Tạo lúc</th><th></th></tr></thead>
      <tbody>${data.items.map(p => `
        <tr>
          <td>${h(p.name)}<div class="sub">${h(p.contact_email || '')}</div></td>
          <td class="mono">${h(p.dpid || '—')}</td>
          <td>${p.auto_publish ? '<span class="badge live">Bật</span>' : '<span class="badge draft">Tắt — qua duyệt</span>'}</td>
          <td>${p.delivery_count}</td>
          <td class="sub">${h((p.created_at || '').slice(0, 10))}</td>
          <td class="actions">
            <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Sửa</button>
            <button class="btn btn-ghost btn-sm" data-key="${p.id}">🔑 Key mới</button>
            <button class="btn btn-danger btn-sm" data-del="${p.id}">Xóa</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="panel empty-note">Chưa có đối tác nào — bấm "＋ Thêm đối tác" để cấp kênh delivery đầu tiên</div>';

  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
    openPartnerModal(data.items.find(x => x.id === b.dataset.edit)));
  box.querySelectorAll('[data-key]').forEach(b => b.onclick = async () => {
    if (!confirm('Tạo API key mới? Key cũ sẽ hết hiệu lực ngay.')) return;
    try {
      const res = await api.post(`/admin/v1/partners/${b.dataset.key}/regenerate-key`);
      showApiKey(res.api_key);
      renderPartnerTable();
    } catch (e) { toast(e.message, true); }
  });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const p = data.items.find(x => x.id === b.dataset.del);
    if (!confirm(`Xóa đối tác "${p.name}"? Key của họ sẽ hết hiệu lực.`)) return;
    try {
      await api.del(`/admin/v1/partners/${p.id}`);
      toast('Đã xóa đối tác');
      renderPartnerTable();
    } catch (e) { toast(e.message, true); }
  });
}

function openPartnerModal(partner = null) {
  const modal = openModal(`
    <h2>${partner ? 'Sửa đối tác' : 'Thêm đối tác delivery'}</h2>
    <form id="pt-form">
      <div class="field"><label>Tên đối tác *</label>
        <input name="name" required value="${h(partner?.name || '')}" placeholder="VD: Mekong Digital Distribution"></div>
      <div class="grid2">
        <div class="field"><label>DPID (DDEX Party ID)</label>
          <input name="dpid" value="${h(partner?.dpid || '')}" placeholder="PADPIDA2026XXXXX"></div>
        <div class="field"><label>Email liên hệ</label>
          <input name="contact_email" type="email" value="${h(partner?.contact_email || '')}"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:6px 0 4px">
        <input type="checkbox" name="auto_publish" style="width:auto" ${partner?.auto_publish ? 'checked' : ''}>
        Auto-publish (nội dung lên thẳng catalog, bỏ qua Review Queue)
      </label>
      <div class="form-error" id="pt-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">${partner ? 'Lưu' : 'Tạo + cấp API key'}</button>
      </div>
    </form>`);
  modal.querySelector('#pt-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'), dpid: fd.get('dpid') || null,
      contact_email: fd.get('contact_email') || null,
      auto_publish: !!fd.get('auto_publish'),
    };
    try {
      if (partner) {
        await api.patch(`/admin/v1/partners/${partner.id}`, body);
        toast('Đã lưu');
        closeModal();
      } else {
        const res = await api.post('/admin/v1/partners', body);
        closeModal();
        showApiKey(res.api_key);
      }
      renderPartnerTable();
    } catch (err) { modal.querySelector('#pt-error').textContent = err.message; }
  };
}

function showApiKey(key) {
  const modal = openModal(`
    <h2>🔑 API key của đối tác</h2>
    <p style="color:var(--warn);font-size:13px;margin-bottom:12px">
      Key chỉ hiển thị MỘT LẦN (server chỉ lưu hash) — sao chép và gửi cho đối tác ngay.</p>
    <div class="keybox"><span style="flex:1" id="key-text">${h(key)}</span>
      <button class="btn btn-ghost btn-sm" id="key-copy">Sao chép</button></div>
    <p style="color:var(--muted);font-size:12.5px;margin-top:14px">Đối tác gửi delivery bằng:</p>
    <div class="logbox" style="margin-top:6px">curl -X POST ${location.origin}/ingestion/v1/deliveries \\
  -H "X-API-Key: ${h(key)}" \\
  -H "Content-Type: application/xml" \\
  --data-binary @NewReleaseMessage.xml</div>
    <div class="modal-actions"><button class="btn btn-primary" data-close>Đã lưu key</button></div>`);
  modal.querySelector('#key-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(key);
      toast('Đã sao chép API key');
    } catch {
      // http không phải localhost → Clipboard API bị chặn: bôi đen sẵn cho Ctrl+C
      const el = modal.querySelector('#key-text');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Trình duyệt chặn tự sao chép — nhấn Ctrl+C để copy', true);
    }
  };
}

/* ============================================================
   DISTRIBUTIONS (SFTP DDEX) — chỉ admin thấy mục này
   Kênh cho đối tác đẩy DDEX ERN XML + audio qua SFTP bằng SSH key
   (kiểu YouTube CMS). Backend tự sinh cặp key hoặc nhận public key
   do đối tác dán vào; private key CHỈ hiện 1 lần lúc tạo/cấp lại.
   ============================================================ */
let sftpInfo = null;   // thông tin SFTP server gần nhất (dùng lại trong các modal)

// rút gọn fingerprint dài (VD SHA256:abcd…) để hiện gọn trong bảng
const fpShort = (fp) => !fp ? '—' : (fp.length > 26 ? fp.slice(0, 23) + '…' : fp);

// banner thông tin SFTP server ở đầu section
function renderSftpBanner(s) {
  if (!s) return '';
  const warn = !s.enabled ? `
    <div class="sftp-warn">⚠ SFTP server đang TẮT — bật
      <span class="mono">ANS_SFTP_ENABLED=true</span> trong .env rồi khởi động lại.</div>` : '';
  return `
    <div class="sftp-banner">
      <div class="sftp-banner-title">🛰 SFTP server</div>
      <div class="conn-grid">
        <div><span class="k">Host</span><span class="mono v">${h(s.host || '—')}</span></div>
        <div><span class="k">Port</span><span class="mono v">${h(String(s.port ?? '—'))}</span></div>
        <div><span class="k">Trạng thái</span><span class="v">${s.enabled
          ? '<span class="badge live">Đang bật</span>'
          : '<span class="badge failed">Tắt</span>'}</span></div>
        <div class="wide"><span class="k">Host key fingerprint</span>
          <span class="mono v">${h(s.host_key_fingerprint || '—')}</span></div>
      </div>
      ${warn}
    </div>`;
}

sections.distributions = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>🛰 Distributions (SFTP)</h1>
      <button class="btn btn-primary" id="btn-new-dist">＋ Tạo distribution</button></div>
    <p style="color:var(--muted);font-size:13.5px;margin:-12px 0 18px;line-height:1.6">
      Mỗi distribution là một kênh <b>SFTP</b> để đối tác đẩy <b>DDEX ERN XML + audio</b> vào
      thư mục <span class="mono">incoming/</span>. Xác thực bằng <b>SSH key</b> — không dùng mật khẩu.</p>
    <div id="dist-table"><p class="empty-note">Đang tải…</p></div>`;
  document.getElementById('btn-new-dist').onclick = () => openDistModal();
  await renderDistTable();
};

async function renderDistTable() {
  const box = document.getElementById('dist-table');
  const data = await api.get('/admin/v1/distributions');
  if (!box || !box.isConnected) return;
  sftpInfo = data.sftp || null;
  const table = data.items.length ? `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Tên</th><th>DPID</th><th>SFTP user</th><th>Fingerprint key</th>
        <th>Auto-publish</th><th>Deliveries</th><th>Lần nhận cuối</th><th></th></tr></thead>
      <tbody>${data.items.map(d => `
        <tr>
          <td>${h(d.name)}<div class="sub">${h(d.contact_email || '')}</div></td>
          <td class="mono">${h(d.dpid || '—')}</td>
          <td class="mono">${h(d.sftp_username || '—')}</td>
          <td class="mono">${h(fpShort(d.ssh_fingerprint))}</td>
          <td>${d.auto_publish
            ? '<span class="badge live">Bật</span>'
            : '<span class="badge draft">Tắt — qua duyệt</span>'}</td>
          <td>${fmtCount(d.delivery_count)}</td>
          <td class="sub">${h((d.last_delivery_at || '').slice(0, 16) || '—')}</td>
          <td class="actions">
            <button class="btn btn-ghost btn-sm" data-conn="${d.id}">Kết nối</button>
            <button class="btn btn-ghost btn-sm" data-deliv="${d.id}">Deliveries</button>
            <button class="btn btn-ghost btn-sm" data-rotate="${d.id}">🔑 Cấp lại key</button>
            <button class="btn btn-ghost btn-sm" data-edit="${d.id}">Sửa</button>
            <button class="btn btn-danger btn-sm" data-del="${d.id}">Xóa</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="panel empty-note">Chưa có distribution nào — bấm "＋ Tạo distribution" để tạo kênh SFTP đầu tiên</div>';
  box.innerHTML = renderSftpBanner(sftpInfo) + table;

  const byId = (id) => data.items.find(x => x.id === id);
  box.querySelectorAll('[data-conn]').forEach(b => b.onclick = () => showDistConnection(byId(b.dataset.conn)));
  box.querySelectorAll('[data-deliv]').forEach(b => b.onclick = () => showDistDeliveries(byId(b.dataset.deliv)));
  box.querySelectorAll('[data-rotate]').forEach(b => b.onclick = () => rotateDistKey(byId(b.dataset.rotate)));
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openDistModal(byId(b.dataset.edit)));
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const d = byId(b.dataset.del);
    if (!confirm(`Xóa distribution "${d.name}"? Key SSH của họ sẽ hết hiệu lực và không đẩy được nữa.`)) return;
    try {
      await api.del(`/admin/v1/distributions/${d.id}`);
      toast('Đã xóa distribution');
      renderDistTable();
    } catch (e) { toast(e.message, true); }
  });
}

// modal tạo mới / sửa — khi sửa KHÔNG đổi key (dùng "Cấp lại key" riêng)
function openDistModal(dist = null) {
  const editing = !!dist;
  const modal = openModal(`
    <h2>${editing ? 'Sửa distribution' : 'Tạo distribution SFTP'}</h2>
    <form id="dist-form">
      <div class="field"><label>Tên distribution *</label>
        <input name="name" required value="${h(dist?.name || '')}" placeholder="VD: Believe Digital"></div>
      <div class="grid2">
        <div class="field"><label>DPID (DDEX Party ID)</label>
          <input name="dpid" value="${h(dist?.dpid || '')}" placeholder="PADPIDA2026XXXXX"></div>
        <div class="field"><label>Email liên hệ</label>
          <input name="contact_email" type="email" value="${h(dist?.contact_email || '')}"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:6px 0 4px">
        <input type="checkbox" name="auto_publish" style="width:auto" ${dist?.auto_publish ? 'checked' : ''}>
        Auto-publish (nội dung lên thẳng catalog, bỏ qua Review Queue)
      </label>
      ${editing ? '' : `
      <div class="field" style="margin-top:14px"><label>SSH key</label>
        <div class="radio-row">
          <label class="radio-card"><input type="radio" name="key_mode" value="server" checked>
            Server tạo cặp SSH key cho tôi</label>
          <label class="radio-card"><input type="radio" name="key_mode" value="own">
            Tôi dán public key của đối tác</label>
        </div>
      </div>
      <div class="field" id="dist-pubkey-wrap" hidden>
        <label>Public key của đối tác (OpenSSH: ssh-ed25519 / ssh-rsa …)</label>
        <textarea name="public_key" rows="3" placeholder="ssh-ed25519 AAAA… partner@host"
          style="font-family:Consolas,monospace"></textarea>
      </div>`}
      <div class="form-error" id="dist-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Lưu' : 'Tạo distribution'}</button>
      </div>
    </form>`);

  // ẩn/hiện ô public key theo lựa chọn (chỉ khi tạo mới)
  if (!editing) {
    const wrap = modal.querySelector('#dist-pubkey-wrap');
    modal.querySelectorAll('[name=key_mode]').forEach(r => r.onchange = () => {
      wrap.hidden = modal.querySelector('[name=key_mode]:checked').value !== 'own';
    });
  }

  modal.querySelector('#dist-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'), dpid: fd.get('dpid') || null,
      contact_email: fd.get('contact_email') || null,
      auto_publish: !!fd.get('auto_publish'),
    };
    try {
      if (editing) {
        await api.patch(`/admin/v1/distributions/${dist.id}`, body);
        toast('Đã lưu');
        closeModal();
      } else {
        if (fd.get('key_mode') === 'own') {
          const pk = (fd.get('public_key') || '').trim();
          if (!pk) throw new Error('Chưa dán public key của đối tác');
          body.public_key = pk;
        }
        const res = await api.post('/admin/v1/distributions', body);
        closeModal();
        showKeypair({ ...res, name: body.name });
      }
      renderDistTable();
    } catch (err) { modal.querySelector('#dist-error').textContent = err.message; }
  };
}

// cấp lại SSH key cho 1 distribution → hiện lại keypair (private key 1 lần)
async function rotateDistKey(dist) {
  if (!confirm(`Cấp lại SSH key cho "${dist.name}"? Key cũ hết hiệu lực ngay — đối tác phải dùng key mới.`)) return;
  try {
    const res = await api.post(`/admin/v1/distributions/${dist.id}/rotate-key`);
    showKeypair({ ...res, name: dist.name, sftp_username: res.sftp_username || dist.sftp_username });
    renderDistTable();
  } catch (e) { toast(e.message, true); }
}

// nút sao chép dùng chung: Clipboard API, fallback bôi đen cho môi trường bị chặn
function bindCopy(btn, getText, selEl, label = '') {
  if (!btn) return;
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      toast(`Đã sao chép${label ? ' ' + label : ''}`);
    } catch {
      // http không phải localhost → Clipboard API bị chặn: bôi đen sẵn cho Ctrl+C
      if (selEl) {
        const range = document.createRange();
        range.selectNodeContents(selEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      toast('Trình duyệt chặn tự sao chép — nhấn Ctrl+C để copy', true);
    }
  };
}

// khối hướng dẫn kết nối cho đối tác (dùng chung showKeypair + showDistConnection)
function connGuideHtml(host, port, user, cmd) {
  return `
    <div class="conn-guide">
      <div class="conn-guide-title">Hướng dẫn kết nối cho đối tác</div>
      <div class="conn-grid">
        <div><span class="k">Host</span><span class="mono v">${h(host)}</span></div>
        <div><span class="k">Port</span><span class="mono v">${h(String(port))}</span></div>
        <div class="wide"><span class="k">Username</span><span class="mono v">${h(user)}</span></div>
      </div>
      <p class="conn-hint">Kết nối bằng SFTP với private key:</p>
      <div class="logbox">${h(cmd)}</div>
      <p class="conn-hint">Đẩy nội dung: đưa file <b>DDEX ERN XML</b> cùng các file <b>audio</b> vào
        thư mục <span class="mono">incoming/</span>. Hệ thống tự phát hiện, validate và import.</p>
    </div>`;
}

// hiển thị keypair sau khi tạo / cấp lại — private key chỉ có 1 lần
function showKeypair(res) {
  const sftp = res.sftp || sftpInfo || {};
  const host = sftp.host || '—';
  const port = sftp.port ?? 22;
  const user = res.sftp_username || '—';
  const pub = res.ssh_public_key || '';
  const fp = res.ssh_fingerprint || '';
  const hasPriv = !!res.private_key;
  const cmd = `sftp -i private_key.pem -P ${port} ${user}@${host}`;

  const modal = openModal(`
    <h2>🔑 SSH key${res.name ? ' — ' + h(res.name) : ''}</h2>
    ${hasPriv ? `
    <p style="color:var(--warn);font-size:13px;margin-bottom:12px">
      ⚠ Private key chỉ hiển thị <b>MỘT LẦN</b> (server không lưu lại) — tải về hoặc sao chép
      và gửi cho đối tác qua kênh an toàn ngay bây giờ.</p>
    <div class="field"><label>Private key (.pem)</label>
      <div class="keybox multiline"><pre id="pk-text" style="flex:1;margin:0">${h(res.private_key)}</pre></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn btn-ghost btn-sm" id="pk-download">⬇ Tải .pem</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pk-copy">Sao chép private key</button>
      </div>
    </div>` : `
    <p style="color:var(--muted);font-size:13px;margin-bottom:12px">
      Đối tác tự tạo cặp key nên hệ thống chỉ lưu <b>public key</b> — không có private key ở đây.</p>`}

    <div class="field"><label>Public key (OpenSSH)</label>
      <div class="keybox"><span id="pub-text" style="flex:1">${h(pub) || '—'}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="pub-copy">Sao chép</button></div></div>
    <div class="field"><label>Fingerprint</label>
      <div class="keybox"><span style="flex:1">${h(fp) || '—'}</span></div></div>

    ${connGuideHtml(host, port, user, cmd)}
    <div class="modal-actions"><button class="btn btn-primary" data-close>${hasPriv ? 'Đã lưu key' : 'Đóng'}</button></div>`);

  if (hasPriv) {
    modal.querySelector('#pk-download').onclick = () => {
      const blob = new Blob([res.private_key], { type: 'application/x-pem-file' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${String(user || 'ans-sftp').replace(/[^\w.-]/g, '_')}.pem`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    bindCopy(modal.querySelector('#pk-copy'), () => res.private_key, modal.querySelector('#pk-text'), 'private key');
  }
  bindCopy(modal.querySelector('#pub-copy'), () => pub, modal.querySelector('#pub-text'), 'public key');
}

// "Xem hướng dẫn kết nối" cho 1 hàng
function showDistConnection(dist) {
  const sftp = sftpInfo || {};
  const host = sftp.host || '—';
  const port = sftp.port ?? 22;
  const user = dist.sftp_username || '—';
  const cmd = `sftp -i private_key.pem -P ${port} ${user}@${host}`;
  openModal(`
    <h2>🔌 Kết nối SFTP — ${h(dist.name)}</h2>
    ${!sftp.enabled ? '<p style="color:var(--warn);font-size:13px;margin-bottom:12px">⚠ SFTP server đang TẮT — đối tác chưa kết nối được cho tới khi bật.</p>' : ''}
    <div class="conn-guide">
      <div class="conn-grid">
        <div><span class="k">Host</span><span class="mono v">${h(host)}</span></div>
        <div><span class="k">Port</span><span class="mono v">${h(String(port))}</span></div>
        <div><span class="k">Username</span><span class="mono v">${h(user)}</span></div>
        <div><span class="k">Fingerprint key</span><span class="mono v">${h(dist.ssh_fingerprint || '—')}</span></div>
        <div class="wide"><span class="k">Host key fingerprint</span>
          <span class="mono v">${h(sftp.host_key_fingerprint || '—')}</span></div>
      </div>
      <p class="conn-hint">Mẫu lệnh kết nối:</p>
      <div class="logbox">${h(cmd)}</div>
      <p class="conn-hint">Đưa file <b>DDEX ERN XML</b> + <b>audio</b> vào thư mục
        <span class="mono">incoming/</span> để hệ thống nhận và import.</p>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Đóng</button></div>`);
}

// "Deliveries" cho 1 hàng — bảng các lần đối tác đẩy DDEX
async function showDistDeliveries(dist) {
  const modal = openModal(`
    <h2>📥 Deliveries — ${h(dist.name)}</h2>
    <div id="dist-deliv-body"><p class="empty-note">Đang tải…</p></div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Đóng</button></div>`);
  try {
    const data = await api.get(`/admin/v1/distributions/${dist.id}/deliveries`);
    const body = modal.querySelector('#dist-deliv-body');
    if (!body) return;
    body.innerHTML = data.items.length ? `
      <div class="tbl-wrap" style="border:none;max-height:420px;overflow-y:auto"><table>
        <thead><tr><th>MessageId</th><th>Loại</th><th>Trạng thái</th><th>Nhận lúc</th><th>Xử lý lúc</th></tr></thead>
        <tbody>${data.items.map(d => `
          <tr>
            <td class="mono">${h(d.message_id || '—')}</td>
            <td>${h((d.message_type || '—').replace('Message', ''))}<div class="sub">ERN ${h(d.ern_version || '?')}</div></td>
            <td>${badge(d.status)}</td>
            <td class="sub">${h((d.received_at || '').slice(0, 16) || '—')}</td>
            <td class="sub">${h((d.processed_at || '').slice(0, 16) || '—')}</td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="empty-note">Chưa nhận delivery nào từ distribution này</p>';
  } catch (e) {
    const body = modal.querySelector('#dist-deliv-body');
    if (body) body.innerHTML = `<p class="empty-note">${h(e.message)}</p>`;
  }
}

/* ============================================================
   TÀI KHOẢN (users) — chỉ admin thấy mục này
   ============================================================ */
const ROLE_BADGE = {   // nhãn + class màu badge theo role
  admin: ['Admin', 'role-admin'],
  manager: ['Manager', 'role-manager'],
  uploader: ['Uploader', 'role-uploader'],
  user: ['User', 'role-user'],
};
const ROLE_DESC = {    // mô tả ngắn hiện dưới select role trong modal
  user: 'Nghe nhạc, tạo playlist — không vào được CMS',
  uploader: 'Upload nhạc, phát hành phải qua duyệt',
  manager: 'Duyệt phát hành, sửa mọi nội dung',
  admin: 'Toàn quyền',
};
const roleBadge = (role) => {
  const [label, cls] = ROLE_BADGE[role] || [role, 'role-user'];
  return `<span class="badge ${cls}">${h(label)}</span>`;
};
// avatar nhỏ trong bảng: ảnh nếu có, không thì vòng tròn chữ cái đầu
const userAvatar = (u) => u.avatar_url
  ? `<img class="thumb avatar" src="${h(u.avatar_url)}" alt="">`
  : `<span class="avatar-letter">${h((u.display_name || u.email || '?').trim().charAt(0).toUpperCase())}</span>`;
// select role dùng chung cho modal tạo/sửa
const roleSelectHtml = (current = 'user') => `
  <select name="role">
    ${['user', 'uploader', 'manager', 'admin'].map(r =>
      `<option value="${r}" ${r === current ? 'selected' : ''}>${r}</option>`).join('')}
  </select>
  <div class="help" data-role-desc></div>`;
// gắn cập nhật mô tả role khi đổi select
function bindRoleDesc(modal) {
  const sel = modal.querySelector('[name=role]');
  const desc = modal.querySelector('[data-role-desc]');
  const upd = () => { desc.textContent = ROLE_DESC[sel.value] || ''; };
  sel.onchange = upd;
  upd();
}

sections.users = async () => {
  main.innerHTML = `
    <div class="sec-head"><h1>👥 Tài khoản</h1>
      <div class="tools">
        <input type="search" id="us-search" placeholder="Tìm email / tên…">
        <select id="us-role">
          <option value="">Tất cả vai trò</option>
          <option value="user">user</option>
          <option value="uploader">uploader</option>
          <option value="manager">manager</option>
          <option value="admin">admin</option>
        </select>
        <button class="btn btn-primary" id="btn-new-user">＋ Tạo tài khoản</button>
      </div></div>
    <div id="us-table"><p class="empty-note">Đang tải…</p></div>`;
  const rerender = () => renderUserTable(
    document.getElementById('us-search').value,
    document.getElementById('us-role').value);
  document.getElementById('btn-new-user').onclick = () => openUserCreateModal(rerender);
  let timer;
  document.getElementById('us-search').oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(rerender, 300);
  };
  document.getElementById('us-role').onchange = rerender;
  await renderUserTable();
};

async function renderUserTable(q = '', role = '') {
  const box = document.getElementById('us-table');
  const data = await api.get(
    `/admin/v1/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(role)}`);
  if (!box || !box.isConnected) return;
  box.innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Tài khoản</th><th>Email</th><th>Vai trò</th><th>Gói</th><th>2FA</th>
        <th class="num">Playlist</th><th class="num">Lượt nghe</th><th>Tham gia</th><th></th></tr></thead>
      <tbody>${data.items.map(u => `
        <tr>
          <td><div class="cell-main">${userAvatar(u)}
            <div>${h(u.display_name || '—')}</div></div></td>
          <td class="mono">${h(u.email)}</td>
          <td>${roleBadge(u.role)}</td>
          <td>${u.plan === 'premium' ? '<span class="badge pending_review">Premium</span>' : 'Free'}</td>
          <td>${u.totp_enabled ? '<span class="badge b2fa">🛡 Bật</span>' : '<span class="sub">—</span>'}</td>
          <td class="num">${u.playlists}</td>
          <td class="num">${fmtCount(u.plays)}</td>
          <td class="sub">${h((u.created_at || '').slice(0, 10))}</td>
          <td class="actions">
            <button class="btn btn-ghost btn-sm" data-edit="${u.id}">Sửa</button>
            <button class="btn btn-ghost btn-sm" data-pass="${u.id}">Đặt lại MK</button>
            ${u.totp_enabled ? `<button class="btn btn-ghost btn-sm" data-t2fa="${u.id}">Tắt 2FA</button>` : ''}
            <button class="btn btn-danger btn-sm" data-del="${u.id}">Xóa</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="9" class="empty-note">Không tìm thấy tài khoản nào</td></tr>'}
      </tbody></table></div>`;

  const rerender = () => renderUserTable(q, role);
  const find = (id) => data.items.find(x => x.id === id);
  box.querySelectorAll('[data-edit]').forEach(b =>
    b.onclick = () => openUserEditModal(find(b.dataset.edit), rerender));
  box.querySelectorAll('[data-pass]').forEach(b =>
    b.onclick = () => openUserResetPassModal(find(b.dataset.pass)));
  box.querySelectorAll('[data-t2fa]').forEach(b => b.onclick = async () => {
    const u = find(b.dataset.t2fa);
    if (!confirm(`Tắt xác thực 2 lớp của “${u.email}”?\nDùng khi người dùng mất thiết bị xác thực.`)) return;
    try {
      await api.post(`/admin/v1/users/${u.id}/disable-2fa`);
      toast('Đã tắt 2FA của tài khoản');
      rerender();
    } catch (e) { toast(e.message, true); }
  });
  box.querySelectorAll('[data-del]').forEach(b =>
    b.onclick = () => openUserDeleteModal(find(b.dataset.del), rerender));
}

/* ---- Modal tạo tài khoản ---- */
function openUserCreateModal(onDone) {
  const modal = openModal(`
    <h2>＋ Tạo tài khoản</h2>
    <form id="us-form">
      <div class="field"><label>Email *</label>
        <input name="email" type="email" required placeholder="ten@example.com"></div>
      <div class="grid2">
        <div class="field"><label>Mật khẩu *</label>
          <input name="password" type="password" required minlength="6" placeholder="Tối thiểu 6 ký tự"></div>
        <div class="field"><label>Tên hiển thị</label>
          <input name="display_name" placeholder="Để trống = lấy từ email"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Vai trò</label>${roleSelectHtml('user')}</div>
        <div class="field"><label>Gói</label>
          <select name="plan">
            <option value="free">Free</option>
            <option value="premium">Premium</option>
          </select></div>
      </div>
      <div class="form-error" id="us-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">Tạo tài khoản</button>
      </div>
    </form>`);
  bindRoleDesc(modal);
  modal.querySelector('#us-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/admin/v1/users', {
        email: fd.get('email'), password: fd.get('password'),
        display_name: fd.get('display_name') || '',
        role: fd.get('role'), plan: fd.get('plan'),
      });
      toast('Đã tạo tài khoản');
      closeModal();
      onDone && onDone();
    } catch (err) { modal.querySelector('#us-error').textContent = err.message; }
  };
}

/* ---- Modal sửa tên / role / plan ---- */
function openUserEditModal(u, onDone) {
  const modal = openModal(`
    <h2>Sửa tài khoản</h2>
    <p style="color:var(--muted);font-size:13px;margin:-8px 0 16px" class="mono">${h(u.email)}</p>
    <form id="us-form">
      <div class="field"><label>Tên hiển thị</label>
        <input name="display_name" required value="${h(u.display_name || '')}"></div>
      <div class="grid2">
        <div class="field"><label>Vai trò</label>${roleSelectHtml(u.role)}</div>
        <div class="field"><label>Gói</label>
          <select name="plan">
            <option value="free" ${u.plan !== 'premium' ? 'selected' : ''}>Free</option>
            <option value="premium" ${u.plan === 'premium' ? 'selected' : ''}>Premium</option>
          </select></div>
      </div>
      <div class="form-error" id="us-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">Lưu thay đổi</button>
      </div>
    </form>`);
  bindRoleDesc(modal);
  modal.querySelector('#us-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/admin/v1/users/${u.id}`, {
        display_name: fd.get('display_name'),
        role: fd.get('role'), plan: fd.get('plan'),
      });
      toast('Đã lưu thay đổi');
      closeModal();
      onDone && onDone();
    } catch (err) {
      // server chặn: tự đổi role chính mình / hạ admin cuối cùng…
      modal.querySelector('#us-error').textContent = err.message;
    }
  };
}

/* ---- Modal đặt lại mật khẩu ---- */
function openUserResetPassModal(u) {
  const modal = openModal(`
    <h2>Đặt lại mật khẩu</h2>
    <p style="color:var(--muted);font-size:13px;margin:-8px 0 16px" class="mono">${h(u.email)}</p>
    <form id="us-form">
      <div class="field"><label>Mật khẩu mới *</label>
        <input name="p1" type="password" required minlength="6" placeholder="Tối thiểu 6 ký tự"></div>
      <div class="field"><label>Nhập lại mật khẩu mới *</label>
        <input name="p2" type="password" required minlength="6"></div>
      <div class="form-error" id="us-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-primary">Đặt mật khẩu</button>
      </div>
    </form>`);
  modal.querySelector('#us-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const err = modal.querySelector('#us-error');
    if (fd.get('p1') !== fd.get('p2')) { err.textContent = 'Hai mật khẩu không khớp'; return; }
    try {
      await api.post(`/admin/v1/users/${u.id}/reset-password`, { new_password: fd.get('p1') });
      toast('Đã đặt mật khẩu mới');
      closeModal();
    } catch (ex) { err.textContent = ex.message; }
  };
}

/* ---- Modal xóa tài khoản — xác nhận bằng cách gõ đúng email ---- */
function openUserDeleteModal(u, onDone) {
  const modal = openModal(`
    <h2>⚠ Xóa tài khoản</h2>
    <p style="font-size:13.5px;line-height:1.6;margin-bottom:14px">
      Xóa vĩnh viễn <b>${h(u.email)}</b> cùng toàn bộ playlist, yêu thích, lịch sử nghe.
      Nội dung đã phát hành (product) được giữ lại. <b>Không thể hoàn tác.</b></p>
    <form id="us-form">
      <div class="field"><label>Gõ chính xác email của tài khoản để xác nhận</label>
        <input name="confirm_email" autocomplete="off" placeholder="${h(u.email)}"></div>
      <div class="form-error" id="us-error"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Hủy</button>
        <button type="submit" class="btn btn-danger" disabled>Xóa vĩnh viễn</button>
      </div>
    </form>`);
  const input = modal.querySelector('[name=confirm_email]');
  const btnDel = modal.querySelector('button[type=submit]');
  // chỉ mở nút xóa khi email gõ vào khớp tuyệt đối (không phân biệt hoa thường)
  const emailMatch = () => input.value.trim().toLowerCase() === (u.email || '').toLowerCase();
  input.oninput = () => { btnDel.disabled = !emailMatch(); };
  modal.querySelector('#us-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!emailMatch()) return;
    // lớp xác nhận thứ 2 — chốt lần cuối trước khi gọi API
    if (!confirm(`Xác nhận lần cuối: xóa vĩnh viễn “${u.email}”?`)) return;
    try {
      await api.del(`/admin/v1/users/${u.id}`);
      toast('Đã xóa tài khoản');
      closeModal();
      onDone && onDone();
    } catch (err) {
      // server chặn: tự xóa chính mình / admin cuối cùng
      modal.querySelector('#us-error').textContent = err.message;
    }
  };
}

/* ============================================================
   CÀI ĐẶT THƯƠNG HIỆU (logo, tên web, màu, tagline)
   ============================================================ */
sections.settings = async () => {
  main.innerHTML = `<div class="sec-head"><h1>⚙ Cài đặt thương hiệu</h1></div><p class="empty-note">Đang tải…</p>`;
  const b = await api.get('/admin/v1/settings/brand');
  main.innerHTML = `
    <div class="sec-head"><h1>⚙ Cài đặt thương hiệu</h1></div>
    <p style="color:var(--muted);font-size:13.5px;margin:-12px 0 18px;line-height:1.6">
      Đổi logo, tên web, màu chủ đạo, khẩu hiệu. Lưu xong tải lại trang (Ctrl+F5) để thấy áp dụng toàn site.</p>
    <div class="two-col">
      <div class="panel">
        <h3>Nhận diện</h3>
        <div class="field"><label>Tên web (đầy đủ)</label>
          <input id="bs-name" value="${h(b.brand_name || '')}" placeholder="ANS Music"></div>
        <div class="grid2">
          <div class="field"><label>Phần đầu (đậm)</label>
            <input id="bs-short" value="${h(b.brand_short || '')}" placeholder="ANS"></div>
          <div class="field"><label>Phần sau (tô màu)</label>
            <input id="bs-suffix" value="${h(b.brand_suffix || '')}" placeholder="Music"></div>
        </div>
        <div class="field"><label>Khẩu hiệu (tagline)</label>
          <input id="bs-tagline" value="${h(b.brand_tagline || '')}" placeholder="Nghe nhạc trực tuyến"></div>
        <div class="field"><label>Màu chủ đạo (accent)</label>
          <div style="display:flex;gap:10px;align-items:center">
            <input type="color" id="bs-accent-picker" value="${h(b.brand_accent || '#7c5cff')}" style="width:52px;height:38px;padding:2px">
            <input id="bs-accent" value="${h(b.brand_accent || '#7c5cff')}" style="flex:1;text-transform:lowercase" placeholder="#7c5cff">
          </div></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn btn-primary" id="bs-save">Lưu thay đổi</button>
          <button class="btn btn-ghost" id="bs-reset">Về mặc định</button>
        </div>
        <div class="form-error" id="bs-error"></div>
      </div>
      <div class="panel">
        <h3>Logo</h3>
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:12px">
          <div id="bs-logo-box" style="width:88px;height:88px;border-radius:16px;background:var(--bg-elev2);
            display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border)">
            <img id="bs-logo-img" src="${h(b.brand_logo_url || '/static/img/logo.svg')}" style="max-width:100%;max-height:100%">
          </div>
          <div style="flex:1">
            <div class="dropzone" id="bs-logo-dz" style="padding:16px">Kéo thả hoặc <b>chọn logo</b><br>
              <span style="font-size:12px">SVG / PNG (nền trong) / JPG · vuông đẹp nhất</span></div>
            <input type="file" id="bs-logo-file" accept=".svg,.png,.jpg,.jpeg,.webp" hidden>
          </div>
        </div>
        <h3 style="margin-top:14px">Xem trước</h3>
        <div id="bs-preview" style="display:flex;align-items:center;gap:10px;padding:14px;
          background:var(--bg-elev2);border-radius:12px">
          <img id="bs-prev-logo" src="${h(b.brand_logo_url || '/static/img/logo.svg')}" width="34" height="34" style="border-radius:9px">
          <span id="bs-prev-name" style="font-size:19px;font-weight:800"></span>
        </div>
      </div>
    </div>`;

  const g = (id) => document.getElementById(id);
  const accent = () => g('bs-accent').value.trim() || '#7c5cff';
  function updatePreview() {
    const short = g('bs-short').value.trim();
    const suffix = g('bs-suffix').value.trim();
    const name = g('bs-name').value.trim() || 'ANS Music';
    g('bs-prev-name').innerHTML = short
      ? `${h(short)} <b style="color:${h(accent())}">${h(suffix)}</b>`
      : h(name);
    g('bs-prev-logo').style.boxShadow = `0 0 0 2px ${accent()}55`;
  }
  ['bs-name', 'bs-short', 'bs-suffix', 'bs-accent'].forEach(id => g(id).oninput = updatePreview);
  g('bs-accent-picker').oninput = (e) => { g('bs-accent').value = e.target.value; updatePreview(); };
  g('bs-accent').oninput = (e) => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) g('bs-accent-picker').value = e.target.value;
    updatePreview();
  };
  updatePreview();

  // upload logo
  const dz = g('bs-logo-dz'), fileInput = g('bs-logo-file');
  dz.onclick = () => fileInput.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) uploadLogo(e.dataTransfer.files[0]); };
  fileInput.onchange = () => { if (fileInput.files[0]) uploadLogo(fileInput.files[0]); };
  async function uploadLogo(f) {
    const fd = new FormData(); fd.append('file', f);
    try {
      const res = await api.upload('/admin/v1/settings/logo', fd);
      const url = res.brand_logo_url + '?t=' + Date.now();
      g('bs-logo-img').src = url;
      g('bs-prev-logo').src = url;
      toast('Đã cập nhật logo — tải lại trang để áp dụng toàn site');
    } catch (e) { toast(e.message, true); }
  }

  g('bs-save').onclick = async () => {
    g('bs-error').textContent = '';
    try {
      await api.patch('/admin/v1/settings/brand', {
        brand_name: g('bs-name').value.trim(),
        brand_short: g('bs-short').value.trim(),
        brand_suffix: g('bs-suffix').value.trim(),
        brand_tagline: g('bs-tagline').value.trim(),
        brand_accent: accent(),
      });
      toast('Đã lưu — tải lại trang (Ctrl+F5) để áp dụng');
    } catch (e) { g('bs-error').textContent = e.message; }
  };
  g('bs-reset').onclick = async () => {
    if (!confirm('Về logo/tên/màu mặc định?')) return;
    try {
      await api.post('/admin/v1/settings/reset');
      toast('Đã về mặc định — tải lại trang');
      sections.settings();
    } catch (e) { toast(e.message, true); }
  };
};

/* boot */
window.addEventListener('auth:change', () => {
  // token hết hạn (api.js tự clear khi gặp 401) → về trang đăng nhập riêng
  if (!auth.loggedIn) gotoLogin();
});
boot();
