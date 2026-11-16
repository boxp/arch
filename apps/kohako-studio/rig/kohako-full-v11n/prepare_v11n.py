"""v11n (BOXP-470): apply on a copy of the v11m layout. No new images.

Layer-solo renders and mesh-vertex measurements of v11m showed three separate causes, all hidden at rest:
- back_hair below the shoulders was a patchwork: holes and stair-stepped cuts where the arms and panels were cut out,
  dark filler blobs, and a purple/gold strip of the panel baked in. Hair moves about 12 px more than the arm at Body X 5.
- that strip slid out past the panel edge when the body turned, which read as a cut in the skirt.
- the panel layers carried a wedge of the leg on their inner side, and the body layer ended on a straight line at
  y=1016 over the thighs while the legs move differently, so the suit lines broke and the thigh visibly shifted.

So: rebuild back_hair below the shoulders from the art with hair continuing under the garments, move the leg wedge from
the panels to the legs, repaint what the panels hide on the legs, and fade the body's lower edge into the legs.
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT']); art_path = os.environ['ART']
d = json.loads((p / 'layout.json').read_text()); L = {x['id']: x for x in d['layers']}
W, H = 1143, 2048
art = cv2.resize(np.array(Image.open(art_path).convert('RGB')), (W, H), interpolation=cv2.INTER_AREA)
dark = art.min(2).astype(np.float32)
def path(k): return p / L[k]['image']['path']
def canvas(k):
    r = L[k]['rect']; a = np.array(Image.open(path(k)).convert('RGBA'))
    assert a.shape[:2] == (r['height'], r['width']), k
    c = np.zeros((H, W, 4), np.uint8); c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = a; return c
def store(k, c):
    r = L[k]['rect']; Image.fromarray(c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']], 'RGBA').save(path(k))
def ell(n): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * n + 1, 2 * n + 1))
def dilate(m, n): return cv2.dilate(m.astype(np.uint8), ell(n)) > 0
def nearest(mask, img):
    """Per-pixel colour of the nearest True pixel of mask in img."""
    _, lab = cv2.distanceTransformWithLabels((~mask).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.where(mask); c = np.zeros((lab.max() + 1, 3), np.uint8); c[lab[ys, xs]] = img[ys, xs]; return c[lab]
def largest(c, th=60):
    n, lab, st, _ = cv2.connectedComponentsWithStats((c[..., 3] >= th).astype(np.uint8), connectivity=8)
    return lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))

layers = {k: canvas(k) for k in ['back_hair', 'body', 'panel_right', 'panel_left', 'leg_right', 'leg_left', 'arm_right', 'arm_left', 'hand_right', 'hand_left']}

# 1. Garments keep only their own body: drop floating crumbs from arms, hands and panels.
for k in ['arm_right', 'arm_left', 'hand_right', 'hand_left', 'panel_right', 'panel_left']:
    keep = dilate(largest(layers[k]), 2); before = int((layers[k][..., 3] > 0).sum())
    layers[k][~keep, 3] = 0; print(k, 'crumbs removed', before - int((layers[k][..., 3] > 0).sum()))

# 1b. The outermost strip of each panel existed only inside back_hair. It belongs to the panel: extend each row
# outwards through the art until the white ground, or into the hair by no more than the outline width.
art_alpha = np.clip((246 - dark) / 46, 0, 1)
for k, outward in [('panel_right', -1), ('panel_left', 1)]:
    c = layers[k]; added = 0
    for y in range(800, 1262):
        xs = np.where(c[y, :, 3] >= 128)[0]
        if len(xs) == 0: continue
        x = int(xs.min()) if outward < 0 else int(xs.max()); darkrun = 0
        for step in range(1, 70):
            nx = x + outward * step
            if nx < 0 or nx >= W or art_alpha[y, nx] <= .1: break
            darkrun = darkrun + 1 if art[y, nx].max() < 110 else 0
            if darkrun > 5: break
            a = int(round(art_alpha[y, nx] * 255))
            if a > c[y, nx, 3]:
                c[y, nx, :3] = art[y, nx] if a == 255 else np.clip((art[y, nx].astype(np.float32) - (1 - art_alpha[y, nx]) * 255) / art_alpha[y, nx], 0, 255).astype(np.uint8)
                c[y, nx, 3] = a; added += 1
    print(k, 'outer strip restored', added)

# 2. Move the leg wedge from the panels to the legs. The panel's inner outline is found row by row (first non-suit
# pixel from the inner edge), fitted as a smooth curve, and everything past it (plus the 3 px outline) goes to the leg.
def legish(c):
    r, g, b = [c[..., i].astype(int) for i in range(3)]
    return (c[..., :3].max(2) < 112) | ((g > 130) & (b > 130) & (r < 120))
wedges = {}
for k, inner in [('panel_right', 1), ('panel_left', -1)]:
    c = layers[k]; leg = legish(c); ys, xb = [], []
    for y in range(888, 1250):
        xs = np.where(c[y, :, 3] > 40)[0]
        if len(xs) == 0: continue
        order = xs[::-1] if inner == 1 else xs
        run = 0
        for x in order:
            if leg[y, x]: run += 1
            else: break
        if run >= 6 and run < len(order): ys.append(y); xb.append(int(order[run]))
    ys, xb = np.array(ys, float), np.array(xb, float)
    keep = np.ones(len(ys), bool)
    for _ in range(4):
        f = np.polyfit(ys[keep], xb[keep], 3); keep = np.abs(np.polyval(f, ys) - xb) < 4
    edge = np.polyval(f, np.arange(H)); last = int(ys[keep].max()); s_ = (edge[last] - edge[last - 40]) / 40
    edge[last:] = edge[last] + s_ * (np.arange(H)[last:] - last)  # straight on down to the hem, where the fit has no rows
    print(k, 'edge fit on', int(keep.sum()), 'rows; x at 900/1000/1100/1200:', [round(float(edge[y]), 1) for y in (900, 1000, 1100, 1200)], 'rows', int(ys.min()), int(ys.max()))
    y0, y1 = int(ys[keep].min()), 1262
    wedge = np.zeros((H, W), bool); X = np.arange(W)
    for y in range(y0, min(y1 + 1, 1262)):
        lim = edge[y] + 3 * inner  # inner==1: wedge is at larger x than the outline
        wedge[y] = (X > lim) if inner == 1 else (X < lim)
    wedge &= c[..., 3] > 0
    # Only where a leg or the body lies under it, with a margin: elsewhere the sliver stays on the panel, or a slit opens.
    support = (layers['leg_right' if k == 'panel_right' else 'leg_left'][..., 3] > 0) | (layers['body'][..., 3] > 0)
    wedge &= cv2.erode(support.astype(np.uint8), ell(6)) > 0
    wedges[k] = wedge; c[wedge, 3] = 0; print(k, 'leg wedge moved', int(wedge.sum()))
    b_ = layers['body']; on = wedge & (b_[..., 3] > 0); b_[on, :3] = art[on]; b_[on, 3] = 255  # above the legs' top the suit is the body layer

# 3. Legs: visible art first, then repaint what the panels hide so nothing smeared shows if a panel moves.
for k, panel in [('leg_right', 'panel_right'), ('leg_left', 'panel_left')]:
    c = layers[k]; w = wedges[panel]
    c[w, :3] = art[w]; c[w, 3] = 255
    hidden = dilate(layers[panel][..., 3] >= 40, 3) & (c[..., 3] > 0) & ~dilate(w, 1)
    visible = (c[..., 3] >= 250) & ~hidden
    src = visible & (c[..., :3].max(2) < 100) & (c[..., 1].astype(int) - c[..., 0] < 16)  # the suit colour, never the cyan line or its glow
    col = nearest(src, c[..., :3])
    blur = cv2.GaussianBlur(col, (0, 0), 2.0)
    c[hidden, :3] = blur[hidden]; print(k, 'hidden repainted', int(hidden.sum()))
    shown = (c[..., 3] > 0) & ~hidden; c[shown, :3] = art[shown]  # what is on show at rest is the art, with no seam against the fade

# 4. Fade the straight lower edge of the body into the legs; the legs carry the same art in the fade.
body = layers['body']; Y0, Y1 = 984, 1016
t = np.clip((Y1 - np.arange(H, dtype=np.float32)) / (Y1 - Y0), 0, 1); ramp = t * t * (3 - 2 * t)
for k in ['leg_right', 'leg_left']:
    c = layers[k]; band = (c[..., 3] > 0) & (body[..., 3] > 0); band[:986] = False; band[1020:] = False
    c[band, :3] = art[band]; c[band, 3] = 255
legs = (layers['leg_right'][..., 3] >= 250) | (layers['leg_left'][..., 3] >= 250)
fade = (np.arange(H)[:, None] >= Y0) & ((body[..., 3] > 0) & legs)   # only where a leg really lies underneath

a = body[..., 3].astype(np.float32); a = np.where(fade, a * ramp[:, None], a); body[..., 3] = np.round(a).astype(np.uint8)
print('body fade px', int(fade.sum()), 'unsupported', int(((body[..., 3] > 0) & (np.arange(H)[:, None] >= Y1) & ~legs).sum()))

# 5. Rebuild back_hair below the shoulders from the art; hair continues under the arms and panels.
Y_H = 470
garment = np.zeros((H, W), bool)
for k in ['arm_right', 'arm_left', 'hand_right', 'hand_left', 'panel_right', 'panel_left', 'body', 'leg_right', 'leg_left']:
    garment |= layers[k][..., 3] >= 128
ring = dilate(garment, 5)
alpha = np.clip((246 - dark) / 46, 0, 1)
r, g, b = [art[..., i].astype(int) for i in range(3)]
hair_colour = (art.max(2) < 125) | ((g >= r - 8) & (b >= g - 3) & (art.max(2) < 250))  # dark, or the cool grey-blue strands
visible = (alpha > .12) & ~ring & hair_colour; visible[:Y_H] = False
hem = dilate((layers['panel_right'][..., 3] > 0) | (layers['panel_left'][..., 3] > 0), 14); hem[:1040] = False
visible &= ~hem  # the panels' own outline near the hem is not hair
visible |= cv2.morphologyEx(visible.astype(np.uint8), cv2.MORPH_CLOSE, ell(2)).astype(bool) & (alpha > .05) & ~ring  # no pinholes in thin strands
n, lab, st, _ = cv2.connectedComponentsWithStats(visible.astype(np.uint8), connectivity=8)
big = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= 60]); visible &= dilate(big, 6)
# Hair continues under the garments; it never spreads over the white background around them. Growth limit: what the
# hair moves relative to the arm at Body X 10, about 30 px, plus margin.
no_hand = np.zeros((H, W), bool)
for k in ['arm_right', 'arm_left', 'panel_right', 'panel_left', 'body', 'leg_right', 'leg_left']: no_hand |= layers[k][..., 3] >= 128
allowed = no_hand | (dilate(no_hand, 5) & (alpha > .12)); allowed[1065:] = False  # the hair ends above the panel hems and stays off the hands
under = visible.copy(); step = ell(3)
for _ in range(16):
    under = cv2.dilate(under.astype(np.uint8), step).astype(bool) & (visible | allowed)
under |= visible
closed = cv2.morphologyEx(under.astype(np.uint8), cv2.MORPH_CLOSE, ell(6)).astype(bool)
closed &= visible | allowed | (alpha > .12)
# Fill only enclosed holes; open gaps between strands remain as in the art.
n, lab, st, _ = cv2.connectedComponentsWithStats((~closed).astype(np.uint8), connectivity=4)
holes = np.zeros((H, W), bool)
for i in range(1, n):
    x, y, w, h, area = st[i]
    if area < 2500 and x > 0 and y > 0 and x + w < W and y + h < H: holes |= lab == i
filled = closed | holes; filled[:Y_H] = False
new = np.zeros((H, W, 4), np.uint8)
solid = visible & (art.max(2) < 100)  # hair body only, so the fill never picks up an edge colour
col = nearest(solid, art); soft = cv2.GaussianBlur(col, (0, 0), 10.0)
inner = filled & ~visible
edge_fade = np.clip(cv2.distanceTransform(filled.astype(np.uint8), cv2.DIST_L2, 5) / 8, 0, 1)  # no hard block where the fill shows
new[inner, :3] = soft[inner]; new[inner, 3] = np.round(edge_fade[inner] * 255).astype(np.uint8)
vis = visible & (dark < 200); new[vis, :3] = art[vis]; new[vis, 3] = 255
# What is on show at rest stays the art itself, right up to the garment edge.
near = dilate(garment, 2)
rim = filled & ~garment & (alpha > .12) & ~hem & (dark < 200) & (hair_colour | ~near)
new[rim, :3] = art[rim]; new[rim, 3] = 255
edge = visible & ~vis; a_ = alpha[edge][:, None]
unmix = np.clip((art[edge].astype(np.float32) - (1 - a_) * 255) / a_, 0, 255)
light = unmix.max(1) > 170
new[edge, :3] = np.where(light[:, None], col[edge].astype(np.float32), unmix).astype(np.uint8)  # un-mixed from the white ground, never a light fringe
new[edge, 3] = np.round(alpha[edge] * 255).astype(np.uint8)
# Gaps closed in the hair mass stay solid: the light strand edges would read as dashes on the fill.
inhole = (holes | (cv2.erode(filled.astype(np.uint8), ell(2)) > 0)) & (dark >= 200) & (new[..., 3] > 0)
new[inhole, :3] = soft[inhole]; new[inhole, 3] = 255
# Thin strands need mesh under them: a nearly invisible halo (just above the mesh alpha threshold 8) keeps them inside the footprint.
halo = dilate(visible, 3) & (new[..., 3] == 0); halo[:Y_H] = False
new[halo, :3] = col[halo]; new[halo, 3] = 10
bh = layers['back_hair']; before = int((bh[Y_H:, :, 3] > 0).sum())
bh[Y_H:] = new[Y_H:]
print('back_hair lower px', before, '->', int((bh[Y_H:, :, 3] > 0).sum()), 'visible art', int(visible.sum()))

for k, c in layers.items(): store(k, c)
d['name'] = 'kohako-full-v11n'
(p / 'layout.json').write_text(json.dumps(d, ensure_ascii=False, indent=2))
