"""Experimental corner split; run on a copy of the already prepared v11g layout."""
import json, os
from pathlib import Path
from PIL import Image, ImageFilter
p = Path(os.environ['LAYOUT'])
d = json.loads((p / 'layout.json').read_text())
layers = d['layers']
hair = next(x for x in layers if x['id'] == 'hair_front')
lash = next(x for x in layers if x['id'] == 'eye_left_lash')
h = Image.open(p / hair['image']['path']).convert('RGBA')
a = Image.open(p / lash['image']['path']).convert('RGBA').getchannel('A')
r, hr = lash['rect'], hair['rect']
a = a.resize((r['width'], r['height']), Image.Resampling.LANCZOS)
mask = Image.new('L', h.size)
mask.paste(a, (r['left'] - hr['left'], r['top'] - hr['top']))
# Isolate the screen-right corner and give the moved patch a small margin.
from PIL import ImageChops
mask = ImageChops.multiply(mask, h.getchannel('A')).point(lambda x: 255 if x > 32 else 0)
box = mask.getbbox()
assert box is not None
box = (max(0, box[0]-2), max(0, box[1]-2), min(h.width, box[2]+2), min(h.height, box[3]+2))
cut = Image.new('L', h.size)
from PIL import ImageDraw
ImageDraw.Draw(cut).rectangle((box[0], box[1], box[2]-1, box[3]-1), fill=255)
part = h.copy(); part.putalpha(ImageChops.multiply(h.getchannel('A'), cut))
h.putalpha(ImageChops.subtract(h.getchannel('A'), cut))
h.save(p / 'hair_front.png'); part.save(p / 'hair_front_corner.png')
corner = json.loads(json.dumps(hair)); corner.update(id='hair_front_corner', name='hair front corner', tags=['face', 'detail'])
corner['image']['path'] = 'hair_front_corner.png'
layers.insert(next(i for i,x in enumerate(layers) if x['id']=='face')+1, corner)
d['name'] = 'kohako-full-v11i'; (p/'layout.json').write_text(json.dumps(d, ensure_ascii=False, indent=2))
print('corner box in hair pixels:', box)
