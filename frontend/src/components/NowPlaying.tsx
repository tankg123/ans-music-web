/** Overlay Đang phát toàn màn hình — đĩa vinyl xoay 3D, waveform tua được,
 *  lyrics đồng bộ LRC. Nền gradient động theo màu accent của bài. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlayer } from '../player';
import { api, assetUrl } from '../api';
import { useLang } from '../i18n';
import Waveform from './Waveform';
import './nowplaying.css';

function fmt(ms: number) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type LrcLine = { t: number; text: string };
function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}

const I = {
  close: <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" /></svg>,
  prev: <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>,
  next: <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" /></svg>,
  play: <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>,
  shuffle: <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M17 3l4 4-4 4v-3h-2.2l-2.6 3.1-1.3-1.5L13.4 8H17V6l-3-3zM3 6h4.5l2.2 2.6-1.3 1.5L6 8H3zm14 9v-2l4 4-4 4v-3h-3.6l-9-11H3v-2h4.5l9 11H17z" /></svg>,
  repeat: <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" /></svg>,
  repeatOne: (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="currentColor" d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" />
      <text x="12" y="14.6" textAnchor="middle" fontSize="8" fontWeight="800" fill="currentColor">1</text>
    </svg>
  ),
};

export default function NowPlaying() {
  const p = usePlayer();
  const { t: tr } = useLang();
  const t = p.current;

  const [lrc, setLrc] = useState<LrcLine[] | null>(null);
  const [plain, setPlain] = useState<string[] | null>(null);
  const [lyrState, setLyrState] = useState<'loading' | 'lrc' | 'plain' | 'none'>('loading');
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const discRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);

  const trackId = t?.id;
  const open = p.showNowPlaying && !!t;

  // nạp lyrics khi đổi bài / mở overlay
  useEffect(() => {
    if (!open || !trackId) return;
    let alive = true;
    setLyrState('loading'); setLrc(null); setPlain(null);
    api.get<{ lyrics?: string; lrc?: string }>(`/v1/tracks/${trackId}/lyrics`).then(d => {
      if (!alive) return;
      if (d.lrc) { setLrc(parseLrc(d.lrc)); setLyrState('lrc'); }
      else if (d.lyrics) { setPlain(String(d.lyrics).split('\n')); setLyrState('plain'); }
      else setLyrState('none');
    }).catch(() => { if (alive) setLyrState('none'); });
    return () => { alive = false; };
  }, [trackId, open]);

  // dòng LRC đang hát
  let active = -1;
  if (lrc && lrc.length) {
    const cur = p.position / 1000 + 0.2;
    for (let i = 0; i < lrc.length; i++) { if (lrc[i].t <= cur) active = i; else break; }
  }
  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  if (!open || !t) return null;

  const dur = p.duration || (t.duration_ms || 0);
  const progress = dur ? p.position / dur : 0;

  const onTilt = (e: React.MouseEvent) => {
    const el = discRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: +(py * -14).toFixed(2), y: +(px * 14).toFixed(2) });
  };
  const resetTilt = () => setTilt({ x: 0, y: 0 });

  const seekWave = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    p.seek(frac * dur);
  };

  return (
    <div className="np-overlay" role="dialog" aria-modal="true">
      <div className="np-bg" />
      {t.cover_url && <div className="np-bg-cover" style={{ backgroundImage: `url("${assetUrl(t.cover_url)}")` }} />}
      <div className="np-aurora" />

      <button className="np-close" onClick={() => p.setShowNowPlaying(false)} title="Đóng (Esc)" aria-label="Đóng">{I.close}</button>
      <div className="np-eyebrow">{tr('nowPlaying')}</div>

      <div className="np-body">
        {/* trái: đĩa + điều khiển */}
        <div className="np-left">
          <div
            ref={discRef}
            className={'np-disc' + (p.playing ? ' spin' : '')}
            style={{ transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
            onMouseMove={onTilt}
            onMouseLeave={resetTilt}
          >
            <div className="np-vinyl">
              <img className="np-vinyl-img" src={assetUrl(t.cover_url) || '/favicon.svg'} alt="" />
              <span className="np-vinyl-hole" />
            </div>
          </div>

          <div className="np-info">
            <div className="np-title">{t.title}</div>
            <div className="np-artists">
              {(t.artists || []).length
                ? t.artists!.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ', '}
                    <Link to={`/artist/${a.id}`} onClick={() => p.setShowNowPlaying(false)}>{a.name}</Link>
                  </span>
                ))
                : <span>{t.subtitle}</span>}
            </div>
          </div>

          <div className="np-wave" onClick={seekWave} title="Bấm để tua">
            <Waveform trackId={t.id} height={72} progress={progress} lazy={false} />
          </div>
          <div className="np-times">
            <span>{fmt(p.position)}</span>
            <span>{fmt(dur)}</span>
          </div>

          <div className="np-controls">
            <button className={'np-ic' + (p.shuffle ? ' on' : '')} onClick={p.toggleShuffle} title="Trộn bài">{I.shuffle}</button>
            <button className="np-ic np-nav" onClick={p.prev} title="Bài trước">{I.prev}</button>
            <button className="np-play" onClick={p.toggle} title="Phát / Dừng">{p.playing ? I.pause : I.play}</button>
            <button className="np-ic np-nav" onClick={p.next} title="Bài sau">{I.next}</button>
            <button className={'np-ic' + (p.repeat !== 'off' ? ' on' : '')} onClick={p.cycleRepeat}
              title={p.repeat === 'one' ? 'Lặp một bài' : p.repeat === 'all' ? 'Lặp tất cả' : 'Lặp lại'}>
              {p.repeat === 'one' ? I.repeatOne : I.repeat}
            </button>
          </div>
        </div>

        {/* phải: lyrics */}
        <div className="np-right">
          <div className="np-lyrics-head">{tr('lyrics')}</div>
          <div className="np-lyrics">
            {lyrState === 'loading' && <div className="np-lyr-msg">{tr('loading')}</div>}
            {lyrState === 'none' && <div className="np-lyr-msg">{tr('noLyrics')}</div>}
            {lyrState === 'lrc' && lrc!.map((l, i) => (
              <div
                key={i}
                ref={i === active ? activeRef : null}
                className={'np-line' + (i === active ? ' active' : '') + (i < active ? ' past' : '')}
                onClick={() => p.seek(l.t * 1000)}
              >
                {l.text || '♪'}
              </div>
            ))}
            {lyrState === 'plain' && plain!.map((l, i) => (
              <div key={i} className="np-line np-line-static">{l || ' '}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
