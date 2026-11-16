"""v29 long-hair mask: (v28 probe mask, dilated 2px) ∩ hair colour, minus costume.

usage: python mask.py BUST(680x650 bust-smile.png) OUTDIR
Writes OUTDIR/v29-mask.png (hair pixels moved from body to the hair_outer layer) and
OUTDIR/v29-hair-alone.png (layer alone on magenta, for the no-costume check).
Hair colour was measured on the bust: hair H 122-131 / S ~65 / V 30-190; costume purple
H 133-138 / S 85-100 / V 190-225; gold H<20 / S>100. The two dark panels between the
gold shoulder pads and the braids are costume lining (curved light top edge, no strands)
and are excluded explicitly. The braid tie rings are included so they follow the braids.
"""
import subprocess, sys, tempfile
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw

bust, out = Path(sys.argv[1]), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as t:
    subprocess.check_call([sys.executable, str(Path(__file__).parent.parent / 'kohako-v28' / 'mask_probe.py'), str(bust), t + '/m28.png'])
    m28 = np.array(Image.open(t + '/m28.png').convert('L')) > 0
src = np.array(Image.open(bust).convert('RGB')); hsv = cv2.cvtColor(src, cv2.COLOR_RGB2HSV).astype(int)
H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
roi = cv2.dilate(m28.astype('uint8'), np.ones((5, 5), np.uint8)) > 0
gold = (H < 25) & (S > 45) & (V > 85)
garment = (H >= 133) & (S >= 78) & (V >= 105)
white = (S < 35) & (V > 185)
costume = gold | garment | white
hair = ((V < 105) | ((H >= 110) & (H <= 132) & (S < 90) & (V < 225))) & ~costume
m = cv2.morphologyEx((roi & hair).astype('uint8'), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
m &= ~costume
n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype('uint8'), 8)
keep = np.zeros(n, bool); keep[1:] = st[1:, cv2.CC_STAT_AREA] >= 40; m = keep[lab]
# drop thin costume outlines: keep only pixels within 3px of a >=4px-thick hair body
core = cv2.morphologyEx(m.astype('uint8'), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4, 4)))
m &= cv2.dilate(core, np.ones((7, 7), np.uint8)) > 0
ex = Image.new('L', (src.shape[1], src.shape[0])); d = ImageDraw.Draw(ex)
d.polygon([(238, 396), (287, 396), (292, 450), (290, 522), (276, 532), (252, 440)], fill=255)   # left pad lining
d.polygon([(518, 394), (569, 394), (561, 440), (541, 540), (527, 540), (521, 450)], fill=255)   # right pad lining
m &= np.asarray(ex) == 0
inc = Image.new('L', (src.shape[1], src.shape[0])); d = ImageDraw.Draw(inc)
d.ellipse((303, 428, 329, 446), fill=255); d.ellipse((476, 430, 502, 448), fill=255)            # braid tie rings
m |= (np.asarray(inc) > 0) & roi
inv = (~m).astype('uint8'); n2, l2, s2, _ = cv2.connectedComponentsWithStats(inv, 4)
for i in range(1, n2):
    if s2[i, cv2.CC_STAT_AREA] < 80: m[l2 == i] = True                                          # fill highlight holes
Image.fromarray((m * 255).astype('uint8')).save(out / 'v29-mask.png')
a = np.clip(cv2.GaussianBlur(m.astype('float32'), (0, 0), 0.7), 0, 1)[..., None]
Image.fromarray((src * a + np.array([255, 0, 255]) * (1 - a)).astype('uint8')).save(out / 'v29-hair-alone.png')
print('v28', int(m28.sum()), 'v29', int(m.sum()), 'removed', int((m28 & ~m).sum()), 'added', int((m & ~m28).sum()), 'outside-x<250', int(m[:, :250].sum()), 'x>=600', int(m[:, 600:].sum()))
