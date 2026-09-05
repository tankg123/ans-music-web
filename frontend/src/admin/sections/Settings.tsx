/** Cài đặt thương hiệu — đổi tên web, logo, màu chủ đạo, tagline (chỉ admin). */
import { useEffect, useRef, useState } from 'react';
import { api, assetUrl } from '../../api';
import { SecHead, Empty, toast } from '../ui';

interface Brand {
  brand_name?: string; brand_short?: string; brand_suffix?: string;
  brand_tagline?: string; brand_accent?: string; brand_logo_url?: string;
  brand_favicon_url?: string;
}

const DEFAULT_ACCENT = '#7c5cff';
const FALLBACK_LOGO = '/favicon.svg';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function Settings() {
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [suffix, setSuffix] = useState('');
  const [tagline, setTagline] = useState('');
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [logoUrl, setLogoUrl] = useState<string>(FALLBACK_LOGO);
  const [faviconUrl, setFaviconUrl] = useState<string>(FALLBACK_LOGO);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [favOver, setFavOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const favRef = useRef<HTMLInputElement>(null);

  // favicon mặc định (/favicon.svg) là asset của frontend → giữ nguyên;
  // file upload nằm ở backend (/media/…) → cần assetUrl.
  const faviconSrc = (u?: string) => {
    const v = u || FALLBACK_LOGO;
    return v.startsWith('/media/') ? assetUrl(v) : v;
  };

  function apply(b: Brand) {
    setName(b.brand_name || '');
    setShort(b.brand_short || '');
    setSuffix(b.brand_suffix || '');
    setTagline(b.brand_tagline || '');
    setAccent(b.brand_accent || DEFAULT_ACCENT);
    setLogoUrl(assetUrl(b.brand_logo_url) || FALLBACK_LOGO);
    setFaviconUrl(faviconSrc(b.brand_favicon_url));
  }

  useEffect(() => {
    let alive = true;
    api.get<Brand>('/admin/v1/settings/brand')
      .then(b => { if (alive) { apply(b); setLoaded(true); } })
      .catch(e => { if (alive) setLoadErr(e.message); });
    return () => { alive = false; };
  }, []);

  const accentVal = accent.trim() || DEFAULT_ACCENT;

  async function save() {
    setErr('');
    try {
      await api.patch('/admin/v1/settings/brand', {
        brand_name: name.trim(), brand_short: short.trim(), brand_suffix: suffix.trim(),
        brand_tagline: tagline.trim(), brand_accent: accentVal,
      });
      toast('Đã lưu — tải lại trang (Ctrl+F5) để áp dụng');
    } catch (e: any) { setErr(e.message); }
  }

  async function reset() {
    if (!window.confirm('Về logo/tên/màu mặc định?')) return;
    try {
      const res = await api.post<{ brand: Brand }>('/admin/v1/settings/reset');
      apply(res.brand || {});
      toast('Đã về mặc định — tải lại trang');
    } catch (e: any) { toast(e.message, true); }
  }

  async function uploadLogo(f: File) {
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await api.upload<{ brand_logo_url: string }>('/admin/v1/settings/logo', fd);
      setLogoUrl(assetUrl(res.brand_logo_url) + '?t=' + Date.now());
      toast('Đã cập nhật logo — tải lại trang để áp dụng toàn site');
    } catch (e: any) { toast(e.message, true); }
  }

  async function uploadFavicon(f: File) {
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await api.upload<{ brand_favicon_url: string }>('/admin/v1/settings/favicon', fd);
      setFaviconUrl(assetUrl(res.brand_favicon_url) + '?t=' + Date.now());
      toast('Đã cập nhật favicon — tải lại trang (Ctrl+F5) để thấy icon mới trên tab');
    } catch (e: any) { toast(e.message, true); }
  }

  function onAccentText(v: string) {
    setAccent(v);
  }

  if (loadErr) return (<div className="a-section"><SecHead title="⚙ Cài đặt thương hiệu" /><Empty>{loadErr}</Empty></div>);
  if (!loaded) return (<div className="a-section"><SecHead title="⚙ Cài đặt thương hiệu" /><Empty>Đang tải…</Empty></div>);

  return (
    <div className="a-section">
      <SecHead title="⚙ Cài đặt thương hiệu" />
      <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '-12px 0 18px', lineHeight: 1.6 }}>
        Đổi logo, tên web, màu chủ đạo, khẩu hiệu. Lưu xong tải lại trang (Ctrl+F5) để thấy áp dụng toàn site.
      </p>

      <div className="two-col">
        <div className="panel">
          <h3>Nhận diện</h3>
          <div className="field"><label>Tên web (đầy đủ)</label>
            <input value={name} placeholder="ANS Music" onChange={e => setName(e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Phần đầu (đậm)</label>
              <input value={short} placeholder="ANS" onChange={e => setShort(e.target.value)} /></div>
            <div className="field"><label>Phần sau (tô màu)</label>
              <input value={suffix} placeholder="Music" onChange={e => setSuffix(e.target.value)} /></div>
          </div>
          <div className="field"><label>Khẩu hiệu (tagline)</label>
            <input value={tagline} placeholder="Nghe nhạc trực tuyến" onChange={e => setTagline(e.target.value)} /></div>
          <div className="field"><label>Màu chủ đạo (accent)</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="color" value={HEX_RE.test(accentVal) ? accentVal : DEFAULT_ACCENT}
                onChange={e => setAccent(e.target.value)} style={{ width: 52, height: 38, padding: 2 }} />
              <input value={accent} placeholder={DEFAULT_ACCENT}
                onChange={e => onAccentText(e.target.value)} style={{ flex: 1, textTransform: 'lowercase' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button className="btn btn-primary" onClick={save}>Lưu thay đổi</button>
            <button className="btn btn-ghost" onClick={reset}>Về mặc định</button>
          </div>
          <div className="form-error">{err}</div>
        </div>

        <div className="panel">
          <h3>Logo</h3>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
            <div style={{
              width: 88, height: 88, borderRadius: 16, background: 'var(--bg-elev2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              border: '1px solid var(--border)',
            }}>
              <img src={logoUrl} style={{ maxWidth: '100%', maxHeight: '100%' }} alt="" />
            </div>
            <div style={{ flex: 1 }}>
              <div className={'dropzone' + (over ? ' over' : '')} style={{ padding: 16 }}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) uploadLogo(f); }}>
                Kéo thả hoặc <b>chọn logo</b><br />
                <span style={{ fontSize: 12 }}>SVG / PNG (nền trong) / JPG · vuông đẹp nhất</span>
              </div>
              <input ref={fileRef} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
            </div>
          </div>

          <h3 style={{ marginTop: 14 }}>Xem trước</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: 'var(--bg-elev2)', borderRadius: 12 }}>
            <img src={logoUrl} width={34} height={34} style={{ borderRadius: 9, boxShadow: `0 0 0 2px ${accentVal}55` }} alt="" />
            <span style={{ fontSize: 19, fontWeight: 800 }}>
              {short.trim()
                ? <>{short.trim()} <b style={{ color: accentVal }}>{suffix.trim()}</b></>
                : (name.trim() || 'ANS Music')}
            </span>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h3>Favicon — icon trên tab trình duyệt</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '2px 0 14px', lineHeight: 1.6 }}>
          Icon nhỏ hiển thị trên tab Chrome/trình duyệt và khi lưu bookmark. Ảnh vuông 32×32 hoặc 64×64 đẹp nhất (ICO / PNG / SVG).
        </p>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* mô phỏng tab trình duyệt */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
            background: 'var(--bg-elev2)', border: '1px solid var(--border)',
            borderRadius: '10px 10px 0 0', minWidth: 210, maxWidth: 260,
          }}>
            <img src={faviconUrl} width={16} height={16} style={{ borderRadius: 3 }} alt="" />
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
              {name.trim() || 'ANS Music'}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 15 }}>×</span>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className={'dropzone' + (favOver ? ' over' : '')} style={{ padding: 16 }}
              onClick={() => favRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setFavOver(true); }}
              onDragLeave={() => setFavOver(false)}
              onDrop={e => { e.preventDefault(); setFavOver(false); const f = e.dataTransfer.files[0]; if (f) uploadFavicon(f); }}>
              Kéo thả hoặc <b>chọn favicon</b><br />
              <span style={{ fontSize: 12 }}>ICO / PNG / SVG · vuông 32×32 hoặc 64×64</span>
            </div>
            <input ref={favRef} type="file" accept=".ico,.png,.svg,.jpg,.jpeg,.webp" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadFavicon(f); e.target.value = ''; }} />
          </div>
        </div>
      </div>
    </div>
  );
}
