/** Hệ thống menu chuột phải cho track.
 *  - <ContextMenu x y items onClose/>  : menu chung, đóng khi click ngoài/Esc/scroll.
 *  - useTrackMenu()  : hook dựng sẵn các mục cho 1 track (Phát tiếp theo, Thêm vào
 *    hàng đợi, Thích, Thêm vào playlist, Đến album/nghệ sĩ, Sao chép liên kết,
 *    Thông tin chi tiết) + render kèm modal chi tiết, modal chọn playlist, toast.
 *  Cách dùng trong danh sách track:
 *    const menu = useTrackMenu();
 *    <div onContextMenu={e => menu.openTrackMenu(e, track)} />
 *    <button onClick={() => menu.openDetails(track.id)} />
 *    {menu.node}
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { usePlayer, type Track } from '../player';
import { useAuth } from '../useAuth';
import { useLang } from '../i18n';
import TrackDetailModal from './TrackDetailModal';
import './cards3d.css';

export type MenuItem =
  | 'hr'
  | { label: string; icon?: React.ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean };

/* Player có thể (ở phiên bản mới) bổ sung playNext/addToQueue. Nới lỏng kiểu để
   dùng khi có, và tự lo phần fallback khi chưa có — build vẫn sạch. */
type PlayerExt = ReturnType<typeof usePlayer> & {
  playNext?: (t: Track) => void;
  addNext?: (t: Track) => void;
  addToQueue?: (t: Track) => void;
};

/* ---------------- Icon nhỏ (inline SVG) ---------------- */
const S = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" {...p} />
);
const IcNext = () => <S><path d="M5 4l10 8-10 8V4z" /><path d="M19 5v14" /></S>;
const IcQueue = () => <S><path d="M3 6h13M3 12h13M3 18h7" /><path d="M18 14v8M14 18h8" /></S>;
const IcHeart = ({ fill }: { fill?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width={17} height={17}>
    <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2 5 5.2 5c2 0 3.3 1.1 4.8 3 1.5-1.9 2.8-3 4.8-3 3.2 0 4.8 3.4 3.2 6.7C19.5 16.4 12 21 12 21z" />
  </svg>
);
const IcPlus = () => <S><path d="M12 5v14M5 12h14" /></S>;
const IcInfo = () => <S><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>;
const IcAlbum = () => <S><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.2" /></S>;
const IcUser = () => <S><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></S>;
const IcLink = () => <S><path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 016 6l-2 2" /><path d="M13 18l-1 1a4 4 0 01-6-6l2-2" /></S>;
const IcDl = () => <S><path d="M12 4v11m0 0l-4-4m4 4l4-4" /><path d="M5 20h14" /></S>;

/* ================= Menu chung ================= */
export function ContextMenu(
  { x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void },
) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 12));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 12));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      {items.map((it, i) => {
        if (it === 'hr') return <hr key={i} />;
        if (it.disabled) return <div className="ctx-label" key={i}>{it.label}</div>;
        return (
          <button key={i} className={'ctx-item' + (it.danger ? ' danger' : '')} role="menuitem"
            onClick={() => { onClose(); it.onClick?.(); }}>
            {it.icon && <span className="ctx-ic">{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/* ================= Modal chọn playlist ================= */
function AddToPlaylistModal(
  { track, onDone, onClose }: { track: Track; onDone: (msg: string) => void; onClose: () => void },
) {
  const { t } = useLang();
  const [items, setItems] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/v1/me/playlists')
      .then(d => { if (alive) setItems((d.items || []).filter((p: any) => !p.is_editorial)); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const createAndAdd = async () => {
    const v = newTitle.trim();
    if (!v || busy) return;
    setBusy('new');
    try {
      const pl = await api.post<any>('/v1/me/playlists', { title: v, visibility: 'private' });
      await api.post(`/v1/me/playlists/${pl.id}/tracks`, { track_id: track.id });
      onDone(t('createdAdded'));
      onClose();
    } catch (e: any) {
      onDone(e?.message || 'Lỗi');
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = async (pl: any) => {
    if (busy) return;
    setBusy(pl.id);
    try {
      await api.post(`/v1/me/playlists/${pl.id}/tracks`, { track_id: track.id });
      onDone(t('addPlaylist'));
      onClose();
    } catch (e: any) {
      onDone(e?.message || 'Lỗi');
      setBusy(null);
    }
  };

  return createPortal(
    <div className="c3d-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="atp-modal" role="dialog" aria-modal="true">
        <div className="atp-head">
          <h2>{t('addPlaylist')}</h2>
          <div className="sub">“{track.title}”</div>
        </div>
        <div className="atp-new">
          <span className="atp-new-ic">＋</span>
          <input className="atp-new-input" placeholder={t('playlistName')} value={newTitle}
            onChange={e => setNewTitle(e.target.value)} disabled={!!busy}
            onKeyDown={e => { if (e.key === 'Enter') createAndAdd(); }} autoFocus />
          <button className="btn btn-primary btn-sm" disabled={!!busy || !newTitle.trim()} onClick={createAndAdd}>
            {busy === 'new' ? '…' : t('createAdd')}
          </button>
        </div>
        <div className="atp-list">
          {items === null && <div className="atp-empty">{t('loading')}</div>}
          {items && items.length === 0 && <div className="atp-empty">{t('myPlaylists')}: —</div>}
          {items && items.map(p => (
            <button key={p.id} className="atp-row" disabled={!!busy} onClick={() => add(p)}>
              {p.cover_url ? <img src={assetUrl(p.cover_url)} alt="" />
                : <span className="atp-ph">♪</span>}
              <span className="nm">{p.title}</span>
              <span className="ct">{p.track_count ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="atp-foot">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ================= Hook cho danh sách track ================= */
export function useTrackMenu() {
  const p = usePlayer() as PlayerExt;
  const { loggedIn } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();

  const [menu, setMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addTrack, setAddTrack] = useState<Track | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (m: string) => {
    setToast(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1700);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  /* --- Hàng đợi: dùng API player nếu có, không thì fallback không làm gián đoạn --- */
  const addToQueue = (track: Track) => {
    if (p.addToQueue) { p.addToQueue(track); }
    else if (!p.current) { p.play([track]); }
    else { p.queue.push(track); }   // giữ nguyên bài đang phát
    showToast(t('addQueue'));
  };
  const playNext = (track: Track) => {
    if (p.playNext) p.playNext(track);
    else if (p.addNext) p.addNext(track);
    else if (p.addToQueue) p.addToQueue(track);
    else if (!p.current) p.play([track]);
    else p.queue.splice(p.index + 1, 0, track);
    showToast(t('playNext'));
  };

  const download = async (track: Track) => {
    if (!loggedIn) { nav('/login'); return; }
    try {
      const { url } = await api.get<{ url: string }>(`/v1/tracks/${track.id}/download`);
      const a = document.createElement('a');
      a.href = assetUrl(url);
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(t('download'));
    } catch (e: any) { showToast(e?.message || 'Lỗi'); }
  };

  const toggleLike = async (track: Track) => {
    if (!loggedIn) { nav('/login'); return; }
    const target = !(track as any).liked;
    try {
      if (target) await api.put(`/v1/me/favorites/track/${track.id}`);
      else await api.del(`/v1/me/favorites/track/${track.id}`);
      (track as any).liked = target;
      showToast(t('like'));
    } catch (e: any) { showToast(e?.message || 'Lỗi'); }
  };

  const copyLink = (track: Track) => {
    const rel = (track as any).release;
    const url = rel?.id
      ? `${location.origin}/album/${rel.id}`
      : `${location.origin}/track/${track.id}`;
    const cb = navigator.clipboard;
    if (cb) cb.writeText(url).then(() => showToast('Đã sao chép liên kết'), () => showToast(url));
    else showToast(url);
  };

  const openTrackMenu = (e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, track });
  };
  const openMenuAt = (x: number, y: number, track: Track) => setMenu({ x, y, track });
  const openDetails = (id: string) => setDetailId(id);

  const buildItems = (track: Track): MenuItem[] => {
    const rel = (track as any).release;
    const artist = track.artists?.[0];
    const liked = !!(track as any).liked;
    const hasAudio = (track as any).has_audio !== false;
    const items: MenuItem[] = [
      { label: t('playNext'), icon: <IcNext />, onClick: () => playNext(track) },
      { label: t('addQueue'), icon: <IcQueue />, onClick: () => addToQueue(track) },
    ];
    if (loggedIn) {
      items.push('hr');
      items.push({
        label: t('like'), icon: <IcHeart fill={liked} />, danger: liked,
        onClick: () => toggleLike(track),
      });
      items.push({ label: t('addPlaylist'), icon: <IcPlus />, onClick: () => setAddTrack(track) });
      if (hasAudio) items.push({ label: t('download'), icon: <IcDl />, onClick: () => download(track) });
    }
    items.push('hr');
    items.push({ label: t('details'), icon: <IcInfo />, onClick: () => setDetailId(track.id) });
    if (rel?.id) items.push({ label: t('toAlbum'), icon: <IcAlbum />, onClick: () => nav(`/album/${rel.id}`) });
    if (artist?.id) items.push({ label: t('toArtist'), icon: <IcUser />, onClick: () => nav(`/artist/${artist.id}`) });
    items.push({ label: t('copyLink'), icon: <IcLink />, onClick: () => copyLink(track) });
    return items;
  };

  const node = (
    <>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={buildItems(menu.track)}
          onClose={() => setMenu(null)} />
      )}
      {addTrack && (
        <AddToPlaylistModal track={addTrack} onDone={showToast} onClose={() => setAddTrack(null)} />
      )}
      {detailId && <TrackDetailModal trackId={detailId} onClose={() => setDetailId(null)} />}
      {toast && createPortal(<div className="c3d-toast">{toast}</div>, document.body)}
    </>
  );

  return { openTrackMenu, openMenuAt, openDetails, toggleLike, download, node };
}

export default ContextMenu;
