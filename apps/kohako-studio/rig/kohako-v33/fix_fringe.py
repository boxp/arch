"""v33: remove the whitish background fringe left on hair layer edges (alpha unchanged).

v29 cut the long hair out of the flat source on a white background, so the anti-aliased
edge pixels of hair_back / hair_side_* still carry near-white RGB. When those edges lie over
dark hair of another layer they show up as a light dotted line. Only edge pixels that are
bright and near-neutral (white fringe, not gold/purple decorations) get the RGB of the nearest
dark opaque hair pixel; alpha and the silhouette stay unchanged.
"""
from PIL import Image
import numpy as np
import cv2

for name in ('hair_back', 'hair_side_left', 'hair_side_right'):
    p = f'/tmp/boxp441/v6/layout/{name}.png'
    a = np.array(Image.open(p).convert('RGBA'))
    rgb = a[:, :, :3].astype(np.int16); al = a[:, :, 3]
    opaque = al >= 250
    eroded = cv2.erode(opaque.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=3).astype(bool)
    edge = (al > 0) & ~eroded
    neutral_bright = (rgb.min(axis=2) > 100) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 40)
    target = edge & neutral_bright
    source = opaque & (rgb.max(axis=2) < 110)  # dark hair body
    _, labels = cv2.distanceTransformWithLabels((~source).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(source)  # label k (1-based) = k-th zero pixel of the input in row-major order
    lab = labels[target] - 1
    iy, ix = ys[lab], xs[lab]
    a[target, :3] = a[iy, ix, :3]
    Image.fromarray(a).save(p)
    print(f'{name}: fringe RGB pixels changed: {int(target.sum())}', flush=True)
