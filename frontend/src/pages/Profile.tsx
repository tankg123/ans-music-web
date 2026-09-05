import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, auth, assetUrl } from '../api';
import { useAuth } from '../useAuth';

const panel: React.CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  borderRadius: 14, padding: 22, marginBottom: 20,
};
const inp: React.CSSProperties = {
  width: '100%', padding: '11px 13px', background: 'var(--bg-elev2)',
  border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 14,
  outline: 'none', color: 'var(--text)', marginBottom: 12,
};
const pill: React.CSSProperties = {
  display: 'inline-block', padding: '4px 11px', borderRadius: 999,
  fontSize: 12, fontWeight: 700,
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Quản trị viên', manager: 'Quản lý', uploader: 'Người tải lên', user: 'Thành viên',
};
const PLAN_LABEL: Record<string, string> = {
  free: 'Miễn phí', pro: 'Pro', premium: 'Premium', vip: 'VIP',
};

interface Stats { playlists: number; favorites: number; follows: number; plays: number }
interface ProfileData {
  id: string; email: string; display_name: string; role: string; plan: string;
  avatar_url: string | null; created_at: string | null;
  email_verified: boolean; totp_enabled: boolean; stats: Stats;
}
interface SetupData { secret: string; otpauth: string; qr_svg: string; issuer_label: string }

function Note({ text, err }: { text: string; err?: boolean }) {
  if (!text) return null;
  return <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: err ? 'var(--danger)' : 'var(--ok)' }}>{text}</div>;
}

export default function Profile() {
  const { loggedIn, user } = useAuth();
  const [p, setP] = useState<ProfileData | null>(null);

  // sửa tên
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState('');
  const [nameMsg, setNameMsg] = useState('');

  // avatar
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avaMsg, setAvaMsg] = useState('');

  // đổi mật khẩu
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwMsg, setPwMsg] = useState({ text: '', err: false });

  // 2FA
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [twoMsg, setTwoMsg] = useState({ text: '', err: false });
  const [showDisable, setShowDisable] = useState(false);
  const [disPw, setDisPw] = useState('');
  const [disCode, setDisCode] = useState('');

  useEffect(() => {
    if (!loggedIn) return;
    api.get<ProfileData>('/v1/me/profile')
      .then(d => { setP(d); setName(d.display_name); })
      .catch(() => setP(null));
  }, [loggedIn]);

  if (!loggedIn || !user) {
    return (
      <div className="page">
        <h1 className="page-title">Hồ sơ</h1>
        <div className="empty">Vui lòng <Link to="/login" style={{ color: 'var(--accent)' }}>đăng nhập</Link> để xem hồ sơ của bạn.</div>
      </div>
    );
  }
  if (!p) return <div className="empty">Đang tải…</div>;

  const letter = (p.display_name || p.email || '?')[0].toUpperCase();

  const saveName = async () => {
    const v = name.trim();
    if (!v) { setNameMsg('Tên không được để trống'); return; }
    try {
      await api.patch('/v1/me', { display_name: v });
      auth.set(auth.token!, { ...user, display_name: v });
      setP({ ...p, display_name: v });
      setEditName(false); setNameMsg('');
    } catch (e: any) { setNameMsg(e.message); }
  };

  const onAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const form = new FormData();
    form.append('file', f);
    try {
      const r = await api.upload<{ ok: boolean; avatar_url: string }>('/v1/me/avatar', form);
      auth.set(auth.token!, { ...user, avatar_url: r.avatar_url });
      setP({ ...p, avatar_url: r.avatar_url });
      setAvaMsg('');
    } catch (err: any) { setAvaMsg(err.message); }
  };

  const changePw = async () => {
    if (newPw.length < 6) { setPwMsg({ text: 'Mật khẩu mới tối thiểu 6 ký tự', err: true }); return; }
    if (newPw !== confPw) { setPwMsg({ text: 'Xác nhận mật khẩu không khớp', err: true }); return; }
    try {
      const r = await api.post<{ token: string; message: string }>('/v1/me/password', {
        current_password: curPw, new_password: newPw,
      });
      auth.set(r.token, user); // giữ phiên hiện tại bằng token mới
      setCurPw(''); setNewPw(''); setConfPw('');
      setPwMsg({ text: r.message || 'Đã đổi mật khẩu', err: false });
    } catch (e: any) { setPwMsg({ text: e.message, err: true }); }
  };

  const startSetup = async () => {
    setTwoMsg({ text: '', err: false });
    try {
      const d = await api.post<SetupData>('/v1/me/2fa/setup');
      setSetup(d); setCode('');
    } catch (e: any) { setTwoMsg({ text: e.message, err: true }); }
  };
  const enable2fa = async () => {
    try {
      await api.post('/v1/me/2fa/enable', { code: code.trim() });
      setP({ ...p, totp_enabled: true });
      setSetup(null); setCode('');
      setTwoMsg({ text: 'Đã bật xác thực 2 lớp', err: false });
    } catch (e: any) { setTwoMsg({ text: e.message, err: true }); }
  };
  const disable2fa = async () => {
    try {
      await api.post('/v1/me/2fa/disable', { password: disPw, code: disCode.trim() });
      setP({ ...p, totp_enabled: false });
      setShowDisable(false); setDisPw(''); setDisCode('');
      setTwoMsg({ text: 'Đã tắt xác thực 2 lớp', err: false });
    } catch (e: any) { setTwoMsg({ text: e.message, err: true }); }
  };

  const statCards: [string, number][] = [
    ['Playlist', p.stats.playlists],
    ['Đã thích', p.stats.favorites],
    ['Đang theo dõi', p.stats.follows],
    ['Lượt nghe', p.stats.plays],
  ];

  return (
    <div className="page">
      <h1 className="page-title">Hồ sơ của tôi</h1>

      {/* HERO */}
      <div style={{ ...panel, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 120, height: 120, borderRadius: '50%', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent)', color: '#fff', fontSize: 48, fontWeight: 800,
          }}>
            {p.avatar_url ? <img src={assetUrl(p.avatar_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : letter}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            title="Đổi ảnh đại diện"
            style={{
              position: 'absolute', right: 2, bottom: 2, width: 36, height: 36, borderRadius: '50%',
              border: '2px solid var(--bg-elev)', background: 'var(--bg-elev2)', color: 'var(--text)',
              cursor: 'pointer', fontSize: 16,
            }}>📷</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatar} />
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          {editName ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <input value={name} onChange={e => setName(e.target.value)} style={{ ...inp, marginBottom: 0, width: 260 }} />
              <button className="btn btn-primary" onClick={saveName}>Lưu</button>
              <button className="btn" style={{ background: 'var(--bg-elev2)' }}
                onClick={() => { setEditName(false); setName(p.display_name); setNameMsg(''); }}>Hủy</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 28, fontWeight: 900 }}>{p.display_name}</h2>
              <button className="btn" style={{ background: 'var(--bg-elev2)', padding: '7px 14px' }}
                onClick={() => setEditName(true)}>✎ Sửa tên</button>
            </div>
          )}
          <Note text={nameMsg} err />
          <div style={{ color: 'var(--muted)', marginTop: 6 }}>{p.email}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ ...pill, background: 'color-mix(in srgb, var(--accent) 22%, transparent)', color: 'var(--text)' }}>
              {ROLE_LABEL[p.role] || p.role}
            </span>
            <span style={{ ...pill, background: 'color-mix(in srgb, var(--accent2) 22%, transparent)', color: 'var(--text)' }}>
              Gói {PLAN_LABEL[p.plan] || p.plan}
            </span>
            <span style={{ ...pill, background: p.email_verified ? 'color-mix(in srgb, var(--ok) 22%, transparent)' : 'color-mix(in srgb, var(--danger) 22%, transparent)', color: 'var(--text)' }}>
              {p.email_verified ? '✓ Email đã xác minh' : 'Email chưa xác minh'}
            </span>
            {p.totp_enabled && (
              <span style={{ ...pill, background: 'color-mix(in srgb, var(--ok) 22%, transparent)', color: 'var(--text)' }}>🔒 2FA đang bật</span>
            )}
          </div>
          <Note text={avaMsg} err />
        </div>
      </div>

      {/* STATS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 20 }}>
        {statCards.map(([label, n]) => (
          <div key={label} style={{ ...panel, marginBottom: 0, textAlign: 'center' }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: 'var(--accent)' }}>{(n || 0).toLocaleString('vi-VN')}</div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ĐỔI MẬT KHẨU */}
      <div style={panel}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>Đổi mật khẩu</h2>
        <input type="password" placeholder="Mật khẩu hiện tại" style={inp}
          value={curPw} onChange={e => setCurPw(e.target.value)} autoComplete="current-password" />
        <input type="password" placeholder="Mật khẩu mới (tối thiểu 6 ký tự)" style={inp}
          value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" />
        <input type="password" placeholder="Nhập lại mật khẩu mới" style={inp}
          value={confPw} onChange={e => setConfPw(e.target.value)} autoComplete="new-password" />
        <button className="btn btn-primary" onClick={changePw}
          disabled={!curPw || !newPw}>Cập nhật mật khẩu</button>
        <Note text={pwMsg.text} err={pwMsg.err} />
      </div>

      {/* 2FA */}
      <div style={panel}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Xác thực 2 lớp (2FA)</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 14 }}>
          Bảo vệ tài khoản bằng mã một lần từ ứng dụng Google Authenticator.
        </p>

        {!p.totp_enabled && !setup && (
          <button className="btn btn-primary" onClick={startSetup}>Thiết lập 2FA</button>
        )}

        {!p.totp_enabled && setup && (
          <div>
            <p style={{ fontSize: 13.5, marginBottom: 10 }}>
              Quét mã QR bằng Google Authenticator, sau đó nhập mã 6 số để xác nhận:
            </p>
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ background: '#fff', padding: 12, borderRadius: 12, width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
              <div style={{ minWidth: 240 }}>
                <div style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 4 }}>Mã bí mật (nhập tay nếu không quét được):</div>
                <div className="mono" style={{ background: 'var(--bg-elev2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', wordBreak: 'break-all', marginBottom: 12, fontSize: 13 }}>{setup.secret}</div>
                <input placeholder="Mã 6 số" inputMode="numeric" maxLength={6} style={inp}
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={enable2fa} disabled={code.length < 6}>Bật 2FA</button>
                  <button className="btn" style={{ background: 'var(--bg-elev2)' }}
                    onClick={() => { setSetup(null); setCode(''); setTwoMsg({ text: '', err: false }); }}>Hủy</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {p.totp_enabled && !showDisable && (
          <button className="btn" style={{ background: 'var(--danger)', color: '#fff' }}
            onClick={() => { setShowDisable(true); setTwoMsg({ text: '', err: false }); }}>Tắt 2FA</button>
        )}

        {p.totp_enabled && showDisable && (
          <div style={{ maxWidth: 320 }}>
            <p style={{ fontSize: 13.5, marginBottom: 10 }}>Nhập mật khẩu và mã 2FA hiện tại để tắt:</p>
            <input type="password" placeholder="Mật khẩu" style={inp}
              value={disPw} onChange={e => setDisPw(e.target.value)} />
            <input placeholder="Mã 6 số" inputMode="numeric" maxLength={6} style={inp}
              value={disCode} onChange={e => setDisCode(e.target.value.replace(/\D/g, ''))} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ background: 'var(--danger)', color: '#fff' }}
                onClick={disable2fa} disabled={!disPw || disCode.length < 6}>Xác nhận tắt</button>
              <button className="btn" style={{ background: 'var(--bg-elev2)' }}
                onClick={() => { setShowDisable(false); setDisPw(''); setDisCode(''); }}>Hủy</button>
            </div>
          </div>
        )}
        <Note text={twoMsg.text} err={twoMsg.err} />
      </div>
    </div>
  );
}
