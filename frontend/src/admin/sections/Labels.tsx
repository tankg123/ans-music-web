/** Labels — bảng danh sách + trang chi tiết (hồ sơ, stats, products thuộc label).
 *  Điều hướng list ↔ detail bằng state nội bộ. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { SecHead, Empty, Modal, Badge, toast, fmtCount, fmtDate } from '../ui';

const EMPTY_FORM = {
  name: '', dpid: '', isrc_prefix: '', c_line: '', p_line: '',
  right_holder: '', contact_email: '', website: '', notes: '',
};
type LabelForm = typeof EMPTY_FORM;
const toForm = (l: any): LabelForm => ({
  name: l?.name || '', dpid: l?.dpid || '', isrc_prefix: l?.isrc_prefix || '',
  c_line: l?.c_line || '', p_line: l?.p_line || '', right_holder: l?.right_holder || '',
  contact_email: l?.contact_email || '', website: l?.website || '', notes: l?.notes || '',
});
const toBody = (f: LabelForm) => ({
  name: f.name.trim(),
  dpid: f.dpid.trim() || null,
  isrc_prefix: f.isrc_prefix.trim().toUpperCase() || null,
  c_line: f.c_line.trim() || null,
  p_line: f.p_line.trim() || null,
  right_holder: f.right_holder.trim() || null,
  contact_email: f.contact_email.trim() || null,
  website: f.website.trim() || null,
  notes: f.notes.trim() || null,
});

export default function Labels() {
  const [sel, setSel] = useState<string | null>(null);
  return sel
    ? <LabelDetail id={sel} onBack={() => setSel(null)} />
    : <LabelTable onOpen={setSel} />;
}

// ---- Bảng danh sách ---------------------------------------------------------
function LabelTable({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [editing, setEditing] = useState<any | null>(null);   // label đang sửa
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.get(`/admin/v1/products/labels?q=${encodeURIComponent(q)}`)
        .then(d => { if (alive) setItems(d.items); })
        .catch(e => { if (alive) { toast(e.message, true); setItems([]); } });
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, nonce]);

  const reload = () => setNonce(n => n + 1);

  const del = async (l: any) => {
    if (!confirm(`Xóa label "${l.name}"?`)) return;
    try {
      await api.del(`/admin/v1/products/labels/${l.id}`);
      toast('Đã xóa label');
      reload();
    } catch (e: any) { toast(e.message, true); }  // 409: còn product
  };

  return (
    <div>
      <SecHead title="🏷 Labels">
        <input type="search" placeholder="Tìm label…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-orange" onClick={() => setCreating(true)}>＋ Thêm label</button>
      </SecHead>

      {items === null ? <Empty>Đang tải…</Empty>
        : items.length === 0 ? <Empty>Chưa có label nào{q ? ' khớp tìm kiếm' : ''} — bấm "＋ Thêm label".</Empty>
        : (
          <div className="tbl-wrap">
            <table>
              <thead><tr>
                <th>Label</th><th>DPID</th><th>ISRC prefix</th>
                <th>℗ / © / Right holder</th><th>Liên hệ</th><th>Products</th><th></th>
              </tr></thead>
              <tbody>{items.map(l => (
                <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(l.id)}>
                  <td><b>{l.name}</b></td>
                  <td className="mono">{l.dpid || '—'}</td>
                  <td className="mono">{l.isrc_prefix || '—'}</td>
                  <td>
                    <div>{l.p_line || '—'}</div>
                    <div className="sub">{l.c_line || '—'}</div>
                    <div className="sub">{l.right_holder || '—'}</div>
                  </td>
                  <td className="sub">{l.contact_email || '—'}</td>
                  <td>
                    <b>{fmtCount(l.product_count)}</b>{' '}
                    {l.live_count ? <span className="badge live">{l.live_count} live</span> : null}{' '}
                    {l.draft_count ? <span className="badge draft">{l.draft_count} nháp</span> : null}{' '}
                    {l.pending_count ? <span className="badge pending_review">{l.pending_count} chờ duyệt</span> : null}
                  </td>
                  <td className="actions" onClick={e => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(l)}>Sửa</button>
                    <button className="btn btn-danger btn-sm" onClick={() => del(l)}>Xóa</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

      {creating && <LabelModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {editing && <LabelModal label={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

// ---- Modal tạo/sửa label ----------------------------------------------------
function LabelModal({ label, onClose, onSaved }: { label?: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<LabelForm>(toForm(label));
  const [err, setErr] = useState('');
  const set = (k: keyof LabelForm, v: string) => setF(s => ({ ...s, [k]: v }));

  const submit = async () => {
    setErr('');
    try {
      if (label) await api.patch(`/admin/v1/products/labels/${label.id}`, toBody(f));
      else await api.post('/admin/v1/products/labels', toBody(f));
      toast('Đã lưu label');
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal title={label ? 'Sửa label' : 'Thêm label'} onClose={onClose}>
      <div className="field"><label>Tên label *</label>
        <input value={f.name} onChange={e => set('name', e.target.value)} autoFocus /></div>
      <div className="grid2">
        <div className="field"><label>ISRC prefix (5 ký tự)</label>
          <input maxLength={5} placeholder="VNA0D" style={{ textTransform: 'uppercase' }}
            value={f.isrc_prefix} onChange={e => set('isrc_prefix', e.target.value)} /></div>
        <div className="field"><label>DPID</label>
          <input value={f.dpid} onChange={e => set('dpid', e.target.value)} /></div>
      </div>
      <p className="sub" style={{ margin: '2px 0 8px' }}>
        Bản quyền mặc định — product tạo bằng label này sẽ tự điền C-Line, P-Line, Right Holder từ đây (vẫn sửa được).
      </p>
      <div className="grid2">
        <div className="field"><label>C-Line Text (©)</label>
          <input placeholder="© 2026 Tên Label" value={f.c_line} onChange={e => set('c_line', e.target.value)} /></div>
        <div className="field"><label>P-Line Text (℗)</label>
          <input placeholder="℗ 2026 Tên Label" value={f.p_line} onChange={e => set('p_line', e.target.value)} /></div>
      </div>
      <div className="field"><label>Right Holder</label>
        <input placeholder="Chủ sở hữu quyền" value={f.right_holder} onChange={e => set('right_holder', e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label>Email liên hệ</label>
          <input type="email" placeholder="label@example.com" value={f.contact_email} onChange={e => set('contact_email', e.target.value)} /></div>
        <div className="field"><label>Website</label>
          <input placeholder="https://…" value={f.website} onChange={e => set('website', e.target.value)} /></div>
      </div>
      <div className="field"><label>Ghi chú nội bộ</label>
        <textarea rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
      <div className="form-error">{err}</div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
        <button className="btn btn-orange" onClick={submit}>{label ? 'Lưu' : 'Thêm'}</button>
      </div>
    </Modal>
  );
}

// ---- Trang chi tiết ---------------------------------------------------------
function LabelDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [l, setL] = useState<any>(null);
  const [loadErr, setLoadErr] = useState('');
  const [err, setErr] = useState('');
  const [f, setF] = useState<LabelForm>(EMPTY_FORM);
  const set = (k: keyof LabelForm, v: string) => setF(s => ({ ...s, [k]: v }));

  const load = () => {
    api.get(`/admin/v1/products/labels/${id}`)
      .then(d => { setL(d); setF(toForm(d)); })
      .catch(e => setLoadErr(e.message || 'Lỗi kết nối'));
  };
  useEffect(load, [id]);

  const save = async () => {
    setErr('');
    try {
      await api.patch(`/admin/v1/products/labels/${id}`, toBody(f));
      toast('Đã lưu label');
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async () => {
    if (!confirm(`Xóa label "${l.name}"?`)) return;
    try {
      await api.del(`/admin/v1/products/labels/${id}`);
      toast('Đã xóa label');
      onBack();
    } catch (e: any) { setErr(e.message); }  // 409: còn product trỏ tới label
  };

  if (loadErr) {
    return (
      <div>
        <SecHead title="⚠ Không mở được label" />
        <Empty>{loadErr} — <a href="#" onClick={e => { e.preventDefault(); onBack(); }}>quay lại</a></Empty>
      </div>
    );
  }
  if (!l) return <Empty>Đang tải label…</Empty>;

  const s = l.stats || {};
  return (
    <div>
      <p className="sub" style={{ marginBottom: 10 }}>
        <a href="#" style={{ color: 'var(--accent)' }} onClick={e => { e.preventDefault(); onBack(); }}>Labels</a> › {l.name}
      </p>
      <div className="two-col">
        {/* Cột trái: hồ sơ */}
        <div className="panel">
          <h3>Hồ sơ label</h3>
          <div className="field"><label>Tên label *</label>
            <input value={f.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>DPID</label>
              <input value={f.dpid} onChange={e => set('dpid', e.target.value)} /></div>
            <div className="field"><label>ISRC prefix (5 ký tự)</label>
              <input maxLength={5} placeholder="VNA0D" style={{ textTransform: 'uppercase' }}
                value={f.isrc_prefix} onChange={e => set('isrc_prefix', e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>C-Line Text (©)</label>
              <input placeholder="© 2026 Tên Label" value={f.c_line} onChange={e => set('c_line', e.target.value)} /></div>
            <div className="field"><label>P-Line Text (℗)</label>
              <input placeholder="℗ 2026 Tên Label" value={f.p_line} onChange={e => set('p_line', e.target.value)} /></div>
          </div>
          <div className="field"><label>Right Holder</label>
            <input placeholder="Chủ sở hữu quyền" value={f.right_holder} onChange={e => set('right_holder', e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Email liên hệ</label>
              <input type="email" placeholder="label@example.com" value={f.contact_email} onChange={e => set('contact_email', e.target.value)} /></div>
            <div className="field"><label>Website</label>
              <input placeholder="https://…" value={f.website} onChange={e => set('website', e.target.value)} /></div>
          </div>
          <div className="field"><label>Ghi chú nội bộ</label>
            <textarea rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
          <div className="form-error">{err}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={save}>Lưu thay đổi</button>
            <button className="btn btn-danger" onClick={remove}>🗑 Xóa label</button>
          </div>
          <p className="sub" style={{ marginTop: 12 }}>Tạo lúc {fmtDate(l.created_at)}</p>
        </div>

        {/* Cột phải: stats + products */}
        <div>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))' }}>
            <div className="stat-card"><div className="num">{fmtCount(s.product_count)}</div><div className="lbl">Products</div></div>
            <div className="stat-card"><div className="num" style={{ color: 'var(--ok)' }}>{fmtCount(s.live_count)}</div><div className="lbl">Đang phát hành</div></div>
            <div className="stat-card"><div className="num">{fmtCount(s.draft_count)}</div><div className="lbl">Nháp</div></div>
            <div className={'stat-card' + (s.pending_count ? ' warn' : '')}><div className="num">{fmtCount(s.pending_count)}</div><div className="lbl">Chờ duyệt</div></div>
            <div className="stat-card"><div className="num">{fmtCount(s.track_count)}</div><div className="lbl">Tracks</div></div>
          </div>
          <div className="panel">
            <h3>Products thuộc label</h3>
            {(l.products || []).length ? (
              <div className="tbl-wrap" style={{ border: 'none' }}>
                <table>
                  <thead><tr><th>Product</th><th>UPC</th><th>Type</th><th>Tracks</th><th>Trạng thái</th></tr></thead>
                  <tbody>{l.products.map((pr: any) => (
                    <tr key={pr.id}>
                      <td><b>{pr.title}</b></td>
                      <td className="mono">{pr.upc || '—'}</td>
                      <td>{pr.release_type || '—'}</td>
                      <td>{fmtCount(pr.track_count)}</td>
                      <td><Badge status={pr.status} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Empty>Chưa có product nào thuộc label này</Empty>}
          </div>
        </div>
      </div>
    </div>
  );
}
