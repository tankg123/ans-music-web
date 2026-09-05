/** Cấu hình thương hiệu — lưu trong app_settings, sửa ở Admin, tiêm vào HTML. */
import { getSetting } from './db.js';

export const BRAND_DEFAULTS: Record<string, string> = {
  brand_name: 'ANS Music',
  brand_short: 'ANS',
  brand_suffix: 'Music',
  brand_tagline: 'Nghe nhạc trực tuyến',
  brand_accent: '#7c5cff',
  brand_logo_url: '/static/img/logo.svg',
  brand_favicon_url: '/favicon.svg',
};
export const BRAND_EDITABLE = new Set(Object.keys(BRAND_DEFAULTS));

export function getBrand(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, def] of Object.entries(BRAND_DEFAULTS)) out[k] = getSetting(k, def) as string;
  return out;
}
