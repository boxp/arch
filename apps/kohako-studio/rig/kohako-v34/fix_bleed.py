"""v34: pad the RGB of fully transparent pixels with the colour of the nearest visible pixel.

The layout PNGs keep the white background RGB under alpha=0 (body: ~195k white texels). If the
runtime samples the atlas with bilinear filtering on straight alpha, that white bleeds into layer
edges and shows as light dotted lines where an edge lies over dark hair. Only alpha=0 pixels are
changed, so the layer images themselves look identical.
"""
import glob
from PIL import Image
import numpy as np
import cv2

for p in sorted(glob.glob('/tmp/boxp441/v6/layout/*.png')):
    a = np.array(Image.open(p).convert('RGBA'))
    visible = a[:, :, 3] > 0
    if visible.all() or not visible.any():
        continue
    _, labels = cv2.distanceTransformWithLabels((~visible).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(visible)
    hidden = ~visible
    lab = labels[hidden] - 1
    a[hidden, :3] = a[ys[lab], xs[lab], :3]
    Image.fromarray(a).save(p)
    print(f'{p.rsplit("/", 1)[1]}: padded {int(hidden.sum())} transparent texels', flush=True)
