/** Chi tiết thể loại — GET /v1/genres/:name/tracks.
 *  Hero gradient (hash tên → màu) + TrackList phát được, nút Phát tất cả / Trộn bài. */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { usePlayer, type Track } from '../player';
import { useLang } from '../i18n';
import { TrackList } from '../components/cards';
import './charts.css';

/* hash tên → cặp màu gradient (đồng bộ với trang Thể loại) */
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

export default function GenreDetail() {
  const { name = '' } = useParams();
  const { t } = useLang();
  const player = usePlayer();
  const [items, setItems] = useState<Track[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setItems(null); setErr('');
    api.get<{ genre: string; items: Track[] }>(`/v1/genres/${encodeURIComponent(name)}/tracks`)
      .then(d => { if (alive) setItems(d.items || []); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [name]);

  const gStyle = useMemo(() => gradientFor(name), [name]);
  const playAll = () => { if (items && items.length) player.play(items, 0); };
  const shuffle = () => {
    if (!items || !items.length) return;
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    player.play(a, 0);
  };

  return (
    <div className="page">
      <div className="gd-hero" style={gStyle}>
        <div className="gd-hero-glyph">🎵</div>
        <div className="gd-eyebrow">{t('genre')}</div>
        <h1 className="gd-name">{name}</h1>
        <div className="gd-count">{items ? `${items.length} bài hát` : t('loading')}</div>
        {items && items.length > 0 && (
          <div className="gd-actions">
            <button className="gd-btn gd-btn-play" onClick={playAll}>▶ {t('play')}</button>
            <button className="gd-btn gd-btn-ghost" onClick={shuffle}>🔀 {t('shuffle')}</button>
          </div>
        )}
      </div>

      {err && <div className="cx-error">Không tải được thể loại: {err}</div>}
      {!err && !items && (
        <div className="cx-loading"><div className="cx-spinner" /><span>{t('loading')}</span></div>
      )}
      {!err && items && items.length === 0 && <div className="cx-empty">{t('notFound')}</div>}
      {!err && items && items.length > 0 && <TrackList tracks={items} />}
    </div>
  );
}
