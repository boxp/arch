"""v29: separate the long hair (v29-mask.png) from body.

Run after kohako-v26/create_parts.py (v6/layout = v17 layout + v25 ornament fix).
Inputs: /tmp/boxp441/kohako/bust-smile.png, /tmp/boxp441/aligned-v28.png (ECC-aligned
codex-shoulder-underlay-v28-1), /tmp/boxp441/v29-mask.png.
- Mask pixels not already in hair_back / hair_side_* are added to hair_back (enlarged to the
  full canvas), so the outer strands follow the same deformer as the existing back hair
  (a separate hair_outer layer duplicated the braids and moved them twice; rejected 1st try).
- Body under the mask (grown 2px, feathered) is replaced with the costume underlay; where the
  underlay is background white (outside the costume) the hair pixels themselves become
  transparent instead (tight mask, so no white blob and no half-transparent fringe).
"""
import json
from pathlib import Path
import cv2, numpy as np
from PIL import Image
p = Path('/tmp/boxp441'); d = p / 'v6/layout'; m = json.loads((d / 'layout.json').read_text())
CW, CH = m['canvas']['width'], m['canvas']['height']
L = {l['id']: l for l in m['layers']}

def canvas_rgba(layer):
    im = np.array(Image.open(d / layer['image']['path']).convert('RGBA')); out = np.zeros((CH, CW, 4), np.uint8)
    t, l = layer['rect']['top'], layer['rect']['left']; out[t:t + im.shape[0], l:l + im.shape[1]] = im; return out

orig = np.array(Image.open(p / 'kohako/bust-smile.png').convert('RGB'))
mask = np.array(Image.open(p / 'v29-mask.png').convert('L')) > 0
under = np.array(Image.open(p / 'aligned-v28.png').convert('RGB'))
existing = np.zeros((CH, CW), np.uint8)
for k in ('hair_back', 'hair_side_left', 'hair_side_right'):
    existing = np.maximum(existing, canvas_rgba(L[k])[..., 3])
extra = mask & (existing < 240)   # also fill where the v17 hair layers are only semi-opaque (else see-through gaps)
# hair_back: full canvas, add the extra strands with a 0.7px feathered edge
hb = canvas_rgba(L['hair_back']); a = (np.clip(cv2.GaussianBlur(extra.astype('float32'), (0, 0), 0.7), 0, 1) * 255).astype('uint8')
sel = a > hb[..., 3]; hb[sel, :3] = orig[sel]; hb[..., 3] = np.maximum(hb[..., 3], a)
# v17 hair_back also carries the white background visible between strands (invisible while the body
# behind it was the same white; it shows once the long hair moves off the body). Hair has no
# white (highlights are lavender, S>=45), so make near-white low-saturation pixels transparent.
hh = cv2.cvtColor(np.ascontiguousarray(hb[..., :3]), cv2.COLOR_RGB2HSV).astype('float32')
wht = np.clip((40 - hh[..., 1]) / 15, 0, 1) * np.clip((hh[..., 2] - 195) / 25, 0, 1)
hb[..., 3] = (hb[..., 3] * (1 - wht)).astype('uint8')
Image.fromarray(hb).save(d / L['hair_back']['image']['path'])
L['hair_back']['image'].update(width=CW, height=CH); L['hair_back']['rect'] = {'left': 0, 'top': 0, 'width': CW, 'height': CH}
# body
b = L['body']; top, left = b['rect']['top'], b['rect']['left']
im = np.array(Image.open(d / b['image']['path']).convert('RGBA')); h, w = im.shape[:2]
f = cv2.GaussianBlur(cv2.dilate(mask.astype('uint8'), np.ones((5, 5), np.uint8)).astype('float32'), (0, 0), 1.0)[top:top + h, left:left + w]
u = under[top:top + h, left:left + w]; hsv = cv2.cvtColor(u, cv2.COLOR_RGB2HSV)
bg = ((hsv[..., 1] < 25) & (hsv[..., 2] > 225)).astype('float32'); bg = cv2.GaussianBlur(bg, (0, 0), 1.0)
ft = np.clip(cv2.GaussianBlur(mask.astype('float32'), (0, 0), 0.7), 0, 1)[top:top + h, left:left + w]
tr = f * (1 - bg)            # costume underlay replaces the body (grown mask)
im[:, :, :3] = (im[:, :, :3] * (1 - tr[..., None]) + u * tr[..., None]).astype('uint8')
ob = cv2.cvtColor(orig[top:top + h, left:left + w], cv2.COLOR_RGB2HSV)
obg = ((ob[..., 1] < 40) & (ob[..., 2] > 200)).astype('float32')   # original background / anti-aliased white next to the strands
wide = cv2.GaussianBlur(cv2.dilate(mask.astype('uint8'), np.ones((15, 15), np.uint8)).astype('float32'), (0, 0), 1.0)[top:top + h, left:left + w]
im[:, :, 3] = (im[:, :, 3] * (1 - np.maximum(ft, wide * obg) * bg)).astype('uint8')   # outside the costume: hair + its white fringe become transparent
Image.fromarray(im).save(d / 'body.png')
m['name'] = 'kohako-v29'; (d / 'layout.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
print('v29 mask', int(mask.sum()), 'extra->hair_back', int(extra.sum()), 'body->transparent', int((ft * bg > 0.5).sum()), flush=True)
