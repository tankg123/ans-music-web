/** Thể loại — GET /v1/home → genres [{name, track_count}].
 *  Lưới thẻ gradient (hash tên → màu), bấm → /genre/:name. 3D tilt hover. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useLang } from '../i18n';
import './charts.css';

interface Genre { name: string; track_count: number; }

/* hash tên → cặp màu gradient sống động, ổn định theo tên */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
function gradientFor(name: string) {
  const h = hashCode(name);
  const h1 = h % 360;
  const h2 = (h1 + 35 + (h % 40)) % 360;
  return { '--g1': `hsl(${h1} 72% 54%)`, '--g2': `hsl(${h2} 68% 40%)` } as React.CSSProperties;
}
const NOTES = ['🎵', '🎶', '🎸', '🎹', '🎧', '🥁', '🎤', '🎺', '🎷', '🪕'];

export default function Genres() {
  const { t } = useLang();
  const nav = useNavigate();
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api.get<{ genres: Genre[] }>('/v1/home')
      .then(d => { if (alive) setGenres(d.genres || []); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="page cx-scene">
      <div className="cx-aurora" />
      <div className="cx-content">
        <div className="cx-hero">
          <div className="cx-hero-l">
            <h1 className="cx-title">
              <span className="cx-title-emoji">🏷️</span>
              <span className="cx-grad">{t('genres')}</span>
            </h1>
            <p className="cx-sub">Duyệt kho nhạc theo thể loại yêu thích của bạn.</p>
          </div>
        </div>

        {err && <div className="cx-error">Không tải được thể loại: {err}</div>}
        {!err && !genres && (
          <div className="gz-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="cx-skel" style={{ aspectRatio: '16 / 10' }} />
            ))}
          </div>
        )}
        {!err && genres && genres.length === 0 && <div className="cx-empty">{t('notFound')}</div>}

        {!err && genres && genres.length > 0 && (
          <div className="gz-grid">
            {genres.map((g, i) => (
              <div key={g.name} className="gz-card" style={gradientFor(g.name)}
                onMouseMove={onTilt} onMouseLeave={offTilt}
                onClick={() => nav(`/genre/${encodeURIComponent(g.name)}`)}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') nav(`/genre/${encodeURIComponent(g.name)}`); }}>
                <span className="gz-note">{NOTES[i % NOTES.length]}</span>
                <div className="gz-name">{g.name}</div>
                <div className="gz-count">{g.track_count} bài hát</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* tilt 3D theo con trỏ */
function onTilt(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget, r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  el.style.setProperty('--ry', ((px - 0.5) * 14).toFixed(2) + 'deg');
  el.style.setProperty('--rx', ((0.5 - py) * 12).toFixed(2) + 'deg');
  el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
  el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
}
function offTilt(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--rx', '0deg');
  e.currentTarget.style.setProperty('--ry', '0deg');
}
