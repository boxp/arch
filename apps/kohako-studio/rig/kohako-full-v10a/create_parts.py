import json, os, shutil
from pathlib import Path
import cv2, numpy as np
from PIL import Image
base=Path(os.environ['BASE_LAYOUT']); v45=Path(os.environ['V45_LAYOUT']); out=Path(os.environ['OUT']); out.mkdir(parents=True,exist_ok=True)
d=json.loads((base/'layout.json').read_text()); h=json.loads((v45/'layout.json').read_text())
P=np.float32([[358,217],[463,226],[406,295]]); Q=np.float32([[522,290],[620,290],[574,354]])
M,_=cv2.estimateAffinePartial2D(P,Q)
keep={'face','eye_right_white','eye_right_iris','eye_right_lash','eye_left_white','eye_left_iris','eye_left_lash','eye_closed_right','eye_closed_left','eye_mid_right_v44','eye_mid_left_v44','mouth_open','face_smile','hair_side_right','hair_side_left','hair_front'}
old=[x for x in d['layers'] if not (x['id']=='face' or x['id'].startswith(('eye_','mouth_')) or x['id']=='front_hair')]
for x in old:
 if x['id']!='neck':
  shutil.copyfile(base/x['image']['path'],out/x['image']['path']); continue
 # Extend the existing dark neck texture behind the chin; the face stays in front.
 a=np.asarray(Image.open(base/x['image']['path']).convert('RGBA')).copy(); pad=50
 extended=np.zeros((a.shape[0]+pad,a.shape[1],4),np.uint8)
 row=a[min(22,a.shape[0]-1)].copy()
 extended[:pad]=row[None,:,:]
 extended[pad:]=a
 Image.fromarray(extended).save(out/x['image']['path'])
 x['rect']['top']-=pad; x['rect']['height']+=pad; x['image']['height']+=pad
new=[]
for x in h['layers']:
 if x['id'] not in keep: continue
 a=np.asarray(Image.open(v45/x['image']['path']).convert('RGBA')); r=x['rect']; canvas=np.zeros((650,680,4),np.uint8); canvas[r['top']:r['top']+r['height'],r['left']:r['left']+r['width']]=a
 if x['id'].startswith('hair_side'): canvas[345:,:,3]=0
 w=cv2.warpAffine(canvas,M,(1143,2048),flags=cv2.INTER_LINEAR); ys,xs=np.where(w[:,:,3]>0); assert len(xs),x['id']; l,t,rr,b=xs.min(),ys.min(),xs.max()+1,ys.max()+1
 name=x['id']+'.png'; Image.fromarray(w[t:b,l:rr]).save(out/name)
 x['image']={'path':name,'width':int(rr-l),'height':int(b-t)}; x['rect']={'left':int(l),'top':int(t),'width':int(rr-l),'height':int(b-t)}; new.append(x)
# Face above neck, remaining head parts above existing braids.
i=next(i for i,x in enumerate(old) if x['id']=='neck')+1
old.insert(i,new.pop(0)); d['layers']=old+new; d['name']='kohako-full-v10a'; (out/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2))
print('transform',M.tolist(), 'layers',len(d['layers']))
