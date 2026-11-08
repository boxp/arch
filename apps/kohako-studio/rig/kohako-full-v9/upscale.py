import os,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=Path(os.environ['OUT']); doc=json.loads((p/'layout.json').read_text())
rgb=np.asarray(Image.open(os.environ['SOURCE']).convert('RGB')); h,w=rgb.shape[:2]
sx=w/1143; sy=h/2048
# Build the exterior from the original image, retaining only background connected to the canvas edge.
near=(rgb.min(2)>238).astype('uint8'); n,labels,_,_=cv2.connectedComponentsWithStats(near,8)
ids=np.unique(np.concatenate((labels[0],labels[-1],labels[:,0],labels[:,-1])))
bg=np.isin(labels,ids)&(near>0)
# v8 silhouette masks preserve enclosed gaps and the floor treatment.
source=np.asarray(Image.open(p/'source.png').convert('RGBA'))[:,:,3]
base=cv2.resize(source,(w,h),interpolation=cv2.INTER_NEAREST)>0
exterior=cv2.dilate(bg.astype('uint8'),np.ones((5,5),np.uint8))>0
for layer in doc['layers']:
 r=layer['rect']; x0=round(r['left']*sx); y0=round(r['top']*sy); x1=round((r['left']+r['width'])*sx); y1=round((r['top']+r['height'])*sy)
 im=np.asarray(Image.open(p/layer['image']['path']).convert('RGBA')); a=cv2.resize(im[:,:,3],(x1-x0,y1-y0),interpolation=cv2.INTER_LINEAR)
 color=cv2.resize(im[:,:,:3],(x1-x0,y1-y0),interpolation=cv2.INTER_LINEAR)
 name=layer['id']; feature=name.startswith('eye_') or name.startswith('mouth_')
 if not feature and name!='face':
  color=rgb[y0:y1,x0:x1].copy()
  # Restrict adjustment to original outer boundary, not internal layer cuts.
  edge=exterior[y0:y1,x0:x1] & (a>0) & base[y0:y1,x0:x1]
  if edge.any():
   opaque=(~exterior[y0:y1,x0:x1] & (a>240)).astype('uint8')
   if opaque.any():
    _,ind=cv2.distanceTransformWithLabels(1-opaque,cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
    ys,xs=np.where(opaque); lookup=np.zeros((len(ys)+1,3),np.uint8); lookup[1:]=color[ys,xs]; nearest=lookup[np.minimum(ind,len(ys))]
    I=color.astype('float32'); F=nearest.astype('float32'); denom=255-F; valid=denom>20
    ratios=np.where(valid,(255-I)/np.maximum(denom,1),0); est=np.max(ratios,axis=2).clip(0,1)
    alpha=np.minimum(a.astype('float32')/255,est); good=edge & (alpha>.05) & (alpha<.999); tiny=edge & (alpha<=.05)
    clean=np.clip((I-(1-alpha[:,:,None])*255)/np.maximum(alpha[:,:,None],.05),0,255).astype('uint8'); color[good]=clean[good]; color[tiny]=nearest[tiny]; a[edge]=(alpha[edge]*255).astype('uint8')
 Image.fromarray(np.dstack((color,a))).save(p/layer['image']['path'])
 layer['rect']={'left':x0,'top':y0,'width':x1-x0,'height':y1-y0}; layer['image']['width']=x1-x0;layer['image']['height']=y1-y0
doc['canvas']={'width':w,'height':h};(p/'layout.json').write_text(json.dumps(doc,indent=2))
