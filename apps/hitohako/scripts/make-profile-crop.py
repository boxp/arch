"""Cut the profile face image out of the published hero key visual.
Run: uvx --from pillow python -I scripts/make-profile-crop.py

The output holds the hero's own pixels: a fixed square crop at 1:1 scale, with no
redraw, resize, flip or colour correction. CROP is specific to one picture, so the
script refuses any hero other than HERO_HASH; re-pick CROP when the hero changes.
"""
import hashlib, os
from PIL import Image

HERO_HASH = '570eabbe64'
CROP = (670, 8, 1230, 568)  # left, top, right, bottom in hero pixels
JPEG_QUALITY = 92

ILLUST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'illust')


def main():
    src = os.path.join(ILLUST, f'hitohako-hero-{HERO_HASH}.jpg')
    with open(src, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if not digest.startswith(HERO_HASH):
        raise SystemExit(f'{src} has sha256 {digest}, expected {HERO_HASH}...')
    out = os.path.join(ILLUST, f'hitohako-profile-{HERO_HASH}.jpg')
    Image.open(src).convert('RGB').crop(CROP).save(out, format='JPEG', quality=JPEG_QUALITY, optimize=True)
    print(f'wrote {os.path.relpath(out)} {CROP[2] - CROP[0]}x{CROP[3] - CROP[1]} {os.path.getsize(out)} bytes')


if __name__ == '__main__':
    main()
