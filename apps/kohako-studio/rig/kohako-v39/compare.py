import json, os
from PIL import Image, ImageChops, ImageDraw
import numpy as np
from pathlib import Path
p=Path('/tmp/compare'); output=p/'out'; target=os.environ.get('TARGET', 'after39'); bust=Image.open(p/'bust29.png').convert('RGB')
meta=json.loads((output/'before39-mouth0.json').read_text()); w,h=meta['tiles'][0]['imageRect'][2:]
original=bust.crop((350,265,470,335)).resize((w,h),Image.Resampling.LANCZOS)
canvas=Image.new('RGB',(w*9,(h+36)*6),'white'); draw=ImageDraw.Draw(canvas); font=ImageDraw.ImageFont.load_default(size=24)
all_diff=outside=0; maxdiff=0
for row in range(3):
 for block,name in enumerate(('before39',target)):
  img=Image.open(output/f'{name}-mouth{row}.png').convert('RGB'); d=json.loads((output/f'{name}-mouth{row}.json').read_text()); y=(row*2+block)*(h+36)
  draw.text((3,y+5),f'{name} X {(0,-30,30)[row]}',fill='black', font=font); canvas.paste(original,(0,y+36))
  for col,t in enumerate(d['tiles']):
   x0,y0,tw,th=t['imageRect']; canvas.paste(img.crop((x0,y0,x0+tw,y0+th)),((col+1)*w,y+36)); draw.text(((col+1)*w+5,y+5),str((0,.02,.04,.06,.08,.25,.5,1)[col]),fill='black', font=font)
 a=Image.open(output/f'before39-full{row}.png').convert('RGB'); b=Image.open(output/f'{target}-full{row}.png').convert('RGB'); d=json.loads((output/f'before39-full{row}.json').read_text()); ar=np.asarray(ImageChops.difference(a,b)); changed=np.any(ar != 0,axis=2); all_diff+=int(changed.sum())
 for t in d['tiles']:
  x,y,tw,th=t['imageRect']; x0=int(x+200/580*tw); x1=int(x+410/580*tw); y0=int(y+230/650*th); y1=int(y+390/650*th); changed[y0:y1+1,x0:x1+1]=False
 outside+=int(changed.sum()); maxdiff=max(maxdiff,int(ar[changed].max()) if changed.any() else 0)
canvas.thumbnail((2880, 1800), Image.Resampling.LANCZOS)
canvas.save(p/'compare.jpg',quality=78,optimize=True)
print('bust',bust.size,'tile',w,h,'all_diff_pixels',all_diff,'outside_mouth_diff_pixels',outside,'outside_max_channel',maxdiff)
