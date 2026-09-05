/* Player toàn cục: queue, shuffle, repeat, Media Session, heartbeat 30s */
import { api } from './api.js?v=2.1.0';

const STORE_KEY = 'ans_player_v1';

class Player extends EventTarget {
  constructor() {
    super();
    this.audio = document.getElementById('audio');
    this.queue = [];          // mảng track object
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off';      // off | all | one
    this.volume = 0.8;
    this.muted = false;
    this.heartbeatSent = false;
    this.source = null;       // ngữ cảnh phát: album|playlist|search...
    this._shuffleOrder = [];

    this._bindAudio();
    this._restore();
  }

  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused && !this.audio.ended; }

  /* ---------- phát ---------- */
  async playQueue(tracks, startIndex = 0, source = null, seekFraction = null) {
    const playable = tracks.filter(t => t.has_audio !== false);
    if (!playable.length) return;
    const target = tracks[startIndex];
    this.queue = playable;
    this.index = Math.max(0, playable.findIndex(t => t.id === (target && target.id)));
    this.source = source;
    this._pendingSeek = seekFraction;    // bấm vào waveform → phát từ vị trí đó
    this._makeShuffleOrder();
    await this._load(true);
    this._emit('queue');
  }

  addNext(track) {
    if (this.index < 0) return this.playQueue([track], 0);
    const pos = this.index + 1;
    this.queue.splice(pos, 0, track);
    if (this.shuffle) {
      // vá shuffle order tại chỗ — KHÔNG reshuffle, để "Phát tiếp theo" đúng nghĩa
      this._shuffleOrder = this._shuffleOrder.map(i => (i >= pos ? i + 1 : i));
      this._shuffleOrder.splice(this._shuffleOrder.indexOf(this.index) + 1, 0, pos);
    } else {
      this._makeShuffleOrder();
    }
    this._emit('queue');
  }

  addToQueue(track) {
    if (this.index < 0) return this.playQueue([track], 0);
    this.queue.push(track);
    if (this.shuffle) this._shuffleOrder.push(this.queue.length - 1);
    else this._makeShuffleOrder();
    this._emit('queue');
  }

  removeFromQueue(i) {
    if (i === this.index) return;
    this.queue.splice(i, 1);
    if (this.shuffle) {
      this._shuffleOrder = this._shuffleOrder
        .filter(x => x !== i)
        .map(x => (x > i ? x - 1 : x));
    }
    if (i < this.index) this.index--;
    if (!this.shuffle) this._makeShuffleOrder();
    this._emit('queue');
  }

  async playAt(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    await this._load(true);
    this._emit('queue');
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  async next(auto = false) {
    if (!this.queue.length) return;
    if (auto && this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      this.heartbeatSent = false;
      return;
    }
    const ni = this._neighbor(1);
    if (ni === null) {
      if (this.repeat === 'all') { await this.playAt(this._orderedFirst()); }
      else if (!auto) { /* cuối queue, bấm tay: không làm gì */ }
      else { this._emit('state'); }
      return;
    }
    await this.playAt(ni);
  }

  async prev() {
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    const pi = this._neighbor(-1);
    if (pi === null) { this.audio.currentTime = 0; return; }
    await this.playAt(pi);
  }

  seek(fraction) {
    if (!this.audio.duration) return;
    this.audio.currentTime = fraction * this.audio.duration;
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    this.audio.volume = this.volume;
    this.muted = false;
    this.audio.muted = false;
    this._save();
    this._emit('volume');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.muted = this.muted;
    this._emit('volume');
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this._makeShuffleOrder();
    this._save();
    this._emit('state');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this._save();
    this._emit('state');
  }

  /* track được cập nhật từ nơi khác (like/unlike) */
  patchTrack(trackId, patch) {
    let touched = false;
    this.queue.forEach(t => {
      if (t.id === trackId) { Object.assign(t, patch); touched = true; }
    });
    if (touched) this._emit('track');
  }

  /* ---------- nội bộ ---------- */
  _neighbor(dir) {
    if (!this.queue.length) return null;
    if (this.shuffle) {
      const pos = this._shuffleOrder.indexOf(this.index);
      const npos = pos + dir;
      if (npos < 0 || npos >= this._shuffleOrder.length) return null;
      return this._shuffleOrder[npos];
    }
    const ni = this.index + dir;
    if (ni < 0 || ni >= this.queue.length) return null;
    return ni;
  }

  _orderedFirst() {
    return this.shuffle ? this._shuffleOrder[0] : 0;
  }

  _makeShuffleOrder() {
    const idx = this.queue.map((_, i) => i);
    if (this.shuffle) {
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      // đưa bài hiện tại lên đầu để next mạch lạc
      const pos = idx.indexOf(this.index);
      if (pos > 0) { idx.splice(pos, 1); idx.unshift(this.index); }
    }
    this._shuffleOrder = idx;
  }

  async _load(autoplay) {
    const track = this.current;
    if (!track) return;
    // token chống stale: người dùng chuyển bài nhanh → chỉ response của
    // lần load MỚI NHẤT được áp dụng (cả nhánh thành công lẫn nhánh lỗi)
    const token = this._loadToken = (this._loadToken || 0) + 1;
    this.heartbeatSent = false;
    try {
      let url;
      const pf = this._prefetch;
      if (pf && pf.id === track.id && Date.now() - pf.at < 4 * 3600 * 1000) {
        url = pf.url; // đã prefetch → phát tức thì, không tốn round-trip
      } else {
        ({ url } = await api.get(`/v1/tracks/${track.id}/stream`));
      }
      if (token !== this._loadToken) return;
      this.audio.src = url;
      if (this._pendingSeek != null) {
        const frac = this._pendingSeek;
        this._pendingSeek = null;
        const apply = () => {
          if (this.audio.duration) this.audio.currentTime = frac * this.audio.duration;
        };
        if (this.audio.duration) apply();
        else this.audio.addEventListener('loadedmetadata', apply, { once: true });
      }
      if (autoplay) await this.audio.play().catch(() => {});
    } catch (e) {
      if (token !== this._loadToken) return;
      this._pendingSeek = null;
      this._emit('error', { message: e.message, track });
      // bỏ qua bài lỗi
      const ni = this._neighbor(1);
      if (ni !== null) await this.playAt(ni);
      return;
    }
    if (token !== this._loadToken) return;
    this._updateMediaSession();
    this._save();
    this._emit('track');
    this._prefetchNext();
  }

  /* lấy sẵn signed URL của bài kế tiếp → chuyển bài không có độ trễ mạng */
  async _prefetchNext() {
    const ni = this._neighbor(1);
    if (ni === null) return;
    const next = this.queue[ni];
    if (!next || !next.has_audio) return;
    if (this._prefetch && this._prefetch.id === next.id) return;
    try {
      const { url } = await api.get(`/v1/tracks/${next.id}/stream`);
      this._prefetch = { id: next.id, url, at: Date.now() };
    } catch { /* bài kế lỗi thì để _load xử lý khi tới lượt */ }
  }

  _bindAudio() {
    const a = this.audio;
    a.volume = this.volume;

    a.addEventListener('play', () => this._emit('state'));
    a.addEventListener('pause', () => this._emit('state'));
    a.addEventListener('ended', () => this.next(true));
    a.addEventListener('timeupdate', () => {
      this._emit('time');
      this._maybeHeartbeat();
    });
    a.addEventListener('progress', () => this._emit('time'));
    a.addEventListener('playing', () => { this._errStreak = 0; });
    a.addEventListener('error', () => {
      if (!this.current || !a.src) return;
      this._emit('error', { message: 'Không phát được audio', track: this.current });
      // URL hỏng/hết hạn/bài bị gỡ → tự bỏ qua, tối đa 3 bài liên tiếp
      this._prefetch = null;
      this._errStreak = (this._errStreak || 0) + 1;
      if (this._errStreak <= 3) this.next(true);
    });
  }

  _maybeHeartbeat() {
    const t = this.current;
    if (!t || this.heartbeatSent) return;
    const ms = this.audio.currentTime * 1000;
    // CÙNG công thức với server (app/routers/playback.py) để mọi lượt gửi đều được đếm
    const dur = t.duration_ms || 0;
    const threshold = dur > 0 ? Math.min(30000, Math.max(1000, dur - 1000)) : 30000;
    if (ms >= threshold) {
      this.heartbeatSent = true;
      api.post('/v1/playback/heartbeat', {
        track_id: t.id, ms_played: Math.round(ms), source: this.source,
      }).catch(() => { this.heartbeatSent = true; });
    }
  }

  _updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.current) return;
    const t = this.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: (t.artists || []).map(a => a.name).join(', '),
      album: t.release ? t.release.title : '',
      artwork: t.cover_url ? [{ src: t.cover_url, sizes: '500x500', type: 'image/svg+xml' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => this.toggle());
    navigator.mediaSession.setActionHandler('pause', () => this.toggle());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (d.seekTime != null && this.audio.duration) this.audio.currentTime = d.seekTime;
    });
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        volume: this.volume, shuffle: this.shuffle, repeat: this.repeat,
        queue: this.queue.slice(0, 200), index: this.index,
        position: this.audio.currentTime || 0,
      }));
    } catch { /* quota */ }
  }

  _restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      this.volume = s.volume ?? 0.8;
      this.shuffle = !!s.shuffle;
      this.repeat = s.repeat || 'off';
      this.audio.volume = this.volume;
      if (Array.isArray(s.queue) && s.queue.length && s.index >= 0) {
        this.queue = s.queue;
        this.index = Math.min(s.index, s.queue.length - 1);
        this._makeShuffleOrder();
        this._restorePosition = s.position || 0;
        // nạp bài nhưng không tự phát (autoplay policy)
        this._loadPaused();
      }
    } catch { /* corrupt */ }
  }

  async _loadPaused() {
    const track = this.current;
    if (!track) return;
    const token = this._loadToken = (this._loadToken || 0) + 1;
    try {
      const { url } = await api.get(`/v1/tracks/${track.id}/stream`);
      if (token !== this._loadToken) return;
      this.audio.src = url;
      this.audio.currentTime = this._restorePosition || 0;
      this.audio.addEventListener('loadedmetadata', () => {
        if (this._restorePosition) this.audio.currentTime = this._restorePosition;
        this._restorePosition = 0;
      }, { once: true });
      this._updateMediaSession();
      this._emit('track');
      this._emit('queue');
    } catch { /* bài không còn */ }
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    if (type === 'track' || type === 'state') this._save();
  }
}

export const player = new Player();

// lưu vị trí phát mỗi 5s để "tiếp tục nghe"
setInterval(() => { if (player.current) player._save(); }, 5000);
