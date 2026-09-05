/** Trình phát nhạc toàn cục — 1 HTMLAudioElement, context React.
 *  Signed stream URL lấy từ /v1/tracks/:id/stream. Hỗ trợ shuffle / repeat,
 *  hàng đợi (thêm/xóa/phát tiếp), prefetch bài kế, Media Session, phím tắt,
 *  và điều khiển overlay Now Playing / Queue. Bắt chước player.js (web cũ). */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api, assetUrl } from './api';

export interface Track {
  id: string; title: string; subtitle?: string | null;
  artists?: { id: string; name: string }[];
  cover_url?: string | null; accent?: string | null; duration_ms?: number;
  isrc?: string | null; release?: any;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  current: Track | null;
  queue: Track[];
  index: number;
  playing: boolean;
  position: number;   // ms
  duration: number;   // ms
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  showNowPlaying: boolean;
  showQueue: boolean;
  play: (tracks: Track[], startIndex?: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  setShowNowPlaying: (v: boolean) => void;
  setShowQueue: (v: boolean) => void;
}

const Ctx = createContext<PlayerState | null>(null);
export const usePlayer = () => {
  const p = useContext(Ctx);
  if (!p) throw new Error('usePlayer ngoài PlayerProvider');
  return p;
};

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current) audioRef.current = new Audio();

  // ---- refs: nguồn sự thật cho logic (tránh stale closure trong callback) ----
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>('off');
  const volumeRef = useRef(1);
  const shuffleOrderRef = useRef<number[]>([]);
  const prefetchRef = useRef<{ id: string; url: string; at: number } | null>(null);
  const loadTokenRef = useRef(0);
  const errStreakRef = useRef(0);
  const prevVolRef = useRef(1);
  const showNPRef = useRef(false);
  const showQueueRef = useRef(false);

  // ---- state: cho render ----
  const [queue, setQueueState] = useState<Track[]>([]);
  const [index, setIndexState] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolState] = useState(1);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeatState] = useState<RepeatMode>('off');
  const [showNowPlaying, setShowNPState] = useState(false);
  const [showQueue, setShowQueueState] = useState(false);

  const current = index >= 0 ? queue[index] || null : null;

  // ---- đồng bộ ref + state ----
  const setQueue = (q: Track[]) => { queueRef.current = q; setQueueState(q); };
  const setIndex = (i: number) => { indexRef.current = i; setIndexState(i); };

  // ---- helpers thuần (chỉ đọc ref) ----
  const makeShuffleOrder = () => {
    const q = queueRef.current;
    const idx = q.map((_, i) => i);
    if (shuffleRef.current) {
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const pos = idx.indexOf(indexRef.current);
      if (pos > 0) { idx.splice(pos, 1); idx.unshift(indexRef.current); }
    }
    shuffleOrderRef.current = idx;
  };

  const neighbor = (dir: number): number | null => {
    const q = queueRef.current;
    if (!q.length) return null;
    if (shuffleRef.current) {
      const order = shuffleOrderRef.current;
      const pos = order.indexOf(indexRef.current);
      const npos = pos + dir;
      if (pos < 0 || npos < 0 || npos >= order.length) return null;
      return order[npos];
    }
    const ni = indexRef.current + dir;
    if (ni < 0 || ni >= q.length) return null;
    return ni;
  };

  const setMeta = (track: Track) => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: (track.artists || []).map(a => a.name).join(', '),
        album: track.release?.title || '',
        artwork: track.cover_url ? [{ src: assetUrl(track.cover_url), sizes: '512x512' }] : [],
      });
    } catch { /* MediaMetadata không hỗ trợ */ }
  };

  const prefetchNext = async () => {
    const ni = neighbor(1);
    if (ni === null) return;
    const nx = queueRef.current[ni];
    if (!nx) return;
    if (prefetchRef.current && prefetchRef.current.id === nx.id) return;
    try {
      const { url } = await api.get<{ url: string }>(`/v1/tracks/${nx.id}/stream`);
      prefetchRef.current = { id: nx.id, url, at: Date.now() };
    } catch { /* để _load xử lý khi tới lượt */ }
  };

  // ---- hành động (stable) ----
  const load = useCallback(async (autoplay: boolean) => {
    const audio = audioRef.current!;
    const track = queueRef.current[indexRef.current];
    if (!track) return;
    const token = ++loadTokenRef.current;
    try {
      let url: string;
      const pf = prefetchRef.current;
      if (pf && pf.id === track.id && Date.now() - pf.at < 4 * 3600 * 1000) {
        url = pf.url;                       // đã prefetch → phát tức thì
      } else {
        ({ url } = await api.get<{ url: string }>(`/v1/tracks/${track.id}/stream`));
      }
      if (token !== loadTokenRef.current) return;   // người dùng đã chuyển bài
      audio.src = assetUrl(url);
      audio.volume = volumeRef.current;
      if (track.accent) document.documentElement.style.setProperty('--accent', track.accent);
      setMeta(track);
      if (autoplay) { await audio.play(); setPlaying(true); }
      errStreakRef.current = 0;
      prefetchNext();
    } catch {
      if (token !== loadTokenRef.current) return;
      setPlaying(false);
      // URL hỏng / bài bị gỡ → tự bỏ qua, tối đa 3 bài liên tiếp
      prefetchRef.current = null;
      errStreakRef.current += 1;
      if (errStreakRef.current <= 3) {
        const ni = neighbor(1);
        if (ni !== null) { setIndex(ni); load(true); }
      }
    }
  }, []);

  const playAt = useCallback((i: number) => {
    if (i < 0 || i >= queueRef.current.length) return;
    setIndex(i);
    load(true);
  }, [load]);

  const nextInternal = useCallback((auto: boolean) => {
    const q = queueRef.current;
    if (!q.length) return;
    if (auto && repeatRef.current === 'one') {
      const audio = audioRef.current!;
      audio.currentTime = 0;
      audio.play().then(() => setPlaying(true)).catch(() => {});
      return;
    }
    const ni = neighbor(1);
    if (ni === null) {
      if (repeatRef.current === 'all') {
        playAt(shuffleRef.current ? shuffleOrderRef.current[0] : 0);
      } else if (auto) {
        setPlaying(false);   // hết hàng đợi (bài tự kết thúc)
      }
      // bấm tay ở cuối hàng đợi: giữ nguyên, không dừng
      return;
    }
    playAt(ni);
  }, [playAt]);

  const next = useCallback(() => nextInternal(false), [nextInternal]);

  const prev = useCallback(() => {
    const audio = audioRef.current!;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const pi = neighbor(-1);
    if (pi === null) { audio.currentTime = 0; return; }
    playAt(pi);
  }, [playAt]);

  const toggle = useCallback(() => {
    const audio = audioRef.current!;
    if (!queueRef.current.length) return;
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => {});
    else { audio.pause(); setPlaying(false); }
  }, []);

  const seek = useCallback((ms: number) => {
    const audio = audioRef.current!;
    if (Number.isFinite(ms)) audio.currentTime = Math.max(0, ms / 1000);
  }, []);

  const setVolume = useCallback((v: number) => {
    const vv = Math.min(1, Math.max(0, v));
    volumeRef.current = vv;
    setVolState(vv);
    audioRef.current!.volume = vv;
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current!;
    if (audio.volume > 0) { prevVolRef.current = audio.volume; setVolume(0); }
    else setVolume(prevVolRef.current || 1);
  }, [setVolume]);

  const play = useCallback((tracks: Track[], startIndex = 0) => {
    if (!tracks.length) return;
    prefetchRef.current = null;
    errStreakRef.current = 0;
    setQueue(tracks);
    setIndex(Math.min(Math.max(0, startIndex), tracks.length - 1));
    makeShuffleOrder();
    load(true);
  }, [load]);

  const addToQueue = useCallback((track: Track) => {
    if (indexRef.current < 0) { play([track], 0); return; }
    const nq = [...queueRef.current, track];
    setQueue(nq);
    if (shuffleRef.current) shuffleOrderRef.current = [...shuffleOrderRef.current, nq.length - 1];
    else makeShuffleOrder();
    prefetchNext();
  }, [play]);

  const playNext = useCallback((track: Track) => {
    if (indexRef.current < 0) { play([track], 0); return; }
    const pos = indexRef.current + 1;
    const nq = [...queueRef.current];
    nq.splice(pos, 0, track);
    setQueue(nq);
    if (shuffleRef.current) {
      // vá shuffle order tại chỗ — KHÔNG reshuffle, để "Phát tiếp theo" đúng nghĩa
      shuffleOrderRef.current = shuffleOrderRef.current.map(i => (i >= pos ? i + 1 : i));
      const cpos = shuffleOrderRef.current.indexOf(indexRef.current);
      shuffleOrderRef.current.splice(cpos + 1, 0, pos);
    } else {
      makeShuffleOrder();
    }
    prefetchRef.current = null;
    prefetchNext();
  }, [play]);

  const removeFromQueue = useCallback((i: number) => {
    if (i === indexRef.current) return;         // không xóa bài đang phát
    if (i < 0 || i >= queueRef.current.length) return;
    const nq = [...queueRef.current];
    nq.splice(i, 1);
    if (i < indexRef.current) setIndex(indexRef.current - 1);
    setQueue(nq);
    if (shuffleRef.current) {
      shuffleOrderRef.current = shuffleOrderRef.current.filter(x => x !== i).map(x => (x > i ? x - 1 : x));
    } else {
      makeShuffleOrder();
    }
    prefetchRef.current = null;
    prefetchNext();
  }, []);

  const clearQueue = useCallback(() => {
    const audio = audioRef.current!;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setQueue([]);
    setIndex(-1);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    shuffleOrderRef.current = [];
    prefetchRef.current = null;
  }, []);

  const toggleShuffle = useCallback(() => {
    const nv = !shuffleRef.current;
    shuffleRef.current = nv;
    setShuffleState(nv);
    makeShuffleOrder();
    prefetchRef.current = null;
    prefetchNext();
  }, []);

  const cycleRepeat = useCallback(() => {
    const nv: RepeatMode = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    repeatRef.current = nv;
    setRepeatState(nv);
  }, []);

  const setShowNowPlaying = useCallback((v: boolean) => {
    showNPRef.current = v;
    setShowNPState(v);
  }, []);
  const setShowQueue = useCallback((v: boolean) => {
    showQueueRef.current = v;
    setShowQueueState(v);
  }, []);

  // ---- gắn sự kiện audio (một lần) ----
  useEffect(() => {
    const audio = audioRef.current!;
    const onTime = () => setPosition(audio.currentTime * 1000);
    const onMeta = () => setDuration(audio.duration * 1000);
    const onEnd = () => nextInternal(true);
    const onPause = () => { setPlaying(false); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; };
    const onPlay = () => { setPlaying(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
    };
  }, [nextInternal]);

  // ---- Media Session action handlers (một lần) ----
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => toggle());
      ms.setActionHandler('pause', () => toggle());
      ms.setActionHandler('previoustrack', () => prev());
      ms.setActionHandler('nexttrack', () => next());
      ms.setActionHandler('seekto', (d: any) => {
        const audio = audioRef.current!;
        if (d.seekTime != null && audio.duration) audio.currentTime = d.seekTime;
      });
    } catch { /* trình duyệt không hỗ trợ đủ action */ }
  }, [toggle, next, prev]);

  // ---- phím tắt toàn cục ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (typing) return;
      const audio = audioRef.current!;
      switch (e.key) {
        case ' ': case 'Spacebar': e.preventDefault(); toggle(); break;
        case 'ArrowRight': if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); break;
        case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - 5); break;
        case 'm': case 'M': toggleMute(); break;
        case 'n': case 'N': next(); break;
        case 'p': case 'P': prev(); break;
        case 'Escape':
          if (showNPRef.current) setShowNowPlaying(false);
          else if (showQueueRef.current) setShowQueue(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, toggleMute, next, prev, setShowNowPlaying, setShowQueue]);

  const value: PlayerState = {
    current, queue, index, playing, position, duration, volume, shuffle, repeat,
    showNowPlaying, showQueue,
    play, toggle, next, prev, seek, setVolume, toggleShuffle, cycleRepeat,
    addToQueue, playNext, removeFromQueue, clearQueue, setShowNowPlaying, setShowQueue,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
