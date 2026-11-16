"""v38: remove hair remnants left in the body layer that show as small fragments on a head tilt (BOXP-441 TD-28).

Diagnosis (deployed v37, per-layer rendering at ParamAngleZ +30): the small dark fragment outside the
right shoulder (viewer right) is in the body layer (ArtMeshTopwear), not in the hair:
  * pixels not connected to the body itself - a floating purple hair highlight (canvas x552-570,
    y345-382, 251 px), a faint dotted line along the old outer hair outline on both sides, ~226
    components / ~570 px in total;
  * a dark tab of hair outline sticking up from the top of the right shoulder (canvas x>=564,
    y388-398), separated from the garment by a 1px transparent slit.
At rest these are hidden behind hair_back; when the head tilts, hair_back moves away and they show.

Fix (no new images): drop every body component that is not connected to the largest one (they are hidden
at rest), and move the dark tab into hair_back at the same canvas position (it is hair outline, and at rest
it also covers a small notch in hair_back, so deleting it would expose the background - tried and rejected).
The rest render is unchanged; on a tilt the tab now moves with the hair. The garment itself (largest
component, shoulder outline from y>=399) is unchanged.

LAYOUT (default /tmp/boxp441/v6/layout) can be overridden.
"""
import json, os
import numpy as np
import cv2
from PIL import Image

layout = os.environ.get('LAYOUT', '/tmp/boxp441/v6/layout')
lay = json.load(open(f'{layout}/layout.json'))
r = {l['id']: l['rect'] for l in lay['layers']}['body']
b = np.array(Image.open(f'{layout}/body.png').convert('RGBA'))
h, w = b.shape[:2]
yy, xx = np.mgrid[0:h, 0:w]
cx, cy = xx + r['left'], yy + r['top']

tab = (b[..., 3] > 0) & (cx >= 564) & (cx < 580) & (cy >= 388) & (cy <= 398)
rect = {l['id']: l['rect'] for l in lay['layers']}
assert rect['hair_back']['left'] == 0 and rect['hair_back']['top'] == 0, 'hair_back must cover the canvas'
hb = np.array(Image.open(f'{layout}/hair_back.png').convert('RGBA'))
src = np.zeros_like(hb)
src[r['top']:r['top'] + h, r['left']:r['left'] + w][tab] = b[tab]
sa = src[..., 3:4].astype(np.float32) / 255
da = hb[..., 3:4].astype(np.float32) / 255
oa = sa + da * (1 - sa)
rgb = (src[..., :3] * sa + hb[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
Image.fromarray(np.concatenate([np.clip(rgb, 0, 255), np.clip(oa * 255, 0, 255)], axis=2).round().astype(np.uint8)).save(f'{layout}/hair_back.png')
b[..., 3][tab] = 0
n, lab, st, _ = cv2.connectedComponentsWithStats((b[..., 3] > 0).astype(np.uint8), 8)
big = int(st[1:, 4].argmax()) + 1
loose = (lab > 0) & (lab != big)
b[..., 3][loose] = 0
Image.fromarray(b).save(f'{layout}/body.png')
print(f'v38 fix_fragments: shoulder tab {int(tab.sum())} px -> hair_back, loose components {n - 2} ({int(loose.sum())} px) removed from body')
