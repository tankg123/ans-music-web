"""Sinh ảnh bìa SVG procedural — gradient + hình khối, kèm màu accent cho UI."""
import html
import random
from pathlib import Path

# Bảng màu tuyển chọn (đậm chất app nhạc): (from, to, accent)
PALETTES = [
    ("#7c3aed", "#db2777", "#c084fc"),
    ("#2563eb", "#06b6d4", "#60a5fa"),
    ("#059669", "#84cc16", "#6ee7b7"),
    ("#ea580c", "#f59e0b", "#fdba74"),
    ("#dc2626", "#7c3aed", "#f87171"),
    ("#0ea5e9", "#6366f1", "#7dd3fc"),
    ("#d946ef", "#f43f5e", "#f0abfc"),
    ("#14b8a6", "#0ea5e9", "#5eead4"),
    ("#f59e0b", "#ef4444", "#fcd34d"),
    ("#8b5cf6", "#3b82f6", "#a78bfa"),
    ("#e11d48", "#fb923c", "#fda4af"),
    ("#22c55e", "#14b8a6", "#86efac"),
]


def _shapes(rng: random.Random, accent: str) -> str:
    out = []
    for _ in range(rng.randint(3, 5)):
        kind = rng.choice(["circle", "ring", "wave"])
        if kind == "circle":
            out.append(
                f'<circle cx="{rng.randint(40, 460)}" cy="{rng.randint(40, 460)}" '
                f'r="{rng.randint(40, 150)}" fill="#ffffff" opacity="0.{rng.randint(4, 12):02d}"/>'
            )
        elif kind == "ring":
            out.append(
                f'<circle cx="{rng.randint(60, 440)}" cy="{rng.randint(60, 440)}" '
                f'r="{rng.randint(60, 170)}" fill="none" stroke="{accent}" '
                f'stroke-width="{rng.randint(6, 20)}" opacity="0.{rng.randint(15, 35):02d}"/>'
            )
        else:
            y = rng.randint(280, 430)
            amp = rng.randint(18, 46)
            out.append(
                f'<path d="M0 {y} Q 125 {y - amp} 250 {y} T 500 {y} V 500 H 0 Z" '
                f'fill="#000000" opacity="0.{rng.randint(10, 22):02d}"/>'
            )
    return "".join(out)


def generate_cover(path: Path, seed: int, title: str, subtitle: str = "") -> str:
    """Sinh SVG 500×500, trả về màu accent."""
    rng = random.Random(seed)
    c1, c2, accent = rng.choice(PALETTES)
    angle = rng.choice([(0, 0, 1, 1), (1, 0, 0, 1), (0, 1, 1, 0), (0, 0, 0, 1)])
    title_e = html.escape(title[:26] + ("…" if len(title) > 26 else ""))
    sub_e = html.escape(subtitle[:30])
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
<defs>
  <linearGradient id="g" x1="{angle[0]}" y1="{angle[1]}" x2="{angle[2]}" y2="{angle[3]}">
    <stop offset="0%" stop-color="{c1}"/><stop offset="100%" stop-color="{c2}"/>
  </linearGradient>
  <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
  </linearGradient>
</defs>
<rect width="500" height="500" fill="url(#g)"/>
{_shapes(rng, accent)}
<rect width="500" height="500" fill="url(#s)"/>
<text x="34" y="436" font-family="'Be Vietnam Pro','Segoe UI',sans-serif" font-size="34"
  font-weight="700" fill="#ffffff">{title_e}</text>
<text x="34" y="468" font-family="'Be Vietnam Pro','Segoe UI',sans-serif" font-size="19"
  fill="#ffffff" opacity="0.85">{sub_e}</text>
</svg>'''
    path.write_text(svg, encoding="utf-8")
    return accent


def generate_avatar(path: Path, seed: int, name: str) -> str:
    """Avatar nghệ sĩ SVG tròn với chữ cái đầu."""
    rng = random.Random(seed)
    c1, c2, accent = rng.choice(PALETTES)
    initials = html.escape("".join(w[0] for w in name.split()[:2]).upper())
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="{c1}"/><stop offset="100%" stop-color="{c2}"/>
</linearGradient></defs>
<rect width="500" height="500" fill="url(#g)"/>
<circle cx="250" cy="250" r="150" fill="#ffffff" opacity="0.12"/>
<text x="250" y="292" text-anchor="middle" font-family="'Be Vietnam Pro','Segoe UI',sans-serif"
  font-size="130" font-weight="800" fill="#ffffff">{initials}</text>
</svg>'''
    path.write_text(svg, encoding="utf-8")
    return accent
