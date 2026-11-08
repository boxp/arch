"""Compare identically rendered v38 and candidate, including non-face pixel counts."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
base,candidate,bust,dest=map(Path,sys.argv[1:]);dest.mkdir(parents=True,exist_ok=True)
source=Image.open(bust).convert('RGB')
angles=['neutral','X -30','X +30','Y -20','Y +20']
results={}
for kind,values,box in [('eyes',['1','.75','.5','.3','.15','.1','0'],(300,160,530,280)),('mouth',['0','.04','.1','.25','.5','1'],(350,265,470,335))]:
 for i,angle in enumerate(angles):
  imgs=[];metas=[]
  for root in (base,candidate):
   imgs.append(Image.open(root/f'v41-{kind}{i}.png').convert('RGB'));metas.append(json.loads((root/f'v41-{kind}{i}.json').read_text()))
  w,h=metas[0]['tiles'][0]['imageRect'][2:]; out=Image.new('RGB',(w*(len(values)+1),(h+28)*2),'white'); draw=ImageDraw.Draw(out)
  for row,label in enumerate(('v38','v41 candidate')):
   y=row*(h+28);out.paste(source.crop(box).resize((w,h),Image.Resampling.LANCZOS),(0,y+28));draw.text((3,y+4),f'{label} {angle} original',fill='black')
   for j,tile in enumerate(metas[row]['tiles']):
    x,yy,tw,th=tile['imageRect'];out.paste(imgs[row].crop((x,yy,x+tw,yy+th)),((j+1)*w,y+28));draw.text(((j+1)*w+3,y+4),values[j],fill='black')
  out.save(dest/f'kohako-v41-{kind}-{i}.jpg',quality=88,optimize=True)
  aa=np.asarray(Image.open(base/f'v41-full-{kind}{i}.png').convert('RGB')).astype(np.int16)
  bb=np.asarray(Image.open(candidate/f'v41-full-{kind}{i}.png').convert('RGB')).astype(np.int16)
  diff=np.abs(aa-bb);changed=np.any(diff,axis=2);total=int(changed.sum())
  meta=json.loads((base/f'v41-full-{kind}{i}.json').read_text())
  for t in meta['tiles']:
   x,y,tw,th=t['imageRect']; left,top,right,bottom=(250,130,560,310) if kind=='eyes' else (300,240,500,340); x0=int(x+(left-100)/580*tw);x1=int(x+(right-100)/580*tw);y0=int(y+top/650*th);y1=int(y+bottom/650*th);changed[y0:y1+1,x0:x1+1]=False
  results[f'{kind}-{angle}']={'changed':total,'outside_face':int(changed.sum()),'outside_max':int(diff[changed].max()) if changed.any() else 0}
(dest/'kohako-v41-pixel-diff.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
