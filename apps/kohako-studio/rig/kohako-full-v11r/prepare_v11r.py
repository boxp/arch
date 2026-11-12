"""v11r (BOXP-470 TD-09): apply on a copy of the v11q layout. No generation, back_hair is untouched.

The "line between the hand and the skirt" is not hair. panel_* still carries a copy of the forearm that ends in a straight
horizontal cut, thin streaks and a slate wedge from the art, and arm_* carries hair and a sliver of the cuff next to the forearm.
They sit between the arm and the panel and do not follow the hair. Only pixels that are the panel or the arm remain in those layers.

Env: LAYOUT (copy of v11q layout), ART, METRICS (json output path).
"""
import json, os
from pathlib import Path
import numpy as np, cv2
from PIL import Image

p = Path(os.environ['LAYOUT']); W, H = 1143, 2048
L = {x['id']: x for x in json.loads((p / 'layout.json').read_text())['layers']}
art = np.array(Image.open(os.environ['ART']).convert('RGB').resize((W, H), Image.LANCZOS)).astype(int)
R, G, B = art[..., 0], art[..., 1], art[..., 2]
luma = art.mean(2)
purple = (B > G + 22) & (R > G + 8)
gold = (R > G + 12) & (G > B + 10) & (R > 120)
paint = (purple | gold).astype(np.uint8)
K = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))


def component(seeds, closed=True):
    m = cv2.morphologyEx(paint, cv2.MORPH_CLOSE, K) if closed else paint
    n, lab = cv2.connectedComponents(m, connectivity=4)
    ids = set()
    for x, y in seeds:
        assert m[y, x], ('seed not on paint', x, y)
        ids.add(int(lab[y, x]))
    c = np.isin(lab, sorted(ids)).astype(np.uint8)
    cnt, _ = cv2.findContours(c, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    f = np.zeros((H, W), np.uint8); cv2.drawContours(f, cnt, -1, 1, -1)  # dark lines and highlights inside belong to the part
    return f


def keep_of(part, r=5):
    ring = cv2.dilate(part, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    return (part > 0) | ((ring > 0) & (luma < 95))  # the part's own outline, and no pale rim


def apply(k, region, keep, part_px):
    r = L[k]['rect']; f = p / L[k]['image']['path']
    a = np.array(Image.open(f).convert('RGBA'))
    c = np.zeros((H, W, 4), np.uint8); c[r['top']:r['top'] + a.shape[0], r['left']:r['left'] + a.shape[1]] = a
    before = c[..., 3].copy()
    soft = cv2.GaussianBlur((~region | keep).astype(np.float32), (0, 0), .8)
    soft[~region] = 1
    # The part's outline and any bites in it come straight from the art, so the edge matches the picture.
    ring = region & keep & (~part_px | (c[..., 3] < 250))
    c[ring, :3] = art[ring]; c[ring, 3] = 255
    c[..., 3] = np.round(c[..., 3] * soft).astype(np.uint8)
    c[region & (c[..., 3] < 8)] = 0
    # Specks left inside the region once its neighbours are gone.
    n, lab, st, _ = cv2.connectedComponentsWithStats((c[..., 3] > 16).astype(np.uint8), connectivity=8)
    big = int(np.argmax(st[1:, 4])) + 1
    small = (lab != big) & (lab > 0) & region
    c[small] = 0
    Image.fromarray(c[r['top']:r['top'] + a.shape[0], r['left']:r['left'] + a.shape[1]], 'RGBA').save(f)
    return {'removed_px': int(((before > 64) & (c[..., 3] <= 64)).sum()), 'specks_px': int(small.sum())}


def poly(pts):
    m = np.zeros((H, W), np.uint8); cv2.fillPoly(m, [np.array(pts, np.int32)], 1); return m > 0


mirror = lambda pts: [(W - 1 - x, y) for x, y in pts]
metrics = {}
# Coordinates are layout pixels of the right arm (screen left); the left arm mirrors them.
ARM_SEEDS = [(385, 800), (395, 770)]           # forearm, gold V
PANEL_SEEDS = [(400, 900), (420, 820)]         # panel, cuff
ARM_REGION = [(405, 757), (476, 757), (476, 960), (320, 960)]
PANEL_REGION = [(262, 787), (440, 787), (440, 1010), (262, 1010)]
for side, k_arm, k_panel, flip in [('right', 'arm_right', 'panel_right', False), ('left', 'arm_left', 'panel_left', True)]:
    def snap(pts):
        out = []
        for x, y in pts:
            x, y = (W - 1 - x, y) if flip else (x, y)
            if not paint[y, x]:
                ys, xs = np.where(paint[y - 12:y + 13, x - 12:x + 13]); i = int(np.argmin((xs - 12) ** 2 + (ys - 12) ** 2)); x, y = x + int(xs[i]) - 12, y + int(ys[i]) - 12
            out.append((x, y))
        return out
    arm = component(snap(ARM_SEEDS)); panel = component(snap(PANEL_SEEDS))
    assert not (arm & panel).any(), 'arm and panel merged: ' + side
    ar = poly(mirror(ARM_REGION) if flip else ARM_REGION); pr = poly(mirror(PANEL_REGION) if flip else PANEL_REGION)
    metrics[k_arm] = apply(k_arm, ar, keep_of(arm), arm > 0); metrics[k_panel] = apply(k_panel, pr, keep_of(panel), panel > 0)
# Under the arm scraps the body layer has a tan underpaint beside the cuff, which is not in the art. Without it the hair shows there.
BODY_REGION = [(394, 775), (448, 775), (448, 845), (394, 845)]
none = np.zeros((H, W), bool)
metrics['body'] = apply('body', poly(BODY_REGION) | poly(mirror(BODY_REGION)), none, none)
Path(os.environ['METRICS']).write_text(json.dumps(metrics, indent=1)); print(json.dumps(metrics))
