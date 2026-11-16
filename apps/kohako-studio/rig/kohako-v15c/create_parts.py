"""Remove dark body underpainting beneath the separate side braids, after v15b.

The braids themselves are already separate meshes and must not be copied into
back hair. This intentionally leaves their existing original pixels untouched.
"""
from pathlib import Path
import json,cv2
import numpy as np
from PIL import Image,ImageDraw
p=Path('/tmp/boxp441'); layout=p/'v6/layout'; path=layout/'layout.json'; m=json.loads(path.read_text()); item=next(x for x in m['layers'] if x['id']=='body'); r=item['rect']; im=np.asarray(Image.open(layout/item['image']['path']).convert('RGBA')).copy(); body=np.zeros((650,680,4),np.uint8); body[r['top']:r['top']+im.shape[0],r['left']:r['left']+im.shape[1]]=im
reg=Image.new('L',(680,650));d=ImageDraw.Draw(reg)
d.polygon([(286,230),(310,230),(317,280),(313,340),(301,383),(280,392),(283,350),(289,305)],fill=255)
d.polygon([(504,230),(528,230),(530,285),(535,340),(550,386),(532,392),(515,373),(505,340),(502,285)],fill=255)
inside=np.asarray(reg)>0; dark=(body[:,:,:3].max(axis=2)<160); selected=inside & dark & (body[:,:,3]>0)
body[selected,3]=0; x,y,w,h=r['left'],r['top'],r['width'],r['height']; Image.fromarray(body[y:y+h,x:x+w]).save(layout/item['image']['path'])
# Extrapolate one pixel at the translucent outer edge of the back-hair alpha.
b=next(x for x in m['layers'] if x['id']=='hair_back'); back=np.asarray(Image.open(layout/b['image']['path']).convert('RGBA')).copy(); alpha=back[:,:,3]; edge=((alpha>0)&(alpha<255)); edge &= cv2.erode((alpha>0).astype('uint8'),np.ones((3,3),np.uint8))==0
br=b['rect']; reference_alpha=np.asarray(Image.open(p/'kohako/layout2/reference.png').convert('RGBA'))[:,:,3]; reference_alpha=reference_alpha[br['top']:br['top']+alpha.shape[0],br['left']:br['left']+alpha.shape[1]]
edge &= (reference_alpha>0) & (reference_alpha<255)
if edge.any():
 interior=cv2.erode((alpha>0).astype('uint8'),np.ones((3,3),np.uint8))>0
 iy,ix=np.nonzero(interior)
 if len(iy):
  _,labels=cv2.distanceTransformWithLabels((~interior).astype('uint8'),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
  indices=np.clip(labels[edge]-1,0,len(iy)-1); back[edge,:3]=back[iy[indices],ix[indices],:3]
 Image.fromarray(back).save(layout/b['image']['path'])
ref=np.asarray(Image.open(p/'kohako/layout2/reference.png').convert('RGBA')).copy();ref[selected,:3]=(ref[selected,:3].astype(float)*.3+np.array([0,220,255])*.7).astype('uint8');Image.fromarray(ref).save(p/'v6/out/v15c-mask.png')
m['name']='kohako-v15c'; path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print('Under-braid body pixels removed:',int(selected.sum()),'defringed:',int(edge.sum()),flush=True)
