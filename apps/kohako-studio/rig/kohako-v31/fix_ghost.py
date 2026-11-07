"""Remove detached low-alpha hair residue from body, constrained to the hair mask."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

p = Path('/tmp/boxp441')
d = p / 'v6/layout'
m = json.loads((d / 'layout.json').read_text())
b = next(layer for layer in m['layers'] if layer['id'] == 'body')
top, left = b['rect']['top'], b['rect']['left']
path = d / b['image']['path']
im = np.array(Image.open(path).convert('RGBA'))
h, w = im.shape[:2]
mask = (np.array(Image.open(p / 'v29-mask.png').convert('L')) > 0).astype('uint8')
region = cv2.dilate(mask, np.ones((15, 15), np.uint8))[top:top+h, left:left+w].astype(bool)
a = im[..., 3]
strong = (a >= 160).astype('uint8')
near = cv2.dilate(strong, np.ones((7, 7), np.uint8)).astype(bool)
remove = (a > 0) & (a < 160) & ~near & region
im[remove, 3] = 0
Image.fromarray(im).save(path)
m['name'] = 'kohako-v31'
(d / 'layout.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
print('v31 ghost alpha removed', int(remove.sum()), flush=True)
