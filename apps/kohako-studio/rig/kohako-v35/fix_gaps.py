"""v35: close the thin see-through gaps between hair strands (BOXP-441 TD-25).

v29 cut the long hair out of the flat source by hair colour, so the 1-3px light lines the
artist left between neighbouring strands (white background showing through) became
transparent / low-alpha slits inside hair_back and hair_side_*. Over the dark body they read
as a light dotted line once the hair moves. A morphological closing of the opaque area finds
slits narrower than the kernel; those pixels become opaque with the RGB of the nearest dark
opaque hair pixel. Wide gaps between strand tips and the outer silhouette stay as they are.

LAYOUT (default /tmp/boxp441/v6/layout) and K (closing kernel, default 5) can be overridden.
"""
import os
from PIL import Image
import numpy as np
import cv2

layout = os.environ.get('LAYOUT', '/tmp/boxp441/v6/layout')
k = int(os.environ.get('K', '5'))
for name in ('hair_back', 'hair_side_left', 'hair_side_right'):
    p = f'{layout}/{name}.png'
    if not os.path.exists(p):
        continue
    a = np.array(Image.open(p).convert('RGBA'))
    al = a[:, :, 3]
    solid = (al >= 200).astype(np.uint8)
    closed = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(bool)
    # only slits enclosed by hair: the closing must not grow the outer silhouette
    filled = closed & (al < 200)
    outside = ~closed
    near_out = cv2.dilate(outside.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    target = filled & ~near_out
    rgb = a[:, :, :3].astype(np.int16)
    source = (al >= 250) & (rgb.max(axis=2) < 130)
    _, labels = cv2.distanceTransformWithLabels((~source).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(source)
    lab = labels[target] - 1
    a[target, :3] = a[ys[lab], xs[lab], :3]
    a[target, 3] = 255
    Image.fromarray(a).save(p)
    print(f'{name}: slit pixels closed: {int(target.sum())}', flush=True)
