"""Darken neutral bright remnants in the internal left hair gap, preserving alpha."""
from PIL import Image
import numpy as np
p='/tmp/boxp441/v6/layout/hair_back.png'
a=np.array(Image.open(p).convert('RGBA'))
y,x=np.indices(a.shape[:2]); rgb=a[:,:,:3].astype(np.int16)
# Narrow strip along the internal diagonal; exclude the outer silhouette and colored details.
center=420-y/2
mask=(y>=355)&(y<=430)&(abs(x-center)<=5)&(a[:,:,3]>0)&(rgb.min(axis=2)>90)&((rgb.max(axis=2)-rgb.min(axis=2))<25)
a[mask,:3]=[38,34,49]
Image.fromarray(a).save(p)
print('hair RGB pixels changed:',int(mask.sum()),flush=True)
