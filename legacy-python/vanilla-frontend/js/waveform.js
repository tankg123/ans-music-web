/* Waveform kiểu Adobe Audition: tải peaks từ server (cache), vẽ canvas
   mirrored quanh trục giữa; phần đã nghe tô xanh lá nhạt. */
import { api } from './api.js?v=2.1.0';

const COLORS = {
  played: '#6ee7a0',                       // xanh lá nhạt — phần đã nghe
  playedDim: 'rgba(110, 231, 160, .55)',
  rest: 'rgba(148, 163, 184, .38)',        // phần chưa nghe (hợp cả dark/light)
  center: 'rgba(148, 163, 184, .25)',
};

const cache = new Map();          // trackId -> peaks[] | null (null = không có)
const pending = new Map();        // trackId -> Promise

export function getPeaks(trackId) {
  if (cache.has(trackId)) return Promise.resolve(cache.get(trackId));
  if (pending.has(trackId)) return pending.get(trackId);
  const p = api.get(`/v1/tracks/${trackId}/waveform`)
    .then(d => {
      const peaks = Array.isArray(d.peaks) && d.peaks.length ? d.peaks : null;
      cache.set(trackId, peaks);
      return peaks;
    })
    .catch(() => { cache.set(trackId, null); return null; })
    .finally(() => pending.delete(trackId));
  pending.set(trackId, p);
  return p;
}

export function peaksInCache(trackId) {
  return cache.get(trackId) || null;
}

/* Vẽ waveform lên canvas. progress: 0..1 (phần tô xanh). hover: 0..1 | null. */
export function drawWave(canvas, peaks, progress = 0, hover = null) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.offsetWidth;
  const hgt = canvas.clientHeight || canvas.offsetHeight;
  if (!w || !hgt || !peaks || !peaks.length) return;
  const pw = Math.round(w * dpr), ph = Math.round(hgt * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);

  const mid = hgt / 2;
  const n = peaks.length;
  const playedX = Math.round(progress * w);

  // trục giữa mảnh
  ctx.fillStyle = COLORS.center;
  ctx.fillRect(0, mid - 0.5, w, 1);

  // mỗi cột 1px: lấy đỉnh lớn nhất của các bucket rơi vào cột đó
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((x / w) * n);
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
    let p = 0;
    for (let i = i0; i < i1 && i < n; i++) if (peaks[i] > p) p = peaks[i];
    const bh = Math.max(0.75, p * mid * 0.96);
    ctx.fillStyle = x <= playedX ? COLORS.played : COLORS.rest;
    ctx.fillRect(x, mid - bh, 1, bh * 2);
  }

  // vạch hover khi rê chuột / kéo
  if (hover != null) {
    const hx = Math.round(hover * w);
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.fillRect(hx, 0, 1, hgt);
  }

  // vạch vị trí hiện tại
  if (progress > 0) {
    ctx.fillStyle = COLORS.played;
    ctx.fillRect(playedX, 0, 1.5, hgt);
  }
}

/* Placeholder khi peaks chưa tải xong */
export function drawWavePlaceholder(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (!w || !hgt) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.center;
  ctx.fillRect(0, hgt / 2 - 0.5, w, 1);
}

export function fractionFromEvent(el, e) {
  const rect = el.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX
    : e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  return Math.min(1, Math.max(0, (cx - rect.left) / rect.width));
}
