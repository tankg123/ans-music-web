/** Thanh phát dưới cùng — bìa đĩa vinyl XOAY khi phát, sóng âm thật của từng bài
 *  (seek được) chồng lên visualizer động, điều khiển shuffle/prev/play/next/repeat,
 *  âm lượng, mở hàng đợi & Now Playing. Bọc assetUrl cho ảnh bìa. */
import { useState } from 'react';
import { usePlayer } from '../player';
import { assetUrl } from '../api';
import Waveform from './Waveform';
import './playerbar.css';

function fmt(ms: number) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---- icons ---- */
const I = {
  prev: <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>,
  next: <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" /></svg>,
  play: <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>,
  shuffle: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17 3l4 4-4 4v-3h-2.2l-2.6 3.1-1.3-1.5L13.4 8H17V6l-3-3zM3 6h4.5l2.2 2.6-1.3 1.5L6 8H3zm14 9v-2l4 4-4 4v-3h-3.6l-9-11H3v-2h4.5l9 11H17z" /></svg>,
  repeat: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" /></svg>,
  repeatOne: (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" />
      <text x="12" y="14.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="currentColor">1</text>
    </svg>
  ),
  queue: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm15-6 5 3-5 3z" /></svg>,
  expand: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 14h2v4h4v2H4zm0-4V4h6v2H6v4zm14 8h-4v2h6v-6h-2zm0-14h-6v2h4v4h2z" /></svg>,
  vol: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9zm12.5 3a4 4 0 0 0-2.5-3.7v7.4A4 4 0 0 0 16.5 12z" /></svg>,
  mute: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9zm14.6 3 2.1-2.1-1.4-1.4L17.2 10.6 15 8.5v7l2.2-2.1 2.1 2.1 1.4-1.4z" /></svg>,
};

export function PlayerBar() {
  const p = usePlayer();
  const t = p.current;
  const [dragFrac, setDragFrac] = useState<number | null>(null);
  const [lastVol, setLastVol] = useState(1);

  const openNP = () => { if (t) p.setShowNowPlaying(true); };

  // Tua theo chính phần tử được bấm (e.currentTarget) → dùng chung cho cả sóng
  // desktop lẫn dải sóng mobile mà không cần ref riêng.
  const fracFromEl = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const onDown = (e: React.PointerEvent) => {
    if (!p.duration) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setDragFrac(fracFromEl(el, e.clientX));
  };
  const onMove = (e: React.PointerEvent) => { if (dragFrac !== null) setDragFrac(fracFromEl(e.currentTarget as HTMLElement, e.clientX)); };
  const onUp = (e: React.PointerEvent) => {
    if (dragFrac === null) return;
    p.seek(fracFromEl(e.currentTarget as HTMLElement, e.clientX) * p.duration);
    setDragFrac(null);
  };

  const frac = dragFrac !== null ? dragFrac : (p.duration ? p.position / p.duration : 0);
  const pct = frac * 100;
  const shownPos = dragFrac !== null ? dragFrac * p.duration : p.position;

  const toggleMute = () => {
    if (p.volume > 0) { setLastVol(p.volume); p.setVolume(0); }
    else p.setVolume(lastVol || 1);
  };

  return (
    <footer id="playerbar">
      <div className="pb-track">
        {t ? (
          <>
            <button className={'pbx-cover-btn pbx-vinyl' + (p.playing ? ' spinning' : '')}
              onClick={openNP} title="Mở toàn màn hình" aria-label="Now playing">
              <img className="pb-cover" src={assetUrl(t.cover_url) || '/favicon.svg'} alt="" />
              <span className="pbx-vinyl-hole" />
              <span className="pbx-cover-veil">{I.expand}</span>
            </button>
            <div className="pb-meta">
              <div className="pb-title pbx-title" onClick={openNP} title={t.title}>{t.title}</div>
              <div className="pb-artist">{(t.artists || []).map(a => a.name).join(', ')}</div>
            </div>
          </>
        ) : <div className="pb-meta"><div className="pb-title">Chưa phát bài nào</div></div>}
      </div>

      <div className="pbx-mini-ctrl">
        <button className="pbx-mini-prev" onClick={p.prev} title="Bài trước">{I.prev}</button>
        <button className="pbx-mini-play" onClick={p.toggle} title="Phát / Dừng">{p.playing ? I.pause : I.play}</button>
        <button className="pbx-mini-next" onClick={p.next} title="Bài sau">{I.next}</button>
      </div>

      {/* Dải sóng nhạc cho mini-player mobile (seek được) */}
      <div className="pbx-mobile-wave" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} title="Bấm/kéo để tua">
        {t && <div className="pbx-mobile-wave-inner"><Waveform trackId={t.id} height={22} progress={frac} lazy={false} /></div>}
        <span className="pbx-waveseek-knob" style={{ left: `${pct}%` }} />
      </div>

      <div className="pb-center">
        <div className="pb-controls pbx-controls">
          <button className={'pbx-icon' + (p.shuffle ? ' on' : '')} onClick={p.toggleShuffle} title="Trộn bài">{I.shuffle}</button>
          <button className="pbx-nav" onClick={p.prev} title="Bài trước">{I.prev}</button>
          <button className="pb-play pbx-play" onClick={p.toggle} title="Phát / Dừng">{p.playing ? I.pause : I.play}</button>
          <button className="pbx-nav" onClick={p.next} title="Bài sau">{I.next}</button>
          <button className={'pbx-icon' + (p.repeat !== 'off' ? ' on' : '')} onClick={p.cycleRepeat}
            title={p.repeat === 'one' ? 'Lặp một bài' : p.repeat === 'all' ? 'Lặp tất cả' : 'Lặp lại'}>
            {p.repeat === 'one' ? I.repeatOne : I.repeat}
          </button>
        </div>
        <div className="pbx-seek">
          <span className="pbx-time">{fmt(shownPos)}</span>
          <div className={'pbx-waveseek' + (dragFrac !== null ? ' dragging' : '')}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} title="Bấm/kéo để tua">
            {t && <div className="pbx-waveseek-wave"><Waveform trackId={t.id} height={40} progress={frac} lazy={false} /></div>}
            <span className="pbx-waveseek-knob" style={{ left: `${pct}%` }} />
          </div>
          <span className="pbx-time">{fmt(p.duration)}</span>
        </div>
      </div>

      <div className="pb-right pbx-side">
        <button className={'pbx-icon' + (p.showQueue ? ' on' : '')} onClick={() => p.setShowQueue(!p.showQueue)} title="Hàng đợi">{I.queue}</button>
        <button className={'pbx-icon' + (p.showNowPlaying ? ' on' : '')} onClick={openNP} title="Đang phát">{I.expand}</button>
        <div className="pbx-vol">
          <button className="pbx-icon" onClick={toggleMute} title="Tắt / bật tiếng">{p.volume === 0 ? I.mute : I.vol}</button>
          <input type="range" min={0} max={1} step={0.01} value={p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))} title="Âm lượng"
            style={{ ['--vol' as any]: `${p.volume * 100}%` }} />
        </div>
      </div>
    </footer>
  );
}
