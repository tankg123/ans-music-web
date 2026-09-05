/** Phân tích đỉnh sóng (peaks) cho UI waveform kiểu Adobe Audition.
 *  Port từ backend/app/waveform.py.
 *
 *  Track được decode về mono 8kHz float32 (qua ffmpeg) rồi chia thành 1000 đoạn,
 *  lấy biên độ đỉnh của từng đoạn, chuẩn hóa 0..1 và cache JSON —
 *  client vẽ canvas chi tiết. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { WAVEFORM_DIR } from './config.js';
import { ffmpegAvailable } from './transcode.js';

const BUCKETS = 1000;
const DECODE_RATE = 8000;

function cachePath(trackId: string): string {
  return path.join(WAVEFORM_DIR, `${trackId}.json`);
}

/** Decode audio → Float32Array mono 8kHz qua ffmpeg (null nếu lỗi/không có ffmpeg). */
function decode(audioPath: string): Float32Array | null {
  if (!ffmpegAvailable()) return null;
  try {
    const proc = spawnSync('ffmpeg', [
      '-v', 'error', '-i', audioPath,
      '-ac', '1', '-ar', String(DECODE_RATE), '-f', 'f32le', 'pipe:1',
    ], { timeout: 120_000, maxBuffer: 512 * 1024 * 1024 });
    if (proc.status !== 0 || !proc.stdout || proc.stdout.length < 4) return null;

    const buf = proc.stdout as Buffer;
    const n = Math.floor(buf.length / 4);
    // copy sang ArrayBuffer căn chỉnh 4 byte để tạo Float32Array an toàn
    const ab = new ArrayBuffer(n * 4);
    new Uint8Array(ab).set(buf.subarray(0, n * 4));
    return new Float32Array(ab);
  } catch {
    return null;
  }
}

/** Tính 1000 đỉnh biên độ 0..1 (null nếu không decode được). */
function computePeaks(audioPath: string): number[] | null {
  const data = decode(audioPath);
  if (!data || data.length < BUCKETS) return null;

  const trimmed = data.length - (data.length % BUCKETS);
  const per = trimmed / BUCKETS;
  const peaks = new Array<number>(BUCKETS);
  let top = 0;
  for (let b = 0; b < BUCKETS; b++) {
    const start = b * per;
    const end = start + per;
    let m = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(data[i]);
      if (a > m) m = a;
    }
    peaks[b] = m;
    if (m > top) top = m;
  }
  if (top <= 0) return null;
  for (let b = 0; b < BUCKETS; b++) {
    peaks[b] = Math.round((peaks[b] / top) * 1000) / 1000;
  }
  return peaks;
}

/**
 * Đọc cache; chưa có thì phân tích rồi lưu.
 * Trả về mảng 1000 đỉnh (0..1) hoặc null nếu không phân tích được.
 */
export function getOrBuildWaveform(trackId: string, audioPath: string): number[] | null {
  const cache = cachePath(trackId);
  if (fs.existsSync(cache)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
    } catch {
      /* cache hỏng → xóa và tính lại */
    }
    try { fs.rmSync(cache, { force: true }); } catch { /* ignore */ }
  }

  const peaks = computePeaks(audioPath);
  if (peaks) {
    try { fs.writeFileSync(cache, JSON.stringify(peaks), 'utf8'); } catch { /* ignore */ }
  }
  return peaks;
}

/** Xóa cache waveform của track (khi audio thay đổi). */
export function invalidateWaveform(trackId: string): void {
  try { fs.rmSync(cachePath(trackId), { force: true }); } catch { /* ignore */ }
}
