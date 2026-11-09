"""v11l (BOXP-441 TD-46..48): apply on a copy of the v11k layout. No new images.

1. Mouth: bring back the bust v45 mouth (the Owner's reference) from the v10k layout, where it is already mapped to the
   full-body head at the bust's mouth/iris ratio; drop the three-state kit mouth.
2. Front hair: smooth the character-left lock's inner edge, remove the dotted light pixels left in the face layer, close
   the notch at the crown where the art hair stub ends above the flower.
3. Back hair and hand edges: re-matte art-background edges from the art (they were binary), rebuild thin wisps as soft
   strands and remove the white/grey bits between them.
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT']); src = Path(os.environ['V10K']); art_path = os.environ['ART']
d = json.loads((p / 'layout.json').read_text()); L = {x['id']: x for x in d['layers']}
W, H = 1143, 2048
art = cv2.resize(np.array(Image.open(art_path).convert('RGB')), (W, H), interpolation=cv2.INTER_AREA)
ART_LAYERS = ['back_hair', 'leg_right', 'leg_left', 'foot_right', 'foot_left', 'body', 'panel_right', 'panel_left', 'arm_right', 'arm_left', 'hand_right', 'hand_left', 'neck', 'braid_right', 'braid_left', 'hair_side_right', 'hair_side_left']
def path(k): return p / L[k]['image']['path']
def canvas(k):
    r = L[k]['rect']; a = np.array(Image.open(path(k)).convert('RGBA'))
    if a.shape[:2] != (r['height'], r['width']): a = cv2.resize(a, (r['width'], r['height']), interpolation=cv2.INTER_AREA)
    c = np.zeros((H, W, 4), np.uint8); c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = a; return c
def store(k, c):
    r = L[k]['rect']; a = c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']]
    Image.fromarray(a, 'RGBA').save(path(k))
def ell(n): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * n + 1, 2 * n + 1))
def nearest(mask):
    _, lab = cv2.distanceTransformWithLabels((~mask).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.where(mask); cols = np.zeros((lab.max() + 1, 3), np.uint8); cols[lab[ys, xs]] = art[ys, xs]
    return cols[lab]

# 1. mouth
srcd = {x['id']: x for x in json.loads((src / 'layout.json').read_text())['layers']}
for k in ('mouth_open', 'face_smile'):
    im = Image.open(src / srcd[k]['image']['path']).convert('RGBA'); im.save(path(k))
    L[k]['rect'] = dict(srcd[k]['rect']); L[k]['image'].update(width=im.size[0], height=im.size[1])
d['layers'] = [x for x in d['layers'] if x['id'] != 'mouth_mid']; (p / L['mouth_mid']['image']['path']).unlink(); L.pop('mouth_mid')

C = {k: canvas(k) for k in ART_LAYERS + ['hair_front']}
# 0. the v11k underlap (26 px under the layers above) sticks out as dark blocks when hands, arms and hair move relative to
#    each other: keep only a short overlap around the v11j silhouettes for those layers
base = Path(os.environ['V11J']); basel = {x['id']: x for x in json.loads((base / 'layout.json').read_text())['layers']}
def base_alpha(k):
    r = basel[k]['rect']; a = np.array(Image.open(base / basel[k]['image']['path']).convert('RGBA'))[..., 3]
    if a.shape[:2] != (r['height'], r['width']): a = cv2.resize(a, (r['width'], r['height']), interpolation=cv2.INTER_AREA)
    c = np.zeros((H, W), np.uint8); c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = a; return c
trimmed = {}
for k, n in [('arm_right', 8), ('arm_left', 8), ('hand_right', 8), ('hand_left', 8)]:
    keep = cv2.dilate((base_alpha(k) >= 128).astype(np.uint8), ell(n)) > 0
    drop = (C[k][..., 3] > 0) & ~keep; C[k][drop, 3] = 0; trimmed[k] = int(drop.sum())
print('trim', trimmed)
# the fingertips were outside the hand rects and only showed through the arm underlap: put them on the hand layers
for k in ('hand_right', 'hand_left'):
    r = L[k]['rect']; z = np.zeros((H, W), bool); z[r['top'] + r['height'] - 16:r['top'] + r['height'] + 16, r['left'] - 6:r['left'] + r['width'] + 6] = True
    m = z & (art.min(2) < 232) & (C[k][..., 3] < 128)
    n, lab, st, _ = cv2.connectedComponentsWithStats((m | (C[k][..., 3] >= 128)).astype(np.uint8), connectivity=8)
    main = np.unique(lab[C[k][..., 3] >= 128]); m &= np.isin(lab, main[main > 0])
    C[k][m, :3] = art[m]; C[k][m, 3] = 255
    print(k, 'fingertip px', int(m.sum()))

# the art-derived back hair also carried glove/cuff/fingertip pixels behind the arms; they float free when the body turns.
# Below the shoulders, hair stops 8 px under the arms and that strip is repainted in the nearest visible hair colour.
bh = C['back_hair']; yy0 = (np.arange(H)[:, None] >= 430)
arms = cv2.dilate(np.any([C[x][..., 3] >= 128 for x in ('arm_right', 'arm_left', 'hand_right', 'hand_left')], axis=0).astype(np.uint8), ell(3)) > 0
torso = np.any([C[x][..., 3] >= 128 for x in ('body', 'panel_right', 'panel_left', 'leg_right', 'leg_left')], axis=0)
vis = (bh[..., 3] >= 128) & ~arms & yy0
strip = (cv2.dilate(vis.astype(np.uint8), ell(8)) > 0) & arms & ~torso & yy0 & (bh[..., 3] > 0)
_, lab = cv2.distanceTransformWithLabels((~vis).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ys, xs = np.where(vis); cols = np.zeros((lab.max() + 1, 3), np.uint8); cols[lab[ys, xs]] = bh[ys, xs, :3]
bh[strip, :3] = cols[lab[strip]]
drop = arms & ~torso & yy0 & (bh[..., 3] > 0) & ~strip
bh[drop, 3] = 0; print('back_hair behind arms: dropped', int(drop.sum()), 'strip', int(strip.sum()))

R_, G_, B_ = art[..., 0].astype(int), art[..., 1].astype(int), art[..., 2].astype(int)
B0 = art.min(2) >= 232
_n, _l, _s, _ = cv2.connectedComponentsWithStats(B0.astype(np.uint8), connectivity=4)
_big = np.zeros(_n, bool)
for i in range(1, _n):
    x, y, w, h, a = _s[i]; _big[i] = x == 0 or y == 0 or x + w >= W or y + h >= H or a >= 60
BG = _big[_l]

# 2a. character-left lock: one smooth inner edge instead of a per-pixel skin cut; soft end above the braid
s = C['hair_side_left']; Z = np.zeros((H, W), np.uint8)
cv2.fillPoly(Z, [np.array([(649, 228), (652, 252), (659, 278), (661, 290), (656, 303), (647, 320), (632, 337), (650, 333), (642, 350), (660, 372), (760, 372), (760, 205), (649, 205)], np.int32)], 255)
skin = (R_ > 205) & (G_ > 150) & (B_ > 130) & (R_ - B_ > 22)
mask = ((Z > 0) & ~skin & ~BG).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, ell(2)); mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, ell(1))
n, lab, st, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
mask = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.float32)
smooth = cv2.GaussianBlur(mask, (0, 0), 1.6) > .5
alpha = cv2.GaussianBlur(smooth.astype(np.float32), (0, 0), .7)
fade = np.clip((372 - np.arange(H, dtype=np.float32)) / 22, 0, 1)[:, None]   # blends into the braid/long hair below
zone = Z > 0
core = smooth & (cv2.erode(smooth.astype(np.uint8), ell(2)) > 0)
if core.any():
    f = nearest(core); edge = zone & smooth & ~core & (art.max(2) >= 150)   # keep the dark outline itself, only replace light rim pixels
    s[edge, :3] = f[edge]; dk = zone & smooth & ~core & (art.max(2) < 150); s[dk, :3] = art[dk]
s[zone, :3] = np.where(core[zone, None], art[zone], s[zone, :3])
s[zone, 3] = np.round(255 * alpha[zone] * fade[np.where(zone)[0], 0]).astype(np.uint8)

# 2b. crown: fade the transplanted outline into the art crown and fill the notch beside the flower
hf = C['hair_front'][..., 3].astype(np.float32)
for x in range(470, 520):
    ys = np.where(hf[:, x] > 16)[0]
    if len(ys) and ys[0] < 200: hf[ys[0]:ys[0] + 12, x] *= np.linspace(0, 1, 12)
C['hair_front'][..., 3] = hf.astype(np.uint8)
# 3a. re-matte edges against the art background
def rematte(c, bg):
    a = c[..., 3]; A = a >= 128
    if not A.any(): return
    er = cv2.erode(A.astype(np.uint8), ell(3)) > 0
    if not er.any(): return
    band = (cv2.dilate(A.astype(np.uint8), ell(2)) > 0) & ~er & (cv2.dilate(bg.astype(np.uint8), ell(3)) > 0)
    f = nearest(er).astype(np.float32); pix = art.astype(np.float32); span = 255 - f
    ch = span.argmax(2); yy, xx = np.indices((H, W)); best = span[yy, xx, ch]
    al = np.clip((255 - pix[yy, xx, ch]) / np.maximum(best, 1), 0, 1); al[al < .1] = 0; al[al > .9] = 1
    use = band & (best >= 60)
    au = al[use][:, None]; un = (pix[use] - (1 - au) * 255) / np.maximum(au, .25)
    c[use, :3] = np.clip(un * au + f[use] * (1 - au), 0, 255).astype(np.uint8); c[use, 3] = np.round(255 * al[use]).astype(np.uint8)
for k in ART_LAYERS:
    if k not in ('hair_side_left', 'hair_side_right'): rematte(C[k], BG)

# 2b (cont.): after re-matting, so the art background behind the stub does not reopen the notch
bh = C['back_hair']; box = np.zeros((H, W), bool); box[96:182, 440:532] = True
sil = ((C['hair_front'][..., 3] >= 128) | (bh[..., 3] >= 128)).astype(np.uint8)
notch = (cv2.morphologyEx(sil, cv2.MORPH_CLOSE, ell(18)) > 0) & (sil == 0) & box
hm = np.median(art[(art.max(2) < 120) & (bh[..., 3] >= 250)], axis=0).astype(np.uint8)
bh[notch, :3] = hm; bh[notch, 3] = 255
if notch.any():
    full = (bh[..., 3] >= 128).astype(np.uint8); rim = (cv2.dilate((full == 0).astype(np.uint8), ell(2)) > 0) & notch
    bh[rim, :3] = (hm * .55).astype(np.uint8)

# 2d. hidden head plate of the back hair: art skin/highlight bits there show through the gap beside the cheek as dots
bh = C['back_hair']; head = np.zeros((H, W), bool); head[70:345, 405:765] = True
br, bg_, bb = bh[..., 0].astype(int), bh[..., 1].astype(int), bh[..., 2].astype(int)
bad = head & (bh[..., 3] > 0) & (((br - bb > 12) | (bh[..., :3].min(2) > 120)) & (bb - br <= 25))
bh[bad, :3] = hm

# 2e. neck: the v11k underlap streaked the art around the cyan lines; restore art pixels where the face does not cover
fa = canvas('face')[..., 3]; open_ = cv2.dilate((fa >= 10).astype(np.uint8), ell(3)) == 0
zn = np.zeros((H, W), bool); zn[385:452, 528:622] = True
for k in ('neck', 'body'):
    m = zn & open_ & (C[k][..., 3] >= 250); C[k][m, :3] = art[m]

# 3b. thin wisps of the back hair (below the shoulders): soft strands, nothing white between them
cover = np.zeros((H, W), bool)
for k in ART_LAYERS:
    if k != 'back_hair': cover |= C[k][..., 3] >= 250
bh = C['back_hair']; a = bh[..., 3]; Zw = np.zeros((H, W), bool); Zw[430:] = True
core = (a >= 250) & (art.max(2) < 170) & Zw
core &= cv2.erode(core.astype(np.uint8), ell(1)) > 0
cand = (art.min(2) < 240) & (cv2.dilate((a > 0).astype(np.uint8), ell(5)) > 0) & Zw & ~cover
op = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, ell(2)) > 0
thin = cand & ~op & ~(cv2.dilate(cover.astype(np.uint8), ell(3)) > 0)
f = nearest(core).astype(np.float32); pix = art.astype(np.float32); span = 255 - f
ch = span.argmax(2); yy, xx = np.indices((H, W)); best = span[yy, xx, ch]
al = np.clip((255 - pix[yy, xx, ch]) / np.maximum(best, 1), 0, 1); al[al < .07] = 0
bh[thin, :3] = np.clip(f[thin], 0, 255).astype(np.uint8); bh[thin, 3] = np.round(255 * al[thin]).astype(np.uint8)
holes = B0 & Zw & ~cover
bh[holes, 3] = 0
vis = ((bh[..., 3] > 30) & Zw & ~cover).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(vis, connectivity=8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 22: bh[lab == i, 3] = 0

for k in ('hand_right', 'hand_left'):   # grow the rect to the rebuilt fingertips
    r = L[k]['rect']; ys, xs = np.where(C[k][..., 3] > 0); t, b, l, rr = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    r.update(left=int(l), top=int(t), width=int(rr - l), height=int(b - t)); L[k]['image'].update(width=int(rr - l), height=int(b - t))
for k in ART_LAYERS + ['hair_front']: store(k, C[k])

# 2c. dotted light pixels in the hair part of the face layer (2x layer image)
r = L['face']['rect']; fi = np.array(Image.open(path('face')).convert('RGBA')); sx = fi.shape[1] / r['width']
g = fi[..., :3].min(2).astype(np.uint8); tophat = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, ell(3))
dark = cv2.medianBlur(fi[..., :3].max(2).astype(np.uint8), 15) < 150
yt = int(round((262 - r['top']) * sx))
spots = (tophat > 40) & dark & (fi[..., 3] > 0); spots[yt:] = False
spots = cv2.dilate(spots.astype(np.uint8), ell(1))
fi[..., :3] = cv2.inpaint(fi[..., :3], spots, 3, cv2.INPAINT_TELEA)
# 2f. beside the character-left lock, the face layer's own broken hair line shows between skin and lock as dots: paint it skin
hs = cv2.resize(C['hair_side_left'][r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width'], 3], (fi.shape[1], fi.shape[0]), interpolation=cv2.INTER_LINEAR) > 64
box = np.zeros(fi.shape[:2], bool); box[int((295 - r['top']) * sx):int((350 - r['top']) * sx), int((636 - r['left']) * sx):int((668 - r['left']) * sx)] = True
band = (cv2.dilate(hs.astype(np.uint8), ell(int(round(6 * sx)))) > 0) & ~hs & box & (fi[..., 3] > 0)
cskin = (fi[..., :3].min(2) >= 170) & (fi[..., 3] >= 250) & ~band
_, lab2 = cv2.distanceTransformWithLabels((~cskin).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ys, xs = np.where(cskin); c2 = np.zeros((lab2.max() + 1, 3), np.uint8); c2[lab2[ys, xs]] = fi[ys, xs, :3]
fi[band, :3] = c2[lab2[band]]; fi[band, 3] = 255; print('cheek band', int(band.sum()))
Image.fromarray(fi, 'RGBA').save(path('face')); print('face spots', int(spots.sum()))
print('notch', int(notch.sum()), 'thin', int(thin.sum()), 'holes', int(holes.sum()))

d['name'] = 'kohako-full-v11l'
(p / 'layout.json').write_text(json.dumps(d, ensure_ascii=False, indent=2))
