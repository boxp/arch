"""v11p (BOXP-470 TD-07): apply on a copy of the v11o layout.

The hair that the body, arms and coat panels hid in the art never existed, and the earlier fill was blurred blobs and scraps of
arm outline. This replaces only that hidden part (target-mask-layout.png) with one generated hair fill. Everything else keeps
its pixels: the visible hair comes from the art, and the face, mouth and costume layers are not touched.

Without generation it also moves the black arm inner from back_hair to the arm layers, gives the art's gaps between strands
back, and removes tiny isolated fragments.

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

# 3. Green key inside the target only.
r, g, b = [F[..., i].astype(np.float32) for i in range(3)]
spill = g - np.maximum(r, b); key = 1 - np.clip((spill - 5) / 35, 0, 1); key[key < .2] = 0
# Below the arms the target's blocky edge would cut the generated tips, so let the fill follow its own silhouette where the layers above hide it at rest.
below = np.zeros((H, W), bool); below[780:] = True
outside_guide = np.ones((H, W), bool); outside_guide[Y0:Y0 + 800, X0:X0 + 800] = False; key[outside_guide] = 0  # F is black there, not keyed
extended = (key >= .5) & cover & below & ~T; T = T | extended; metrics['target_extended_px'] = int(extended.sum())
key[~T] = 0
rgb = F.astype(np.float32); rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(r, b) + 8)
inner = cv2.distanceTransform(T.astype(np.uint8), cv2.DIST_L2, 5)
blend = np.clip(inner / 5, 0, 1)  # 5 px cross-fade toward what lies outside the target, where that is hair
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

back_new = back.astype(np.float32)
a_old = back_new[..., 3] / 255; a_gen = key * blend + a_old * (1 - blend)
a_gen[a_old < .01] = key[a_old < .01]
a_gen = np.where(T, a_gen, a_old)
rgb_out = rgb * (key * blend)[..., None] + back_new[..., :3] * ((1 - blend) * a_old)[..., None]
rgb_out = rgb_out / np.maximum((key * blend + (1 - blend) * a_old)[..., None], 1e-6)
out = back_new.copy(); out[T, :3] = rgb_out[T]; out[..., 3] = a_gen * 255
# The generated fill stops short of the shoulder band; leave the earlier hair there, otherwise the strand has a hole above the arm.
shoulder = T & (key < .5) & (a_old > 0); shoulder[560:] = False
out[shoulder] = back_new[shoulder]; metrics['shoulder_kept_px'] = int(shoulder.sum())
back = np.clip(np.round(out), 0, 255).astype(np.uint8)

# Below the arms, earlier filler outside the fill stays hidden at rest and shows as blocks when the body turns: remove it.
junk = (back[..., 3] > 0) & cover & ~T & below; back[junk, 3] = 0; metrics['hidden_filler_removed_px'] = int(junk.sum())

# 4. The art has background between the strands here, the earlier pass had painted hair into it.
art_bg = art.min(2) > 235
roi = np.zeros((H, W), bool); roi[455:1171] = True
gap = (back[..., 3] > 0) & roi & ~cover & ~T & art_bg
back[gap, 3] = 0; metrics['gap_restored_px'] = int(gap.sum())
# Visible hair outside the target is the art: restore it, unmixed from the white ground so the anti-aliased rims are not dotted lines.
dark = art.min(2).astype(np.float32); aa = np.clip((246 - dark) / 46, 0, 1)
band = roi & ~cover & ~T & (back[..., 3] > 0)
un = np.clip((art[band].astype(np.float32) - (1 - aa[band])[:, None] * 255) / np.maximum(aa[band], .01)[:, None], 0, 255)
back[band, :3] = un.astype(np.uint8); back[band, 3] = np.minimum(back[band, 3], np.round(aa[band] * 255)).astype(np.uint8)
metrics['visible_restored_from_art_px'] = int(band.sum())

# 5. Fragments under 40 px that belong to nothing.
n, lab, st, _ = cv2.connectedComponentsWithStats(((back[..., 3] > 128) & roi).astype(np.uint8), connectivity=8)
small = np.isin(lab, [i for i in range(1, n) if st[i, 4] < 40])
back[small, 3] = 0; metrics['fragments_removed_px'] = int(small.sum()); metrics['fragment_components'] = int((st[1:, 4] < 40).sum())

store('back_hair', back)
metrics['target_alpha_coverage_after'] = round(float((back[..., 3][T] > 128).mean()), 3)
metrics['visible_hair_unchanged_outside_target_px'] = int(np.count_nonzero((orig_back[..., :3] != back[..., :3]).any(2) & ~T & (back[..., 3] > 0)))
print(json.dumps(metrics, ensure_ascii=False, indent=1))
if os.environ.get('METRICS'): Path(os.environ['METRICS']).write_text(json.dumps(metrics, ensure_ascii=False, indent=1))
