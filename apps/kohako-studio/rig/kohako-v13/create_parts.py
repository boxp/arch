"""Transfer exposed original rear-hair strips from body into the moving back layer.

Run after v6/create_parts.py, before the v6 rig generation pipeline. All coordinates
are in the original 680x650 bust crop; no image assets are stored in the repo.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw

p = Path('/tmp/boxp441')
layout = p / 'v6/layout'
manifest_path = layout / 'layout.json'
manifest = json.loads(manifest_path.read_text())
items = {item['id']: item for item in manifest['layers']}

def canvas(layer):
    item = items[layer]
    rect = item['rect']
    image = np.asarray(Image.open(layout / item['image']['path']).convert('RGBA'))
    result = np.zeros((650, 680, 4), dtype=np.uint8)
    x, y = rect['left'], rect['top']
    result[y:y + image.shape[0], x:x + image.shape[1]] = image
    return result

body = canvas('body')
back = canvas('hair_back')
reference = np.asarray(Image.open(p / 'kohako/layout2/reference.png').convert('RGBA'))
region = Image.new('L', (680, 650))
draw = ImageDraw.Draw(region)
# Exposed hair between the braids and outer contour, above the shoulders.
# The polygon boundaries stay clear of the face, flower, hand and clothing.
draw.polygon([(250,230),(288,230),(300,342),(285,365),(228,385),(198,430),(160,455),(194,387),(224,310)], fill=255)
draw.polygon([(518,230),(553,230),(567,315),(585,365),(601,397),(574,388),(550,367),(515,350)], fill=255)
inside = np.asarray(region) > 0
dark = (reference[:, :, :3].max(axis=2) < 155) & (reference[:, :, 3] > 0)
dark = cv2.dilate(dark.astype('uint8'), np.ones((3, 3), np.uint8)) > 0
mask = (inside & dark & (body[:, :, 3] == 255)).astype('float32')
# Fade the transfer inward over 18 pixels to reduce seams with fixed hair.
distance = cv2.distanceTransform(inside.astype('uint8'), cv2.DIST_L2, 5)
mask = cv2.GaussianBlur(mask, (0, 0), 1.2) * np.minimum(distance / 18.0, 1.0)
mask[body[:, :, 3] != 255] = 0
selected = mask > 0.005
back[selected] = body[selected]
body[:, :, 3] = np.rint(body[:, :, 3] * (1 - mask)).astype('uint8')
for name, rgba in [('body', body), ('hair_back', back)]:
    ys, xs = np.nonzero(rgba[:, :, 3])
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    item = items[name]
    Image.fromarray(rgba[y0:y1, x0:x1]).save(layout / item['image']['path'])
    item['rect'] = {'left': x0, 'top': y0, 'width': x1-x0, 'height': y1-y0}
    item['image'].update(width=x1-x0, height=y1-y0)
manifest['name'] = 'kohako-v13'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print('Transferred original hair pixels:', int((mask > .5).sum()), flush=True)
