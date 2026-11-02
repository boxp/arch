"""Generate seamless wagara (Japanese pattern) pixel tiles for the site background.
Run: uvx --from pillow python -I scripts/make-tiles.py
"""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'pixel')
BG = (26, 11, 46)        # deep purple
LINE = (58, 30, 92)      # muted purple line
PINK = (247, 168, 196)   # sakura pink
PINK_DARK = (214, 120, 160)
GOLD = (227, 179, 65)

def seigaiha(size=32):
    """Blue-wave (青海波) pattern: overlapping concentric half circles."""
    im = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(im)
    r = size // 2
    centers = []
    for row in range(-1, 4):
        y = row * (size // 2)
        off = 0 if row % 2 == 0 else r
        for col in range(-1, 3):
            centers.append((col * size + off, y))
    centers.sort(key=lambda c: c[1])
    for (cx, cy) in centers:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BG)
        for rr in (r, r - 4, r - 8, r - 12):
            if rr > 0:
                d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=LINE)
    return im

def asanoha(size=48):
    """Hemp-leaf (麻の葉) inspired star lattice using 6 line directions."""
    im = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(im)
    h = size
    w = size
    # triangular lattice: horizontal lines + two diagonals
    step = h // 2
    for y in range(0, h + 1, step):
        d.line([(0, y), (w, y)], fill=LINE)
    for k in range(-2, 3):
        d.line([(k * w // 1 + 0, 0), (k * w // 1 + w // 2, h // 2)], fill=LINE)
        d.line([(k * w // 1 + w // 2, h // 2), (k * w // 1 + w, h)], fill=LINE)
        d.line([(k * w // 1 + 0, h), (k * w // 1 + w // 2, h // 2)], fill=LINE)
        d.line([(k * w // 1 + w // 2, h // 2), (k * w // 1 + w, 0)], fill=LINE)
    # vertical spokes from lattice vertices to make the "leaf" star
    for x in range(0, w + 1, w // 2):
        d.line([(x, 0), (x, h)], fill=LINE)
    for x in range(w // 4, w + 1, w // 2):
        d.line([(x, step // 2), (x, step + step // 2)], fill=LINE)
    return im

def sakura(size=32):
    """Scattered sakura petals / blossoms on deep purple."""
    im = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(im)
    def blossom(cx, cy, c):
        for dx, dy in ((0, -2), (2, 0), (0, 2), (-2, 0)):
            d.point((cx + dx, cy + dy), fill=c)
            d.point((cx + dx // 2, cy + dy // 2), fill=c)
        d.point((cx, cy), fill=GOLD)
    def petal(cx, cy, c):
        d.point((cx, cy), fill=c); d.point((cx + 1, cy), fill=c); d.point((cx, cy + 1), fill=c)
    blossom(6, 6, PINK)
    blossom(22, 18, PINK)
    petal(14, 26, PINK_DARK)
    petal(27, 4, PINK_DARK)
    petal(3, 20, PINK_DARK)
    return im

os.makedirs(OUT, exist_ok=True)
seigaiha().save(os.path.join(OUT, 'tile-seigaiha.png'))
asanoha().save(os.path.join(OUT, 'tile-asanoha.png'))
sakura().save(os.path.join(OUT, 'tile-sakura.png'))
print('tiles written to', os.path.abspath(OUT))
