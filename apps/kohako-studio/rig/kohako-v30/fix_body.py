"""v30: close the holes left in body at the shoulders (v29 residue).

Run right after kohako-v29/probe.py. Diagnosed from the v29 recording (thinking, t~6.0s): the
"small white fragment" at the top of the left shoulder pad is a transparent hole in body, between
the pad and the neck, where the generated underlay was background white and probe.py made the
body transparent. It is enclosed by costume, so it should be costume, not background.
Only the shoulder sides (canvas x<270 or x>550, the white collar in the middle is untouched) and
within 21px of the hair mask:
  - the triangle under the left shoulder line (pad top -> collar) -> flat dark suit colour,
    alpha 255 (a first try that made it transparent made the white patch larger)
  - near-white low-saturation pixels touching the outside (the white fringe) -> alpha 0
"""
import json
from pathlib import Path
import cv2, numpy as np
from PIL import Image
p = Path('/tmp/boxp441'); d = p / 'v6/layout'; m = json.loads((d / 'layout.json').read_text())
CW, CH = m['canvas']['width'], m['canvas']['height']
b = next(l for l in m['layers'] if l['id'] == 'body'); top, left = b['rect']['top'], b['rect']['left']
im = np.array(Image.open(d / b['image']['path']).convert('RGBA')); h, w = im.shape[:2]
mask = (np.array(Image.open(p / 'v29-mask.png').convert('L')) > 0).astype('uint8')
side = np.zeros((CH, CW), np.uint8); side[:, :270] = 1; side[:, 550:] = 1
reg = (cv2.dilate(mask, np.ones((21, 21), np.uint8)) & side)[top:top + h, left:left + w].astype(bool)
tr = (im[..., 3] < 128).astype('uint8')
pad = np.pad(tr, 1, constant_values=1); ff = pad.copy(); fm = np.zeros((h + 4, w + 4), np.uint8)
cv2.floodFill(ff, fm, (0, 0), 2); outside = (ff[1:-1, 1:-1] == 2)
# The left shoulder between the pad top and the collar was hidden by the braid in the original and the
# generated underlay is background there, so body ends in a flat cut at y~385 and the page shows through
# once the hair moves. Fill the triangle under a natural shoulder line (collar side (332,353) -> pad top
# (232,398), stopping left of the gold collar band so it does not smear upward) with the dark suit colour, only where body is transparent.
tri = np.zeros((CH, CW), np.uint8)
cv2.fillPoly(tri, [np.array([(222, 404), (332, 353), (332, 404)], np.int32)], 1)
hm = tri[top:top + h, left:left + w].astype(bool) & (im[..., 3] < 250)
# flat dark suit colour (inpainting smeared the gold stripe at x~275 upward)
cv = cv2.cvtColor(np.ascontiguousarray(im[..., :3]), cv2.COLOR_RGB2HSV)
band = np.zeros((h, w), bool); band[400 - top:420 - top, 240 - left:330 - left] = True
dark = band & (im[..., 3] > 250) & (cv[..., 2] < 90)
col = np.median(im[dark, :3], axis=0).astype('uint8')
im[hm, :3] = col; im[hm, 3] = 255
print('v30 fill colour', col.tolist(), 'from', int(dark.sum()), 'px', flush=True)
outside &= ~hm
bh = cv2.cvtColor(np.ascontiguousarray(im[..., :3]), cv2.COLOR_RGB2HSV); wht = (bh[..., 1] < 40) & (bh[..., 2] > 200)
near_out = cv2.dilate(outside.astype('uint8'), np.ones((5, 5), np.uint8)).astype(bool)
fringe = wht & near_out & reg & (im[..., 3] > 0)
im[fringe, 3] = 0
Image.fromarray(im).save(d / 'body.png')
m['name'] = 'kohako-v30'; (d / 'layout.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
print('v30 shoulder filled', int(hm.sum()), 'white fringe removed', int(fringe.sum()), flush=True)
