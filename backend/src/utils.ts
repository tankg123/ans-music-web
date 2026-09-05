/** Tiện ích — port 1:1 từ Python (chuẩn hóa tiếng Việt, ISRC/UPC, signed URL).
 *  Thuật toán HMAC/checksum GIỮ NGUYÊN để tương thích dữ liệu + URL bản cũ. */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { SECRET_KEY, STREAM_URL_TTL } from './config.js';

/** Bỏ dấu tiếng Việt + lowercase để tìm kiếm không dấu. */
export function normalizeText(s: string): string {
  if (!s) return '';
  s = s.replace(/đ/g, 'd').replace(/Đ/g, 'd');
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // bỏ dấu kết hợp (Mn)
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/;
export function validateIsrc(isrc: string): boolean {
  if (!isrc) return false;
  return ISRC_RE.test(isrc.replace(/-/g, '').toUpperCase());
}
export const cleanIsrc = (isrc: string): string => (isrc || '').replace(/-/g, '').toUpperCase().trim();

export function validateUpc(upc: string): boolean {
  if (!upc || !/^\d+$/.test(upc) || upc.length < 12 || upc.length > 14) return false;
  const digits = upc.split('').map(Number);
  const check = digits.pop()!;
  digits.reverse();
  const total = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (total % 10)) % 10 === check;
}

export function gtinCheckDigit(digits: string): string {
  const rev = digits.split('').map(Number).reverse();
  const total = rev.reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (total % 10)) % 10);
}

function hmac32(msg: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(msg).digest('hex').slice(0, 32);
}
const nowSec = () => Math.floor(Date.now() / 1000);

export function signStream(trackId: string, ttl = STREAM_URL_TTL): string {
  const exp = nowSec() + ttl;
  return `exp=${exp}&sig=${hmac32(`${trackId}.${exp}`)}`;
}
export function verifyStreamSig(trackId: string, exp: string, sig: string): boolean {
  const e = parseInt(exp, 10);
  if (Number.isNaN(e) || e < nowSec()) return false;
  return timingSafeEqual(hmac32(`${trackId}.${e}`), sig || '');
}
export function signDownload(kind: string, objId: string, ttl = 3600): string {
  const exp = nowSec() + ttl;
  return `exp=${exp}&sig=${hmac32(`dl:${kind}:${objId}.${exp}`)}`;
}
export function verifyDownloadSig(kind: string, objId: string, exp: string, sig: string): boolean {
  const e = parseInt(exp, 10);
  if (Number.isNaN(e) || e < nowSec()) return false;
  return timingSafeEqual(hmac32(`dl:${kind}:${objId}.${e}`), sig || '');
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function safeFilename(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').trim() || 'download';
}

export function stableSeed(s: string): number {
  return zlib.crc32(Buffer.from(s || '', 'utf8')) & 0xffff;
}

export function fmtDuration(ms: number): string {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
