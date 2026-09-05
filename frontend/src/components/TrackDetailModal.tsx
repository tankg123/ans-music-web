/** Modal thông tin chi tiết bài hát — GET /v1/tracks/:id.
 *  Hiển thị bìa + tựa, nghệ sĩ gom theo vai trò (credits), album, hãng phát hành,
 *  ISRC, UPC, thể loại, thời lượng, ngôn ngữ, ℗ p_line, lượt nghe.
 *  Đóng bằng X / nền / Esc. Bố cục portal ra body để không bị cắt bởi overflow. */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { useLang } from '../i18n';
import './cards3d.css';

/* Nhãn vai trò DDEX → tên hiển thị song ngữ (bám theo bản legacy). */
const ROLE_LABELS: Record<'vi' | 'en', Record<string, string>> = {
  vi: {
    MainArtist: 'Nghệ sĩ chính', FeaturedArtist: 'Nghệ sĩ hợp tác',
    Composer: 'Sáng tác', Lyricist: 'Viết lời', Producer: 'Sản xuất',
    Arranger: 'Hòa âm phối khí', Remixer: 'Phối lại', Conductor: 'Chỉ huy',
    Mixer: 'Hòa âm', Engineer: 'Kỹ thuật', Performer: 'Trình bày',
  },
  en: {
    MainArtist: 'Main artist', FeaturedArtist: 'Featured artist',
    Composer: 'Composer', Lyricist: 'Lyricist', Producer: 'Producer',
    Arranger: 'Arranger', Remixer: 'Remixer', Conductor: 'Conductor',
    Mixer: 'Mixer', Engineer: 'Engineer', Performer: 'Performer',
  },
};

function fmtDur(ms?: number): string {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function fmtCount(n?: number): string {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(v);
}

function langName(code: string | null | undefined, lang: 'vi' | 'en'): string {
  if (!code) return '';
  try { return new Intl.DisplayNames([lang], { type: 'language' }).of(code) || code; }
  catch { return code; }
}

export default function TrackDetailModal(
  { trackId, onClose }: { trackId: string; onClose: () => void },
) {
  const { t, lang } = useLang();
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null);
    api.get(`/v1/tracks/${trackId}`)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setErr(e?.message || t('notFound')); });
    return () => { alive = false; };
  }, [trackId, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const roleMap = (l: 'vi' | 'en') => ROLE_LABELS[l] || ROLE_LABELS.vi;
  const roleLabel = (r: string) => roleMap(lang)[r] || roleMap('vi')[r] || r;

  const row = (label: string, value: React.ReactNode, mono = false) =>
    value ? (
      <div className="det-row">
        <span className="det-k">{label}</span>
        <span className={'det-v' + (mono ? ' mono' : '')}>{value}</span>
      </div>
    ) : null;

  let inner: React.ReactNode;
  if (err) {
    inner = <div className="tdm-error">{err}</div>;
  } else if (!data) {
    inner = (
      <>
        <div className="tdm-head">
          <div className="tdm-cover" />
          <div><div className="tdm-title">{t('loading')}</div></div>
        </div>
        <div className="tdm-skel" style={{ width: '70%' }} />
        <div className="tdm-skel" style={{ width: '55%' }} />
        <div className="tdm-skel" style={{ width: '62%' }} />
        <div style={{ height: 18 }} />
      </>
    );
  } else {
    const rel = data.release || {};
    const pLine = data.p_line
      ? (String(data.p_line).trim().startsWith('℗') ? data.p_line : `℗ ${data.p_line}`)
      : '';

    // gom credits theo vai trò, giữ thứ tự API trả về
    const byRole = new Map<string, any[]>();
    (data.credits || []).forEach((c: any) => {
      if (!byRole.has(c.role)) byRole.set(c.role, []);
      byRole.get(c.role)!.push(c);
    });
    // fallback khi track không có bảng credits: dùng artists
    if (byRole.size === 0 && Array.isArray(data.artists) && data.artists.length) {
      byRole.set('MainArtist', data.artists);
    }
    const creditRows = Array.from(byRole.entries()).map(([role, list]) => (
      <div className="det-row" key={role}>
        <span className="det-k">{roleLabel(role)}</span>
        <span className="det-v">
          {list.map((a: any, i: number) => (
            <span key={a.id || i}>
              {i > 0 && ', '}
              {a.id
                ? <Link to={`/artist/${a.id}`} onClick={onClose}>{a.name}</Link>
                : a.name}
            </span>
          ))}
        </span>
      </div>
    ));

    inner = (
      <>
        <div className="tdm-head">
          <div className="tdm-cover">
            {data.cover_url && <img src={assetUrl(data.cover_url)} alt="" />}
          </div>
          <div>
            <div className="tdm-kicker">{t('details')}</div>
            <div className="tdm-title">
              {data.title}
              {data.explicit && <span className="badge-e" title="Explicit">E</span>}
            </div>
            {data.subtitle && <div className="tdm-sub">{data.subtitle}</div>}
          </div>
        </div>
        <div className="tdm-body">
          {creditRows}
          {row(t('toAlbum'), rel.id
            ? <Link to={`/album/${rel.id}`} onClick={onClose}>{rel.title}</Link> : null)}
          {row(t('label'), rel.label_name)}
          {row('ISRC', data.isrc, true)}
          {row('UPC', rel.upc, true)}
          {row(t('genre'), data.genre)}
          {row(t('duration'), data.duration_ms ? fmtDur(data.duration_ms) : null)}
          {row(t('language'), langName(data.language, lang === 'en' ? 'en' : 'vi'))}
          {row(t('plays'), fmtCount(data.play_count))}
          {pLine && <div className="det-lines">{pLine}</div>}
        </div>
      </>
    );
  }

  return createPortal(
    <div className="c3d-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tdm-modal" role="dialog" aria-modal="true">
        <button className="tdm-x" onClick={onClose} aria-label="Đóng">✕</button>
        {inner}
      </div>
    </div>,
    document.body,
  );
}
