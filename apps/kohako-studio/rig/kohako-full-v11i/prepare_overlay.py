"""Duplicate the screen-right lash pixels overlapped by front hair to an upper layer."""
import os,json
from pathlib import Path
from PIL import Image,ImageChops,ImageFilter
p=Path(os.environ['LAYOUT']);d=json.loads((p/'layout.json').read_text());layers=d['layers']
h=next(x for x in layers if x['id']=='hair_front'); l=next(x for x in layers if x['id']=='eye_left_lash');hr=h['rect'];r=l['rect']
front=Image.open(p/h['image']['path']).convert('RGBA').getchannel('A'); region=front.crop((r['left']-hr['left'],r['top']-hr['top'],r['left']-hr['left']+r['width'],r['top']-hr['top']+r['height']))
mask=region.resize((l['image']['width'],l['image']['height']),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(5)).point(lambda x: 255 if x>32 else 0)
im=Image.open(p/l['image']['path']).convert('RGBA'); im.putalpha(ImageChops.multiply(im.getchannel('A'),mask));assert im.getbbox();im.save(p/'lash_corner_overlay.png')
x=json.loads(json.dumps(l));x.update(id='lash_corner_overlay',name='lash corner overlay',tags=['face','detail']);x['image']['path']='lash_corner_overlay.png';layers.append(x);d['name']='kohako-full-v11i';(p/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2));print('overlay bounds',im.getbbox())
