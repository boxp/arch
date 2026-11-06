"""Replace v13 generated back-hair underpaint with stretched original hair.

Run after v13/create_parts.py. Preserve transferred v13 original pixels and all
other layers. Texture samples are from dark hair in the original bust crop.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
p = Path('/tmp/boxp441')
layout = p/'v6/layout'
manifest_path = layout/'layout.json'
m = json.loads(manifest_path.read_text())
item = next(x for x in m['layers'] if x['id'] == 'hair_back')
baseline = json.loads((p/'v13/baseline-layout/layout.json').read_text())
old = next(x for x in baseline['layers'] if x['id'] == 'hair_back')
def canvas(folder, layer):
    img = np.array(Image.open(folder/layer['image']['path']).convert('RGBA'))
    a = np.zeros((650,680,4), dtype=np.uint8)
    x,y = layer['rect']['left'],layer['rect']['top']
    a[y:y+img.shape[0],x:x+img.shape[1]] = img
    return a
back = canvas(layout,item)
base = canvas(p/'v13/baseline-layout',old)
ref = Image.open(p/'kohako/layout2/reference.png').convert('RGBA')
# Vertical strips avoid the face, clothes and flower; preserve original hair hues
# and highlights while extending them behind the moving head.
left = ref.crop((260,260,275,310)).resize((210,600),Image.Resampling.BICUBIC)
right = ref.crop((530,260,540,310)).resize((210,600),Image.Resampling.BICUBIC)
texture = Image.new('RGBA',(680,650))
texture.paste(left,(205,20)); texture.paste(right,(415,20))
# Crown patch from original upper hair, away from the flower.
crown = ref.crop((340,35,490,95)).resize((420,130),Image.Resampling.BICUBIC)
texture.paste(crown,(205,17))
t = np.asarray(texture)
# Identical RGB means v13 did not transfer body pixels at that point.
use = (base[:,:,3]>0) & (back[:,:,3]>0) & np.all(back[:,:,:3] == base[:,:,:3],axis=2) & (t[:,:,3]>0)
back[use,:3] = t[use,:3]
r=item['rect']; x,y,w,h=r['left'],r['top'],r['width'],r['height']
Image.fromarray(back[y:y+h,x:x+w]).save(layout/item['image']['path'])
m['name']='kohako-v14'
manifest_path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print('Original-texture replacement pixels:',int(use.sum()),flush=True)
