/** Đối tác delivery (kênh API) — cấp API key để bắn DDEX ERN XML. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { toast, Modal, fmtDate } from '../ui';

interface Partner {
  id: string;
  name: string;
  dpid?: string | null;
  contact_email?: string | null;
  auto_publish: boolean;
  delivery_count: number;
  created_at?: string | null;
}

async function copyText(text: string, label = '') {
  try {
    await navigator.clipboard.writeText(text);
    toast('Đã sao chép' + (label ? ' ' + label : ''));
  } catch {
    toast('Trình duyệt chặn tự sao chép — hãy bôi đen và nhấn Ctrl+C', true);
  }
}

export default function Partners() {
  const [items, setItems] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  // form: false = đóng, null = thêm mới, Partner = sửa
  const [form, setForm] = useState<Partner | null | false>(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api.get('/admin/v1/partners');
      setItems(data.items || []);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function regenKey(p: Partner) {
    if (!window.confirm('Tạo API key mới? Key cũ sẽ hết hiệu lực ngay.')) return;
    try {
      const res = await api.post(`/admin/v1/partners/${p.id}/regenerate-key`);
      setApiKey(res.api_key);
      load();
    } catch (e: any) { toast(e.message, true); }
  }

  async function del(p: Partner) {
    if (!window.confirm(`Xóa đối tác "${p.name}"? Key của họ sẽ hết hiệu lực.`)) return;
    try {
      await api.del(`/admin/v1/partners/${p.id}`);
      toast('Đã xóa đối tác');
      load();
    } catch (e: any) { toast(e.message, true); }
  }

  return (
    <div>
      <div className="sec-head">
        <h1>🤝 Đối tác delivery</h1>
        <div className="tools">
          <button className="btn btn-primary" onClick={() => setForm(null)}>＋ Thêm đối tác</button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '-12px 0 18px', lineHeight: 1.6 }}>
        Mỗi distributor/label được cấp <b>API key</b> để bắn DDEX ERN XML thẳng vào{' '}
        <span className="mono">POST /ingestion/v1/deliveries</span> (header{' '}
        <span className="mono">X-API-Key</span>). Bật <b>auto-publish</b> để bỏ qua hàng chờ duyệt.
      </p>

      {loading ? (
        <p className="empty-note">Đang tải…</p>
      ) : items.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Đối tác</th><th>DPID</th><th>Auto-publish</th>
                <th>Deliveries</th><th>Tạo lúc</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <div className="sub">{p.contact_email || ''}</div>
                  </td>
                  <td className="mono">{p.dpid || '—'}</td>
                  <td>
                    {p.auto_publish
                      ? <span className="badge live">Bật</span>
                      : <span className="badge draft">Tắt — qua duyệt</span>}
                  </td>
                  <td>{p.delivery_count}</td>
                  <td className="sub">{fmtDate(p.created_at || undefined)}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setForm(p)}>Sửa</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => regenKey(p)}>🔑 Key mới</button>
                    <button className="btn btn-danger btn-sm" onClick={() => del(p)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty-note">
          Chưa có đối tác nào — bấm "＋ Thêm đối tác" để cấp kênh delivery đầu tiên
        </div>
      )}

      {form !== false && (
        <PartnerForm
          partner={form}
          onClose={() => setForm(false)}
          onSaved={() => { setForm(false); load(); }}
          onCreated={key => { setForm(false); load(); setApiKey(key); }}
        />
      )}

      {apiKey && <ApiKeyModal apiKey={apiKey} onClose={() => setApiKey(null)} />}
    </div>
  );
}

function PartnerForm({ partner, onClose, onSaved, onCreated }: {
  partner: Partner | null;
  onClose: () => void;
  onSaved: () => void;
  onCreated: (apiKey: string) => void;
}) {
  const [name, setName] = useState(partner?.name || '');
  const [dpid, setDpid] = useState(partner?.dpid || '');
  const [email, setEmail] = useState(partner?.contact_email || '');
  const [autoPublish, setAutoPublish] = useState(!!partner?.auto_publish);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body = {
      name, dpid: dpid || null, contact_email: email || null, auto_publish: autoPublish,
    };
    try {
      if (partner) {
        await api.patch(`/admin/v1/partners/${partner.id}`, body);
        toast('Đã lưu');
        onSaved();
      } else {
        const res = await api.post('/admin/v1/partners', body);
        onCreated(res.api_key);
      }
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal title={partner ? 'Sửa đối tác' : 'Thêm đối tác delivery'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Tên đối tác *</label>
          <input required value={name} onChange={e => setName(e.target.value)}
            placeholder="VD: Mekong Digital Distribution" />
        </div>
        <div className="grid2">
          <div className="field">
            <label>DPID (DDEX Party ID)</label>
            <input value={dpid} onChange={e => setDpid(e.target.value)} placeholder="PADPIDA2026XXXXX" />
          </div>
          <div className="field">
            <label>Email liên hệ</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '6px 0 4px' }}>
          <input type="checkbox" style={{ width: 'auto' }}
            checked={autoPublish} onChange={e => setAutoPublish(e.target.checked)} />
          Auto-publish (nội dung lên thẳng catalog, bỏ qua Review Queue)
        </label>
        <div className="form-error">{error}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn btn-primary">{partner ? 'Lưu' : 'Tạo + cấp API key'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ApiKeyModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const curl = `curl -X POST ${window.location.origin}/ingestion/v1/deliveries \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/xml" \\
  --data-binary @NewReleaseMessage.xml`;
  return (
    <Modal title="🔑 API key của đối tác" onClose={onClose}>
      <p style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 12 }}>
        Key chỉ hiển thị MỘT LẦN (server chỉ lưu hash) — sao chép và gửi cho đối tác ngay.
      </p>
      <div className="keybox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>{apiKey}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => copyText(apiKey, 'API key')}>Sao chép</button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 14 }}>Đối tác gửi delivery bằng:</p>
      <div className="keybox" style={{ marginTop: 6 }}>{curl}</div>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>Đã lưu key</button>
      </div>
    </Modal>
  );
}
