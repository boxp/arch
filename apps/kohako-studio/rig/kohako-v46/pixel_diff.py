"""Count differing pixels outside the eye rectangle for each shared-session pose."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
root,dest=map(Path,sys.argv[1:]); results={}
for i,angle in enumerate(['front','X -30','X +30','Y -20','Y +20']):
 meta=json.loads((root/f'baseline1-full-eyes{i}.json').read_text())['tiles']
 imgs={p:np.asarray(Image.open(root/f'{p}-full-eyes{i}.png').convert('RGB')) for p in ('baseline1','baseline2','v45','candidate')}
 for p in ('baseline2','v45','candidate'):
  changed=np.any(imgs['baseline1']!=imgs[p],axis=2)
  for t in meta:
   x,y,w,h=t['imageRect'];x0=int(x+(250-100)/580*w);x1=int(x+(560-100)/580*w);y0=int(y+130/650*h);y1=int(y+310/650*h);changed[y0:y1+1,x0:x1+1]=False
  results[f'{angle} {p}']=int(changed.sum())
dest.write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
