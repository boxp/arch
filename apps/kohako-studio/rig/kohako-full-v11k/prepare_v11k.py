"""v11k (BOXP-441 TD-43..46): apply on a copy of the v11j layout. No new images.

Sources the accepted full-body art (kohako-full-art-v0) for silhouette and hair pixels; face/eye placement is unchanged.
1. Character-left side hair (screen right): rebuild the lock from the art; drop the transplanted, stepped edge.
2. Restore art silhouette missing from the layers (crown, long hair) into back_hair.
3. White cuts: remove white fringe at cut edges, decontaminate edge colours, fill pinholes, and let lower layers
   underlap the layers above so seams do not open while moving. Lower layers stay inside their own rect (rig anchors).
4. Mouth: remove the pale block in the open mouth and the pale band under the closed line.
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT']); art_path = os.environ['ART']
d = json.loads((p / 'layout.json').read_text()); L = {x['id']: x for x in d['layers']}; order = [x['id'] for x in d['layers']]
W, H = 1143, 2048
art = cv2.resize(np.array(Image.open(art_path).convert('RGB')), (W, H), interpolation=cv2.INTER_AREA)
ART_LAYERS = ['back_hair', 'leg_right', 'leg_left', 'foot_right', 'foot_left', 'body', 'panel_right', 'panel_left', 'arm_right', 'arm_left', 'hand_right', 'hand_left', 'neck', 'braid_right', 'braid_left', 'hair_side_right', 'hair_side_left']
HAIRY = {'back_hair', 'braid_right', 'braid_left', 'hair_side_right', 'hair_side_left'}

def path(k): return p / L[k]['image']['path']
def canvas(k):
    r = L[k]['rect']; a = np.array(Image.open(path(k)).convert('RGBA'))
    if a.shape[:2] != (r['height'], r['width']): a = cv2.resize(a, (r['width'], r['height']), interpolation=cv2.INTER_AREA)
    c = np.zeros((H, W, 4), np.uint8); c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = a; return c
def store(k, c, grow=False):
    r = L[k]['rect']; m = c[..., 3] > 0
    if grow:
        ys, xs = np.where(m); t, b, l, rr = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        r.update(left=int(l), top=int(t), width=int(rr - l), height=int(b - t)); L[k]['image'].update(width=int(rr - l), height=int(b - t))
    a = c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']]
    Image.fromarray(a, 'RGBA').save(path(k))

C = {k: canvas(k) for k in ART_LAYERS + ['hair_front']}
nearwhite = art.min(2) >= 235
# art background = near-white regions that touch the border or are large; small enclosed white (highlights, collar) is content
_n, _l, _s, _ = cv2.connectedComponentsWithStats(nearwhite.astype(np.uint8), connectivity=4)
_bgk = np.zeros(_n, bool)
for _i in range(1, _n):
    _x, _y, _w, _h, _a = _s[_i]
    _bgk[_i] = _x == 0 or _y == 0 or _x + _w >= W or _y + _h >= H or _a >= 60
nearwhite = _bgk[_l]
hairlike = (art.max(2) < 150) & (art[..., 2].astype(int) >= art[..., 0].astype(int) - 6)   # dark blue-violet, excludes skin/gold
crown = np.zeros((H, W), bool); crown[60:300, 400:760] = True
sakura = np.zeros((H, W), bool); sakura[100:330, 410:515] = True   # the sakura ornament is in hair_front at its own position
hairlike = hairlike | (crown & ~sakura & ~nearwhite & (art[..., 0].astype(int) < 200))

# 1. character-left lock from the art
poly = np.array([(649, 228), (652, 252), (659, 278), (661, 290), (656, 303), (647, 320), (632, 337), (650, 333), (642, 350), (660, 360), (760, 360), (760, 205), (649, 205)], np.int32)
Z = np.zeros((H, W), np.uint8); cv2.fillPoly(Z, [poly], 255)
R_, G_, B_ = art[..., 0].astype(int), art[..., 1].astype(int), art[..., 2].astype(int)
skin = (R_ > 205) & (G_ > 150) & (B_ > 130) & (R_ - B_ > 22)
lockm = (Z > 0) & ~skin & ~nearwhite
lockm = cv2.morphologyEx(lockm.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(lockm, connectivity=8)
if n > 2: lockm = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
alpha = cv2.GaussianBlur((lockm * 255).astype(np.uint8), (0, 0), 0.7)
s = C['hair_side_left']; lk = alpha > 0
s[lk, :3] = art[lk]; s[..., 3] = np.maximum(s[..., 3], alpha)
# keep only what lies outside the skin side of the boundary
s[(Z > 0) & skin, 3] = 0
# feather the old hair_front out over y=236..256 inside the zone so the rebuilt lock shows
hf = C['hair_front']; fz = np.zeros((H, W), np.float32); fz[Z > 0] = 1
ramp = np.clip((np.arange(H, dtype=np.float32) - 236) / 20, 0, 1)[:, None]
hf[..., 3] = (hf[..., 3] * (1 - fz * ramp)).astype(np.uint8)
print('lock px', int(lockm.sum()))

# 2. silhouette restore into back_hair (dark hair pixels only; art shadow under the feet is excluded)
def union(ids):
    u = np.zeros((H, W), np.uint8)
    for k in ids: u = np.maximum(u, C[k][..., 3] if k in C else canvas(k)[..., 3])
    return u
vis = [k for k in order if not k.startswith(('eye_closed', 'eye_mid', 'mouth_mid', 'mouth_open', 'face_smile'))]
U = union(vis)
hb = np.zeros((H, W), bool); hb[:1940] = True
miss = (U < 250) & ~nearwhite & hb
add = miss & hairlike
bh = C['back_hair']; bh[add, :3] = art[add]; bh[add, 3] = 255
print('back_hair restored', int(add.sum()), 'non-hair still missing', int((miss & ~hairlike).sum()))

# head underplate: the whole head silhouette from the art, always hidden at rest, so head-follow layers never open onto
# the background (crown slit, eye-corner nicks) while the head moves; non-hair pixels become plain hair colour
hm = np.median(art[hairlike & (U >= 250)], axis=0).astype(np.uint8) if (hairlike & (U >= 250)).any() else np.array([50, 48, 62], np.uint8)
head = np.zeros((H, W), bool); head[70:345, 405:765] = True; head &= ~nearwhite
hdark = (art.max(2) < 135) & head
plate = head & ((bh[..., 3] < 250)) & ~sakura
bh[plate, :3] = hm; bh[plate & hdark, :3] = art[plate & hdark]; bh[plate, 3] = 255

# hair_front's own top outline would read as a second line inside the restored crown; fade it into the art crown
hfa = C['hair_front'][..., 3].astype(np.float32)
for x in range(520, 720):
    ys = np.where(hfa[:, x] > 16)[0]
    if len(ys) == 0 or ys[0] > 260: continue
    y0 = ys[0]; hfa[y0:y0 + 10, x] *= np.linspace(0, 1, 10)
C['hair_front'][..., 3] = hfa.astype(np.uint8)

# non-hair art pixels go to the nearest art layer inside its own rect
rest = miss & ~hairlike
if rest.any():
    best = None; bestd = None
    for k in ART_LAYERS:
        if k in HAIRY: continue
        r = L[k]['rect']; dist = cv2.distanceTransform((C[k][..., 3] < 128).astype(np.uint8), cv2.DIST_L2, 3)
        out = np.ones((H, W), bool); out[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = False; dist[out] = 1e6
        if best is None: best = np.zeros((H, W), np.uint8); bestd = dist.copy()
        else: better = dist < bestd; best[better] = ART_LAYERS.index(k); bestd[better] = dist[better]
    for i, k in enumerate(ART_LAYERS):
        if k in HAIRY: continue
        m = rest & (best == i) & (bestd < 40)
        if m.any(): C[k][m, :3] = art[m]; C[k][m, 3] = 255

# 3. white cuts
def nearest_opaque(c):
    a = c[..., 3]; src = (a >= 250).astype(np.uint8)
    if src.sum() == 0: return c
    _, labels = cv2.distanceTransformWithLabels(1 - src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.where(src); colors = np.zeros((labels.max() + 1, 3), np.uint8)
    colors[labels[ys, xs]] = c[ys, xs, :3]
    edge = (a > 0) & (a < 250); c[edge, :3] = colors[labels[edge]]
    return c
collar = np.zeros((H, W), bool); collar[400:520, 510:640] = True
for k in ART_LAYERS:
    c = C[k]
    for _ in range(3):   # remove white/grey fringe connected to transparency
        a = c[..., 3]; near = cv2.dilate((a < 128).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        lo = c[..., :3].min(2); sat = c[..., :3].max(2).astype(int) - lo
        fringe = near & (a > 0) & ((lo >= 205) | ((k in HAIRY) & (lo >= 105) & (sat < 40)))
        if k == 'body': fringe &= ~collar
        c[fringe, 3] = 0
    # pinholes: close 1-2px transparent cracks using art pixels
    a = c[..., 3] > 128
    closed = cv2.morphologyEx(a.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool) & ~a & ~nearwhite
    c[closed, :3] = art[closed]; c[closed, 3] = 255
    nearest_opaque(c)
# underlap: extend each lower layer under the opaque layers drawn above it, within its own rect, using its own edge colour
above = np.zeros((H, W), bool)
N = 26
for k in reversed(order):
    if k.startswith(('eye_', 'mouth_', 'face_')): continue
    if k in C and k != 'hair_front':
        c = C[k]; r = L[k]['rect']; a = c[..., 3] >= 250
        rectm = np.zeros((H, W), bool); rectm[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = True
        if k == 'hair_side_left': rectm[:] = True
        band = cv2.dilate(a.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * N + 1, 2 * N + 1))).astype(bool) & ~a & above & rectm
        if a.any() and band.any():
            # smooth fill (normalised blur of the layer's own colour) instead of streaky nearest-pixel extrusion
            w = cv2.GaussianBlur(a.astype(np.float32), (0, 0), N / 2) + 1e-4
            col = cv2.GaussianBlur((c[..., :3] * a[..., None]).astype(np.float32), (0, 0), N / 2) / w[..., None]
            _, labels = cv2.distanceTransformWithLabels((~a).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
            ys, xs = np.where(a); colors = np.zeros((labels.max() + 1, 3), np.uint8); colors[labels[ys, xs]] = c[ys, xs, :3]
            weak = w[band] < 0.02
            v = np.clip(col[band], 0, 255).astype(np.uint8); v[weak] = colors[labels[band]][weak]
            c[band, :3] = v; c[band, 3] = 255
    src = C[k][..., 3] if k in C else canvas(k)[..., 3]
    above |= src >= 250

for k in ART_LAYERS: store(k, C[k], grow=k in ('back_hair', 'hair_side_left'))
store('hair_front', C['hair_front'])

# 4. mouth
mo = np.array(Image.open(path('mouth_open')).convert('RGBA')).astype(np.float32); h, w = mo.shape[:2]
rgb = mo[..., :3]; a = mo[..., 3]
line = (rgb.max(2) < 120) & (a > 40)             # upper lip stroke and rim stay
interior = (a > 40) & ~line
ys = np.where(interior.any(1))[0]; y0, y1 = ys.min(), ys.max()
yy = np.tile(((np.arange(h, dtype=np.float32) - y0) / max(1, y1 - y0))[:, None], (1, w))
deep = np.array([96, 30, 46], np.float32); tongue = np.array([186, 88, 100], np.float32)
# darken the throat; a low soft tongue replaces the pale block read as front teeth
t = np.clip((yy - 0.52) / 0.32, 0, 1) ** 1.3; t = t[..., None]
col = deep * (1 - t) + tongue * t
rgb[interior] = col[interior]; mo[..., :3] = rgb
Image.fromarray(np.clip(mo, 0, 255).astype(np.uint8), 'RGBA').save(path('mouth_open'))
# closed mouth: reuse the half-open layer's upper lip stroke (same curve as the kit mouth sheet) as one continuous line
sm = np.array(Image.open(path('mouth_mid')).convert('RGBA'))
dark = (sm[..., :3].max(2) < 140)
sm[~dark, 3] = 0
Image.fromarray(sm, 'RGBA').save(path('face_smile'))

d['name'] = 'kohako-full-v11k'
(p / 'layout.json').write_text(json.dumps(d, ensure_ascii=False, indent=2))
