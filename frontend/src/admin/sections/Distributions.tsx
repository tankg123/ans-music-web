/** Distributions (SFTP DDEX) — kênh đối tác đẩy ERN XML + audio qua SSH key. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { toast, Modal, Badge, fmtCount } from '../ui';

interface SftpInfo { host?: string; port?: number; enabled?: boolean; host_key_fingerprint?: string; }
interface Dist {
  id: string;
  name: string;
  dpid?: string | null;
  contact_email?: string | null;
  auto_publish: boolean;
  sftp_username?: string | null;
  ssh_fingerprint?: string | null;
  last_delivery_at?: string | null;
  created_at?: string | null;
  delivery_count: number;
}
interface KeypairData {
  name?: string;
  sftp_username?: string | null;
  ssh_public_key?: string;
  ssh_fingerprint?: string;
  private_key?: string | null;
  sftp?: SftpInfo | null;
}

const fpShort = (fp?: string | null) => !fp ? '—' : (fp.length > 26 ? fp.slice(0, 23) + '…' : fp);
const clip16 = (s?: string | null) => (s || '').slice(0, 16) || '—';

async function copyText(text: string, label = '') {
  try {
    await navigator.clipboard.writeText(text);
    toast('Đã sao chép' + (label ? ' ' + label : ''));
  } catch {
    toast('Trình duyệt chặn tự sao chép — hãy bôi đen và nhấn Ctrl+C', true);
  }
}
function downloadPem(text: string, user?: string | null) {
  const blob = new Blob([text], { type: 'application/x-pem-file' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${String(user || 'ans-sftp').replace(/[^\w.-]/g, '_')}.pem`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- khối key/value dùng chung cho banner + hướng dẫn kết nối ----
function KV({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 3 }}>{label}</span>
      <span className="mono" style={{ color: 'var(--text)' }}>{children}</span>
    </div>
  );
}
const kvGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginTop: 12 };

function SftpBanner({ s }: { s: SftpInfo | null }) {
  if (!s) return null;
  return (
    <div className="sftp-banner">
      <div style={{ fontWeight: 700 }}>🛰 SFTP server</div>
      <div style={kvGrid}>
        <KV label="Host">{s.host || '—'}</KV>
        <KV label="Port">{s.port ?? '—'}</KV>
        <KV label="Trạng thái">
          {s.enabled
            ? <span className="badge live">Đang bật</span>
            : <span className="badge failed">Tắt</span>}
        </KV>
        <KV label="Host key fingerprint" wide>{s.host_key_fingerprint || '—'}</KV>
      </div>
      {!s.enabled && (
        <div className="sftp-warn" style={{ marginTop: 14, marginBottom: 0 }}>
          ⚠ SFTP server đang TẮT — bật <span className="mono">ANS_SFTP_ENABLED=true</span> trong
          .env rồi khởi động lại.
        </div>
      )}
    </div>
  );
}

function ConnGuide({ host, port, user, cmd }: { host: string; port: number | string; user: string; cmd: string }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Hướng dẫn kết nối cho đối tác</div>
      <div style={kvGrid}>
        <KV label="Host">{host}</KV>
        <KV label="Port">{port}</KV>
        <KV label="Username" wide>{user}</KV>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '12px 0 6px' }}>
        Kết nối bằng SFTP với private key:
      </p>
      <div className="keybox">{cmd}</div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 10 }}>
        Đẩy nội dung: đưa file <b>DDEX ERN XML</b> cùng các file <b>audio</b> vào thư mục{' '}
        <span className="mono">incoming/</span>. Hệ thống tự phát hiện, validate và import.
      </p>
    </div>
  );
}

export default function Distributions() {
  const [items, setItems] = useState<Dist[]>([]);
  const [sftp, setSftp] = useState<SftpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Dist | null | false>(false);
  const [keypair, setKeypair] = useState<KeypairData | null>(null);
  const [connDist, setConnDist] = useState<Dist | null>(null);
  const [delivDist, setDelivDist] = useState<Dist | null>(null);

  async function load() {
    try {
      const data = await api.get('/admin/v1/distributions');
      setItems(data.items || []);
      setSftp(data.sftp || null);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function rotateKey(d: Dist) {
    if (!window.confirm(`Cấp lại SSH key cho "${d.name}"? Key cũ hết hiệu lực ngay — đối tác phải dùng key mới.`)) return;
    try {
      const res = await api.post(`/admin/v1/distributions/${d.id}/rotate-key`);
      setKeypair({ ...res, name: d.name, sftp_username: res.sftp_username || d.sftp_username, sftp });
      load();
    } catch (e: any) { toast(e.message, true); }
  }

  async function del(d: Dist) {
    if (!window.confirm(`Xóa distribution "${d.name}"? Key SSH của họ sẽ hết hiệu lực và không đẩy được nữa.`)) return;
    try {
      await api.del(`/admin/v1/distributions/${d.id}`);
      toast('Đã xóa distribution');
      load();
    } catch (e: any) { toast(e.message, true); }
  }

  return (
    <div>
      <div className="sec-head">
        <h1>🛰 Distributions (SFTP)</h1>
        <div className="tools">
          <button className="btn btn-primary" onClick={() => setForm(null)}>＋ Tạo distribution</button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '-12px 0 18px', lineHeight: 1.6 }}>
        Mỗi distribution là một kênh <b>SFTP</b> để đối tác đẩy <b>DDEX ERN XML + audio</b> vào thư
        mục <span className="mono">incoming/</span>. Xác thực bằng <b>SSH key</b> — không dùng mật khẩu.
      </p>

      {loading ? (
        <p className="empty-note">Đang tải…</p>
      ) : (
        <>
          <SftpBanner s={sftp} />
          {items.length ? (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tên</th><th>DPID</th><th>SFTP user</th><th>Fingerprint key</th>
                    <th>Auto-publish</th><th>Deliveries</th><th>Lần nhận cuối</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(d => (
                    <tr key={d.id}>
                      <td>{d.name}<div className="sub">{d.contact_email || ''}</div></td>
                      <td className="mono">{d.dpid || '—'}</td>
                      <td className="mono">{d.sftp_username || '—'}</td>
                      <td className="mono">{fpShort(d.ssh_fingerprint)}</td>
                      <td>
                        {d.auto_publish
                          ? <span className="badge live">Bật</span>
                          : <span className="badge draft">Tắt — qua duyệt</span>}
                      </td>
                      <td>{fmtCount(d.delivery_count)}</td>
                      <td className="sub">{clip16(d.last_delivery_at)}</td>
                      <td className="actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setConnDist(d)}>Kết nối</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setDelivDist(d)}>Deliveries</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => rotateKey(d)}>🔑 Cấp lại key</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setForm(d)}>Sửa</button>
                        <button className="btn btn-danger btn-sm" onClick={() => del(d)}>Xóa</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel empty-note">
              Chưa có distribution nào — bấm "＋ Tạo distribution" để tạo kênh SFTP đầu tiên
            </div>
          )}
        </>
      )}

      {form !== false && (
        <DistForm
          dist={form}
          onClose={() => setForm(false)}
          onSaved={() => { setForm(false); load(); }}
          onCreated={res => { setForm(false); load(); setKeypair(res); }}
        />
      )}

      {keypair && (
        <KeypairModal data={{ ...keypair, sftp: keypair.sftp || sftp }} onClose={() => setKeypair(null)} />
      )}

      {connDist && (
        <ConnModal dist={connDist} sftp={sftp} onClose={() => setConnDist(null)} />
      )}

      {delivDist && (
        <DeliveriesModal dist={delivDist} onClose={() => setDelivDist(null)} />
      )}
    </div>
  );
}

function DistForm({ dist, onClose, onSaved, onCreated }: {
  dist: Dist | null;
  onClose: () => void;
  onSaved: () => void;
  onCreated: (res: KeypairData) => void;
}) {
  const editing = !!dist;
  const [name, setName] = useState(dist?.name || '');
  const [dpid, setDpid] = useState(dist?.dpid || '');
  const [email, setEmail] = useState(dist?.contact_email || '');
  const [autoPublish, setAutoPublish] = useState(!!dist?.auto_publish);
  const [keyMode, setKeyMode] = useState<'server' | 'own'>('server');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body: any = {
      name, dpid: dpid || null, contact_email: email || null, auto_publish: autoPublish,
    };
    try {
      if (editing) {
        await api.patch(`/admin/v1/distributions/${dist!.id}`, body);
        toast('Đã lưu');
        onSaved();
      } else {
        if (keyMode === 'own') {
          const pk = publicKey.trim();
          if (!pk) throw new Error('Chưa dán public key của đối tác');
          body.public_key = pk;
        }
        const res = await api.post('/admin/v1/distributions', body);
        onCreated({ ...res, name });
      }
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal title={editing ? 'Sửa distribution' : 'Tạo distribution SFTP'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Tên distribution *</label>
          <input required value={name} onChange={e => setName(e.target.value)} placeholder="VD: Believe Digital" />
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

        {!editing && (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <label>SSH key</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="radio" name="key_mode" style={{ width: 'auto' }}
                    checked={keyMode === 'server'} onChange={() => setKeyMode('server')} />
                  Server tạo cặp SSH key cho tôi
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="radio" name="key_mode" style={{ width: 'auto' }}
                    checked={keyMode === 'own'} onChange={() => setKeyMode('own')} />
                  Tôi dán public key của đối tác
                </label>
              </div>
            </div>
            {keyMode === 'own' && (
              <div className="field">
                <label>Public key của đối tác (OpenSSH: ssh-ed25519 / ssh-rsa …)</label>
                <textarea rows={3} value={publicKey} onChange={e => setPublicKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAA… partner@host"
                  style={{ fontFamily: 'Consolas, monospace' }} />
              </div>
            )}
          </>
        )}

        <div className="form-error">{error}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn btn-primary">{editing ? 'Lưu' : 'Tạo distribution'}</button>
        </div>
      </form>
    </Modal>
  );
}

function KeypairModal({ data, onClose }: { data: KeypairData; onClose: () => void }) {
  const sftp = data.sftp || {};
  const host = sftp.host || '—';
  const port = sftp.port ?? 22;
  const user = data.sftp_username || '—';
  const pub = data.ssh_public_key || '';
  const fp = data.ssh_fingerprint || '';
  const hasPriv = !!data.private_key;
  const cmd = `sftp -i private_key.pem -P ${port} ${user}@${host}`;

  return (
    <Modal title={'🔑 SSH key' + (data.name ? ' — ' + data.name : '')} onClose={onClose} wide>
      {hasPriv ? (
        <div className="field">
          <p style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 12 }}>
            ⚠ Private key chỉ hiển thị <b>MỘT LẦN</b> (server không lưu lại) — tải về hoặc sao chép
            và gửi cho đối tác qua kênh an toàn ngay bây giờ.
          </p>
          <label>Private key (.pem)</label>
          <div className="keybox">{data.private_key}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => downloadPem(data.private_key!, user)}>⬇ Tải .pem</button>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => copyText(data.private_key!, 'private key')}>Sao chép private key</button>
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
          Đối tác tự tạo cặp key nên hệ thống chỉ lưu <b>public key</b> — không có private key ở đây.
        </p>
      )}

      <div className="field">
        <label>Public key (OpenSSH)</label>
        <div className="keybox" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ flex: 1 }}>{pub || '—'}</span>
          {pub && (
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => copyText(pub, 'public key')}>Sao chép</button>
          )}
        </div>
      </div>
      <div className="field">
        <label>Fingerprint</label>
        <div className="keybox">{fp || '—'}</div>
      </div>

      <ConnGuide host={host} port={port} user={user} cmd={cmd} />
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>{hasPriv ? 'Đã lưu key' : 'Đóng'}</button>
      </div>
    </Modal>
  );
}

function ConnModal({ dist, sftp, onClose }: { dist: Dist; sftp: SftpInfo | null; onClose: () => void }) {
  const s = sftp || {};
  const host = s.host || '—';
  const port = s.port ?? 22;
  const user = dist.sftp_username || '—';
  const cmd = `sftp -i private_key.pem -P ${port} ${user}@${host}`;
  return (
    <Modal title={`🔌 Kết nối SFTP — ${dist.name}`} onClose={onClose}>
      {!s.enabled && (
        <p style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 12 }}>
          ⚠ SFTP server đang TẮT — đối tác chưa kết nối được cho tới khi bật.
        </p>
      )}
      <div style={kvGrid}>
        <KV label="Host">{host}</KV>
        <KV label="Port">{port}</KV>
        <KV label="Username">{user}</KV>
        <KV label="Fingerprint key">{dist.ssh_fingerprint || '—'}</KV>
        <KV label="Host key fingerprint" wide>{s.host_key_fingerprint || '—'}</KV>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '12px 0 6px' }}>Mẫu lệnh kết nối:</p>
      <div className="keybox">{cmd}</div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 10 }}>
        Đưa file <b>DDEX ERN XML</b> + <b>audio</b> vào thư mục <span className="mono">incoming/</span>{' '}
        để hệ thống nhận và import.
      </p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
      </div>
    </Modal>
  );
}

interface DistDelivery {
  id: string;
  message_id?: string | null;
  message_type?: string | null;
  ern_version?: string | null;
  status: string;
  received_at?: string | null;
  processed_at?: string | null;
}
function DeliveriesModal({ dist, onClose }: { dist: Dist; onClose: () => void }) {
  const [rows, setRows] = useState<DistDelivery[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/admin/v1/distributions/${dist.id}/deliveries`)
      .then(data => setRows(data.items || []))
      .catch((e: any) => setError(e.message));
  }, [dist.id]);

  return (
    <Modal title={`📥 Deliveries — ${dist.name}`} onClose={onClose} wide>
      {error ? (
        <p className="empty-note">{error}</p>
      ) : rows === null ? (
        <p className="empty-note">Đang tải…</p>
      ) : rows.length ? (
        <div className="tbl-wrap" style={{ border: 'none', maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>MessageId</th><th>Loại</th><th>Trạng thái</th>
                <th>Nhận lúc</th><th>Xử lý lúc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id}>
                  <td className="mono">{d.message_id || '—'}</td>
                  <td>
                    {(d.message_type || '—').replace('Message', '')}
                    <div className="sub">ERN {d.ern_version || '?'}</div>
                  </td>
                  <td><Badge status={d.status} /></td>
                  <td className="sub">{clip16(d.received_at)}</td>
                  <td className="sub">{clip16(d.processed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-note">Chưa nhận delivery nào từ distribution này</p>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
      </div>
    </Modal>
  );
}
