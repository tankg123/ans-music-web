import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePlayer, type Track } from '../player';
import { assetUrl, api } from '../api';
import { useAuth } from '../useAuth';
import { useTrackMenu } from './ContextMenu';
import Waveform from './Waveform';
import './cards3d.css';

/* --- Tilt 3D theo vị trí con trỏ (ghi thẳng CSS var, không re-render) --- */
const MAX_TILT = 15;
function tiltMove(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  el.style.setProperty('--ry', ((px - 0.5) * 2 * MAX_TILT).toFixed(2) + 'deg');
  el.style.setProperty('--rx', (-(py - 0.5) * 2 * MAX_TILT).toFixed(2) + 'deg');
  el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
  el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
}
function tiltLeave(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--ry', '0deg');
}

export function AlbumCard({ album }: { album: any }) {
  return (
    <Link to={`/album/${album.id}`} className="album-card tilt3d"
      onMouseMove={tiltMove} onMouseLeave={tiltLeave}>
      <div className="ac-cover" style={{ background: album.accent || '#222' }}>
        {album.cover_url && <img src={assetUrl(album.cover_url)} alt="" loading="lazy" />}
      </div>
      <div className="ac-title">{album.title}</div>
      <div className="ac-sub">{(album.artists || []).map((a: any) => a.name).join(', ')}</div>
    </Link>
  );
}

export function ArtistCard({ artist }: { artist: any }) {
  return (
    <Link to={`/artist/${artist.id}`} className="artist-card tilt3d"
      onMouseMove={tiltMove} onMouseLeave={tiltLeave}>
      <div className="art-avatar" style={{ background: artist.accent || '#333' }}>
        {artist.image_url ? <img src={assetUrl(artist.image_url)} alt="" loading="lazy" /> : (artist.name || '?')[0]}
      </div>
      <div className="ac-title">{artist.name}</div>
    </Link>
  );
}

/* --- Icon nút hành động trên hàng track --- */
const RS = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" {...p} />
);
const IcInfo = () => <RS><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></RS>;
const IcDl = () => <RS><path d="M12 4v11m0 0l-4-4m4 4l4-4" /><path d="M5 20h14" /></RS>;
const IcMore = () => <RS><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></RS>;
const IcHeart = ({ fill }: { fill?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2 5 5.2 5c2 0 3.3 1.1 4.8 3 1.5-1.9 2.8-3 4.8-3 3.2 0 4.8 3.4 3.2 6.7C19.5 16.4 12 21 12 21z" />
  </svg>
);

function fmtDur(ms?: number) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TrackList({ tracks }: { tracks: Track[] }) {
  const p = usePlayer();
  const { loggedIn } = useAuth();
  const nav = useNavigate();
  const menu = useTrackMenu();
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const isLiked = (t: Track) => likes[t.id] ?? !!(t as any).liked;

  const handleLike = async (t: Track) => {
    if (!loggedIn) { nav('/login'); return; }
    if (busy[t.id]) return;
    const target = !isLiked(t);
    setLikes(m => ({ ...m, [t.id]: target }));
    setBusy(m => ({ ...m, [t.id]: true }));
    try {
      if (target) await api.put(`/v1/me/favorites/track/${t.id}`);
      else await api.del(`/v1/me/favorites/track/${t.id}`);
      (t as any).liked = target;
    } catch {
      setLikes(m => ({ ...m, [t.id]: !target }));
    } finally {
      setBusy(m => ({ ...m, [t.id]: false }));
    }
  };

  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  const onWaveClick = (e: React.MouseEvent, i: number, isCur: boolean) => {
    e.stopPropagation();
    if (isCur && p.duration) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      p.seek(frac * p.duration);
    } else {
      p.play(tracks, i);
    }
  };

  return (
    <div className="track-list">
      {tracks.map((t, i) => {
        const isCur = p.current?.id === t.id;
        const prog = isCur && p.duration ? p.position / p.duration : 0;
        return (
        <div key={t.id} className={'track-row' + (isCur ? ' playing' : '')}
          onDoubleClick={() => p.play(tracks, i)}
          onContextMenu={(e) => menu.openTrackMenu(e, t)}>
          <button className="tr-play" onClick={stop(() => p.play(tracks, i))} title="Phát">
            {isCur && p.playing ? '⏸' : '▶'}
          </button>
          <img className="tr-cover" src={assetUrl(t.cover_url) || '/favicon.svg'} alt="" loading="lazy" />
          <div className="tr-main">
            <div className="tr-title">{t.title}</div>
            <div className="tr-artist">{(t.artists || []).map(a => a.name).join(', ')}</div>
          </div>
          <div className={'tr-wave' + (isCur ? ' cur' : '')} onClick={(e) => onWaveClick(e, i, isCur)}
            title={isCur ? 'Bấm để tua' : 'Bấm để phát'}>
            <Waveform trackId={t.id} height={30} progress={prog} />
          </div>
          <div className="tr-actions">
            <button className="tr-btn tr-info" title="Thông tin chi tiết"
              onClick={stop(() => menu.openDetails(t.id))}><IcInfo /></button>
            {loggedIn && (
              <button className={'tr-btn tr-like' + (isLiked(t) ? ' liked' : '') + (busy[t.id] ? ' busy' : '')}
                title="Yêu thích" onClick={stop(() => handleLike(t))}>
                <IcHeart fill={isLiked(t)} />
              </button>
            )}
            {loggedIn && (t as any).has_audio !== false && (
              <button className="tr-btn tr-dl" title="Tải xuống"
                onClick={stop(() => menu.download(t))}><IcDl /></button>
            )}
            <button className="tr-btn tr-more" title="Thêm"
              onClick={(e) => { e.stopPropagation(); menu.openTrackMenu(e, t); }}><IcMore /></button>
          </div>
          <span className="tr-dur">{fmtDur(t.duration_ms)}</span>
        </div>
        );
      })}
      {menu.node}
    </div>
  );
}
