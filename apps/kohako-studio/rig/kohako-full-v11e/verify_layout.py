#!/usr/bin/env python3
"""Compare v11c and v11e prepared layouts; arguments are their directory paths."""
import hashlib
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
base, candidate = map(Path, sys.argv[1:3])
a = np.asarray(Image.open(base / 'face.png').convert('RGBA'))
b = np.asarray(Image.open(candidate / 'face.png').convert('RGBA'))
assert a.shape == b.shape
changed = np.any(a != b, axis=2)
mask = np.zeros(a.shape[:2], np.uint8)
for poly in [[(22,147),(31,141),(49,145),(59,158),(59,193),(48,202),(34,190),(25,171)],[(310,145),(329,141),(341,146),(344,165),(334,184),(319,198),(308,193),(307,160)]]:
    cv2.fillPoly(mask, [np.array(poly, np.int32)], 255)
gray = cv2.cvtColor(a[:, :, :3], cv2.COLOR_RGB2GRAY)
gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
assert not np.any(changed & (mask == 0))
assert not np.any(changed & (cv2.magnitude(gx, gy) > 200))
assert np.array_equal(a[:, :, 3], b[:, :, 3])
for p in base.glob('*.png'):
    if p.name != 'face.png':
        assert hashlib.sha256(p.read_bytes()).digest() == hashlib.sha256((candidate / p.name).read_bytes()).digest(), p.name
print('changed face pixels:', int(changed.sum()), '; outside mask, alpha, strong gradients and other PNGs: unchanged')
