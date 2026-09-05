/** Tài khoản — danh sách + tạo/sửa/đặt lại mật khẩu/tắt 2FA/xóa (chỉ admin). */
import { useEffect, useState, type ReactNode } from 'react';
import { api, assetUrl } from '../../api';
import { SecHead, Modal, fmtCount, fmtDate, toast } from '../ui';

interface UserRow {
  id: string; email: string; display_name: string | null; role: string; plan: string;
  created_at: string | null; avatar_url: string | null; email_verified: boolean;
  totp_enabled: boolean; playlists: number; plays: number;
}

const ROLES = ['user', 'uploader', 'manager', 'admin'];
const ROLE_LABEL: Record<string, string> = { user: 'User', uploader: 'Uploader', manager: 'Manager', admin: 'Admin' };
const ROLE_DESC: Record<string, string> = {
  user: 'Nghe nhạc, tạo playlist — không vào được CMS',
  uploader: 'Upload nhạc, phát hành phải qua duyệt',
  manager: 'Duyệt phát hành, sửa mọi nội dung',
  admin: 'Toàn quyền',
};

function roleBadge(role: string): ReactNode {
  const cls = ROLES.includes(role) ? role : 'user';
  return <span className={'role-badge ' + cls}>{ROLE_LABEL[role] || role}</span>;
}

function Avatar({ u }: { u: UserRow }) {
  if (u.avatar_url) return <img className="thumb" src={assetUrl(u.avatar_url)} alt="" />;
  const letter = (u.display_name || u.email || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="thumb" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
      background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 800,
    }}>{letter}</span>
  );
}

/** Select vai trò + mô tả ngắn phía dưới (dùng chung modal tạo/sửa). */
function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <select name="role" value={value} onChange={e => onChange(e.target.value)}>
        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <div className="sub" style={{ marginTop: 6 }}>{ROLE_DESC[value] || ''}</div>
    </>
  );
}

export default function Users() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  // modal đang mở: kiểu + user mục tiêu
  const [modal, setModal] = useState<{ kind: 'create' | 'edit' | 'reset' | 'delete'; user?: UserRow } | null>(null);

  async function load(sq = q, sr = role) {
    setLoading(true);
    try {
      const data = await api.get<{ items: UserRow[] }>(
        `/admin/v1/users?q=${encodeURIComponent(sq)}&role=${encodeURIComponent(sr)}`);
      setItems(data.items || []);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }

  // tìm kiếm có debounce; đổi role load ngay
  useEffect(() => {
    const t = setTimeout(() => { load(q, role); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, role]);

  const reload = () => load();

  async function disable2fa(u: UserRow) {
    if (!window.confirm(`Tắt xác thực 2 lớp của “${u.email}”?\nDùng khi người dùng mất thiết bị xác thực.`)) return;
    try {
      await api.post(`/admin/v1/users/${u.id}/disable-2fa`);
      toast('Đã tắt 2FA của tài khoản');
      reload();
    } catch (e: any) { toast(e.message, true); }
  }

  return (
    <div className="a-section">
      <SecHead title="👥 Tài khoản">
        <input type="search" placeholder="Tìm email / tên…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="">Tất cả vai trò</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => setModal({ kind: 'create' })}>＋ Tạo tài khoản</button>
      </SecHead>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Tài khoản</th><th>Email</th><th>Vai trò</th><th>Gói</th><th>2FA</th>
              <th style={{ textAlign: 'right' }}>Playlist</th><th style={{ textAlign: 'right' }}>Lượt nghe</th>
              <th>Tham gia</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="empty-note">Đang tải…</td></tr>
            ) : items.length ? items.map(u => (
              <tr key={u.id}>
                <td><div className="cell-main"><Avatar u={u} /><div>{u.display_name || '—'}</div></div></td>
                <td className="mono">{u.email}</td>
                <td>{roleBadge(u.role)}</td>
                <td>{u.plan === 'premium' ? <span className="badge pending_review">Premium</span> : 'Free'}</td>
                <td>{u.totp_enabled ? <span className="badge" style={{ color: 'var(--ok)' }}>🛡 Bật</span> : <span className="sub">—</span>}</td>
                <td style={{ textAlign: 'right' }}>{fmtCount(u.playlists)}</td>
                <td style={{ textAlign: 'right' }}>{fmtCount(u.plays)}</td>
                <td className="sub">{fmtDate(u.created_at || undefined)}</td>
                <td className="actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: 'edit', user: u })}>Sửa</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: 'reset', user: u })}>Đặt lại MK</button>
                  {u.totp_enabled && <button className="btn btn-ghost btn-sm" onClick={() => disable2fa(u)}>Tắt 2FA</button>}
                  <button className="btn btn-danger btn-sm" onClick={() => setModal({ kind: 'delete', user: u })}>Xóa</button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={9} className="empty-note">Không tìm thấy tài khoản nào</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.kind === 'create' && (
        <UserFormModal onClose={() => setModal(null)} onDone={reload} />
      )}
      {modal?.kind === 'edit' && modal.user && (
        <UserFormModal user={modal.user} onClose={() => setModal(null)} onDone={reload} />
      )}
      {modal?.kind === 'reset' && modal.user && (
        <ResetPassModal user={modal.user} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'delete' && modal.user && (
        <DeleteModal user={modal.user} onClose={() => setModal(null)} onDone={reload} />
      )}
    </div>
  );
}

/* ---- Modal tạo / sửa tài khoản ---- */
function UserFormModal({ user, onClose, onDone }: { user?: UserRow; onClose: () => void; onDone: () => void }) {
  const editing = !!user;
  const [email] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [emailInput, setEmailInput] = useState('');
  const [role, setRole] = useState(user?.role || 'user');
  const [plan, setPlan] = useState(user?.plan === 'premium' ? 'premium' : 'free');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      if (editing) {
        await api.patch(`/admin/v1/users/${user!.id}`, { display_name: displayName, role, plan });
        toast('Đã lưu thay đổi');
      } else {
        await api.post('/admin/v1/users', {
          email: emailInput, password, display_name: displayName, role, plan,
        });
        toast('Đã tạo tài khoản');
      }
      onClose();
      onDone();
    } catch (ex: any) {
      setErr(ex.message);
    }
  }

  return (
    <Modal title={editing ? 'Sửa tài khoản' : '＋ Tạo tài khoản'} onClose={onClose}>
      {editing && <p className="mono" style={{ color: 'var(--muted)', fontSize: 13, margin: '-8px 0 16px' }}>{email}</p>}
      <form onSubmit={submit}>
        {!editing && (
          <div className="field"><label>Email *</label>
            <input type="email" required placeholder="ten@example.com" value={emailInput} onChange={e => setEmailInput(e.target.value)} /></div>
        )}
        <div className="grid2">
          {!editing && (
            <div className="field"><label>Mật khẩu *</label>
              <input type="password" required minLength={6} placeholder="Tối thiểu 6 ký tự" value={password} onChange={e => setPassword(e.target.value)} /></div>
          )}
          <div className="field"><label>Tên hiển thị{editing ? '' : ''}</label>
            <input required={editing} placeholder={editing ? '' : 'Để trống = lấy từ email'} value={displayName} onChange={e => setDisplayName(e.target.value)} /></div>
        </div>
        <div className="grid2">
          <div className="field"><label>Vai trò</label><RoleSelect value={role} onChange={setRole} /></div>
          <div className="field"><label>Gói</label>
            <select value={plan} onChange={e => setPlan(e.target.value)}>
              <option value="free">Free</option>
              <option value="premium">Premium</option>
            </select></div>
        </div>
        <div className="form-error">{err}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn btn-primary">{editing ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Modal đặt lại mật khẩu ---- */
function ResetPassModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p1 !== p2) { setErr('Hai mật khẩu không khớp'); return; }
    setErr('');
    try {
      await api.post(`/admin/v1/users/${user.id}/reset-password`, { new_password: p1 });
      toast('Đã đặt mật khẩu mới');
      onClose();
    } catch (ex: any) { setErr(ex.message); }
  }

  return (
    <Modal title="Đặt lại mật khẩu" onClose={onClose}>
      <p className="mono" style={{ color: 'var(--muted)', fontSize: 13, margin: '-8px 0 16px' }}>{user.email}</p>
      <form onSubmit={submit}>
        <div className="field"><label>Mật khẩu mới *</label>
          <input type="password" required minLength={6} placeholder="Tối thiểu 6 ký tự" value={p1} onChange={e => setP1(e.target.value)} /></div>
        <div className="field"><label>Nhập lại mật khẩu mới *</label>
          <input type="password" required minLength={6} value={p2} onChange={e => setP2(e.target.value)} /></div>
        <div className="form-error">{err}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn btn-primary">Đặt mật khẩu</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Modal xóa tài khoản — xác nhận bằng cách gõ đúng email ---- */
function DeleteModal({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [err, setErr] = useState('');
  const matched = confirmEmail.trim().toLowerCase() === (user.email || '').toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!matched) return;
    if (!window.confirm(`Xác nhận lần cuối: xóa vĩnh viễn “${user.email}”?`)) return;
    setErr('');
    try {
      await api.del(`/admin/v1/users/${user.id}`);
      toast('Đã xóa tài khoản');
      onClose();
      onDone();
    } catch (ex: any) { setErr(ex.message); }
  }

  return (
    <Modal title="⚠ Xóa tài khoản" onClose={onClose}>
      <p style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 14 }}>
        Xóa vĩnh viễn <b>{user.email}</b> cùng toàn bộ playlist, yêu thích, lịch sử nghe.
        Nội dung đã phát hành (product) được giữ lại. <b>Không thể hoàn tác.</b>
      </p>
      <form onSubmit={submit}>
        <div className="field"><label>Gõ chính xác email của tài khoản để xác nhận</label>
          <input autoComplete="off" placeholder={user.email} value={confirmEmail} onChange={e => setConfirmEmail(e.target.value)} /></div>
        <div className="form-error">{err}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn btn-danger" disabled={!matched}>Xóa vĩnh viễn</button>
        </div>
      </form>
    </Modal>
  );
}
