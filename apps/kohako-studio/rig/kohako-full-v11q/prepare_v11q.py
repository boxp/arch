"""v11q (BOXP-470 TD-02): apply on a copy of the v11o layout, with the v11p fill and no new generation.

v11p's merge rule cut the fill: art-background pixels were punched back through it (slits), the polygon mask sliced it where
the art was body or arm (bites), and art hair and fill met on a hard line. Here the keyed fill is laid down whole, the art's
visible hair goes on top with a feathered seam, and the art's light anti-aliased rims are unmixed so they do not read as dots.

Env: LAYOUT (copy of v11o layout), ART, GEN (1254x1254 generated fill), MASK (target-mask-layout.png),
PENT (mask of arm inner pixels in back_hair, layout scale .npy), METRICS (json output path).
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT'])
d = json.loads((p / 'layout.json').read_text()); L = {x['id']: x for x in d['layers']}
W, H = 1143, 2048
X0, Y0, S = 170, 340, 800 / 1254  # guide canvas: layout x170-970 / y340-1140 scaled to 1254
art = np.array(Image.open(os.environ['ART']).convert('RGB').resize((W, H), Image.LANCZOS))
gen = np.array(Image.open(os.environ['GEN']).convert('RGB'))
assert gen.shape[:2] == (1254, 1254), gen.shape
T = np.array(Image.open(os.environ['MASK']).convert('L')) > 127
pent = np.load(os.environ['PENT'])
assert T.shape == (H, W) and pent.shape == (H, W) and (pent & ~T).sum() == 0


def canvas(k):
    r = L[k]['rect']; a = np.array(Image.open(p / L[k]['image']['path']).convert('RGBA'))
    assert a.shape[:2] == (r['height'], r['width']), k
    c = np.zeros((H, W, 4), np.uint8); c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = a; return c


def store(k, c):
    r = L[k]['rect']; Image.fromarray(c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']], 'RGBA').save(p / L[k]['image']['path'])


back = canvas('back_hair'); orig_back = back.copy()
cover = np.zeros((H, W), bool)
for x in d['layers']:
    if x['id'] != 'back_hair':
        r = x['rect']; a = np.array(Image.open(p / x['image']['path']).convert('RGBA'))  # some layer images differ from their rect
        cover[r['top']:r['top'] + a.shape[0], r['left']:r['left'] + a.shape[1]] |= a[:H - r['top'], :W - r['left'], 3] > 128
metrics = {}

# Tiny islands inside the target and leftover warm arm outlines next to it are also part of the fill.
n, lab, st, _ = cv2.connectedComponentsWithStats((~T).astype(np.uint8), connectivity=4)
islands = np.isin(lab, [i for i in range(1, n) if st[i, 4] < 200]); T = T | islands
rgb0 = back[..., :3].astype(int)
warm_line = (rgb0[..., 0] - rgb0[..., 2] > 12) & (rgb0[..., 0] > 50) & (back[..., 3] > 0) & ~T
near = cv2.dilate(T.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61))) > 0
warm_line &= near; T = T | warm_line
metrics['target_added_islands_px'] = int(islands.sum()); metrics['target_added_warm_line_px'] = int(warm_line.sum())

# 1. The arm inner belongs to the arm layers. Moving the pixels as they are keeps the picture at rest.
for k, side in [('arm_right', pent & (np.arange(W)[None, :] < W // 2)), ('arm_left', pent & (np.arange(W)[None, :] >= W // 2))]:
    arm = canvas(k); r = L[k]['rect']
    ys, xs = np.where(side)
    assert xs.min() >= r['left'] and xs.max() < r['left'] + r['width'] and ys.min() >= r['top'] and ys.max() < r['top'] + r['height'], k
    src = back[side].astype(np.float32); dst = arm[side].astype(np.float32); a = src[:, 3:] / 255; b = dst[:, 3:] / 255
    out_a = a + b * (1 - a); rgb = (src[:, :3] * a + dst[:, :3] * b * (1 - a)) / np.maximum(out_a, 1e-6)
    arm[side] = np.concatenate([np.clip(rgb, 0, 255), np.round(out_a * 255)], 1).astype(np.uint8)
    store(k, arm); metrics['moved_' + k] = int(side.sum())

# 2. Register the generated fill on the visible hair (ECC, translation and scale only), then bring it to layout scale.
G = np.zeros((H, W, 3), np.uint8); G[:] = (0, 255, 0)
ins = back[..., 3] > 128
keep = ins & ~cover & (np.abs(back[..., :3].astype(int) - art.astype(int)).max(2) <= 24) & ~pent
keep[:440] = False; keep[1010:] = False
G[keep] = art[keep]
guide = cv2.resize(G[Y0:Y0 + 800, X0:X0 + 800], (1254, 1254), interpolation=cv2.INTER_LANCZOS4)
keep_g = cv2.resize(keep[Y0:Y0 + 800, X0:X0 + 800].astype(np.uint8), (1254, 1254), interpolation=cv2.INTER_NEAREST) > 0
keep_g = cv2.erode(keep_g.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
g_g = cv2.cvtColor(guide, cv2.COLOR_RGB2GRAY).astype(np.float32); g_i = cv2.cvtColor(gen, cv2.COLOR_RGB2GRAY).astype(np.float32)
M = np.array([[1, 0, 0], [0, 1, 0]], np.float32)
_, M = cv2.findTransformECC(g_g, g_i, M, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_COUNT, 400, 1e-6), keep_g.astype(np.uint8), 5)
residual_layout = np.linalg.norm(cv2.transform(np.array([[[0, 0], [1254, 0], [0, 1254], [1254, 1254]]], np.float32), M)[0] - np.array([[0, 0], [1254, 0], [0, 1254], [1254, 1254]], np.float32), axis=1).max() * S
metrics['registration_corner_shift_px_layout'] = round(float(residual_layout), 2)
aligned = cv2.warpAffine(gen, M, (1254, 1254), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
diff = np.abs(aligned.astype(np.float32) - guide.astype(np.float32)).mean(2)
metrics['registration_mae_on_visible_hair'] = round(float(diff[keep_g].mean()), 2)
crop = cv2.resize(aligned, (800, 800), interpolation=cv2.INTER_AREA)
F = np.zeros((H, W, 3), np.uint8); F[Y0:Y0 + 800, X0:X0 + 800] = crop

# 3. Green key over the whole guide canvas. The fill is not cut by the target polygon any more.
r, g, b = [F[..., i].astype(np.float32) for i in range(3)]
spill = g - np.maximum(r, b); key = 1 - np.clip((spill - 5) / 35, 0, 1); key[key < .2] = 0
outside_guide = np.ones((H, W), bool); outside_guide[Y0:Y0 + 800, X0:X0 + 800] = False; key[outside_guide] = 0  # F is black there, not keyed
fill_top = int(np.where(T.any(1))[0].min()); key[:fill_top] = 0; metrics['fill_top_y'] = fill_top
rgb = F.astype(np.float32); rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(r, b) + 8)
# Close the pinholes the key left inside strands, and drop specks: both are keying noise, not hair shapes.
solid = key >= .5
n, lab, st, _ = cv2.connectedComponentsWithStats((~solid).astype(np.uint8), connectivity=4)
pin = np.isin(lab, [i for i in range(1, n) if st[i, 4] < 400])
filled = cv2.inpaint(np.clip(rgb, 0, 255).astype(np.uint8), pin.astype(np.uint8), 3, cv2.INPAINT_TELEA).astype(np.float32)
rgb[pin] = filled[pin]; key[pin] = 1; metrics['fill_pinhole_px'] = int(pin.sum())
n, lab, st, _ = cv2.connectedComponentsWithStats((key >= .5).astype(np.uint8), connectivity=8)
speck = np.isin(lab, [i for i in range(1, n) if st[i, 4] < 40]); key[speck] = 0; metrics['fill_speck_px'] = int(speck.sum())
hair_mask = key >= .5
metrics['target_px'] = int(T.sum()); metrics['target_covered_px'] = int((hair_mask & T).sum())

# Material checks on the fill before merge (proposal thresholds).
R, G_, B = [rgb[..., i] for i in range(3)]
gray = rgb.mean(2)
sd = np.sqrt(np.maximum(cv2.blur(gray ** 2, (7, 7)) - cv2.blur(gray, (7, 7)) ** 2, 0))
m = hair_mask & T
warm = (R - B > 18) & (R > 60)
metrics['warm_px'] = int((warm & m).sum())
metrics['magenta_px'] = int(((R > 170) & (B > 170) & (G_ < 110) & T).sum())
metrics['low_texture_rate'] = round(float(((sd < 2.5) & m).sum() / max(int(m.sum()), 1)), 3)
outside = F[..., 1].astype(np.float32) - np.maximum(F[..., 0], F[..., 2]).astype(np.float32) < 30
guard = cv2.dilate((T | ins).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
outside &= ~guard; outside[:Y0] = False; outside[Y0 + 800:] = False; outside[:, :X0] = False; outside[:, X0 + 800:] = False
metrics['hair_outside_target_px'] = int(outside.sum())

# 4. Lay the fill down whole; the art's visible hair goes on top.
old = back.astype(np.float32); a_old = old[..., 3] / 255
art_bg = art.min(2) > 235
roi = np.zeros((H, W), bool); roi[455:1171] = True
V = roi & ~cover & ~T & (a_old > 0) & ~art_bg
# Arm and sleeve outlines left at the edge of the arm, and thin scraps cut off from the art's strands, are not hair to keep on top of the fill.
warm = (art[..., 0].astype(int) - art[..., 2] > 18) & (art[..., 0] > 60)
V &= ~warm
n, lab, st, _ = cv2.connectedComponentsWithStats(V.astype(np.uint8), connectivity=8)
scrap = np.isin(lab, [i for i in range(1, n) if st[i, 4] < 300]) & (key >= .5); V &= ~scrap
# Lines one or two pixels wide left at the seam read as dotted ghosts over the fill. Keep the art's thin strands away from it.
near_seam = cv2.distanceTransform(1 - ((T | cover) & ~V).astype(np.uint8), cv2.DIST_L2, 5) < 10
thin = V & (cv2.morphologyEx(V.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) == 0) & near_seam & (key >= .5); V &= ~thin
metrics['art_thin_dropped_px'] = int(thin.sum())
metrics['art_scrap_dropped_px'] = int(scrap.sum()); metrics['art_warm_dropped_px'] = int((warm & roi & ~cover & ~T & (a_old > 0) & ~art_bg).sum())
# Keep the earlier hair only where the fill does not reach and the art gives nothing better: behind the shoulders, and under the arms above the elbow.
keep_old = roi & (a_old > 0) & (key < .5) & ~V & ((T & (np.arange(H)[:, None] < 560)) | (cover & ~T & (np.arange(H)[:, None] < 780)))
metrics['earlier_hair_kept_px'] = int(keep_old.sum())
base_a = np.where(keep_old, a_old, key); base_a[~roi] = 0
base_rgb = np.where(keep_old[..., None], old[..., :3], rgb)

# Unmix the art from its white ground so anti-aliased rims carry no white. Hair stays opaque away from the art's background.
dark = art.min(2).astype(np.float32)
near_bg = cv2.dilate(art_bg.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
aa = np.where(near_bg, np.clip((238 - dark) / 98, 0, 1), 1.0)
un = np.clip((art.astype(np.float32) - (1 - aa)[..., None] * 255) / np.maximum(aa, .05)[..., None], 0, 255)
# Feather only the seam against the hidden part. The art's outer silhouette and the edges of its own gaps stay as drawn.
seam = (T & (key >= .5) & ~V).astype(np.uint8)
d = cv2.distanceTransform(1 - seam, cv2.DIST_L2, 5)
# Where the art hair ends at an arm or panel, the boundary is hidden at rest but opens in motion, so give it a short feather too.
arm_seam = (cover & (key >= .5) & ~V).astype(np.uint8)
d2 = cv2.distanceTransform(1 - arm_seam, cv2.DIST_L2, 5)
fade = 1 - (1 - np.minimum(np.clip(d / 12, 0, 1), np.clip(d2 / 6, 0, 1))) * key
va = np.where(V, np.minimum(a_old, aa) * fade, 0)
oa = va + base_a * (1 - va)
ov = (un * va[..., None] + base_rgb * (base_a * (1 - va))[..., None]) / np.maximum(oa[..., None], 1e-6)
out = old.copy()
out[roi, :3] = ov[roi]; out[roi, 3] = np.round(oa[roi] * 255)
back = np.clip(np.round(out), 0, 255).astype(np.uint8)
metrics['visible_art_px'] = int(V.sum())
metrics['fill_over_art_background_px'] = int((hair_mask & ~cover & art_bg & roi).sum())

# 5. Fragments under 40 px that belong to nothing.
n, lab, st, _ = cv2.connectedComponentsWithStats(((back[..., 3] > 128) & roi).astype(np.uint8), connectivity=8)
small = np.isin(lab, [i for i in range(1, n) if st[i, 4] < 40])
back[small, 3] = 0; metrics['fragments_removed_px'] = int(small.sum()); metrics['fragment_components'] = int((st[1:, 4] < 40).sum())

# Pinholes between the fill and the art's strands open in motion as bright dots. Close only tiny enclosed ones.
n, lab, st, _ = cv2.connectedComponentsWithStats(((back[..., 3] <= 128) & roi).astype(np.uint8), connectivity=4)
tiny = np.isin(lab, [i for i in range(1, n) if st[i, 4] < 120])
pad = cv2.inpaint(back[..., :3], tiny.astype(np.uint8), 3, cv2.INPAINT_TELEA)
back[tiny, :3] = pad[tiny]; back[tiny, 3] = 255; metrics['pinhole_closed_px'] = int(tiny.sum()); metrics['pinhole_components'] = int((st[1:, 4] < 120).sum())
store('back_hair', back)
metrics['fill_px_lost'] = int((hair_mask & roi & (back[..., 3] <= 128)).sum())
print(json.dumps(metrics, ensure_ascii=False, indent=1))
if os.environ.get('METRICS'): Path(os.environ['METRICS']).write_text(json.dumps(metrics, ensure_ascii=False, indent=1))
