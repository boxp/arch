"""v11j (BOXP-441 TD-42): apply on a copy of the prepared v11g layout. No new images; the eye and face placement is unchanged.

1. Screen-right eye corner: the lower-left edge of hair_front covered the lash tail. Move that edge to the right
   and paint the area behind it (and the old lash tail left in the face layer) with nearby skin, so the tail is
   visible when open and skin, not background, shows when closed.
2. back_hair, arms, hands: remove the small pieces and hairline remnants that only become visible when the body
   turns (hidden behind the arms at rest).
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT'])
d = json.loads((p / 'layout.json').read_text())
L = {x['id']: x for x in d['layers']}

def load(k): return np.array(Image.open(p / L[k]['image']['path']).convert('RGBA'))
def save(k, a): Image.fromarray(a, 'RGBA').save(p / L[k]['image']['path'])

# 1. hair_front edge (1:1 with canvas)
hf = load('hair_front'); r = L['hair_front']['rect']; A = hf[..., 3].copy()
DX = 6
new = A.copy()
for y in range(A.shape[0]):
    cy = y + r['top']
    if not 258 <= cy <= 302: continue
    t = min(1.0, (cy - 258) / 12.0); dx = int(round(DX * t))
    if dx == 0: continue
    x0 = 640 - r['left']; x1 = 695 - r['left']
    row = A[y]; shifted = np.concatenate([np.zeros(dx, row.dtype), row[:-dx]])
    new[y, x0:x1] = np.minimum(row[x0:x1], shifted[x0:x1])
# smooth the moved edge so the row-wise shift does not leave stair steps
y0, y1 = 258 - r['top'], 303 - r['top']; x0, x1 = 640 - r['left'], 695 - r['left']
changed = cv2.dilate((new != A).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
blur = cv2.GaussianBlur(new, (0, 0), 1.0)
band = np.zeros_like(changed); band[y0:y1, x0:x1] = True
new[changed & band] = np.minimum(A, blur)[changed & band]
print('hair_front removed px', int(((A > 128) & (new <= 128)).sum()))
hf[..., 3] = new; save('hair_front', hf)

# skin behind the new edge in the face layer (2x image)
f = load('face'); fr = L['face']['rect']; s = f.shape[1] / fr['width']
for cy in range(262, 304):
    yi = int((cy - r['top'])); row = new[yi] if 0 <= yi < new.shape[0] else None
    if row is None: continue
    xs = np.where(row[640 - r['left']:] > 128)[0]
    edge = (xs[0] + 640) if len(xs) else 664
    edge = min(edge + 4, fr['left'] + fr['width'])
    fy0, fy1 = int((cy - fr['top']) * s), int((cy + 1 - fr['top']) * s)
    fx0, fx1 = int((640 - fr['left']) * s), int((edge - fr['left']) * s)
    sx0, sx1 = int((630 - fr['left']) * s), int((640 - fr['left']) * s)
    band = f[fy0:fy1, sx0:sx1]; ok = band[..., 3] > 200
    skin = np.median(band[ok][:, :3], axis=0) if ok.any() else np.array([250, 225, 215])
    f[fy0:fy1, fx0:fx1, :3] = skin.astype(np.uint8); f[fy0:fy1, fx0:fx1, 3] = 255
save('face', f)

# 2. remnants
def rest_cover():
    c = np.zeros((2048, 1143), bool)
    for k in ['body', 'panel_right', 'panel_left', 'arm_right', 'arm_left', 'hand_right', 'hand_left']:
        l = L[k]; rr = l['rect']; a = load(k)[..., 3]
        if a.shape[1] != rr['width'] or a.shape[0] != rr['height']: a = cv2.resize(a, (rr['width'], rr['height']))
        c[rr['top']:rr['top'] + rr['height'], rr['left']:rr['left'] + rr['width']] |= a > 128
    return c

cover = rest_cover()
bh = load('back_hair'); br = L['back_hair']['rect']; a = bh[..., 3]
sub = cover[br['top']:br['top'] + br['height'], br['left']:br['left'] + br['width']]
yy = np.arange(a.shape[0])[:, None] + br['top']
n, lab, st, _ = cv2.connectedComponentsWithStats((a > 128).astype(np.uint8), connectivity=8)
small = np.zeros_like(a, bool)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 900: small |= lab == i
opened = cv2.morphologyEx((a > 128).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
thin = (a > 0) & ~cv2.dilate(opened.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & sub & (yy[:, :] > 440)
kill = small | thin
print('back_hair small', int(small.sum()), 'thin hidden', int(thin.sum()))
bh[kill] = 0; save('back_hair', bh)
for k in ['arm_left', 'arm_right', 'hand_left', 'hand_right']:
    im = load(k); n, lab, st, _ = cv2.connectedComponentsWithStats((im[..., 3] > 16).astype(np.uint8), connectivity=8)
    if n <= 2: continue
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); drop = (lab > 0) & (lab != big) & (st[lab, cv2.CC_STAT_AREA] < 400)
    print(k, 'drop', int(drop.sum())); im[drop] = 0; save(k, im)

# The dark wedge beside the eye was a stray back_hair piece removed above; this also closes the space it left.
# Holes the trim or earlier cuts leave inside the head area are closed from behind with hair colour.
def union():
    c = np.zeros((2048, 1143), bool)
    for x in d['layers']:
        if x['id'].startswith(('eye_', 'mouth_', 'face_smile')): continue  # hidden or switched layers must not count as cover
        rr = x['rect']; a = load(x['id'])[..., 3]
        if a.shape[1] != rr['width'] or a.shape[0] != rr['height']: a = cv2.resize(a, (rr['width'], rr['height']))
        c[rr['top']:rr['top'] + rr['height'], rr['left']:rr['left'] + rr['width']] |= a > 96
    return c
u = union(); n, lab, st, _ = cv2.connectedComponentsWithStats((~u).astype(np.uint8), connectivity=4)
bh = load('back_hair'); br = L['back_hair']['rect']; filled = 0
hair = np.median(bh[(bh[..., 3] > 200)][:, :3], axis=0).astype(np.uint8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] > 3000 or st[i, cv2.CC_STAT_LEFT] < 420 or st[i, cv2.CC_STAT_LEFT] + st[i, cv2.CC_STAT_WIDTH] > 720: continue
    if st[i, cv2.CC_STAT_TOP] < 200 or st[i, cv2.CC_STAT_TOP] + st[i, cv2.CC_STAT_HEIGHT] > 440: continue
    m = cv2.dilate((lab == i).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)[br['top']:br['top'] + br['height'], br['left']:br['left'] + br['width']]
    bh[m & (bh[..., 3] < 255), :3] = hair; bh[m, 3] = 255; filled += int(st[i, cv2.CC_STAT_AREA])
# The strip behind the moved hair edge may open to the side hair instead of being enclosed.
box = np.zeros_like(u); box[262:322, 655:700] = True
m = cv2.dilate((box & ~u).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)[br['top']:br['top'] + br['height'], br['left']:br['left'] + br['width']]
bh[m & (bh[..., 3] < 255), :3] = hair; bh[m, 3] = 255; filled += int((box & ~u).sum())
print('enclosed holes filled px', filled); save('back_hair', bh)

d['name'] = 'kohako-full-v11j'
(p / 'layout.json').write_text(json.dumps(d, ensure_ascii=False, indent=2))
