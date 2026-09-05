/** Kho mã UPC / ISRC — nhập dải mã đã đăng ký; hệ thống cấp phát tự động khi phát hành.
 *  Tab ISRC (bài hát) / UPC (release), thêm thủ công / import .txt, bật tự sinh khi hết kho. */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { SecHead, Empty, toast, fmtCount, fmtDate } from '../ui';

type Kind = 'isrc' | 'upc';
interface Report { added: string[]; skipped: { code: string; reason: string }[] }

export default function IdPool() {
  const [kind, setKind] = useState<Kind>('isrc');
  return (
    <div>
      <SecHead title="🔢 Kho mã UPC / ISRC" />
      <p className="sub" style={{ margin: '-12px 0 16px', lineHeight: 1.6 }}>
        Nhập dải mã đã đăng ký (IFPI cấp ISRC, GS1 cấp UPC) — hệ thống <b>cấp phát tự động từ kho</b> khi
        phát hành; hết kho sẽ tự sinh mã nội bộ nếu được bật.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={'btn ' + (kind === 'isrc' ? 'btn-primary' : 'btn-ghost')} onClick={() => setKind('isrc')}>ISRC (bài hát)</button>
        <button className={'btn ' + (kind === 'upc' ? 'btn-primary' : 'btn-ghost')} onClick={() => setKind('upc')}>UPC (release)</button>
      </div>
      <Pool key={kind} kind={kind} />
    </div>
  );
}

function Pool({ kind }: { kind: Kind }) {
  const [data, setData] = useState<any>(null);
  const [codes, setCodes] = useState('');
  const [result, setResult] = useState<Report | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const label = kind === 'isrc' ? 'ISRC' : 'UPC';
  const placeholder = kind === 'isrc'
    ? 'VNA0D2600101\nVNA0D2600102\n…'
    : '0827969279321\n0827969279338\n…';

  const load = () => {
    api.get(`/admin/v1/idpool?kind=${kind}`)
      .then(setData)
      .catch(e => { toast(e.message, true); setData({ items: [], available: 0, used: 0, auto_generate: false }); });
  };
  useEffect(load, [kind]);

  const toggleAuto = async (checked: boolean) => {
    // optimistic — hoàn tác nếu lỗi
    setData((d: any) => ({ ...d, auto_generate: checked }));
    try {
      await api.patch('/admin/v1/idpool/settings', { kind, auto_generate: checked });
      toast(checked ? 'Đã bật tự sinh mã' : 'Đã tắt tự sinh — chỉ dùng mã trong kho');
    } catch (e: any) {
      toast(e.message, true);
      setData((d: any) => ({ ...d, auto_generate: !checked }));
    }
  };

  const addCodes = async () => {
    const list = codes.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (!list.length) { toast('Chưa nhập mã nào', true); return; }
    try {
      const rep: Report = await api.post('/admin/v1/idpool', { kind, codes: list });
      setResult(rep);
      setCodes('');
      toast(`Đã thêm ${rep.added.length} mã ${label}`);
      load();
    } catch (e: any) { toast(e.message, true); }
  };

  const importFile = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const rep: Report = await api.upload(`/admin/v1/idpool/import?kind=${kind}`, fd);
      setResult(rep);
      toast(`Import: +${rep.added.length} mã, bỏ qua ${rep.skipped.length}`);
      load();
    } catch (e: any) { toast(e.message, true); }
  };

  const delCode = async (id: string) => {
    try {
      await api.del(`/admin/v1/idpool/${id}`);
      toast('Đã xóa mã khỏi kho');
      load();
    } catch (e: any) { toast(e.message, true); }
  };

  if (!data) return <Empty>Đang tải…</Empty>;

  return (
    <div>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
        <div className="stat-card">
          <div className="num" style={{ color: 'var(--ok)' }}>{fmtCount(data.available)}</div>
          <div className="lbl">Mã {label} còn trong kho</div>
        </div>
        <div className="stat-card">
          <div className="num">{fmtCount(data.used)}</div>
          <div className="lbl">Đã cấp phát</div>
        </div>
        <div className="stat-card">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!!data.auto_generate}
              onChange={e => toggleAuto(e.target.checked)} />
            Tự sinh mã khi kho hết
          </label>
          <div className="lbl" style={{ marginTop: 6 }}>Tắt = bắt buộc dùng mã thật trong kho</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>➕ Thêm mã {label}</h3>
          <div className="field">
            <label>Nhập thủ công (mỗi dòng 1 mã, hoặc cách nhau dấu phẩy)</label>
            <textarea rows={5} placeholder={placeholder} style={{ fontFamily: 'Consolas, monospace' }}
              value={codes} onChange={e => setCodes(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={addCodes}>Thêm vào kho</button>
            <span className="sub">hoặc</span>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>📄 Import file .txt</button>
            <input ref={fileRef} type="file" accept=".txt,.csv" hidden
              onChange={e => { if (e.target.files?.[0]) importFile(e.target.files[0]); e.target.value = ''; }} />
          </div>
          {result && (
            <div className="keybox" style={{ marginTop: 14 }}>
              <div>✅ Đã thêm {result.added.length} mã</div>
              {result.skipped.map((s, i) => (
                <div key={i} style={{ color: 'var(--danger)' }}>✗ {s.code} — {s.reason}</div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h3>Danh sách mã ({fmtCount(data.available + data.used)})</h3>
          <div className="tbl-wrap" style={{ border: 'none', maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Mã</th><th>Trạng thái</th><th>Thêm lúc</th><th></th></tr></thead>
              <tbody>
                {data.items.length === 0
                  ? <tr><td colSpan={4} className="empty-note">Kho trống — thêm mã ở khung bên trái</td></tr>
                  : data.items.map((c: any) => (
                    <tr key={c.id}>
                      <td className="mono">{c.code}</td>
                      <td>{c.status === 'available'
                        ? <span className="badge live">Sẵn sàng</span>
                        : <span className="badge draft">Đã dùng</span>}</td>
                      <td className="sub">{fmtDate(c.added_at)}</td>
                      <td className="actions">
                        {c.status === 'available' &&
                          <button className="btn btn-danger btn-sm" onClick={() => delCode(c.id)}>Xóa</button>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
