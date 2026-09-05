/** Bảng xếp hạng — GET /v1/charts?period=week|month|all.
 *  Tab chọn kỳ, podium top-3 (vàng/bạc/đồng) 3D + danh sách xếp hạng, bấm để phát. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { usePlayer, type Track } from '../player';
import { useLang } from '../i18n';
import './charts.css';

type Period = 'week' | 'month' | 'all';

interface ChartTrack extends Track {
  rank?: number;
  period_plays?: number;
  play_count?: number;
  release?: { id: string; title: string } | null;
}

function fmtCount(n?: number): string {
  const v = n || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(v);
}
function fmtDur(ms?: number): string {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function artists(a?: { id: string; name: string }[]) {
  return a || [];
}

/* tilt 3D theo con trỏ */
function onTilt(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget, r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  el.style.setProperty('--ry', ((px - 0.5) * 16).toFixed(2) + 'deg');
  el.style.setProperty('--rx', ((0.5 - py) * 12).toFixed(2) + 'deg');
  el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
  el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
}
function offTilt(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--rx', '0deg');
  e.currentTarget.style.setProperty('--ry', '0deg');
}

export default function Charts() {
  const { t } = useLang();
  const player = usePlayer();
  const [period, setPeriod] = useState<Period>('week');
  const [items, setItems] = useState<ChartTrack[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setItems(null); setErr('');
    api.get<{ items: ChartTrack[] }>(`/v1/charts?period=${period}`)
      .then(d => { if (alive) setItems(d.items || []); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [period]);

  const tabs: { key: Period; label: string }[] = [
    { key: 'week', label: t('week') },
    { key: 'month', label: t('month') },
    { key: 'all', label: t('allTime') },
  ];

  const playAt = (i: number) => { if (items) player.play(items as Track[], i); };
  const top3 = items ? items.slice(0, 3) : [];
  const rest = items ? items.slice(3) : [];

  return (
    <div className="page cx-scene">
      <div className="cx-aurora" />
      <div className="cx-content">
        <div className="cx-hero">
          <div className="cx-hero-l">
            <h1 className="cx-title">
              <span className="cx-title-emoji">🏆</span>
              <span className="cx-grad">{t('charts')}</span>
            </h1>
            <p className="cx-sub">Những bài hát được nghe nhiều nhất trên ANS Music.</p>
          </div>
          {items && items.length > 0 && (
            <button className="cx-playall" onClick={() => playAt(0)}>
              <span className="ico">▶</span> {t('play')}
            </button>
          )}
        </div>

        <div className="cx-tabs" role="tablist" style={{ marginBottom: 26 }}>
          {tabs.map(tb => (
            <button key={tb.key} role="tab" aria-selected={period === tb.key}
              className={'cx-tab' + (period === tb.key ? ' on' : '')}
              onClick={() => setPeriod(tb.key)}>{tb.label}</button>
          ))}
        </div>

        {err && <div className="cx-error">Không tải được bảng xếp hạng: {err}</div>}
        {!err && !items && (
          <div>
            <div className="cx-podium">
              {[0, 1, 2].map(i => <div key={i} className="cx-skel cx-skel-pod" />)}
            </div>
            <div className="cx-list">
              {Array.from({ length: 7 }).map((_, i) => <div key={i} className="cx-skel cx-skel-row" />)}
            </div>
          </div>
        )}
        {!err && items && items.length === 0 && (
          <div className="cx-empty">{t('notFound')}</div>
        )}

        {!err && items && items.length > 0 && (
          <>
            <div className="cx-podium">
              {top3.map((tk, i) => {
                const rank = tk.rank ?? i + 1;
                const cur = player.current?.id === tk.id;
                return (
                  <div key={tk.id} className={`cx-pod rank${rank <= 3 ? rank : ''}`}
                    onMouseMove={onTilt} onMouseLeave={offTilt} onClick={() => playAt(i)}>
                    {rank === 1 && <div className="cx-crown">👑</div>}
                    <div className="cx-medal">{rank}</div>
                    <div className="cx-pod-art">
                      <div className="cx-vinyl" />
                      <div className="cx-pod-cover">
                        {tk.cover_url && <img src={assetUrl(tk.cover_url)} alt="" loading="lazy" />}
                        <div className="cx-pod-play">{cur && player.playing ? '⏸' : '▶'}</div>
                      </div>
                    </div>
                    <div className="cx-pod-title">{tk.title}</div>
                    <div className="cx-pod-artist">{artists(tk.artists).map(a => a.name).join(', ')}</div>
                    <div className="cx-pod-plays">🔥 {fmtCount(tk.period_plays ?? tk.play_count)} {t('plays').toLowerCase()}</div>
                  </div>
                );
              })}
            </div>

            {rest.length > 0 && (
              <div className="cx-list">
                {rest.map((tk, i) => {
                  const idx = i + 3;
                  const rank = tk.rank ?? idx + 1;
                  const cur = player.current?.id === tk.id;
                  return (
                    <div key={tk.id} className={'cx-row' + (cur ? ' playing' : '')}
                      onClick={() => playAt(idx)}>
                      <div className="cx-rank">
                        {cur && player.playing
                          ? <span className="cx-eq"><i /><i /><i /></span>
                          : rank}
                      </div>
                      <img className="cx-rc-cover" src={assetUrl(tk.cover_url) || '/favicon.svg'} alt="" loading="lazy" />
                      <div className="cx-rc-main">
                        <div className="cx-rc-title">{tk.title}</div>
                        <div className="cx-rc-artist">
                          {artists(tk.artists).map((a, k) => (
                            <span key={a.id}>
                              {k > 0 && ', '}
                              <Link to={`/artist/${a.id}`} onClick={ev => ev.stopPropagation()}>{a.name}</Link>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="cx-rc-plays">
                        <b>{fmtCount(tk.period_plays ?? tk.play_count)}</b>
                        <span>{t('plays')}</span>
                      </div>
                      <span className="cx-rc-dur">{fmtDur(tk.duration_ms)}</span>
                      <button className="cx-play-btn" onClick={ev => { ev.stopPropagation(); playAt(idx); }}
                        title={t('play')}>{cur && player.playing ? '⏸' : '▶'}</button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
