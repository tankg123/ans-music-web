/** Module Products (Admin) — port trung thành từ frontend/js/admin.js (sections.products,
 *  showProduct + 4 tab Metadata/Tracks/QC/Releases, uploadTrackFiles + upload-tray).
 *  Nguồn JSON: server/src/routes/products.ts. Nhãn UI tiếng Việt, field API giữ snake_case. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, uploadWithProgress, assetUrl } from '../../api';
import { useAuth } from '../../useAuth';
import { toast, Modal, Badge, SecHead, fmtDur } from '../ui';
import { uploadTray, UploadTray } from '../UploadTray';

// ===========================================================================
// Hằng số + helpers
// ===========================================================================
const RELEASE_TYPES = ['Single', 'EP', 'Album', 'Compilation'];
const ROLE_LABELS: Record<string, string> = {
  MainArtist: 'Main artist', FeaturedArtist: 'Featured artist', Composer: 'Composer',
  Lyricist: 'Lyricist', MusicPublisher: 'Music publisher', Producer: 'Producer',
  Mixer: 'Mixer', Remixer: 'Remixer', Performer: 'Performer',
};
const ALL_ROLES = Object.keys(ROLE_LABELS);
const REQUIRED_ROLES = ['MainArtist', 'Composer', 'Lyricist', 'MusicPublisher', 'Producer', 'Mixer'];

const fmtBytes = (b: number) => (!b ? '—'
  : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');

/** UTC "YYYY-MM-DD HH:MM:SS" ⇄ giá trị datetime-local */
function utcToInput(s?: string | null): string {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function inputToUtc(v?: string | null): string | null {
  if (!v) return null;
  return new Date(v).toISOString().slice(0, 19).replace('T', ' ');
}
function humanDate(s?: string | null): string {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? '' : d.toLocaleString('vi-VN', { dateStyle: 'long', timeStyle: 'short' });
}

const LOGO = '/favicon.svg';

// Preview audio dùng chung (không đụng player toàn cục của web nghe nhạc)
let _preview: HTMLAudioElement | null = null;
async function streamUrl(trackId: string): Promise<string> {
  const { url } = await api.get<{ url: string }>(`/v1/tracks/${trackId}/stream`);
  return url;
}

// Tách detail lỗi QC (backend trả detail = {message, errors})
function parseDetail(e: any): { message: string; errors: string[] } {
  try {
    const d = JSON.parse(e.message);
    if (d && typeof d === 'object') return { message: d.message || e.message, errors: d.errors || [] };
  } catch { /* detail là chuỗi thường */ }
  return { message: e.message, errors: [] };
}

const rowStyle = { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' as const };

// ===========================================================================
// Root: danh sách ↔ chi tiết (state trong component)
// ===========================================================================
export default function Products() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="a-section">
      {openId
        ? <ProductDetail id={openId} onBack={() => setOpenId(null)} />
        : <ProductList onOpen={setOpenId} />}
      <UploadTray />
    </div>
  );
}

// ===========================================================================
// Danh sách products
// ===========================================================================
function ProductList({ onOpen }: { onOpen: (id: string) => void }) {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [items, setItems] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function load(qq: string, st: string) {
    setItems(null);
    setSelected(new Set());
    try {
      const data = await api.get(`/admin/v1/products?q=${encodeURIComponent(qq)}&state=${st}`);
      setItems(data.items);
    } catch (e: any) { toast(e.message, true); setItems([]); }
  }
  useEffect(() => {
    const t = setTimeout(() => load(q, state), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, state]);

  const list = items || [];
  const allSelected = list.length > 0 && list.every(p => selected.has(p.id));
  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(list.map(p => p.id)));
  }

  async function bulk(action: string, label: string) {
    const ids = [...selected];
    if (!ids.length || busy) return;
    if (!confirm(`${label} ${ids.length} product đã chọn?`)) return;
    setBusy(true);
    try {
      const res = await api.post('/admin/v1/products/bulk', { ids, action });
      const failed = (res.results || []).filter((r: any) => !r.ok);
      if (res.done && !res.failed) toast(`✅ ${label}: ${res.done} product`);
      else if (res.done) toast(`${label}: ${res.done} OK · ${res.failed} lỗi — ${failed[0]?.error || ''}`, true);
      else toast(`${label} không thực hiện được: ${failed[0]?.error || 'Lỗi'}`, true);
      await load(q, state);
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  }

  const n = selected.size;

  return (
    <>
      <SecHead title="📦 Products">
        <select value={state} onChange={e => setState(e.target.value)} style={{ width: 170 }}>
          <option value="">Tất cả trạng thái</option>
          <option value="draft">Draft</option>
          <option value="live">Published</option>
          <option value="scheduled">Hẹn giờ</option>
          <option value="pending_review">Chờ duyệt</option>
          <option value="taken_down">Taken down</option>
        </select>
        <input type="search" placeholder="Tìm product…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-orange" onClick={() => setCreating(true)}>＋ Create Product</button>
      </SecHead>

      {n > 0 && (
        <div className="bulk-bar">
          <b>{n}</b> đã chọn
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Bỏ chọn</button>
          <span className="bulk-sep" />
          {canManage && <button className="btn btn-orange btn-sm" disabled={busy} onClick={() => bulk('publish', '🚀 Phát hành')}>🚀 Phát hành</button>}
          {canManage && <button className="btn btn-ok btn-sm" disabled={busy} onClick={() => bulk('approve', '✅ Duyệt & phát hành')}>✅ Duyệt</button>}
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => bulk('submit_review', '📤 Gửi duyệt')}>📤 Gửi duyệt</button>
          {canManage && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => bulk('takedown', '⛔ Takedown')}>⛔ Takedown</button>}
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => bulk('delete', '🗑 Xóa')}>🗑 Xóa</button>
        </div>
      )}

      {items === null ? <p className="empty-note">Đang tải…</p>
        : items.length === 0
          ? <div className="panel empty-note">Chưa có product nào — bấm "＋ Create Product" để bắt đầu</div>
          : (
            <div className="tbl-wrap"><table>
              <thead><tr>
                <th style={{ width: 34 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Chọn tất cả" /></th>
                <th>Product</th><th>Type</th><th>Label</th><th>UPC</th><th>Tracks</th>
                <th>Release date</th>{canManage && <th>Người tạo</th>}<th>State</th>
              </tr></thead>
              <tbody>
                {items.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} className={selected.has(p.id) ? 'row-sel' : ''} onClick={() => onOpen(p.id)}>
                    <td onClick={e => { e.stopPropagation(); toggle(p.id); }}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} onClick={e => e.stopPropagation()} />
                    </td>
                    <td><div className="cell-main">
                      <img className="thumb" src={assetUrl(p.cover_url) || LOGO} alt="" />
                      <div>{p.title}{p.title_version && <span className="sub"> ({p.title_version})</span>}
                        <div className="sub">{p.main_artists || '—'}</div></div>
                    </div></td>
                    <td>{p.release_type}</td>
                    <td>{p.label_display || p.label_name || '—'}</td>
                    <td className="mono">{p.upc || '—'}</td>
                    <td>{p.track_count}</td>
                    <td className="sub">{(p.platform_release_date || '').slice(0, 16) || '—'}</td>
                    {canManage && <td className="sub">{p.creator_email || '—'}</td>}
                    <td><Badge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}

      {creating && <CreateProductModal onClose={() => setCreating(false)} onCreated={id => { setCreating(false); onOpen(id); }} />}
    </>
  );
}

// ===========================================================================
// Modal tạo product
// ===========================================================================
function CreateProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [labels, setLabels] = useState<any[]>([]);
  const [f, setF] = useState({ title: '', title_version: '', release_type: 'Single', label_id: '', is_migrated: false });
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/admin/v1/products/labels').then(d => setLabels(d.items)).catch(() => {}); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.label_id) { setErr('Chọn label'); return; }
    try {
      const res = await api.post('/admin/v1/products', {
        title: f.title, title_version: f.title_version || null,
        release_type: f.release_type, label_id: f.label_id, is_migrated: f.is_migrated,
      });
      toast('Đã tạo product (Draft)');
      onCreated(res.id);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <Modal title="Create Product" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="panel">
          <h3>Product Info</h3>
          <div className="field"><label>Title *</label>
            <input required placeholder="Product title" value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} /></div>
          <div className="grid2">
            <div className="field"><label>Title Version</label>
              <input placeholder="e.g. Deluxe Edition, Remastered" value={f.title_version}
                onChange={e => setF(s => ({ ...s, title_version: e.target.value }))} /></div>
            <div className="field"><label>Release Type *</label>
              <select value={f.release_type} onChange={e => setF(s => ({ ...s, release_type: e.target.value }))}>
                {RELEASE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select></div>
          </div>
        </div>
        <div className="panel">
          <h3>Label &amp; Type</h3>
          <div className="field"><label>Label *</label>
            <select required value={f.label_id} onChange={e => setF(s => ({ ...s, label_id: e.target.value }))}>
              <option value="">Select label</option>
              {labels.map(l => <option key={l.id} value={l.id}>{l.name}{l.isrc_prefix ? ` (${l.isrc_prefix})` : ''}</option>)}
            </select></div>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto', marginTop: 2 }} checked={f.is_migrated}
              onChange={e => setF(s => ({ ...s, is_migrated: e.target.checked }))} />
            <span><b>Migrated network</b><br />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>Chuyển product từ hệ thống khác — bắt buộc nhập ISRC thủ công cho từng track (không auto-generate).</span></span>
          </label>
        </div>
        {err && <div className="form-error">{err}</div>}
        <div style={rowStyle}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-orange">Create</button>
        </div>
      </form>
    </Modal>
  );
}

// ===========================================================================
// Chi tiết product — header + 4 tab
// ===========================================================================
function ProductDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [p, setP] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('metadata');
  const [detailTrackId, setDetailTrackId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const [nonce, setNonce] = useState(0);

  async function load() {
    try { setP(await api.get(`/admin/v1/products/${id}`)); }
    catch (e: any) { setErr(e.message || 'Lỗi kết nối'); }
  }
  useEffect(() => { load(); }, [id, nonce]);
  const reload = () => setNonce(n => n + 1);

  function goTab(t: string, trackId?: string) { setTab(t); setDetailTrackId(trackId || null); }

  if (err) {
    return (
      <>
        <SecHead title="⚠ Không mở được product" />
        <p className="empty-note">{err} — <a href="#" onClick={e => { e.preventDefault(); onBack(); }}>quay lại danh sách</a></p>
      </>
    );
  }
  if (!p) return <p className="empty-note">Đang tải product…</p>;

  const mainArtists = (p.contributors?.MainArtist || []).map((a: any) => a.name).join(', ') || '—';

  async function uploadCover(file: File) {
    const fd = new FormData(); fd.append('file', file);
    try { await api.upload(`/admin/v1/products/${id}/cover`, fd); toast('Đã cập nhật ảnh bìa'); reload(); }
    catch (e: any) { toast(e.message, true); }
  }
  async function submitReview() {
    try {
      const res = await api.post(`/admin/v1/products/${id}/submit-review`);
      toast(res.warnings ? `📤 Đã gửi duyệt (QC có ${res.warnings} cảnh báo)` : '📤 Đã gửi duyệt — chờ manager phê duyệt');
      reload();
    } catch (e: any) {
      const d = parseDetail(e);
      if (d.errors.length) toast(`${d.message} — mở tab QC Check để xem chi tiết`, true);
      else toast(d.message || e.message, true);
      if (d.errors.length) goTab('qc');
    }
  }
  async function approve() {
    if (!confirm(`Duyệt & phát hành "${p.title}"?`)) return;
    try {
      const res = await api.post(`/admin/v1/products/${id}/approve`);
      toast(res.status === 'scheduled' ? '✅ Đã duyệt — hẹn giờ phát hành ⏰' : '✅ Đã duyệt — product ĐÃ PHÁT HÀNH');
      reload();
    } catch (e: any) { toast(e.message, true); }
  }
  async function del() {
    if (!confirm(`Xóa product "${p.title}"? (chỉ Draft/Taken down)`)) return;
    try { await api.del(`/admin/v1/products/${id}`); toast('Đã xóa product'); onBack(); }
    catch (e: any) { toast(e.message, true); }
  }

  const qcChip = p.qc_errors
    ? <button className="btn btn-danger btn-sm" onClick={() => goTab('qc')}>⛔ {p.qc_errors} lỗi QC</button>
    : p.qc_warnings
      ? <button className="btn btn-ghost btn-sm" onClick={() => goTab('qc')}>⚠ {p.qc_warnings} cảnh báo</button> : null;

  const tabs = [
    { key: 'metadata', label: '📄 Metadata' },
    { key: 'tracks', label: '🎵 Tracks' },
    { key: 'qc', label: '✅ QC Check' },
    { key: 'releases', label: '🚀 Releases' },
  ];
  const activeTab = tab === 'trackdetail' ? 'tracks' : tab;

  return (
    <>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 10 }}>
        <a href="#" style={{ color: 'var(--accent)' }} onClick={e => { e.preventDefault(); onBack(); }}>Products</a> › {p.title}
      </p>

      <div className="panel" style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 92, height: 92, flexShrink: 0 }}>
          <img src={assetUrl(p.cover_url) || LOGO} alt="" style={{ width: 92, height: 92, borderRadius: 10, objectFit: 'cover' }} />
          <button className="btn btn-ghost btn-sm" style={{ position: 'absolute', bottom: 4, left: 4 }}
            onClick={() => coverInput.current?.click()}>Manage</button>
          <input ref={coverInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadCover(f); e.target.value = ''; }} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 800, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {p.title}{p.title_version && <span className="sub">({p.title_version})</span>}
            <span className="mono">#{String(p.id).slice(0, 6)}</span> <Badge status={p.status} />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
            <span>👤 <b style={{ color: 'var(--text)' }}>{mainArtists}</b></span>
            <span>💿 {p.release_type}</span>
            <span>📅 {humanDate(p.platform_release_date) || 'Chưa đặt ngày'}</span>
            <span># {p.upc || 'UPC: auto khi publish'}</span>
            <span>🎵 {p.genre || '—'}</span>
            <span>{p.track_count} tracks</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {qcChip}
          {!canManage && p.status === 'draft' && <button className="btn btn-orange btn-sm" onClick={submitReview}>📤 Gửi duyệt</button>}
          {canManage && p.status === 'pending_review' && <>
            <button className="btn btn-ok btn-sm" onClick={approve}>✅ Duyệt &amp; phát hành</button>
            <button className="btn btn-danger btn-sm" onClick={() => setRejecting(true)}>❌ Từ chối</button>
          </>}
          <button className="btn btn-ghost btn-sm" title="Xóa (chỉ Draft)" onClick={del}>🗑</button>
        </div>
      </div>

      {p.status === 'pending_review' && (
        <div className="sftp-warn" style={{ marginBottom: 14 }}>🕓 <b>Chờ duyệt</b> — Đã gửi duyệt{p.submitted_at ? ` ${humanDate(p.submitted_at) || p.submitted_at}` : ''}{canManage ? '. Kiểm tra nội dung rồi Duyệt hoặc Từ chối ở góc phải.' : ', manager sẽ kiểm tra và phát hành.'}</div>
      )}
      {p.review_note && p.status === 'draft' && (
        <div className="sftp-warn" style={{ marginBottom: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          ⚠ <b>Bị từ chối:</b> {p.review_note}
          <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>Sửa nội dung theo ghi chú rồi bấm “📤 Gửi duyệt” lại.</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => goTab(t.key)} style={{
            padding: '10px 16px', border: 'none', background: 'none', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
            color: activeTab === t.key ? 'var(--text)' : 'var(--muted)',
            borderBottom: activeTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'metadata' && <MetadataTab p={p} reload={reload} />}
      {tab === 'tracks' && <TracksTab p={p} reload={reload} onEdit={tid => goTab('trackdetail', tid)} />}
      {tab === 'trackdetail' && <TrackDetail p={p} trackId={detailTrackId!} reload={reload} goTab={goTab} />}
      {tab === 'qc' && <QcTab p={p} goTab={goTab} />}
      {tab === 'releases' && <ReleasesTab p={p} canManage={canManage} reload={reload} onReject={() => setRejecting(true)} onSubmit={submitReview} />}

      {rejecting && <RejectModal p={p} onClose={() => setRejecting(false)} onDone={() => { setRejecting(false); reload(); }} />}
    </>
  );
}

// ===========================================================================
// Tab Metadata
// ===========================================================================
function GenreSelect({ value, genres, setGenres, onChange, allowEmpty }:
{ value: string; genres: any[]; setGenres: (g: any[]) => void; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const names = genres.map(g => g.name);
  async function handle(v: string) {
    if (v === '__new__') {
      const name = (prompt('Tên thể loại mới:') || '').trim();
      if (!name) return;
      try {
        const res = await api.post('/admin/v1/products/genres', { name });
        if (!names.includes(res.name)) setGenres([...genres, { id: res.id, name: res.name }]);
        onChange(res.name);
        toast(res.existed ? 'Thể loại đã có' : 'Đã thêm thể loại');
      } catch (e: any) { toast(e.message, true); }
    } else onChange(v);
  }
  const showCurrentExtra = value && !names.includes(value);
  return (
    <select value={value} onChange={e => handle(e.target.value)}>
      {(allowEmpty || !value) && <option value="">— Chọn thể loại —</option>}
      {showCurrentExtra && <option value={value}>{value}</option>}
      {genres.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
      <option value="__new__">➕ Thêm thể loại mới…</option>
    </select>
  );
}

function MetadataTab({ p, reload }: { p: any; reload: () => void }) {
  const [labels, setLabels] = useState<any[]>([]);
  const [genres, setGenres] = useState<any[]>([]);
  const origInit = p.original_release_date && String(p.original_release_date).length === 10
    ? p.original_release_date + ' 00:00:00' : p.original_release_date;
  const [f, setF] = useState({
    title: p.title || '', title_version: p.title_version || '',
    label_id: p.label_id || '', release_type: p.release_type || 'Single',
    genre: p.genre || 'Pop', subgenre: p.subgenre || '',
    metadata_language: p.metadata_language || 'vi', audio_language: p.audio_language || 'vi',
    parental_warning: p.parental_warning || 'NotExplicit',
    reldate: utcToInput(p.platform_release_date), origdate: utcToInput(origInit), predate: utcToInput(p.preorder_date),
    c_line: p.c_line || '', c_line_year: p.c_line_year || '',
    p_line: p.p_line || '', p_line_year: p.p_line_year || '', right_holder: p.right_holder || '',
    upc: p.upc || '', catalog_number: p.catalog_number || '',
    release_price_tier: p.release_price_tier || '', track_price_tier: p.track_price_tier || '',
    mastered_by: p.mastered_by || '',
    is_compilation: !!p.is_compilation, is_migrated: !!p.is_migrated,
  });
  const upd = (k: string, v: any) => setF(s => ({ ...s, [k]: v }));
  useEffect(() => {
    Promise.all([api.get('/admin/v1/products/labels'), api.get('/admin/v1/products/genres')])
      .then(([l, g]) => { setLabels(l.items); setGenres(g.items); }).catch(() => {});
  }, []);

  function onLabelChange(v: string) {
    const lb = labels.find(l => l.id === v);
    setF(s => {
      const n = { ...s, label_id: v };
      if (lb) {
        if (lb.c_line && !s.c_line.trim()) n.c_line = lb.c_line;
        if (lb.p_line && !s.p_line.trim()) n.p_line = lb.p_line;
        if (lb.right_holder && !s.right_holder.trim()) n.right_holder = lb.right_holder;
      }
      return n;
    });
  }

  async function save() {
    try {
      await api.patch(`/admin/v1/products/${p.id}`, {
        title: f.title.trim(), title_version: f.title_version.trim() || null,
        label_id: f.label_id, release_type: f.release_type,
        genre: f.genre || null, subgenre: f.subgenre || null,
        metadata_language: f.metadata_language, audio_language: f.audio_language,
        parental_warning: f.parental_warning,
        platform_release_date: inputToUtc(f.reldate), original_release_date: inputToUtc(f.origdate),
        preorder_date: inputToUtc(f.predate),
        c_line: f.c_line.trim() || null, c_line_year: f.c_line_year ? Number(f.c_line_year) : null,
        p_line: f.p_line.trim() || null, p_line_year: f.p_line_year ? Number(f.p_line_year) : null,
        right_holder: f.right_holder.trim() || null,
        upc: f.upc.trim() || null, catalog_number: f.catalog_number.trim() || null,
        release_price_tier: f.release_price_tier.trim() || null, track_price_tier: f.track_price_tier.trim() || null,
        mastered_by: f.mastered_by.trim() || null,
        is_compilation: f.is_compilation, is_migrated: f.is_migrated,
      });
      toast('Đã lưu metadata');
      reload();
    } catch (e: any) { toast(e.message, true); }
  }

  return (
    <>
      <div className="two-col">
        <div className="panel">
          <h3>Release Information</h3>
          <div className="field"><label>Title *</label><input value={f.title} onChange={e => upd('title', e.target.value)} /></div>
          <div className="field"><label>Title Version</label>
            <input value={f.title_version} placeholder="e.g. Deluxe Edition, Remix" onChange={e => upd('title_version', e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Label *</label>
              <select value={f.label_id} onChange={e => onLabelChange(e.target.value)}>
                {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></div>
            <div className="field"><label>Release Type *</label>
              <select value={f.release_type} onChange={e => upd('release_type', e.target.value)}>
                {RELEASE_TYPES.map(x => (
                  <option key={x} value={x} disabled={x === 'Single' && p.track_count > 1}>
                    {x}{x === 'Single' && p.track_count > 1 ? ' (cần ≤1 track)' : ''}</option>
                ))}
              </select></div>
          </div>
          <div className="grid2">
            <div className="field"><label>Primary Genre *</label>
              <GenreSelect value={f.genre} genres={genres} setGenres={setGenres} onChange={v => upd('genre', v)} /></div>
            <div className="field"><label>Secondary Genre</label>
              <GenreSelect value={f.subgenre} genres={genres} setGenres={setGenres} onChange={v => upd('subgenre', v)} allowEmpty /></div>
          </div>
        </div>

        <div className="panel">
          <h3>Languages &amp; Content Advisory</h3>
          <div className="grid2">
            <div className="field"><label>Metadata Language *</label>
              <select value={f.metadata_language} onChange={e => upd('metadata_language', e.target.value)}>
                {['vi', 'en', 'ko', 'ja'].map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select></div>
            <div className="field"><label>Audio Language *</label>
              <select value={f.audio_language} onChange={e => upd('audio_language', e.target.value)}>
                {['vi', 'en', 'ko', 'ja'].map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select></div>
          </div>
          <div className="field"><label>Parental Advisory *</label>
            <AdvisoryRadios name="p-adv" value={f.parental_warning} onChange={v => upd('parental_warning', v)} /></div>
        </div>

        <div className="panel">
          <h3>Release Dates</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '-6px 0 12px' }}>🕐 Global Timed Release (UTC)</p>
          <div className="field"><label>Release Date *</label>
            <input type="datetime-local" value={f.reldate} onChange={e => upd('reldate', e.target.value)} />
            <div className="sub" style={{ marginTop: 4 }}>{f.reldate ? new Date(f.reldate).toLocaleString('vi-VN', { dateStyle: 'long', timeStyle: 'short' }) : ''}</div></div>
          <div className="field"><label>Original Release Date *</label>
            <input type="datetime-local" value={f.origdate} onChange={e => upd('origdate', e.target.value)} /></div>
          <div className="field"><label>Pre-order Date</label>
            <input type="datetime-local" value={f.predate} onChange={e => upd('predate', e.target.value)} />
            <div className="sub" style={{ marginTop: 4 }}>Mặc định = lúc tạo · không được sau Release Date</div></div>
        </div>

        <div className="panel">
          <h3>Copyrights</h3>
          <div className="grid2">
            <div className="field"><label>C-Line Text (©) *</label><input value={f.c_line} onChange={e => upd('c_line', e.target.value)} /></div>
            <div className="field"><label>C-Line Year *</label><input type="number" min={1900} max={2100} value={f.c_line_year} onChange={e => upd('c_line_year', e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>P-Line Text (℗) *</label><input value={f.p_line} onChange={e => upd('p_line', e.target.value)} /></div>
            <div className="field"><label>P-Line Year *</label><input type="number" min={1900} max={2100} value={f.p_line_year} onChange={e => upd('p_line_year', e.target.value)} /></div>
          </div>
          <div className="field"><label>Right Holder *</label><input value={f.right_holder} onChange={e => upd('right_holder', e.target.value)} /></div>
        </div>

        <div className="panel">
          <h3>Product Details</h3>
          <div className="grid2">
            <div className="field"><label>UPC Code</label><input value={f.upc} placeholder="Auto-generate khi publish" onChange={e => upd('upc', e.target.value)} /></div>
            <div className="field"><label>Catalog Number</label><input value={f.catalog_number} onChange={e => upd('catalog_number', e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>Release Price Tier</label><input value={f.release_price_tier} placeholder="Digital45" onChange={e => upd('release_price_tier', e.target.value)} /></div>
            <div className="field"><label>Track Price Tier</label><input value={f.track_price_tier} placeholder="Front" onChange={e => upd('track_price_tier', e.target.value)} /></div>
          </div>
          <div className="field"><label>Mastered By</label><input value={f.mastered_by} onChange={e => upd('mastered_by', e.target.value)} /></div>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.is_compilation} onChange={e => upd('is_compilation', e.target.checked)} />
            <span><b>Compilation (Multiartist)</b> — album tổng hợp nhiều nghệ sĩ</span></label>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.is_migrated} onChange={e => upd('is_migrated', e.target.checked)} />
            <span><b>Migrated network</b> — nhập ISRC thủ công từng track</span></label>
        </div>

        <div className="panel" style={{ gridColumn: '1/-1' }}>
          <h3>Contributors <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 12 }}>— vai trò trên toàn bộ release</span></h3>
          <RoleGroups contributors={p.contributors || {}}
            onSave={payload => api.put(`/admin/v1/products/${p.id}/contributors`, { contributors: payload })
              .then(() => toast('Đã lưu contributors')).catch(e => toast(e.message, true))} />
        </div>
      </div>

      <div style={rowStyle}>
        <button className="btn btn-ghost" onClick={reload}>Cancel</button>
        <button className="btn btn-orange" onClick={save}>Save</button>
      </div>
    </>
  );
}

function AdvisoryRadios({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  const opts = [
    { v: 'NotExplicit', t: 'None', s: 'No explicit content' },
    { v: 'Explicit', t: 'Explicit', s: 'Contains explicit content' },
    { v: 'Edited', t: 'Edited', s: 'Explicit content edited' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {opts.map(o => (
        <label key={o.v} style={{
          flex: '1 1 140px', display: 'block', padding: '9px 12px', borderRadius: 9, cursor: 'pointer',
          border: '1px solid ' + (value === o.v ? 'var(--accent)' : 'var(--border)'),
          background: value === o.v ? 'var(--accent-soft)' : 'var(--bg-elev2)',
        }}>
          <input type="radio" name={name} value={o.v} checked={value === o.v} onChange={() => onChange(o.v)} style={{ width: 'auto', marginRight: 6 }} />
          <b style={{ fontSize: 13 }}>{o.t}</b>
          <div className="sub">{o.s}</div>
        </label>
      ))}
    </div>
  );
}

// ===========================================================================
// Contributors — role groups (dùng chung product & track), tự lưu khi đổi
// ===========================================================================
function RoleGroups({ contributors, onSave, readonly }:
{ contributors: Record<string, any[]>; onSave?: (payload: Record<string, string[]>) => void; readonly?: boolean }) {
  const [state, setState] = useState<Record<string, any[]>>(() => {
    const s: Record<string, any[]> = {};
    ALL_ROLES.forEach(r => { s[r] = [...(contributors[r] || [])]; });
    return s;
  });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<string | null>(null);

  function commit(next: Record<string, any[]>) {
    setState(next);
    if (onSave) { const payload: Record<string, string[]> = {}; ALL_ROLES.forEach(r => { payload[r] = next[r].map(a => a.artist_id); }); onSave(payload); }
  }
  function toggleOpen(role: string) { setOpen(s => { const n = new Set(s); n.has(role) ? n.delete(role) : n.add(role); return n; }); }
  function addTo(role: string, artist: any) {
    if (state[role].some(x => x.artist_id === artist.id)) { toast('Nghệ sĩ đã có trong role này', true); return; }
    commit({ ...state, [role]: [...state[role], { artist_id: artist.id, name: artist.name, image_url: artist.image_url }] });
    setOpen(s => new Set(s).add(role));
  }
  function move(role: string, i: number, d: number) {
    const j = i + d; if (j < 0 || j >= state[role].length) return;
    const arr = [...state[role]]; [arr[i], arr[j]] = [arr[j], arr[i]];
    commit({ ...state, [role]: arr });
  }
  function rm(role: string, i: number) { const arr = [...state[role]]; arr.splice(i, 1); commit({ ...state, [role]: arr }); }

  if (readonly) {
    const rows = ALL_ROLES.filter(r => (contributors[r] || []).length);
    if (!rows.length) return <div className="empty-note">Chưa có contributors — thêm ở tab Metadata của product</div>;
    return (
      <div>
        {rows.map(role => (
          <div key={role} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: 10, marginBottom: 8, opacity: .9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              {ROLE_LABELS[role]} <span className="badge">{contributors[role].length}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>🔒 khóa</span></div>
            {contributors[role].map((a: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <img src={assetUrl(a.image_url) || LOGO} alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
                <span>{a.name}</span></div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {ALL_ROLES.map(role => {
        const req = REQUIRED_ROLES.includes(role);
        const list = state[role];
        const isOpen = open.has(role);
        return (
          <div key={role} style={{ border: '1px solid var(--border)', borderRadius: 9, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer' }}
              onClick={() => toggleOpen(role)}>
              <b>{ROLE_LABELS[role]}{req && <span style={{ color: 'var(--danger)' }}> *</span>}</b>
              <span className="badge" style={{ background: list.length ? undefined : 'var(--bg-hover)', color: list.length ? undefined : 'var(--danger)' }}>{list.length}</span>
              <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setPicking(role); }}>＋ Add</button>
              <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{isOpen ? '▴' : '▾'}</span>
            </div>
            {isOpen && (
              <div style={{ padding: '0 12px 10px' }}>
                {list.length === 0 ? <div className="empty-note" style={{ padding: 8 }}>Chưa có nghệ sĩ</div>
                  : list.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                      <img src={assetUrl(a.image_url) || LOGO} alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
                      <span style={{ flex: 1 }}>{a.name}</span>
                      <button className="btn btn-ghost btn-sm" title="Lên" onClick={() => move(role, i, -1)}>▲</button>
                      <button className="btn btn-ghost btn-sm" title="Xuống" onClick={() => move(role, i, 1)}>▼</button>
                      <button className="btn btn-ghost btn-sm" title="Remove" onClick={() => rm(role, i)}>✕</button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })}
      {picking && <ArtistPicker onClose={() => setPicking(null)} onPick={a => { addTo(picking, a); setPicking(null); }} />}
    </div>
  );
}

function ArtistPicker({ onClose, onPick }: { onClose: () => void; onPick: (a: any) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/admin/v1/products/artist-options?q=${encodeURIComponent(q)}`).then(d => setItems(d.items)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  async function createNew() {
    const name = q.trim() || prompt('Tên nghệ sĩ mới:') || '';
    if (!name.trim()) return;
    try {
      const res = await api.post('/admin/v1/products/artist-options', { name: name.trim(), type: 'person' });
      onPick({ id: res.id, name: res.name || name, image_url: null });
      toast(res.existed ? 'Nghệ sĩ đã có sẵn — dùng lại' : 'Đã tạo nghệ sĩ mới');
    } catch (e: any) { toast(e.message, true); }
  }
  return (
    <Modal title="Thêm contributor" onClose={onClose}>
      <div className="field"><input autoFocus placeholder="Tìm nghệ sĩ…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {items.length === 0 ? <div className="empty-note">Không tìm thấy</div>
          : items.slice(0, 30).map(a => (
            <button key={a.id} onClick={() => onPick(a)} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
              padding: 7, border: 'none', background: 'none', cursor: 'pointer',
            }}>
              <img src={assetUrl(a.image_url) || LOGO} alt="" style={{ width: 28, height: 28, borderRadius: 6 }} />
              <span>{a.name}</span>
            </button>
          ))}
      </div>
      <div style={rowStyle}>
        <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
        <button className="btn btn-orange" onClick={createNew}>＋ Tạo nghệ sĩ mới</button>
      </div>
    </Modal>
  );
}

// ===========================================================================
// Tab Tracks
// ===========================================================================
function TracksTab({ p, reload, onEdit }: { p: any; reload: () => void; onEdit: (tid: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [manual, setManual] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadTracks() {
    try { const d = await api.get(`/admin/v1/products/${p.id}/tracks`); setItems(d.items); }
    catch (e: any) { toast(e.message, true); setItems([]); }
  }
  useEffect(() => { loadTracks(); }, [p.id]);

  async function uploadFiles(files: File[]) {
    for (const file of files) {
      const uid = uploadTray.add(file.name);
      try {
        const tr = await api.post(`/admin/v1/products/${p.id}/tracks`, { title: file.name.replace(/\.[^.]+$/, '') });
        const fd = new FormData(); fd.append('file', file);
        await uploadWithProgress(`/admin/v1/products/${p.id}/tracks/${tr.id}/audio`, fd, e => uploadTray.progress(uid, e.percent));
        uploadTray.done(uid, true);
      } catch (err: any) { uploadTray.done(uid, false, err.message); toast(`${file.name}: ${err.message}`, true); }
    }
    loadTracks(); reload();
  }
  function pickFiles(files: File[]) {
    if (p.is_migrated) { toast('Migrated network: thêm track thủ công để nhập ISRC', true); return; }
    if (files.length) uploadFiles(files);
  }
  async function togglePlay(t: any) {
    try {
      if (!_preview) _preview = new Audio();
      if (playingId === t.id && !_preview.paused) { _preview.pause(); setPlayingId(null); return; }
      _preview.src = await streamUrl(t.id);
      _preview.play();
      setPlayingId(t.id);
      _preview.onended = () => setPlayingId(null);
    } catch (e: any) { toast(e.message, true); }
  }
  async function removeTrack(t: any) {
    if (!confirm(`Gỡ track "${t.title}" khỏi product?`)) return;
    try { await api.del(`/admin/v1/products/${p.id}/tracks/${t.id}`); toast('Đã gỡ track'); loadTracks(); reload(); }
    catch (e: any) { toast(e.message, true); }
  }
  async function moveTrack(t: any, d: number) {
    if (!items) return;
    const ids = items.map(x => x.id);
    const i = ids.indexOf(t.id); const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api.put(`/admin/v1/products/${p.id}/tracks/reorder`, { track_ids: ids }); loadTracks(); }
    catch (e: any) { toast(e.message, true); }
  }

  const shown = (items || []).filter(t => !q || String(t.title).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search…" style={{ width: 240 }} value={q} onChange={e => setQ(e.target.value)} />
        <div className="tools">
          <button className="btn btn-ghost" onClick={() => { loadTracks(); reload(); }}>🔄</button>
          <button className="btn btn-orange" onClick={() => (p.is_migrated ? toast('Migrated network: thêm track thủ công để nhập ISRC', true) : fileInput.current?.click())}>⬆ Chọn file nhạc</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setManual(true)}>Nhập thủ công</button>
          <input ref={fileInput} type="file" accept=".wav,.flac,.mp3,.m4a,.ogg,.opus" multiple hidden
            onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; pickFiles(files); }} />
        </div>
      </div>

      <div className={'dropzone' + (over ? ' over' : '')} style={{ padding: 16, marginBottom: 12 }}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); pickFiles([...e.dataTransfer.files]); }}>
        Kéo thả file audio vào đây — mỗi file tự tạo 1 track (WAV khuyến nghị, tự chuẩn hóa 44.1kHz)
      </div>

      {items === null ? <p className="empty-note">Đang tải…</p> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>#</th><th>Title</th><th>ISRC</th><th>Type</th><th>Duration</th><th>Size</th><th>State</th><th></th></tr></thead>
          <tbody>
            {shown.length === 0 ? <tr><td colSpan={8} className="empty-note">Chưa có track — bấm Chọn file nhạc hoặc kéo thả file</td></tr>
              : shown.map(t => (
                <tr key={t.id}>
                  <td>{t.track_no}</td>
                  <td><b>{t.title}</b>{t.subtitle && <span className="sub"> ({t.subtitle})</span>}
                    <div className="sub">{(t.artists || []).map((a: any) => a.name).join(', ') || '—'}</div></td>
                  <td className="mono">{t.isrc || '—'}</td>
                  <td>{t.file_format ? <span className="badge live">{t.file_format}</span> : '—'}</td>
                  <td>{fmtDur(t.duration_ms)}</td>
                  <td>{fmtBytes(t.file_size)}</td>
                  <td>{t.upload_state === 'uploaded' ? <span className="badge live">Uploaded</span> : <span className="badge pending_review">Missing file</span>}</td>
                  <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" title="Lên" onClick={() => moveTrack(t, -1)}>▲</button>
                    <button className="btn btn-ghost btn-sm" title="Xuống" onClick={() => moveTrack(t, 1)}>▼</button>
                    {t.upload_state === 'uploaded' && <button className="btn btn-ghost btn-sm" onClick={() => togglePlay(t)}>{playingId === t.id ? '⏸' : '▶'}</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => onEdit(t.id)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => removeTrack(t)}>✕</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table></div>
      )}

      {manual && <AddTrackModal p={p} onClose={() => setManual(false)} onDone={() => { setManual(false); loadTracks(); reload(); }} />}
    </>
  );
}

function AddTrackModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [isrc, setIsrc] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await api.post(`/admin/v1/products/${p.id}/tracks`, { title, isrc: isrc || null }); toast('Đã thêm track — upload audio để hoàn tất'); onDone(); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <Modal title="Add Track" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>Title *</label><input required value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="field"><label>ISRC {p.is_migrated ? <span style={{ color: 'var(--danger)' }}>* (Migrated network — bắt buộc)</span> : <span className="sub">(trống → tự cấp từ kho/prefix label)</span>}</label>
          <input placeholder="VNA0D2600123" style={{ textTransform: 'uppercase' }} required={!!p.is_migrated} value={isrc} onChange={e => setIsrc(e.target.value)} /></div>
        {err && <div className="form-error">{err}</div>}
        <div style={rowStyle}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-orange">Add</button>
        </div>
      </form>
    </Modal>
  );
}

// ===========================================================================
// Track detail (trong tab Tracks)
// ===========================================================================
function TrackDetail({ p, trackId, reload, goTab }:
{ p: any; trackId: string; reload: () => void; goTab: (t: string, tid?: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [lyr, setLyr] = useState<{ lyrics: string; lrc: string }>({ lyrics: '', lrc: '' });
  const [f, setF] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const audioInput = useRef<HTMLInputElement>(null);

  async function loadAll() {
    const d = await api.get(`/admin/v1/products/${p.id}/tracks`);
    setItems(d.items);
    const tr = d.items.find((x: any) => x.id === trackId) || d.items[0];
    if (!tr) { goTab('tracks'); return; }
    const ly = await api.get(`/v1/tracks/${tr.id}/lyrics`).catch(() => ({ lyrics: '', lrc: '' }));
    setLyr({ lyrics: ly.lyrics || '', lrc: ly.lrc || '' });
    setF({
      id: tr.id, track_no: tr.track_no, isrc: tr.isrc || '', title: tr.title || '', subtitle: tr.subtitle || '',
      secondary_isrc: tr.secondary_isrc || '', genre: tr.genre || '', secondary_genre: tr.secondary_genre || '',
      clip_start_seconds: tr.clip_start_seconds ?? 30, language: tr.language || 'vi',
      parental_warning: tr.parental_warning || 'NotExplicit',
      c_line: tr.c_line || '', c_line_year: tr.c_line_year || '', p_line: tr.p_line || '', p_line_year: tr.p_line_year || '',
      right_holder: tr.right_holder || '', instant_grat_stream_date: tr.instant_grat_stream_date || '',
      instant_grat_download_date: tr.instant_grat_download_date || '',
      lyrics: ly.lyrics || '', lyrics_lrc: ly.lrc || '',
      upload_state: tr.upload_state, file_format: tr.file_format, file_size: tr.file_size, has_master: tr.has_master,
      contributors: tr.contributors || {},
    });
  }
  useEffect(() => { setF(null); loadAll(); }, [p.id, trackId]);

  if (!f || !items) return <p className="empty-note">Đang tải track…</p>;
  const upd = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const idx = Math.max(0, items.findIndex(x => x.id === f.id));
  const igEnabled = p.preorder_date && p.platform_release_date
    && p.platform_release_date > new Date().toISOString().slice(0, 19).replace('T', ' ');

  async function uploadAudio(file: File) {
    setUploading(true);
    const uid = uploadTray.add(file.name);
    const fd = new FormData(); fd.append('file', file);
    try {
      await uploadWithProgress(`/admin/v1/products/${p.id}/tracks/${f.id}/audio`, fd, e => uploadTray.progress(uid, e.percent));
      uploadTray.done(uid, true); toast('Đã upload audio'); loadAll(); reload();
    } catch (e: any) { uploadTray.done(uid, false, e.message); toast(e.message, true); }
    finally { setUploading(false); }
  }
  async function play() {
    try { if (!_preview) _preview = new Audio(); _preview.src = await streamUrl(f.id); _preview.play(); }
    catch (e: any) { toast(e.message, true); }
  }
  async function update() {
    try {
      await api.patch(`/admin/v1/products/tracks/${f.id}`, {
        title: f.title.trim(), subtitle: f.subtitle.trim() || null,
        isrc: f.isrc.trim() || null, secondary_isrc: f.secondary_isrc.trim() || null,
        genre: f.genre.trim() || null, secondary_genre: f.secondary_genre.trim() || null,
        language: f.language, parental_warning: f.parental_warning,
        clip_start_seconds: Number(f.clip_start_seconds || 30),
        c_line: f.c_line.trim() || null, c_line_year: f.c_line_year ? Number(f.c_line_year) : null,
        p_line: f.p_line.trim() || null, p_line_year: f.p_line_year ? Number(f.p_line_year) : null,
        right_holder: f.right_holder.trim() || null,
        instant_grat_stream_date: f.instant_grat_stream_date || null,
        instant_grat_download_date: f.instant_grat_download_date || null,
        lyrics: f.lyrics.trim() || null, lyrics_lrc: f.lyrics_lrc.trim() || null,
      });
      toast('Đã cập nhật track'); loadAll();
    } catch (e: any) { toast(e.message, true); }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 16 }}>
      <div className="panel" style={{ padding: 8, alignSelf: 'start' }}>
        <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase' }}>Tracklist</div>
        {items.map(x => (
          <div key={x.id} onClick={() => goTab('trackdetail', x.id)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
            background: x.id === f.id ? 'var(--accent-soft)' : 'transparent',
          }}>
            <span className="sub">{x.track_no}</span><span style={{ flex: 1 }}>{x.title}</span>
            {x.upload_state !== 'uploaded' && <span title="Thiếu file">⚠</span>}
          </div>
        ))}
      </div>

      <div>
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" disabled={idx === 0} onClick={() => goTab('trackdetail', items[idx - 1].id)}>←</button>
          <button className="btn btn-ghost btn-sm" disabled={idx === items.length - 1} onClick={() => goTab('trackdetail', items[idx + 1].id)}>→</button>
          <b style={{ fontSize: 15 }}>#{f.track_no} · {f.title}</b>
          <span className="mono">{f.isrc}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}/{items.length}</span>
          {f.upload_state === 'uploaded' && <button className="btn btn-ghost btn-sm" onClick={play}>▶ Play</button>}
        </div>

        <div className="two-col">
          <div className="panel">
            <h3>Track Info</h3>
            <div className="field"><label>Title *</label><input value={f.title} onChange={e => upd('title', e.target.value)} /></div>
            <div className="field"><label>Title Version</label><input value={f.subtitle} placeholder="e.g. Radio Edit" onChange={e => upd('subtitle', e.target.value)} /></div>
            <div className="grid2">
              <div className="field"><label>ISRC Code</label><input value={f.isrc} style={{ textTransform: 'uppercase' }} onChange={e => upd('isrc', e.target.value)} /></div>
              <div className="field"><label>Secondary ISRC</label><input value={f.secondary_isrc} placeholder="Optional" onChange={e => upd('secondary_isrc', e.target.value)} /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>Primary Genre</label><input value={f.genre} onChange={e => upd('genre', e.target.value)} /></div>
              <div className="field"><label>Secondary Genre</label><input value={f.secondary_genre} onChange={e => upd('secondary_genre', e.target.value)} /></div>
            </div>
            <div className="field"><label>Clip Start Time (seconds)</label><input type="number" min={0} value={f.clip_start_seconds} onChange={e => upd('clip_start_seconds', e.target.value)} /></div>
          </div>

          <div className="panel">
            <h3>Languages &amp; Content Advisory</h3>
            <div className="field"><label>Audio Language</label>
              <select value={f.language} onChange={e => upd('language', e.target.value)}>
                {['vi', 'en', 'ko', 'ja'].map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select></div>
            <div className="field"><label>Parental Advisory</label>
              <AdvisoryRadios name="t-adv" value={f.parental_warning} onChange={v => upd('parental_warning', v)} /></div>
            <h3 style={{ marginTop: 16 }}>Instant Gratification</h3>
            {!igEnabled && <p className="sub" style={{ color: 'var(--warn)', margin: '-4px 0 10px' }}>⚠ Cần pre-order date + release date tương lai trong metadata product.</p>}
            <div className="grid2">
              <div className="field"><label>Stream Date</label><input type="date" disabled={!igEnabled} value={f.instant_grat_stream_date} onChange={e => upd('instant_grat_stream_date', e.target.value)} /></div>
              <div className="field"><label>Download Date</label><input type="date" disabled={!igEnabled} value={f.instant_grat_download_date} onChange={e => upd('instant_grat_download_date', e.target.value)} /></div>
            </div>
          </div>

          <div className="panel">
            <h3>Copyrights (track)</h3>
            <div className="grid2">
              <div className="field"><label>C-Line (©)</label><input value={f.c_line} onChange={e => upd('c_line', e.target.value)} /></div>
              <div className="field"><label>Year</label><input type="number" value={f.c_line_year} onChange={e => upd('c_line_year', e.target.value)} /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>P-Line (℗)</label><input value={f.p_line} onChange={e => upd('p_line', e.target.value)} /></div>
              <div className="field"><label>Year</label><input type="number" value={f.p_line_year} onChange={e => upd('p_line_year', e.target.value)} /></div>
            </div>
            <div className="field"><label>Right Holder</label><input value={f.right_holder} onChange={e => upd('right_holder', e.target.value)} /></div>
            <h3 style={{ marginTop: 14 }}>🎵 Media Assets</h3>
            <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {f.upload_state === 'uploaded'
                ? <>{f.file_format && <span className="badge live">{f.file_format}</span>} {f.has_master && <span className="badge live">WAV master ✓</span>} · {fmtBytes(f.file_size)} · ✓ valid</>
                : <span className="badge pending_review">Chưa có file audio</span>}
            </p>
            <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => audioInput.current?.click()}>⬆ {f.upload_state === 'uploaded' ? 'Replace file' : 'Upload audio'}</button>
            <input ref={audioInput} type="file" accept=".wav,.flac,.mp3,.m4a,.ogg,.opus" hidden
              onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) uploadAudio(file); }} />
          </div>

          <div className="panel">
            <h3>🎤 Lyrics {(!lyr.lyrics && !lyr.lrc) ? <span className="badge pending_review">No lyrics added yet</span> : <span className="badge live">✓</span>}</h3>
            <div className="field"><label>Plain lyrics</label><textarea rows={4} value={f.lyrics} onChange={e => upd('lyrics', e.target.value)} /></div>
            <div className="field"><label>Synced lyrics (LRC)</label><textarea rows={4} placeholder="[00:12.00]Câu hát…" value={f.lyrics_lrc} onChange={e => upd('lyrics_lrc', e.target.value)} /></div>
          </div>

          <div className="panel" style={{ gridColumn: '1/-1' }}>
            <h3>Contributors (track) <span className="sub">{p.release_type === 'Single'
              ? '— Single dùng chung với product (khóa), sửa ở tab Metadata'
              : '— kế thừa từ product, có thể override riêng cho track này'}</span></h3>
            {p.release_type === 'Single'
              ? <RoleGroups contributors={f.contributors} readonly />
              : <RoleGroups contributors={f.contributors}
                onSave={payload => api.put(`/admin/v1/products/tracks/${f.id}/contributors`, { contributors: payload })
                  .then(() => toast('Đã lưu contributors (track)')).catch(e => toast(e.message, true))} />}
          </div>
        </div>

        <div style={rowStyle}>
          <button className="btn btn-ghost" onClick={() => goTab('tracks')}>Cancel</button>
          <button className="btn btn-orange" onClick={update}>Update</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Tab QC Check
// ===========================================================================
function QcTab({ p, goTab }: { p: any; goTab: (t: string) => void }) {
  const [qc, setQc] = useState<any | null>(null);
  useEffect(() => { api.get(`/admin/v1/products/${p.id}/qc`).then(setQc).catch(e => toast(e.message, true)); }, [p.id]);
  if (!qc) return <p className="empty-note">Đang chạy QC…</p>;
  const st: Record<string, string> = { pass: '✅', warning: '⚠', error: '❌' };
  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,minmax(140px,1fr))', maxWidth: 560 }}>
        <div className={'stat-card' + (qc.errors ? ' danger' : '')}><div className="num">{qc.errors}</div><div className="lbl">Errors (chặn publish)</div></div>
        <div className={'stat-card' + (qc.warnings ? ' warn' : '')}><div className="num">{qc.warnings}</div><div className="lbl">Warnings</div></div>
        <div className="stat-card"><div className="num">{qc.can_publish ? '✓' : '✗'}</div><div className="lbl">Sẵn sàng publish</div></div>
      </div>
      {qc.groups.map((g: any) => (
        <div className="panel" key={g.name}>
          <h3>{g.name}</h3>
          {g.rules.map((r: any, i: number) => (
            <div key={i} style={{
              display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0',
              borderTop: i ? '1px solid color-mix(in srgb, var(--border) 45%, transparent)' : undefined,
            }}>
              <span>{st[r.level]}</span>
              <span style={{ flex: 1, color: r.level === 'error' ? 'var(--danger)' : r.level === 'warning' ? 'var(--warn)' : 'var(--text)' }}>{r.label}</span>
              <span className="sub">{r.detail || ''}</span>
            </div>
          ))}
        </div>
      ))}
      {qc.can_publish && (
        <div style={rowStyle}>
          <button className="btn btn-orange" onClick={() => goTab('releases')}>🚀 Sang tab Releases để Publish</button>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Tab Releases — hành động theo role
// ===========================================================================
/** Mốc mặc định khi hẹn giờ: +1 ngày từ bây giờ (định dạng datetime-local). */
function defaultRelInput(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ReleasesTab({ p, canManage, reload, onReject, onSubmit }:
{ p: any; canManage: boolean; reload: () => void; onReject: () => void; onSubmit: () => void }) {
  const [qc, setQc] = useState<any | null>(null);
  const [hist, setHist] = useState<any[]>([]);
  useEffect(() => {
    Promise.all([api.get(`/admin/v1/products/${p.id}/qc`), api.get(`/admin/v1/products/${p.id}/releases`)])
      .then(([q, h]) => { setQc(q); setHist(h.items); }).catch(e => toast(e.message, true));
  }, [p.id]);

  const isLive = p.status === 'live' || p.status === 'scheduled';
  const isPending = p.status === 'pending_review';
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const dateInFuture = (p.platform_release_date || '') > nowUtc;

  // Điều khiển thời điểm phát hành: ngay bây giờ, hoặc hẹn giờ.
  const [relMode, setRelMode] = useState<'now' | 'schedule'>(dateInFuture ? 'schedule' : 'now');
  const [relAt, setRelAt] = useState<string>(utcToInput(p.platform_release_date) || defaultRelInput());
  const [busy, setBusy] = useState(false);

  function relBody(): { release_at: string } | null {
    if (relMode === 'now') return { release_at: 'now' };
    const utc = inputToUtc(relAt);
    if (!utc) { toast('Chọn thời gian hẹn giờ phát hành', true); return null; }
    return { release_at: utc };
  }
  function relToast(status: string) {
    return status === 'scheduled'
      ? `⏰ Đã hẹn giờ phát hành — ${humanDate(inputToUtc(relAt)) || relAt}`
      : '🚀 ĐÃ PHÁT HÀNH — nhạc hiển thị trên website';
  }

  async function publish() {
    const body = relBody(); if (!body) return;
    setBusy(true);
    try { const res = await api.post(`/admin/v1/products/${p.id}/publish`, body); toast(relToast(res.status)); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  async function approveScheduled() {
    const body = relBody(); if (!body) return;
    if (!confirm(`Duyệt & phát hành "${p.title}"?`)) return;
    setBusy(true);
    try { const res = await api.post(`/admin/v1/products/${p.id}/approve`, body); toast(res.status === 'scheduled' ? relToast('scheduled') : '✅ Đã duyệt — ĐÃ PHÁT HÀNH'); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  async function update() { try { await api.post(`/admin/v1/products/${p.id}/update-release`); toast('Đã đẩy metadata mới nhất'); reload(); } catch (e: any) { toast(e.message, true); } }
  async function takedown() {
    if (!confirm('Takedown — gỡ product khỏi website?')) return;
    try { await api.post(`/admin/v1/products/${p.id}/takedown`); toast('Đã gỡ khỏi website'); reload(); } catch (e: any) { toast(e.message, true); }
  }

  const flowInline = (txt: string) => <span className="sub">{txt}</span>;
  // Khối chọn thời điểm phát hành (hiện khi manager sắp publish/approve)
  const scheduler = (
    <div className="rel-sched">
      <label className={'rel-opt' + (relMode === 'now' ? ' on' : '')}>
        <input type="radio" name="relmode" checked={relMode === 'now'} onChange={() => setRelMode('now')} /> 🚀 Phát hành ngay
      </label>
      <label className={'rel-opt' + (relMode === 'schedule' ? ' on' : '')}>
        <input type="radio" name="relmode" checked={relMode === 'schedule'} onChange={() => setRelMode('schedule')} /> ⏰ Hẹn giờ
      </label>
      {relMode === 'schedule' && (
        <>
          <input type="datetime-local" value={relAt} onChange={e => setRelAt(e.target.value)} style={{ width: 220 }} />
          <span className="sub">{relAt ? humanDate(inputToUtc(relAt)) : ''} (giờ máy bạn)</span>
        </>
      )}
    </div>
  );

  let actions: ReactNode = null;
  if (!canManage) {
    if (p.status === 'draft') actions = <><button className="btn btn-orange" onClick={onSubmit}>📤 Gửi duyệt</button>{flowInline('Manager sẽ kiểm tra nội dung và phát hành sau khi duyệt')}</>;
    else if (isPending) actions = flowInline(`🕓 Đang chờ manager duyệt${p.submitted_at ? ` — đã gửi ${humanDate(p.submitted_at) || p.submitted_at}` : ''}`);
    else actions = flowInline(`Product đã ${isLive ? 'phát hành' : 'gỡ xuống'} — liên hệ manager nếu cần thay đổi`);
  } else if (isPending) {
    actions = <>
      <button className="btn btn-ok" disabled={!qc?.can_publish || busy} title={qc?.can_publish ? '' : 'QC còn lỗi — kiểm tra tab QC Check'} onClick={approveScheduled}>✅ Duyệt &amp; phát hành</button>
      <button className="btn btn-danger" disabled={busy} onClick={onReject}>❌ Từ chối</button>
    </>;
  } else if (isLive) {
    actions = <><button className="btn btn-orange" onClick={update}>🔄 Update release</button><button className="btn btn-danger" onClick={takedown}>⛔ Takedown</button></>;
  } else {
    actions = <button className="btn btn-orange" disabled={!qc?.can_publish || busy} title={qc?.can_publish ? '' : 'QC còn lỗi — kiểm tra tab QC Check'} onClick={publish}>🚀 Publish</button>;
  }

  return (
    <>
      <div className="panel">
        <h3>Phát hành lên website</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
          Trạng thái hiện tại: <Badge status={p.status} /> · QC: {qc ? (qc.errors ? <span style={{ color: 'var(--danger)' }}>{qc.errors} lỗi</span> : '✓ pass') : '…'}
          {qc && qc.warnings ? ` · ⚠ ${qc.warnings} cảnh báo` : ''}</p>
        {canManage && (isPending || !isLive) && scheduler}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>
      </div>
      <div className="panel">
        <h3>Lịch sử phát hành</h3>
        {hist.length === 0 ? <p className="empty-note">Chưa có lần phát hành nào</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}><table>
            <thead><tr><th>Thời gian</th><th>Hành động</th><th>Provider</th><th>Người thao tác</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead>
            <tbody>{hist.map(x => (
              <tr key={x.id}>
                <td className="sub">{x.created_at}</td><td><b>{x.action}</b></td><td>{x.provider}</td>
                <td className="sub">{x.actor_email || '—'}</td>
                <td><Badge status={x.status === 'success' ? 'imported' : 'failed'} /></td>
                <td className="sub">{x.detail || ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function RejectModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) { setErr('Cần ghi chú lý do từ chối'); return; }
    try { await api.post(`/admin/v1/products/${p.id}/reject`, { note: note.trim() }); toast('Đã từ chối — product quay về Draft kèm ghi chú'); onDone(); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <Modal title="❌ Từ chối phát hành" onClose={onClose}>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
        “{p.title}” sẽ quay về <b>Draft</b> — uploader thấy lý do bên dưới và sửa lại.</p>
      <form onSubmit={submit}>
        <div className="field"><label>Lý do từ chối *</label>
          <textarea rows={4} required placeholder="VD: Ảnh bìa sai kích thước, thiếu lyrics bài 2, sai P-Line…" value={note} onChange={e => setNote(e.target.value)} /></div>
        {err && <div className="form-error">{err}</div>}
        <div style={rowStyle}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn btn-danger">Từ chối</button>
        </div>
      </form>
    </Modal>
  );
}
