/** Nghệ sĩ — card-grid + trang chi tiết (ảnh, hồ sơ, top tracks/releases).
 *  Điều hướng list ↔ detail bằng state nội bộ (section render theo state ở AdminApp). */
import { useEffect, useState, type CSSProperties } from 'react';
import { api, assetUrl } from '../../api';
import { SecHead, Empty, Modal, Badge, toast, fmtCount, fmtDate } from '../ui';

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const artistColor = (a: any): string => (ACCENT_RE.test(a?.accent || '') ? a.accent : '#7c5cff');
const artistTypeLabel = (t: string) => (t === 'group' ? 'Nhóm nhạc' : 'Cá nhân');

/** Avatar tròn — ảnh nếu có, không thì chữ cái đầu trên nền accent. */
function Avatar({ a, size, className }: { a: any; size?: number; className?: string }) {
  const c = artistColor(a);
  const style: CSSProperties = size
    ? { width: size, height: size, borderRadius: '50%', margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', fontWeight: 800, fontSize: Math.round(size * 0.36) }
    : {};
  if (a.image_url) {
    return (
      <div className={className} style={style}>
        <img src={assetUrl(a.image_url)} alt="" loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div className={className} style={{ ...style, background: c + '26', color: c }}>
      {(a.name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

export default function Artists() {
  const [sel, setSel] = useState<string | null>(null);
  return sel
    ? <ArtistDetail id={sel} onBack={() => setSel(null)} />
    : <ArtistGrid onOpen={setSel} />;
}

// ---- Danh sách card ---------------------------------------------------------
function ArtistGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[] | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.get(`/admin/v1/artists?q=${encodeURIComponent(q)}`)
        .then(d => { if (alive) setItems(d.items); })
        .catch(e => { if (alive) { toast(e.message, true); setItems([]); } });
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  return (
    <div>
      <SecHead title="🎤 Nghệ sĩ">
        <input type="search" placeholder="Tìm nghệ sĩ…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>＋ Thêm nghệ sĩ</button>
      </SecHead>

      {items === null ? <Empty>Đang tải…</Empty>
        : items.length === 0 ? <Empty>Chưa có nghệ sĩ nào{q ? ' khớp tìm kiếm' : ''}.</Empty>
        : (
          <div className="card-grid">
            {items.map(a => (
              <div key={a.id} className="a-card" onClick={() => onOpen(a.id)}>
                <Avatar a={a} className="av" />
                <div style={{ fontWeight: 700 }} title={a.name}>{a.name}</div>
                <div className="sub">{artistTypeLabel(a.type)}{a.country ? ` · ${a.country}` : ''}</div>
                <div className="sub" style={{ marginTop: 6 }}>
                  {fmtCount(a.track_count)} bài · {fmtCount(a.release_count)} release · {fmtCount(a.followers)} follower
                </div>
              </div>
            ))}
          </div>
        )}

      {showNew && <NewArtistModal onClose={() => setShowNew(false)} onCreated={id => { setShowNew(false); onOpen(id); }} />}
    </div>
  );
}

// ---- Modal thêm nghệ sĩ -----------------------------------------------------
function NewArtistModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: '', type: 'person', country: '', isni: '', ipi: '', bio: '' });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  const submit = async () => {
    setErr('');
    try {
      const res = await api.post('/admin/v1/artists', {
        name: f.name.trim(), type: f.type,
        country: f.country.trim().toUpperCase() || null,
        isni: f.isni.trim() || null, ipi: f.ipi.trim() || null,
        bio: f.bio.trim() || null,
      });
      toast('Đã thêm nghệ sĩ');
      onCreated(res.id);
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal title="Thêm nghệ sĩ (Party)" onClose={onClose}>
      <div className="field"><label>Tên *</label>
        <input value={f.name} onChange={e => set('name', e.target.value)} autoFocus /></div>
      <div className="grid2">
        <div className="field"><label>Loại</label>
          <select value={f.type} onChange={e => set('type', e.target.value)}>
            <option value="person">Cá nhân (Person)</option>
            <option value="group">Nhóm nhạc (Group)</option>
          </select></div>
        <div className="field"><label>Quốc gia (ISO-2)</label>
          <input maxLength={2} placeholder="VN" style={{ textTransform: 'uppercase' }}
            value={f.country} onChange={e => set('country', e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label>ISNI</label>
          <input placeholder="0000 0001 2345 6789" value={f.isni} onChange={e => set('isni', e.target.value)} /></div>
        <div className="field"><label>IPI</label>
          <input value={f.ipi} onChange={e => set('ipi', e.target.value)} /></div>
      </div>
      <div className="field"><label>Tiểu sử</label>
        <textarea rows={3} value={f.bio} onChange={e => set('bio', e.target.value)} /></div>
      <div className="form-error">{err}</div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" onClick={submit}>Thêm nghệ sĩ</button>
      </div>
    </Modal>
  );
}

// ---- Trang chi tiết ---------------------------------------------------------
function ArtistDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [a, setA] = useState<any>(null);
  const [err, setErr] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [over, setOver] = useState(false);
  // form nội bộ (đồng bộ lại mỗi khi nạp nghệ sĩ)
  const [f, setF] = useState({ name: '', type: 'person', country: '', isni: '', ipi: '', bio: '', accent: '#7c5cff' });
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  const load = () => {
    api.get(`/admin/v1/artists/${id}`)
      .then(d => {
        setA(d);
        setF({
          name: d.name || '', type: d.type === 'group' ? 'group' : 'person',
          country: d.country || '', isni: d.isni || '', ipi: d.ipi || '',
          bio: d.bio || '', accent: artistColor(d),
        });
      })
      .catch(e => setLoadErr(e.message || 'Lỗi kết nối'));
  };
  useEffect(load, [id]);

  const save = async () => {
    setErr('');
    try {
      await api.patch(`/admin/v1/artists/${id}`, {
        name: f.name.trim(), type: f.type,
        country: f.country.trim().toUpperCase() || null,
        isni: f.isni.trim() || null, ipi: f.ipi.trim() || null,
        bio: f.bio.trim() || null, accent: f.accent,
      });
      toast('Đã lưu hồ sơ nghệ sĩ');
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const uploadPhoto = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload(`/admin/v1/artists/${id}/image`, fd);
      setA((prev: any) => ({ ...prev, image_url: res.image_url }));
      toast('Đã cập nhật ảnh nghệ sĩ');
    } catch (e: any) { toast(e.message, true); }
  };

  const remove = async () => {
    if (!confirm(`Xóa nghệ sĩ "${a.name}"? Không thể hoàn tác.`)) return;
    try {
      await api.del(`/admin/v1/artists/${id}`);
      toast('Đã xóa nghệ sĩ');
      onBack();
    } catch (e: any) { toast(e.message, true); }  // 409: còn gắn track/release
  };

  if (loadErr) {
    return (
      <div>
        <SecHead title="⚠ Không mở được nghệ sĩ" />
        <Empty>{loadErr} — <a href="#" onClick={e => { e.preventDefault(); onBack(); }}>quay lại</a></Empty>
      </div>
    );
  }
  if (!a) return <Empty>Đang tải nghệ sĩ…</Empty>;

  return (
    <div>
      <p className="sub" style={{ marginBottom: 10 }}>
        <a href="#" style={{ color: 'var(--accent)' }} onClick={e => { e.preventDefault(); onBack(); }}>Nghệ sĩ</a> › {a.name}
      </p>
      <div className="two-col">
        {/* Cột trái: ảnh + stats + xóa */}
        <div className="panel" style={{ textAlign: 'center' }}>
          <label
            className={'dropzone' + (over ? ' over' : '')}
            style={{ display: 'block', padding: 16, cursor: 'pointer' }}
            title="Bấm hoặc kéo thả ảnh vào đây để đổi (PNG/JPG/WebP ≤5MB)"
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files[0]) uploadPhoto(e.dataTransfer.files[0]); }}
          >
            <Avatar a={a} size={140} />
            <div style={{ marginTop: 10, fontWeight: 600 }}>⬆ Đổi ảnh</div>
            <input type="file" accept=".png,.jpg,.jpeg,.webp" hidden
              onChange={e => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0]); e.target.value = ''; }} />
          </label>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', margin: '16px 0' }}>
            <div className="stat-card"><div className="num">{fmtCount(a.track_count)}</div><div className="lbl">Bài hát</div></div>
            <div className="stat-card"><div className="num">{fmtCount(a.release_count)}</div><div className="lbl">Release</div></div>
            <div className="stat-card"><div className="num">{fmtCount(a.followers)}</div><div className="lbl">Follower</div></div>
          </div>
          <p className="sub" style={{ marginBottom: 12 }}>Tạo lúc {fmtDate(a.created_at)}</p>
          <button className="btn btn-danger btn-sm" onClick={remove}>🗑 Xóa nghệ sĩ</button>
        </div>

        {/* Cột phải: hồ sơ + top tracks/releases */}
        <div>
          <div className="panel">
            <h3>Hồ sơ nghệ sĩ</h3>
            <div className="field"><label>Tên *</label>
              <input value={f.name} onChange={e => set('name', e.target.value)} /></div>
            <div className="grid2">
              <div className="field"><label>Loại</label>
                <select value={f.type} onChange={e => set('type', e.target.value)}>
                  <option value="person">Cá nhân (Person)</option>
                  <option value="group">Nhóm nhạc (Group)</option>
                </select></div>
              <div className="field"><label>Quốc gia (ISO-2)</label>
                <input maxLength={2} placeholder="VN" style={{ textTransform: 'uppercase' }}
                  value={f.country} onChange={e => set('country', e.target.value)} /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>ISNI</label>
                <input placeholder="0000 0001 2345 6789" value={f.isni} onChange={e => set('isni', e.target.value)} /></div>
              <div className="field"><label>IPI</label>
                <input value={f.ipi} onChange={e => set('ipi', e.target.value)} /></div>
            </div>
            <div className="field"><label>Màu accent (tô điểm trang nghệ sĩ trên web nghe nhạc)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input type="color" value={f.accent} onChange={e => set('accent', e.target.value)}
                  style={{ width: 52, height: 38, padding: 2 }} />
                <span className="mono">{f.accent}</span>
              </div></div>
            <div className="field"><label>Tiểu sử</label>
              <textarea rows={4} value={f.bio} onChange={e => set('bio', e.target.value)} /></div>
            <div className="form-error">{err}</div>
            <button className="btn btn-primary" onClick={save}>Lưu thay đổi</button>
          </div>

          <div className="two-col">
            <div className="panel">
              <h3>🔥 Top bài hát</h3>
              {(a.top_tracks || []).length ? (
                <div className="tbl-wrap" style={{ border: 'none' }}>
                  <table>
                    <thead><tr><th>Bài hát</th><th>ISRC</th><th style={{ textAlign: 'right' }}>Lượt nghe</th></tr></thead>
                    <tbody>{a.top_tracks.map((t: any) => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td className="mono">{t.isrc || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{fmtCount(t.play_count)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <Empty>Chưa có bài hát nào</Empty>}
            </div>
            <div className="panel">
              <h3>💿 Releases</h3>
              {(a.releases || []).length ? (
                <div className="tbl-wrap" style={{ border: 'none' }}>
                  <table>
                    <thead><tr><th>Release</th><th>Trạng thái</th></tr></thead>
                    <tbody>{a.releases.map((r: any) => (
                      <tr key={r.id}><td>{r.title}</td><td><Badge status={r.status} /></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <Empty>Chưa gắn release nào</Empty>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
