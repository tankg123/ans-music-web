/** Pipeline audio: transcode WAV/FLAC → AAC (m4a) cho streaming bằng ffmpeg.
 *  Port từ backend/app/transcode.py.
 *
 *  Có ffmpeg  → file phát là AAC nhẹ (~10× nhỏ hơn WAV), bản gốc giữ ở media/masters.
 *  Không ffmpeg → trả null, caller giữ nguyên file gốc (degrade êm, không lỗi).
 *
 *  better-sqlite3 style: dùng spawnSync (ĐỒNG BỘ) — không async/await. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { AUDIO_DIR, MASTER_DIR, TRANSCODE_BITRATE } from './config.js';

// định dạng nên transcode (lossless/nặng); mp3/m4a/ogg đã nén sẵn thì giữ nguyên
export const TRANSCODE_EXTS = new Set(['.wav', '.flac']);

let _ffmpegChecked = false;
let _ffmpegOk = false;

/** Có ffmpeg trong PATH không (kết quả cache lại sau lần đầu). */
export function ffmpegAvailable(): boolean {
  if (_ffmpegChecked) return _ffmpegOk;
  _ffmpegChecked = true;
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    _ffmpegOk = !r.error && r.status === 0;
  } catch {
    _ffmpegOk = false;
  }
  return _ffmpegOk;
}

function tryUnlink(p: string): void {
  try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
}

/** Thay thế nguyên tử: xóa dst (nếu có) rồi rename src→dst (Windows rename không ghi đè). */
function replaceFile(src: string, dst: string): void {
  tryUnlink(dst);
  fs.renameSync(src, dst);
}

function fileOk(p: string): boolean {
  try {
    return fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

export interface ProcessedAudio {
  audio_name: string;
  master_name: string;
}

/**
 * Pipeline chuẩn: mọi upload → bản gốc WAV 44.1kHz/16-bit stereo
 * (MASTER_DIR — nguồn sự thật + file download) + bản stream AAC nhẹ (AUDIO_DIR/*.m4a).
 *
 * KHÔNG đụng vào srcPath (caller giữ để undo). Trả về
 * {audio_name, master_name} hoặc null nếu không có ffmpeg / transcode lỗi.
 */
export function processAudio(srcPath: string, trackId: string): ProcessedAudio | null {
  if (!ffmpegAvailable()) return null;

  const master = path.join(MASTER_DIR, `${trackId}.wav`);
  const mTmp = path.join(MASTER_DIR, `${trackId}.tmp.wav`);
  const stream = path.join(AUDIO_DIR, `${trackId}.m4a`);
  const sTmp = path.join(AUDIO_DIR, `${trackId}.tmp.m4a`);

  try {
    const p1 = spawnSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', srcPath, '-vn',
      '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
      '-f', 'wav', mTmp,
    ], { timeout: 300_000, stdio: 'ignore' });
    if (p1.status !== 0 || !fileOk(mTmp)) {
      tryUnlink(mTmp);
      return null;
    }

    const p2 = spawnSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', mTmp, '-vn',
      '-c:a', 'aac', '-b:a', TRANSCODE_BITRATE,
      '-movflags', '+faststart', '-f', 'mp4', sTmp,
    ], { timeout: 300_000, stdio: 'ignore' });
    if (p2.status !== 0 || !fileOk(sTmp)) {
      tryUnlink(mTmp);
      tryUnlink(sTmp);
      return null;
    }

    replaceFile(mTmp, master);
    replaceFile(sTmp, stream);
    return { audio_name: path.basename(stream), master_name: path.basename(master) };
  } catch {
    tryUnlink(mTmp);
    tryUnlink(sTmp);
    return null;
  }
}

/** Xóa cặp file đã sinh bởi processAudio (dùng khi rollback). */
export function cleanupProcessed(trackId: string): void {
  tryUnlink(path.join(MASTER_DIR, `${trackId}.wav`));
  tryUnlink(path.join(AUDIO_DIR, `${trackId}.m4a`));
}

/** Parse header WAV (RIFF) để lấy thời lượng — fallback khi không có ffprobe. */
function wavDurationMs(p: string): number {
  let fd: number | undefined;
  try {
    fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(65536);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    if (n < 44) return 0;
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
      return 0;
    }
    let off = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (off + 8 <= n) {
      const id = head.toString('ascii', off, off + 4);
      const size = head.readUInt32LE(off + 4);
      if (id === 'fmt ') {
        // fmt: audioFormat(2) channels(2) sampleRate(4) byteRate(4) ...
        byteRate = head.readUInt32LE(off + 8 + 8);
      } else if (id === 'data') {
        dataSize = size;
        break;
      }
      off += 8 + size + (size & 1); // chunk padding về chẵn
    }
    if (byteRate > 0 && dataSize > 0) return Math.floor((dataSize / byteRate) * 1000);
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Thời lượng audio theo ms (tương đương mutagen bên Python).
 * Ưu tiên ffprobe (mọi định dạng); fallback parse header WAV. Trả 0 nếu không đọc được.
 */
export function audioDurationMs(p: string): number {
  try {
    const r = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      p,
    ], { encoding: 'utf8', timeout: 60_000 });
    if (!r.error && r.status === 0 && r.stdout) {
      const sec = parseFloat(r.stdout.trim());
      if (Number.isFinite(sec) && sec > 0) return Math.floor(sec * 1000);
    }
  } catch {
    /* ffprobe thiếu → thử WAV */
  }
  if (p.toLowerCase().endsWith('.wav')) return wavDurationMs(p);
  return 0;
}
