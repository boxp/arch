from PIL import Image
import numpy as np
from scipy import ndimage
from pathlib import Path
p=Path('/work'); a=np.array(Image.open(p/'baseline-capture/rest-magenta.png').convert('RGB')).astype(int);b=np.array(Image.open(p/'k/rest-magenta.png').convert('RGB')).astype(int);d=np.abs(a-b);m=d.max(axis=2)
print('max',m.max(),*[f'>{t}={int((m>t).sum())}' for t in (0,2,8,16,32)])
for t in [16,32]:
 labels,n=ndimage.label(m>t,np.ones((3,3)));comps=[]
 for i in range(1,n+1):
  y,x=np.where(labels==i)
  if len(x)>=3: comps.append((len(x),[int(x.min()),int(y.min()),int(x.max()),int(y.max())]))
 print(t,sorted(comps,reverse=True)[:30])
Image.fromarray(np.uint8(np.minimum(d*8,255))).save(p/'rest-diff.png')
