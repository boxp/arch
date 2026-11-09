"""v11m (BOXP-470): apply on a copy of the v11l layout. No new images.

The hand layers were cut straight across the wrist; at rest the opening was covered only by a dark patch baked into
back_hair, so turning the body showed a gap and the patch floating free. Rebuild the wrist of each hand layer from the
source art and remove that patch from back_hair, so the hand carries its own pixels.
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT']); art_path = os.environ['ART']
d = json.loads((p / 'layout.json').read_text()); L = {x['id']: x for x in d['layers']}
W, H = 1143, 2048
art = cv2.resize(np.array(Image.open(art_path).convert('RGB')), (W, H), interpolation=cv2.INTER_AREA)
def path(k): return p / L[k]['image']['path']
def canvas(k):
    r = L[k]['rect']; a = np.array(Image.open(path(k)).convert('RGBA'))
    assert a.shape[:2] == (r['height'], r['width']), k
    c = np.zeros((H, W, 4), np.uint8); c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = a; return c
def store(k, c):
    r = L[k]['rect']; Image.fromarray(c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']], 'RGBA').save(path(k))
def ell(n): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * n + 1, 2 * n + 1))
def nearest(mask):
    _, lab = cv2.distanceTransformWithLabels((~mask).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.where(mask); c = np.zeros((lab.max() + 1, 3), np.uint8); c[lab[ys, xs]] = art[ys, xs]; return c[lab]
def poly(points):
    m = np.zeros((H, W), np.uint8); cv2.fillPoly(m, [np.array(points, np.int32)], 1); return m > 0

# The opening of each wrist, in canvas pixels, bounded by the cuff, the strap and the palm edge in the art. It stays
# clear of the hair tips beside the cuff. (x, y)
WRIST = {'hand_right': [(276, 925), (333, 925), (334, 945), (324, 949), (321, 968), (270, 968)],
         'hand_left': [(862, 925), (811, 925), (810, 945), (820, 949), (826, 968), (872, 968)]}
PATCH = {'hand_right': (266, 922, 342, 964), 'hand_left': (802, 922, 878, 964)}  # x0, y0, x1, y1 in back_hair

bh = canvas('back_hair'); dark = art.min(2)
for k, points in WRIST.items():
    c = canvas(k); hole = poly(points) & (c[..., 3] < 250)
    # The background of the art is white: alpha from its darkness, colour from the nearest solid art pixel.
    al = np.clip((246 - dark.astype(np.float32)) / 46, 0, 1)
    core = (dark < 200) & poly(points); colour = nearest(core)
    fill = hole & (al > 0)
    c[fill, :3] = np.where(np.repeat((dark[fill] < 200)[:, None], 3, 1), art[fill], colour[fill])
    c[fill, 3] = np.maximum(c[fill, 3], np.round(al[fill] * 255).astype(np.uint8))
    store(k, c)
    x0, y0, x1, y1 = PATCH[k]; box = np.zeros((H, W), bool); box[y0:y1, x0:x1] = True
    # Remove only what the rebuilt hand now covers: the hair tips next to the cuff are real art and stay.
    patch = box & (cv2.dilate((c[..., 3] >= 128).astype(np.uint8), ell(2)) > 0) & (bh[..., 3] > 0)
    bh[patch, 3] = 0
    n, lab, st, _ = cv2.connectedComponentsWithStats((box & (bh[..., 3] > 0)).astype(np.uint8), connectivity=8)
    crumbs = 0
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 40: bh[lab == i, 3] = 0; crumbs += int(st[i, cv2.CC_STAT_AREA])
    print(k, 'filled', int(fill.sum()), 'patch removed', int(patch.sum()), 'crumbs', crumbs)
store('back_hair', bh)
d['name'] = 'kohako-full-v11m'
(p / 'layout.json').write_text(json.dumps(d, ensure_ascii=False, indent=2))
