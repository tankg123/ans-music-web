/** Sinh ảnh bìa / avatar SVG procedural — gradient + hình khối, kèm màu accent cho UI.
 *  Port từ backend/app/covers.py.
 *
 *  Màu + hình khối TẤT ĐỊNH theo seed (PRNG mulberry32 riêng — không cần khớp
 *  Mersenne Twister của Python, chỉ cần ổn định theo seed). Trả về màu accent hex. */
import fs from 'node:fs';
import path from 'node:path';

// Bảng màu tuyển chọn (đậm chất app nhạc): [from, to, accent]
const PALETTES: [string, string, string][] = [
  ['#7c3aed', '#db2777', '#c084fc'],
  ['#2563eb', '#06b6d4', '#60a5fa'],
  ['#059669', '#84cc16', '#6ee7b7'],
  ['#ea580c', '#f59e0b', '#fdba74'],
  ['#dc2626', '#7c3aed', '#f87171'],
  ['#0ea5e9', '#6366f1', '#7dd3fc'],
  ['#d946ef', '#f43f5e', '#f0abfc'],
  ['#14b8a6', '#0ea5e9', '#5eead4'],
  ['#f59e0b', '#ef4444', '#fcd34d'],
  ['#8b5cf6', '#3b82f6', '#a78bfa'],
  ['#e11d48', '#fb923c', '#fda4af'],
  ['#22c55e', '#14b8a6', '#86efac'],
];

const ANGLES: [number, number, number, number][] = [
  [0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0], [0, 0, 0, 1],
];

/** PRNG tất định (mulberry32) — trả hàm next() ∈ [0,1). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randint(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
function choice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
/** "0.NN" với NN zero-pad 2 chữ số (khớp `0.{n:02d}` của Python). */
function op2(n: number): string {
  return `0.${String(n).padStart(2, '0')}`;
}

const ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
};
/** Tương đương html.escape(s, quote=True) của Python. */
function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, (c) => ESCAPE[c]);
}

function shapes(rng: () => number, accent: string): string {
  const out: string[] = [];
  const count = randint(rng, 3, 5);
  for (let i = 0; i < count; i++) {
    const kind = choice(rng, ['circle', 'ring', 'wave']);
    if (kind === 'circle') {
      out.push(
        `<circle cx="${randint(rng, 40, 460)}" cy="${randint(rng, 40, 460)}" `
        + `r="${randint(rng, 40, 150)}" fill="#ffffff" opacity="${op2(randint(rng, 4, 12))}"/>`,
      );
    } else if (kind === 'ring') {
      out.push(
        `<circle cx="${randint(rng, 60, 440)}" cy="${randint(rng, 60, 440)}" `
        + `r="${randint(rng, 60, 170)}" fill="none" stroke="${accent}" `
        + `stroke-width="${randint(rng, 6, 20)}" opacity="${op2(randint(rng, 15, 35))}"/>`,
      );
    } else {
      const y = randint(rng, 280, 430);
      const amp = randint(rng, 18, 46);
      out.push(
        `<path d="M0 ${y} Q 125 ${y - amp} 250 ${y} T 500 ${y} V 500 H 0 Z" `
        + `fill="#000000" opacity="${op2(randint(rng, 10, 22))}"/>`,
      );
    }
  }
  return out.join('');
}

function writeSvg(dest: string, svg: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, svg, 'utf8');
}

export interface CoverOpts {
  seed: number;
  title: string;
  subtitle?: string;
}

/** Sinh SVG bìa 500×500, ghi ra destSvgPath, trả về màu accent (hex). */
export function generateCover(destSvgPath: string, opts: CoverOpts): string {
  const { seed, title } = opts;
  const subtitle = opts.subtitle || '';
  const rng = makeRng(seed);
  const [c1, c2, accent] = choice(rng, PALETTES);
  const angle = choice(rng, ANGLES);
  const titleE = escapeHtml(title.slice(0, 26) + (title.length > 26 ? '…' : ''));
  const subE = escapeHtml(subtitle.slice(0, 30));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
<defs>
  <linearGradient id="g" x1="${angle[0]}" y1="${angle[1]}" x2="${angle[2]}" y2="${angle[3]}">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
  </linearGradient>
</defs>
<rect width="500" height="500" fill="url(#g)"/>
${shapes(rng, accent)}
<rect width="500" height="500" fill="url(#s)"/>
<text x="34" y="436" font-family="'Be Vietnam Pro','Segoe UI',sans-serif" font-size="34"
  font-weight="700" fill="#ffffff">${titleE}</text>
<text x="34" y="468" font-family="'Be Vietnam Pro','Segoe UI',sans-serif" font-size="19"
  fill="#ffffff" opacity="0.85">${subE}</text>
</svg>`;
  writeSvg(destSvgPath, svg);
  return accent;
}

export interface AvatarOpts {
  seed: number;
  name: string;
}

/** Avatar nghệ sĩ SVG tròn với chữ cái đầu; ghi ra destSvgPath, trả về accent (hex). */
export function generateAvatar(destSvgPath: string, opts: AvatarOpts): string {
  const { seed, name } = opts;
  const rng = makeRng(seed);
  const [c1, c2, accent] = choice(rng, PALETTES);
  const initials = escapeHtml(
    (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
</linearGradient></defs>
<rect width="500" height="500" fill="url(#g)"/>
<circle cx="250" cy="250" r="150" fill="#ffffff" opacity="0.12"/>
<text x="250" y="292" text-anchor="middle" font-family="'Be Vietnam Pro','Segoe UI',sans-serif"
  font-size="130" font-weight="800" fill="#ffffff">${initials}</text>
</svg>`;
  writeSvg(destSvgPath, svg);
  return accent;
}
