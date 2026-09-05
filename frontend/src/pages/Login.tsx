import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login, loginVerify2fa, registerRequest, registerConfirm, BRAND } from '../api';

type Mode = 'login' | 'register';
type Step = 'form' | 'code' | '2fa';

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'register') {
        const res: any = await registerRequest(email.trim(), pass, name.trim());
        setMsg(res.email_sent ? 'Đã gửi mã 6 số tới email của bạn.' : 'Chưa cấu hình email — xem mã ở console server.');
        setStep('code');
      } else {
        const res: any = await login(email.trim(), pass);
        if (res.requires_2fa) { setPending(res.pending); setStep('2fa'); }
        else nav('/');
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function confirmCode(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await registerConfirm(email.trim(), code.trim()); nav('/'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function confirm2fa(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await loginVerify2fa(pending, code.trim()); nav('/'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="login-shell">
      <div className="login-brand">
        <div className="lb-logo">{BRAND.brand_short || 'ANS'} <b>{BRAND.brand_suffix || 'Music'}</b></div>
        <h1>Âm nhạc của bạn.<br /><span>Mọi lúc, mọi nơi.</span></h1>
        <p>{BRAND.brand_tagline || 'Nghe nhạc trực tuyến'}</p>
      </div>
      <div className="login-form-wrap">
        <div className="login-card">
          {step === 'form' && <>
            <div className="mode-tabs">
              <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Đăng nhập</button>
              <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Tạo tài khoản</button>
            </div>
            <form onSubmit={submit}>
              {mode === 'register' && <input placeholder="Tên hiển thị" value={name} onChange={e => setName(e.target.value)} />}
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
              <input type="password" placeholder="Mật khẩu" value={pass} onChange={e => setPass(e.target.value)} required />
              {err && <div className="form-err">{err}</div>}
              <button className="btn btn-primary btn-full" disabled={busy}>{mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</button>
            </form>
          </>}
          {step === 'code' && <form onSubmit={confirmCode}>
            <h2>Xác thực email</h2>
            <p className="sub">{msg}</p>
            <input placeholder="Mã 6 số" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
            {err && <div className="form-err">{err}</div>}
            <button className="btn btn-primary btn-full" disabled={busy}>Xác nhận</button>
          </form>}
          {step === '2fa' && <form onSubmit={confirm2fa}>
            <h2>Xác thực 2 lớp</h2>
            <p className="sub">Nhập mã 6 số từ Google Authenticator</p>
            <input placeholder="Mã 6 số" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={6} autoFocus />
            {err && <div className="form-err">{err}</div>}
            <button className="btn btn-primary btn-full" disabled={busy}>Xác nhận</button>
          </form>}
          <Link to="/" className="back-link">← Về trang nghe nhạc</Link>
        </div>
      </div>
    </div>
  );
}
