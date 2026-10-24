"""Convert a green-screen character illustration into the transparent hero image.
Run: uvx --from pillow python -I scripts/make-hero.py <source.png> [height]

Pipeline (no pixel-art conversion, no palette reduction):
  1. soft chroma key on the pure-green background (alpha from green excess)
  2. un-mix the background colour out of semi-transparent edge pixels (despill)
  3. trim to the opaque bounding box (+ small margin)
  4. LANCZOS downscale to `height` px (default 1600 = 2x of the 800px CSS height)
  5. write public/illust/hitohako-hero-<hash>.png and .webp, where <hash> is the
     first 10 hex chars of the SHA-256 of the PNG bytes (content-addressed name so
     that a redrawn hero is never served from a cache of the previous one),
     and remove the previous hitohako-hero-*.{png,webp} files.
The site resolves the current file name at build time via src/lib/hero.ts.
"""
import glob, hashlib, io, os, sys
from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'illust')
BG = (0, 255, 0)
LO, HI = 24, 150   # green-excess range mapped to alpha 1 -> 0

def key(src):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()
    out = Image.new('RGBA', (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            excess = g - max(r, b)
            if excess <= LO:
                a = 255
            elif excess >= HI:
                a = 0
            else:
                a = round(255 * (1 - (excess - LO) / (HI - LO)))
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
            elif a == 255:
                op[x, y] = (r, g, b, 255)
            else:
                f = a / 255
                # c = f*fg + (1-f)*bg  ->  fg = (c - (1-f)*bg) / f
                fg = tuple(min(255, max(0, round((c - (1 - f) * bc) / f))) for c, bc in zip((r, g, b), BG))
                op[x, y] = fg + (a,)
    return out

def main():
    src = sys.argv[1]
    height = int(sys.argv[2]) if len(sys.argv) > 2 else 1600
    im = key(src)
    bbox = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    m = 8
    im = im.crop((max(0, bbox[0] - m), max(0, bbox[1] - m), min(im.width, bbox[2] + m), min(im.height, bbox[3] + m)))
    scale = height / im.height
    im = im.resize((round(im.width * scale), height), Image.LANCZOS)
    os.makedirs(OUT_DIR, exist_ok=True)
    png = io.BytesIO()
    im.save(png, format='PNG', optimize=True)
    digest = hashlib.sha256(png.getvalue()).hexdigest()[:10]
    for old in glob.glob(os.path.join(OUT_DIR, 'hitohako-hero*.png')) + glob.glob(os.path.join(OUT_DIR, 'hitohako-hero*.webp')):
        os.remove(old)
    base = os.path.join(OUT_DIR, f'hitohako-hero-{digest}')
    with open(base + '.png', 'wb') as f:
        f.write(png.getvalue())
    im.save(base + '.webp', quality=88, method=6)
    print(im.size, base)

if __name__ == '__main__':
    main()
