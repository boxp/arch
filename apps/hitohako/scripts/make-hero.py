"""Publish the finished hero key visual (a full-background landscape JPEG) as
content-hashed site assets.
Run: uvx --from pillow python -I scripts/make-hero.py <hero.jpg>

The source is the finished illustration as delivered. It is NOT redrawn, keyed,
cropped, flipped or colour-corrected here:
  1. <hash> = first 10 hex chars of the SHA-256 of the source JPEG bytes, so the
     published file name can be checked against the delivered original
  2. public/illust/hitohako-hero-<hash>.jpg  - byte-identical copy of the source
     (fallback `src`, also the largest candidate)
  3. public/illust/hitohako-hero-<hash>-<w>w.webp for each width in WIDTHS
     (LANCZOS downscale only, never upscaled; aspect ratio preserved) used as the
     responsive `srcset`
  4. previous hitohako-hero-*.{jpg,png,webp} files are removed, so the site can
     never keep serving an old picture from a browser / CDN cache.
The site resolves the current file names at build time via src/lib/hero.ts.
"""
import glob, hashlib, io, os, shutil, sys
from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'illust')
WIDTHS = (960, 1440, 2560)
WEBP_QUALITY = 90


def main():
    src = sys.argv[1]
    with open(src, 'rb') as f:
        data = f.read()
    digest = hashlib.sha256(data).hexdigest()
    h = digest[:10]
    im = Image.open(io.BytesIO(data))
    if im.format != 'JPEG':
        sys.exit(f'expected a JPEG source, got {im.format}')
    im = im.convert('RGB')

    os.makedirs(OUT_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(OUT_DIR, 'hitohako-hero-*')):
        os.remove(old)
        print('removed', os.path.relpath(old))

    jpg = os.path.join(OUT_DIR, f'hitohako-hero-{h}.jpg')
    with open(jpg, 'wb') as f:
        f.write(data)
    print(f'wrote {os.path.relpath(jpg)} {im.width}x{im.height} {len(data)} bytes (sha256 {digest})')

    for w in sorted(set(WIDTHS)):
        if w > im.width:
            print(f'skip {w}w (source is only {im.width}px wide, no upscaling)')
            continue
        out = os.path.join(OUT_DIR, f'hitohako-hero-{h}-{w}w.webp')
        scaled = im if w == im.width else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        scaled.save(out, format='WEBP', quality=WEBP_QUALITY, method=6)
        print(f'wrote {os.path.relpath(out)} {scaled.width}x{scaled.height} {os.path.getsize(out)} bytes')


if __name__ == '__main__':
    main()
