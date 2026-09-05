import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

/** Waveform kiểu Audition — vẽ canvas theo devicePixelRatio, tô phần đã phát
 *  bằng màu accent, phần chưa phát màu mờ. peaks lấy từ /v1/tracks/:id/waveform.
 *  lazy=true (mặc định): chỉ tải peaks khi canvas lọt vào khung nhìn — tránh nạp
 *  ồ ạt khi danh sách nhiều bài (mỗi hàng track có sóng riêng). */
export default function Waveform({
  trackId, height = 64, progress = 0, lazy = true,
}: { trackId: string; height?: number; progress?: number; lazy?: boolean }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [visible, setVisible] = useState(!lazy);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // hiện trong khung nhìn?
  useEffect(() => {
    if (!lazy || visible) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setPeaks(null);
    api.get<{ peaks: number[] }>(`/v1/tracks/${trackId}/waveform`)
      .then(d => { if (alive) setPeaks(Array.isArray(d.peaks) ? d.peaks : []); })
      .catch(() => { if (alive) setPeaks([]); });
    return () => { alive = false; };
  }, [trackId, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !peaks) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, wrap.clientWidth);
      const h = height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const n = peaks.length;
      if (!n) return;
      let max = 0.0001;
      for (let i = 0; i < n; i++) if (peaks[i] > max) max = peaks[i];

      const cs = getComputedStyle(document.documentElement);
      const accent = (cs.getPropertyValue('--accent') || '#7c5cff').trim() || '#7c5cff';
      const idle = 'rgba(147,160,187,0.30)';
      const playedX = w * Math.min(1, Math.max(0, progress));

      const slot = w / n;
      const barW = Math.max(1, slot * 0.62);
      const mid = h / 2;
      for (let i = 0; i < n; i++) {
        const x = i * slot + (slot - barW) / 2;
        const amp = Math.max(1, (peaks[i] / max) * (h * 0.46));
        ctx.fillStyle = (x + barW / 2) <= playedX ? accent : idle;
        ctx.fillRect(x, mid - amp, barW, amp * 2);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [peaks, height, progress]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
