import json,os
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
p=Path(os.environ['LAYOUT']);d=json.loads((p/'layout.json').read_text())
for side in ('left','right'):
 layer=next(x for x in d['layers'] if x['id']==f'eye_{side}_lash');im=Image.open(p/layer['image']['path']).convert('RGBA');assert im.size==(150,100)
 mask=Image.new('L',im.size);ImageDraw.Draw(mask).rectangle((0,67,149,75),fill=255)
 part=im.copy();part.putalpha(ImageChops.multiply(im.getchannel('A'),mask));im.putalpha(ImageChops.subtract(im.getchannel('A'),mask));im.save(p/layer['image']['path'])
 sub=json.loads(json.dumps(layer));sub.update(id=f'lash_lower_{side}',name=f'lash lower {side}',tags=['face','detail']);sub['image']['path']=f'lash_lower_{side}.png';part.save(p/sub['image']['path']);d['layers'].insert(d['layers'].index(layer)+1,sub)
(p/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2))
