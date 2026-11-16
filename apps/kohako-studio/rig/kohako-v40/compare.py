"""Create per-pose eye comparisons and count changes outside eye region."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
out=Path(sys.argv[1]); bust=Image.open(sys.argv[2]).convert('RGB'); dest=Path(sys.argv[3]); dest.mkdir(parents=True,exist_ok=True)
angles=['neutral','X-30','X+30','Y-20','Y+20']; vals=['1','0.75','0.5','0.3','0.15','0.1','0']
outside=total=0; maximum=0
for i,angle in enumerate(angles):
 meta=json.loads((out/f'before40-eyes{i}.json').read_text()); w,h=meta['tiles'][0]['imageRect'][2:]
 original=bust.crop((300,160,530,280)).resize((w,h),Image.Resampling.LANCZOS)
 canvas=Image.new('RGB',(w*8,(h+28)*2),'white'); draw=ImageDraw.Draw(canvas)
 for row,tag in enumerate(('before40','after40')):
  img=Image.open(out/f'{tag}-eyes{i}.png').convert('RGB'); d=json.loads((out/f'{tag}-eyes{i}.json').read_text()); y=row*(h+28)
  canvas.paste(original,(0,y+28)); draw.text((3,y+4),f'{tag} {angle} source',fill='black')
  for j,t in enumerate(d['tiles']):
   x,yy,tw,th=t['imageRect']; canvas.paste(img.crop((x,yy,x+tw,yy+th)),((j+1)*w,y+28)); draw.text(((j+1)*w+3,y+4),vals[j],fill='black')
 canvas.save(dest/f'kohako-v40-eyes-{i}.jpg',quality=90,optimize=True)
 a=np.asarray(Image.open(out/f'before40-full{i}.png').convert('RGB')).astype('int16'); b=np.asarray(Image.open(out/f'after40-full{i}.png').convert('RGB')).astype('int16'); diff=np.abs(a-b); changed=np.any(diff,axis=2); total+=int(changed.sum())
 d=json.loads((out/f'before40-full{i}.json').read_text())
 for t in d['tiles']:
  x,y,tw,th=t['imageRect']; x0=int(x+(250-100)/580*tw); x1=int(x+(560-100)/580*tw); y0=int(y+130/650*th); y1=int(y+310/650*th); changed[y0:y1+1,x0:x1+1]=False
 outside+=int(changed.sum()); maximum=max(maximum,int(diff[changed].max()) if changed.any() else 0)
print(f'changed={total} outside_eye={outside} outside_max_channel={maximum}')
