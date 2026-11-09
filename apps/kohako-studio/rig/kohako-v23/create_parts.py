"""v23: split chest-length hair into a head-following upper part and a body-attached lower part.

Diagnosis (TD-21): hair_back / hair_side_* reach the chest, and psd2live's hair.back/current
follow warp moves the whole frame with the head, while the hair painted on the body stays.
Split each long hair layer at the shoulder line: the upper piece keeps its hair tag (head
follow + physics), the lower piece is tagged as top-wear so it stays with the body.
Run after kohako-v17/create_parts.py and before the v6 rig generation pipeline. No new images.
"""
from pathlib import Path
import copy, json, os
import numpy as np
from PIL import Image

p = Path('/tmp/boxp441'); layout = p / 'v6/layout'; path = layout / 'layout.json'
m = json.loads(path.read_text())
Y0 = int(os.environ.get('V23_Y0', 365)); Y1 = int(os.environ.get('V23_Y1', 425)); SOFT = 15
# upper: full above Y0, fades to 0 at Y1. lower: fades in over [Y0-SOFT, Y0], full below Y0 (drawn beneath upper).
def ramp_upper(y):
    return np.clip((Y1 - y) / float(Y1 - Y0), 0, 1)
def ramp_lower(y):
    return np.clip((y - (Y0 - SOFT)) / float(SOFT), 0, 1)

def crop(rgba, base_left, base_top):
    ys, xs = np.nonzero(rgba[:, :, 3])
    if len(ys) == 0: return None
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    return rgba[y0:y1, x0:x1], {'left': base_left + x0, 'top': base_top + y0, 'width': x1 - x0, 'height': y1 - y0}

targets = [x for x in m['layers'] if x['id'] in ('hair_back', 'hair_side_left', 'hair_side_right')]
report = {}
for item in targets:
    img = np.asarray(Image.open(layout / item['image']['path']).convert('RGBA')).astype('float32')
    top = item['rect']['top']; left = item['rect']['left']
    yy = (np.arange(img.shape[0]) + top)[:, None]
    up = img.copy(); up[:, :, 3] = img[:, :, 3] * ramp_upper(yy)
    lo = img.copy(); lo[:, :, 3] = img[:, :, 3] * ramp_lower(yy)
    upc = crop(np.rint(up).astype('uint8'), left, top); loc = crop(np.rint(lo).astype('uint8'), left, top)
    idx = m['layers'].index(item)
    if loc is not None:
        lower = copy.deepcopy(item); lower['id'] = item['id'] + '_lower'; lower['name'] = item['name'] + ' lower'
        lower['tags'] = ['top'] + [t for t in item.get('tags', []) if t in ('left', 'right')]
        lower['image'] = {'path': lower['id'] + '.png', 'width': loc[1]['width'], 'height': loc[1]['height']}; lower['rect'] = loc[1]
        Image.fromarray(loc[0]).save(layout / lower['image']['path'])
        m['layers'].insert(idx, lower)  # beneath the upper piece
    rgba, rect = upc
    Image.fromarray(rgba).save(layout / item['image']['path'])
    item['rect'] = rect; item['image'].update(width=rect['width'], height=rect['height'])
    report[item['id']] = {'upper': rect, 'lower': loc[1] if loc else None}
m['name'] = 'kohako-v23'
path.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
(p / 'v6/out').mkdir(parents=True, exist_ok=True)
(p / 'v6/out/v23-split.json').write_text(json.dumps({'Y0': Y0, 'Y1': Y1, 'soft': SOFT, 'layers': report}, indent=2))
print('v23 split', json.dumps(report), flush=True)
