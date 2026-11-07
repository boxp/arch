"""v37: move the head hair that was left baked in the body layer into hair_back (BOXP-441 TD-27).

Diagnosis (deployed v36, per-layer rendering): the body layer ("top", ArtMeshTopwear) still held
the hair of the head itself - the outer rim of the crown and the side hair framing the face down to
the jaw - plus thin outlines of the long hair. The draw order is hair_back < body < face < front
hair, so the top of hair_back is hidden behind those body pixels. When the head turns, the face,
bangs, braids and the visible outer long hair follow the head, while the hair right next to the face
(body) stays with the torso; the two slide against each other and the hair reads as moving
independently of the face. v36's measurements tracked hair_back vertices (largely hidden), not the
pixels that are actually seen.

Fix (no new images): every opaque body pixel above the jaw line (canvas y < YCUT) outside the neck
column, plus the thin (< 5px) hair outlines on the sides of the body, is composited OVER hair_back at
the same canvas position and removed from the body. At rest the render is unchanged (hair_back is
right under the body), and above the jaw hair_back follows the head (v36 backhair-anchor), so this
hair now moves with the face.

Side effect, kept on purpose: psd2live reads the shoulder / waist lines from the body layer's mesh
footprint. With the head hair in the body it put the shoulder line inside the head (y ~ 92), so Body X
swung the whole head (face +-35px at Body X +-10, more than the shoulders). With the hair moved the torso
frame is right and the neck hardly moves on Body X, as psd2live intends; the long hair below the shoulders
then follows the torso's turn through kohako-v37/patch_body.py. (Leaving the moved pixels in the body at
alpha 8 did not keep the old frame - the anchors come from the mesh footprint - so GHOST defaults to 0.)

LAYOUT (default /tmp/boxp441/v6/layout), YCUT (default 345), GHOST (default 0) can be overridden.
"""
import json, os
import numpy as np
import cv2
from PIL import Image

layout = os.environ.get('LAYOUT', '/tmp/boxp441/v6/layout')
ycut = int(os.environ.get('YCUT', '345'))
ghost = int(os.environ.get('GHOST', '0'))
NX0, NX1, NECKY = 355, 470, 280  # neck column (canvas px): stays in the body

lay = json.load(open(f'{layout}/layout.json'))
rect = {l['id']: l['rect'] for l in lay['layers']}
assert rect['hair_back']['left'] == 0 and rect['hair_back']['top'] == 0, 'hair_back must cover the canvas'
b = np.array(Image.open(f'{layout}/body.png').convert('RGBA'))
hb = np.array(Image.open(f'{layout}/hair_back.png').convert('RGBA'))
bl, bt = rect['body']['left'], rect['body']['top']
h, w = b.shape[:2]
yy, xx = np.mgrid[0:h, 0:w]
cy, cx = yy + bt, xx + bl
op = b[..., 3] > 0
neck = (cx >= NX0) & (cx <= NX1) & (cy > NECKY)
head = op & (cy < ycut) & ~neck
# thin hair outlines left on the sides of the body (not the garment): opaque pixels removed by a 5x5 opening
opened = cv2.morphologyEx(op.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(bool)
dark = b[..., :3].astype(np.int32).max(axis=2) < 120
thin = op & ~opened & dark & ((cx < 280) | (cx > 530)) & (cy >= 200)
move = head | thin

src = np.zeros_like(hb)
src[bt:bt + h, bl:bl + w][move] = b[move]
sa = src[..., 3:4].astype(np.float32) / 255
da = hb[..., 3:4].astype(np.float32) / 255
oa = sa + da * (1 - sa)
rgb = (src[..., :3] * sa + hb[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
out = np.concatenate([np.clip(rgb, 0, 255), np.clip(oa * 255, 0, 255)], axis=2).round().astype(np.uint8)
Image.fromarray(out).save(f'{layout}/hair_back.png')
b[..., 3] = np.where(move, np.minimum(b[..., 3], ghost), b[..., 3]).astype(np.uint8)
Image.fromarray(b).save(f'{layout}/body.png')
print(f'v37 move_headhair: head {int(head.sum())} px, thin outlines {int(thin.sum())} px -> hair_back (ycut {ycut}, body keeps alpha {ghost})')
