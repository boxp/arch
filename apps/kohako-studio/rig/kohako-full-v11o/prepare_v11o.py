"""v11o (BOXP-470): apply on a copy of the v11n layout. No new images.

The Owner still saw cut skirt ends, a step on the outer thigh and odd irises in the blink on v11n. Compared with the art at
the same scale these turned out to be three causes that the earlier fixes did not touch:
- the panel layer rects stop inside the art (x=291 and x=854), so the rounded outer corners of the hem and their outline were
  cut on a straight vertical line, at rest as well;
- leg_right / leg_left stop at x=425 / x=719, so above y=1262 the outer strip of each thigh had stayed on the panel layers and
  moved with them, while below y=1262 it moved with the leg, which is the visible step;
- the half-open eye of the head kit shows only the pale lower half of the iris with no highlight, not the eye that is open.

So: widen the rects, give the hem its art back, move the thigh strip to the legs with coverage continuing under the panels, and
rebuild the interior of the half-open eye from the accepted open-eye pixels, keeping the drawn lids, lashes and layer alpha.
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT']); art_path = os.environ['ART']
d = json.loads((p / 'layout.json').read_text()); L = {x['id']: x for x in d['layers']}
W, H = 1143, 2048
art = cv2.resize(np.array(Image.open(art_path).convert('RGB')), (W, H), interpolation=cv2.INTER_AREA)
dark = art.min(2).astype(np.float32); art_alpha = np.clip((246 - dark) / 46, 0, 1)
def path(k): return p / L[k]['image']['path']
def img(k): return np.array(Image.open(path(k)).convert('RGBA'))
def canvas(k):
    r = L[k]['rect']; a = img(k); assert a.shape[:2] == (r['height'], r['width']), k
    c = np.zeros((H, W, 4), np.uint8); c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = a; return c
def store(k, c, rect=None):
    if rect:
        L[k]['rect'] = dict(L[k]['rect'], **rect)
        for f in ('width', 'height'):
            if f in L[k]['image']: L[k]['image'][f] = L[k]['rect'][f]
    r = L[k]['rect']; Image.fromarray(c[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']], 'RGBA').save(path(k))
def ell(n): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * n + 1, 2 * n + 1))
def dilate(m, n): return cv2.dilate(m.astype(np.uint8), ell(n)) > 0
def nearest(mask, im):
    _, lab = cv2.distanceTransformWithLabels((~mask).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.where(mask); c = np.zeros((lab.max() + 1, 3), np.uint8); c[lab[ys, xs]] = im[ys, xs]; return c[lab]
def unmix(y, x):
    a = art_alpha[y, x]
    return art[y, x] if a >= 1 else np.clip((art[y, x].astype(np.float32) - (1 - a) * 255) / max(a, .01), 0, 255).astype(np.uint8), int(round(a * 255))

layers = {k: canvas(k) for k in ['panel_right', 'panel_left', 'leg_right', 'leg_left', 'body']}

# 1. Hem corners: extend rows of each panel outwards through the art to the white ground, past the old rect.
for k, outward, rect in [('panel_right', -1, {'left': 262, 'width': 291 + 215 - 262}), ('panel_left', 1, {'width': 882 - 640})]:
    c = layers[k]; added = 0
    for y in range(1070, 1262):
        xs = np.where(c[y, :, 3] >= 128)[0]
        if len(xs) == 0: continue
        x = int(xs.min()) if outward < 0 else int(xs.max())
        run = []
        for step in range(1, 40):
            nx = x + outward * step
            if nx < 0 or nx >= W or art_alpha[y, nx] <= .08: break
            run.append(nx)
        last_dark = max([i for i, nx in enumerate(run) if art[y, nx].max() < 90], default=-1)
        for i, nx in enumerate(run):
            col, a = unmix(y, nx)
            if i <= last_dark: col, a = art[y, nx], 255  # the light band of the hem is inside the outline: opaque, not white ground
            if a > c[y, nx, 3]: c[y, nx, :3] = col; c[y, nx, 3] = a; added += 1
    print(k, 'hem corner restored', added)
    L[k]['_rect'] = rect

# 2. The outer strip of each thigh leaves the panel and joins the leg. Inner outline of each panel found row by row
#    (first non-suit pixel from the inner edge) and fitted as a smooth curve; everything past it, plus 3 px of outline, moves.
def legish(c):
    r, g, b = [c[..., i].astype(int) for i in range(3)]
    return (c[..., :3].max(2) < 112) | ((g > 130) & (b > 130) & (r < 120))
for k, inner, leg_k, rect in [('panel_right', 1, 'leg_right', {'left': 380, 'width': 425 + 160 - 380}), ('panel_left', -1, 'leg_left', {'width': 763 - 555})]:
    c = layers[k]; leg = legish(c); ys, xb = [], []
    for y in range(888, 1170):  # lower rows reach the light strip of the thigh, which reads as panel
        xs = np.where(c[y, :, 3] > 40)[0]
        if len(xs) == 0: continue
        order = xs[::-1] if inner == 1 else xs; run = 0
        for x in order:
            if leg[y, x]: run += 1
            else: break
        if run < len(order): ys.append(y); xb.append(int(order[run]))
    ys, xb = np.array(ys, float), np.array(xb, float); keep = np.ones(len(ys), bool)
    for _ in range(4):
        f = np.polyfit(ys[keep], xb[keep], 3); keep = np.abs(np.polyval(f, ys) - xb) < 4
    edge = np.polyval(f, np.arange(H)); last = int(ys[keep].max()); s_ = (edge[last] - edge[last - 60]) / 60
    edge[last:] = edge[last] + s_ * (np.arange(H)[last:] - last)  # the panel's inner edge runs straight on to the hem tip
    print(k, 'edge fit rows', int(keep.sum()), 'x at 1000/1150/1250:', [round(float(edge[y]), 1) for y in (1000, 1150, 1250)])
    # The panel keeps its whole inner outline, whatever its width on each row; only what lies past it is the thigh's.
    widths = []
    for y in range(888, 1262):
        x = int(round(edge[y])); w_ = 0
        while 0 <= x + inner * w_ < W and w_ < 8 and art[y, x + inner * w_].max() >= 110: w_ += 1  # the suit, up to the dark line
        widths.append(w_ + 6)  # the line is about 6 px wide; the thigh next to it is just as dark, so it cannot be followed by colour
    widths = np.array(cv2.GaussianBlur(np.array(widths, np.float32)[None, :], (0, 0), 5))[0]
    print(k, 'inner outline width px median', round(float(np.median(widths)), 1))
    strip = np.zeros((H, W), bool); X = np.arange(W)
    for y in range(888, 1262):
        lim = edge[y] + inner * (widths[y - 888] + 1)
        if y >= 1160:  # where the white gap opens between the hem and the thigh, the art itself separates them
            x0 = int(round(edge[y]))
            gap = [j for j in range(1, 34) if 0 <= x0 + inner * j < W and art_alpha[y, x0 + inner * j] < .3]
            if gap: lim = x0 + inner * gap[0]
        strip[y] = (X > lim) if inner == 1 else (X < lim)
    strip &= c[..., 3] > 0
    c[strip, 3] = 0; print(k, 'thigh strip moved', int(strip.sum()))
    leg_c = layers[leg_k]; body_c = layers['body']; on_leg = strip.copy(); on_leg[:986] = False; on_body = strip & ~on_leg
    a_ = art_alpha
    for mask, t in [(on_leg, leg_c), (on_body, body_c)]:
        ys_, xs_ = np.where(mask)
        for y, x in zip(ys_, xs_):
            col, a = unmix(y, x); t[y, x, :3] = col; t[y, x, 3] = a
    # 3. Leg coverage continues under the panel so no gap opens when the panel moves relative to the leg.
    under = dilate((leg_c[..., 3] >= 250) | on_leg, 14) & (leg_c[..., 3] < 8) & (c[..., 3] >= 128); under[:986] = False; under[1262:] = False
    # Near the hem tip the panel covers empty ground, not leg: keep the coverage inside the thigh's outer contour there.
    cy, cx = [], []
    for y in range(1200, 1340):
        x0 = int(round(edge[y])) + inner * 2; gap = None
        for j in range(0, 60):
            nx = x0 + inner * j
            if 0 <= nx < W:
                if gap is None and art_alpha[y, nx] < .3: gap = j
                elif gap is not None and art_alpha[y, nx] >= .6: cy.append(y); cx.append(nx); break
    cf = np.polyfit(cy, cx, 2); contour = np.polyval(cf, np.arange(H)); print(leg_k, 'outer contour fit rows', len(cy))
    out_of_leg = np.zeros((H, W), bool)
    for y in range(1150, 1262): out_of_leg[y] = (X < contour[y] - 2) if inner == 1 else (X > contour[y] + 2)
    under &= ~out_of_leg
    src = (leg_c[..., 3] >= 250) & (leg_c[..., :3].max(2) < 100) & (leg_c[..., 1].astype(int) - leg_c[..., 0] < 16)
    col = cv2.GaussianBlur(nearest(src, leg_c[..., :3]), (0, 0), 2.0); leg_c[under, :3] = col[under]; leg_c[under, 3] = 255
    print(leg_k, 'coverage extended under panel', int(under.sum()))
    # 4. Below the panel hem the leg's own outer contour may also have been cut by the old rect: restore it from the art.
    outward = -inner; added = 0
    for y in range(1262, 1760):
        xs = np.where(leg_c[y, :, 3] >= 128)[0]
        if len(xs) == 0: continue
        x = int(xs.min()) if outward < 0 else int(xs.max())
        for step in range(1, 40):
            nx = x + outward * step
            if nx < 0 or nx >= W or art_alpha[y, nx] <= .08: break
            col_, a = unmix(y, nx)
            if a > leg_c[y, nx, 3]: leg_c[y, nx, :3] = col_; leg_c[y, nx, 3] = a; added += 1
    print(leg_k, 'outer contour restored below hem', added)
    # What is now on show at rest is the art itself, with no repainted seam left next to the moved strip.
    shown = (leg_c[..., 3] >= 200) & (c[..., 3] < 40) & dilate(strip, 10) & (art_alpha > .9); shown[:986] = False
    leg_c[shown, :3] = art[shown]; print(leg_k, 'seam repainted from art', int(shown.sum()))
    # Under the panels the leg is plain suit: no panel colours or light strip left over to slide into view.
    hid = (leg_c[..., 3] > 0) & dilate(c[..., 3] >= 128, 3) & ~dilate(strip, 2) & (leg_c[..., 3] >= 8); hid[:986] = False
    src2 = (leg_c[..., 3] >= 250) & ~hid & (leg_c[..., :3].max(2) < 100) & (leg_c[..., 1].astype(int) - leg_c[..., 0] < 16)
    col2 = cv2.GaussianBlur(nearest(src2, leg_c[..., :3]), (0, 0), 2.0); leg_c[hid, :3] = col2[hid]
    L[leg_k]['_rect'] = rect

for k in layers:
    r = L[k].pop('_rect', None); store(k, layers[k], r); print(k, 'rect', L[k]['rect'])

# 5. Half-open eye: the interior is rebuilt from the open eye, under the drawn lid and lashes of the kit's half-open eye.
def over(fg, bg):
    a = fg[..., 3:4] / 255.; ba = bg[..., 3:4] / 255.; oa = a + ba * (1 - a); rgb = (fg[..., :3] * a + bg[..., :3] * ba * (1 - a)) / np.maximum(oa, 1e-6)
    return np.dstack([rgb, oa[..., 0] * 255]).round().astype(np.uint8)
CUT = .30  # share of the open eye hidden behind the lid
for side in ['right', 'left']:
    mk = f'eye_mid_{side}_v44'; mid = img(mk); white = img(f'eye_{side}_white'); iris = img(f'eye_{side}_iris')
    h, w = mid.shape[:2]; ball = over(iris, white)
    a = mid[..., 3] > 128; rgb = mid[..., :3].astype(int); v = rgb.max(2)
    lash = a & (v < 105) & (rgb[..., 2] < rgb[..., 0] + 45); bm = ball[..., 3] > 128
    tops, bots, otop, obot = {}, {}, {}, {}
    for x in range(w):
        ys = np.where(lash[:, x])[0]; inner = np.where(a[:, x] & ~lash[:, x])[0]
        if len(inner) < 6: continue
        up = ys[ys < inner.mean()]; lo = ys[ys > inner.mean()]; b_ = np.where(bm[:, x])[0]
        if len(up) == 0 or len(lo) == 0 or len(b_) == 0: continue
        tops[x], bots[x], otop[x], obot[x] = up.max() + 1, lo.min(), b_.min(), b_.max()
    xs = np.array(sorted(tops)); T, B, O, OB = [np.polyval(np.polyfit(xs, [q[x] for x in xs], 2), np.arange(w)) for q in (tops, bots, otop, obot)]
    Ho = np.maximum(OB - O, 1); YY, XX = np.mgrid[:h, :w]
    # The highlight is taken out of the source and redrawn whole under the lid, so it is not sliced by the lid.
    br = ball[..., :3].astype(int); irisa = cv2.dilate((iris[..., 3] > 40).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    hl = (br.min(2) > 218) & irisa & (ball[..., 3] > 128) & (YY < np.median(O[xs.min():xs.max()]) + .55 * np.median(Ho[xs.min():xs.max()]))
    nl, labl, stl, _ = cv2.connectedComponentsWithStats(hl.astype(np.uint8), connectivity=8); assert nl > 1, side
    j = 1 + int(np.argmax(stl[1:, 4])); bx, by, bw, bh = [int(v_) for v_ in stl[j, :4]]
    hm = cv2.dilate(((labl == j) * 255).astype(np.uint8), np.ones((5, 5), np.uint8))
    ball = np.dstack([cv2.inpaint(ball[..., :3], hm, 4, cv2.INPAINT_TELEA), ball[..., 3]])
    top = O + CUT * Ho; yy = np.arange(h, dtype=np.float32)[:, None]
    mapy = (top[None, :] + (yy - T[None, :]) * (OB - top)[None, :] / np.maximum(B - T, 1)[None, :]).astype(np.float32)
    warped = cv2.remap(ball, np.tile(np.arange(w, dtype=np.float32), (h, 1)), mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    new = mid.copy(); x0, x1 = int(xs.min()), int(xs.max())
    interior = a & (YY >= T) & (YY <= B - 1) & (XX >= x0 - 1) & (XX <= x1 + 1) & ~((v < 105) & (rgb[..., 2] < rgb[..., 0] + 45) & ((YY < T + 1.5) | (YY > B - 2.5)))
    use = interior & (warped[..., 3] > 180); new[use, :3] = warped[use, :3]
    cx = bx + bw / 2; cy = T[int(round(cx))] + 2.5 + bh / 2; S = 4
    sa = np.zeros((h * S, w * S), np.uint8); cv2.ellipse(sa, (int(round((cx + .5) * S)), int(round((cy + .5) * S))), (int(bw / 2 * S), int(bh / 2 * S)), 0, 0, 360, 255, -1, cv2.LINE_AA)
    sa = cv2.resize(sa, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)[..., None] / 255; sa = np.where(interior[..., None], sa, 0)
    new[..., :3] = (new[..., :3] * (1 - sa) + np.array([250, 250, 255], np.float32) * sa).round().astype(np.uint8)
    Image.fromarray(new, 'RGBA').save(path(mk)); print(mk, 'interior rebuilt px', int(use.sum()), 'highlight at', round(cx, 1), round(float(cy), 1))

d['name'] = 'kohako-full-v11o'
(p / 'layout.json').write_text(json.dumps(d, ensure_ascii=False, indent=2))
