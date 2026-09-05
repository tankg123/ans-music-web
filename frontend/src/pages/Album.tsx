import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { TrackList } from '../components/cards';
import { usePlayer, type Track } from '../player';
import { useLang } from '../i18n';
import './pages-extra.css';

/* nghiêng 3D theo con trỏ */
function useTilt(max = 11) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`);
  };
  const reset = () => {
    const el = ref.current; if (!el) return;
    el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
  };
  return { ref, onMouseMove: onMove, onMouseLeave: reset };
}

function ArtistLinks({ artists }: { artists?: any[] }) {
  const list = artists || [];
  if (!list.length) return null;
  return <>{list.map((a, i) => (
    <span key={a.id || i}>{i > 0 && ', '}<Link className="pe-alink" to={`/artist/${a.id}`}>{a.name}</Link></span>
  ))}</>;
}

const fmtLong = (ms?: number) => {
  const m = Math.round((ms || 0) / 60000);
  if (!m) return '';
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
};
const fmtDate = (d?: string) => {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (!m) return String(d);
  const dt = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' });
};
const pcLine = (a: any) => {
  const norm = (s: string, sym: string) => (String(s).trim().startsWith(sym) ? String(s).trim() : `${sym} ${s}`);
  return [a.p_line ? norm(a.p_line, '℗') : '', a.c_line ? norm(a.c_line, '©') : '']
    .filter(Boolean).join('  ·  ');
};

export default function Album() {
  const { id } = useParams();
  const { t } = useLang();
  const p = usePlayer();
  const tilt = useTilt();
  const [a, setA] = useState<any>(null);
  const [dling, setDling] = useState(false);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState(false);

  useEffect(() => { setA(null); api.get(`/v1/albums/${id}`).then(setA).catch(() => setA(false)); }, [id]);

  if (a === false) return <div className="pe-empty"><div className="pe-empty-ic">💿</div><h3>{t('notFound')}</h3></div>;
  if (!a) return <div className="empty">{t('loading')}</div>;

  const tracks: Track[] = a.tracks || [];
  const accent = a.accent || 'var(--accent)';
  const year = (a.release_date || '').slice(0, 4);

  const flash = (msg: string, err = false) => {
    setNote(msg); setNoteErr(err);
    window.setTimeout(() => setNote(''), 4000);
  };
  const downloadAlbum = async () => {
    setDling(true);
    try {
      const res = await api.get<{ url: string; track_count: number }>(`/v1/albums/${id}/download`);
      const link = document.createElement('a');
      link.href = assetUrl(res.url); link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
      flash(`Đang đóng gói ${res.track_count} bài (ZIP)…`);
    } catch (e: any) { flash(e.message || 'Không tải được album', true); }
    finally { setDling(false); }
  };

  const meta: [string, React.ReactNode, boolean?][] = [
    ['Loại phát hành', a.release_type ? String(a.release_type).toUpperCase() : '', false],
    ['Nghệ sĩ chính', a.artists?.length ? <ArtistLinks artists={a.artists} /> : '', false],
    [t('label'), a.label_name || '', false],
    ['UPC', a.upc || '', true],
    [t('releaseDate'), fmtDate(a.release_date), false],
    [t('genre'), a.genre || '', false],
    [t('duration'), fmtLong(a.total_duration_ms), false],
  ];
  const cLine = pcLine(a);

  return (
    <div className="page pe-scope" style={{ ['--pg-accent' as any]: accent }}>
      <div className="pe-hero">
        <div className="pe-cover" {...tilt}>
          {a.cover_url ? <img src={assetUrl(a.cover_url)} alt={a.title} />
            : <div className="pe-cover-ph">{(a.title || '?')[0]}</div>}
        </div>
        <div className="pe-hero-info">
          <div className="pe-type">{a.release_type || 'Album'}</div>
          <h1 className="pe-title">{a.title}</h1>
          <div className="pe-submeta">
            <b><ArtistLinks artists={a.artists} /></b>
            {year && <><span className="pe-dot">·</span><span>{year}</span></>}
            <span className="pe-dot">·</span>
            <span>{tracks.length} bài{fmtLong(a.total_duration_ms) ? `, ${fmtLong(a.total_duration_ms)}` : ''}</span>
          </div>
          <div className="pe-actions">
            <button className="pe-play-big" title={t('play')}
              onClick={() => tracks.length && p.play(tracks, 0)}>▶</button>
            <button className="pe-btn" onClick={downloadAlbum} disabled={dling}>
              ⬇ {dling ? t('loading') : t('downloadAlbum')}
            </button>
            {note && <span className={'pe-note' + (noteErr ? ' err' : '')}>{note}</span>}
          </div>
        </div>
      </div>

      {(meta.some(([, v]) => v) || cLine) && (
        <div className="pe-meta">
          {meta.map(([k, v, mono], i) => v ? (
            <div className="pe-meta-item" key={i}>
              <span className="pe-meta-k">{k}</span>
              <span className={'pe-meta-v' + (mono ? ' mono' : '')}>{v}</span>
            </div>
          ) : null)}
          {cLine && <div className="pe-copyline">{cLine}</div>}
        </div>
      )}

      {tracks.length ? <TrackList tracks={tracks} />
        : <div className="pe-empty"><div className="pe-empty-ic">🎵</div><h3>Album chưa có bài hát</h3></div>}
    </div>
  );
}
