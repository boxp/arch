"""Ornament underlay fix (TD-22): the cherry ornament was cut into hair_front, and its silhouette was
filled with hair colour in body and hair_back as if it were part of the head. Keep hair only inside an
estimated head contour; make the rest of the ornament-shaped fill transparent."""
import json, sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image
L = Path(sys.argv[1]); dbg = Path(sys.argv[2]) if len(sys.argv) > 2 else None
m = json.loads((L / 'layout.json').read_text()); W, H = m['canvas']['width'], m['canvas']['height']
lay = {l['id']: l for l in m['layers']}
def canvas(lid):
    l = lay[lid]; a = np.zeros((H, W, 4), np.uint8); img = np.asarray(Image.open(L / l['image']['path']).convert('RGBA'))
    r = l['rect']; a[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']] = img; return a
def store(lid, a):
    l = lay[lid]; r = l['rect']; Image.fromarray(a[r['top']:r['top'] + r['height'], r['left']:r['left'] + r['width']]).save(L / l['image']['path'])
front = canvas('hair_front'); body = canvas('body'); back = canvas('hair_back')
def hsv(a): return cv2.cvtColor(a[:, :, :3], cv2.COLOR_RGB2HSV)
fh = hsv(front); fa = front[:, :, 3] > 128
# ornament = pink pixels of the front hair layer (hue near magenta/red, saturated enough, bright)
pink = fa & (((fh[:, :, 0] > 150) | (fh[:, :, 0] < 12)) & (fh[:, :, 1] > 40) & (fh[:, :, 2] > 120))
k = lambda n: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (n, n))
box = np.zeros_like(pink); box[30:215, 230:335] = True  # the ornament hangs at the left side of the head only
pink &= box
orn = cv2.morphologyEx(pink.astype(np.uint8), cv2.MORPH_CLOSE, k(9)); orn = cv2.dilate(orn, k(7))  # flower + tassels + outlines
# hair silhouette without the ornament: dark, opaque pixels of body + front hair
def dark(a): h = hsv(a); return (a[:, :, 3] > 200) & (h[:, :, 2] < 110)
hair = (dark(body) | dark(front)) & ~(cv2.dilate(orn, k(5)) > 0)
hair = hair[:, :].astype(np.uint8)
contour = cv2.morphologyEx(hair, cv2.MORPH_CLOSE, k(71))  # bridges the notch left by the ornament along the head contour
contour = cv2.morphologyEx(contour, cv2.MORPH_OPEN, k(9))
region = orn > 0
outside = region & (contour == 0)
report = {}
for lid, a in [('body', body), ('hair_back', back)]:
    before = int((a[:, :, 3][region] > 0).sum())
    a[:, :, 3][outside] = 0
    report[lid] = {'ornament_px': int(region.sum()), 'opaque_before': before, 'cleared': int(outside.sum() and (a[:, :, 3][outside] == 0).sum())}
    store(lid, a)
print('ornament fix', json.dumps(report), flush=True)

# Second underlay fix: where the side hair / braids were cut out, body keeps a light pink inpaint. Inside the head
# contour it should be hair; outside it should be transparent. The face rect is left untouched.
side = np.zeros((H, W), bool)
for lid in ['hair_side_left', 'hair_side_right']:
    side |= canvas(lid)[:, :, 3] > 128
fr = lay['face']['rect']; side[fr['top']:fr['top'] + fr['height'], fr['left']:fr['left'] + fr['width']] = False
bh = hsv(body); side[345:, :] = False  # below the shoulder line the side hair lies over the outfit
light = (body[:, :, 3] > 0) & (bh[:, :, 2] >= 100) & side
light_in = light & (contour > 0); light_out = light & (contour == 0)
hair_px = body[:, :, :3][dark(body) & ~region]
hair_col = np.median(hair_px, axis=0).astype(np.uint8) if len(hair_px) else np.array([40, 36, 52], np.uint8)
body[:, :, :3][light_in] = hair_col; body[:, :, 3][light_in] = 255; body[:, :, 3][light_out] = 0
report['side_underlay'] = {'to_hair': int(light_in.sum()), 'cleared': int(light_out.sum())}
store('body', body)
print('side underlay fix', json.dumps(report['side_underlay']), flush=True)
if dbg:
    dbg.mkdir(parents=True, exist_ok=True)
    vis = np.zeros((H, W, 3), np.uint8); vis[hair > 0] = (80, 80, 80); vis[contour > 0] = np.maximum(vis[contour > 0], (0, 120, 0)); vis[region] = (200, 0, 200); vis[outside] = (255, 255, 0)
    Image.fromarray(vis[0:260, 200:480]).resize((840, 780), Image.NEAREST).save(dbg / 'orn-fix-mask.png')
    comp = np.zeros((H, W, 4), np.uint8); comp[:] = (200, 230, 200, 255)
    for a in [body, back]:
        pass
    im = Image.new('RGBA', (W, H), (200, 230, 200, 255))
    for lid in ['hair_back', 'body', 'hair_front']:
        l = lay[lid]; im.alpha_composite(Image.open(L / l['image']['path']).convert('RGBA'), (l['rect']['left'], l['rect']['top']))
    im.crop((230, 20, 430, 220)).resize((600, 600), Image.LANCZOS).convert('RGB').save(dbg / 'orn-fix-after.png')
    Image.fromarray(body[20:220, 230:430]).resize((600, 600), Image.LANCZOS).save(dbg / 'orn-fix-body.png')
