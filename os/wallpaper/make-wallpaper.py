#!/usr/bin/env python3
"""Erzeugt das AleGamestation-OS-Hintergrundbild (dunkles Violett/Cyan wie die App, Logo + Schriftzug).
Aufruf: python3 os/wallpaper/make-wallpaper.py <ausgabe.png> [breite] [höhe]"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
out = sys.argv[1]
W = int(sys.argv[2]) if len(sys.argv) > 2 else 3840
H = int(sys.argv[3]) if len(sys.argv) > 3 else 2160
s = H / 2160  # Skalierung

# Hintergrund: senkrechter Verlauf + zwei weiche Lichtflecken (Violett oben links, Cyan unten rechts)
bg = Image.new("RGB", (W, H))
top, bottom = (23, 17, 48), (8, 8, 16)
d = ImageDraw.Draw(bg)
for y in range(H):
    t = y / (H - 1)
    d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))


def glow(cx, cy, r, color, alpha):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(r * 0.55))


bg = bg.convert("RGBA")
bg = Image.alpha_composite(bg, glow(int(W * 0.12), int(H * 0.05), int(H * 0.75), (124, 92, 255), 120))
bg = Image.alpha_composite(bg, glow(int(W * 0.92), int(H * 1.0), int(H * 0.6), (34, 211, 238), 70))

# Feines Raster als „Konsolen“-Struktur, nach außen ausgeblendet
grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
g = ImageDraw.Draw(grid)
step = int(96 * s)
for x in range(0, W, step):
    g.line([(x, 0), (x, H)], fill=(255, 255, 255, 9))
for y in range(0, H, step):
    g.line([(0, y), (W, y)], fill=(255, 255, 255, 9))
mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).ellipse([W * 0.2, H * 0.05, W * 0.8, H * 0.95], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(H * 0.15))
grid.putalpha(Image.composite(grid.getchannel("A"), Image.new("L", (W, H), 0), mask))
bg = Image.alpha_composite(bg, grid)

# Logo mit Leuchten in der Mitte
icon = Image.open(ROOT / "build" / "icon.png").convert("RGBA")
size = int(360 * s)
icon = icon.resize((size, size), Image.LANCZOS)
cx, cy = W // 2, int(H * 0.44)
halo = glow(cx, cy, int(size * 0.9), (124, 92, 255), 150)
bg = Image.alpha_composite(bg, halo)
bg.alpha_composite(icon, (cx - size // 2, cy - size // 2))

# Schriftzug „AleGamestation“ (Ale dünner, Gamestation fett) + „OS“
fonts = Path("/usr/share/fonts/google-noto")
reg = ImageFont.truetype(str(fonts / "NotoSans-Regular.ttf"), int(120 * s))
bold = ImageFont.truetype(str(fonts / "NotoSans-Bold.ttf"), int(120 * s))
small = ImageFont.truetype(str(fonts / "NotoSans-Bold.ttf"), int(40 * s))
d = ImageDraw.Draw(bg)
w1 = d.textlength("Ale", font=reg)
w2 = d.textlength("Gamestation", font=bold)
x = cx - (w1 + w2) / 2
y = cy + size // 2 + int(70 * s)
d.text((x, y), "Ale", font=reg, fill=(214, 210, 236))
d.text((x + w1, y), "Gamestation", font=bold, fill=(255, 255, 255))
label = "O  S"
d.text((cx - d.textlength(label, font=small) / 2, y + int(170 * s)), label, font=small, fill=(168, 163, 199))

bg.convert("RGB").save(out, optimize=True)
print(out, W, H)
