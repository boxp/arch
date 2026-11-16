import json
from pathlib import Path
import numpy as np
from scipy import ndimage
P=Path('/work'); data={v:json.loads((P/v/'lines.json').read_text()) for v in ['j','k']}
for pose in data['j']['poses']:
 def pix(v):return {(p['x'],p['y']) for c in data[v]['poses'][pose] for p in c['pixels'] if p['class']=='G'}
 diff=pix('k')-pix('j'); mask=np.zeros((1110,838),bool)
 for x,y in diff: mask[y,x]=True
 labels,n=ndimage.label(mask,np.ones((3,3))); print(pose,'new G',len(diff),end=' ')
 for i in range(1,n+1):
  yy,xx=np.where(labels==i);print(f'{len(xx)}:[{xx.min()},{yy.min()},{xx.max()},{yy.max()}]',end=' ')
 print()
