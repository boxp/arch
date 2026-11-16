"""Trial: align an existing generated closed-eye image and replace eye-close layers."""
from pathlib import Path
import json, cv2, numpy as np
from PIL import Image
p=Path('/tmp/boxp441'); layout=p/'v6/layout'; path=layout/'layout.json'; m=json.loads(path.read_text()); items={x['id']:x for x in m['layers']}
ref=np.asarray(Image.open(p/'kohako/layout2/reference.png').convert('RGB'))
src=np.asarray(Image.open(p/'gen/codex-eyes-closed-v14-1.png').convert('RGB').resize((680,650),Image.Resampling.LANCZOS))
# Align non-eye facial landmarks; eyes and mouth differ intentionally.
template=cv2.cvtColor(ref,cv2.COLOR_RGB2GRAY); moving=cv2.cvtColor(src,cv2.COLOR_RGB2GRAY)
mask=np.zeros((650,680),np.uint8); mask[115:335,300:530]=255; mask[185:253,315:505]=0; mask[280:315,375:445]=0
warp=np.eye(2,3,dtype=np.float32)
try:
 score,warp=cv2.findTransformECC(template,moving,warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,200,1e-6),mask,5)
 # Reject implausible alignments rather than silently warp the face.
 if np.linalg.norm(warp[:,:2]-np.eye(2))>.25 or np.linalg.norm(warp[:,2])>60: raise ValueError('unstable affine')
except (cv2.error,ValueError): score=None; warp=np.eye(2,3,dtype=np.float32)
aligned=cv2.warpAffine(src,warp,(680,650),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
Image.fromarray(aligned).save(p/'v6/out/v15e-aligned.png')
for name,(x0,y0,x1,y1) in {'eye_closed_right':(319,193,398,244),'eye_closed_left':(424,202,504,252)}.items():
 yy,xx=np.indices((y1-y0,x1-x0)); cx=(x1-x0-1)/2; cy=(y1-y0-1)/2; dist=((xx-cx)/(cx-1))**2+((yy-cy)/(cy-1))**2
 ring=(dist>.55)&(dist<.9); r=ref[y0:y1,x0:x1].astype(np.float32); a=aligned[y0:y1,x0:x1].astype(np.float32)
 skin=ring & (r[:,:,0]>150)&(r[:,:,1]>100)&(r[:,:,0]>r[:,:,2]) & (a[:,:,0]>150)&(a[:,:,1]>100)&(a[:,:,0]>a[:,:,2])
 delta=np.median(r[skin]-a[skin],axis=0) if skin.sum()>10 else np.zeros(3)
 # Limit correction; retain generated eye-line contrast.
 delta=np.clip(delta,-25,25); a=np.clip(a+delta,0,255).astype('uint8')
 alpha=(np.clip((1-dist)/.25,0,1)*255).astype('uint8'); rgba=np.dstack((a,alpha)); Image.fromarray(rgba).save(layout/items[name]['image']['path']); item=items[name]; item['rect']={'left':x0,'top':y0,'width':x1-x0,'height':y1-y0}; item['image'].update(width=x1-x0,height=y1-y0)
m['name']='kohako-v15e'; path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n'); (p/'v6/out/v15e-align.json').write_text(json.dumps({'ecc':score,'warp':warp.tolist()},indent=2));print('eye alignment',score,warp.tolist(),flush=True)
# Align the mouth source using facial surroundings, excluding eyes and mouth.
src=np.asarray(Image.open(p/'gen/codex-mouth-closed-v16-1.png').convert('RGB').resize((680,650),Image.Resampling.LANCZOS))
moving=cv2.cvtColor(src,cv2.COLOR_RGB2GRAY); warp=np.eye(2,3,dtype=np.float32)
try:
 score,warp=cv2.findTransformECC(template,moving,warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,200,1e-6),mask,5)
 if np.linalg.norm(warp[:,:2]-np.eye(2))>.25 or np.linalg.norm(warp[:,2])>60: raise ValueError('unstable affine')
except (cv2.error,ValueError) as e: raise RuntimeError('mouth alignment failed; do not silently use unaligned material') from e
aligned=cv2.warpAffine(src,warp,(680,650),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
Image.fromarray(aligned).save(p/'v6/out/v16-mouth-aligned.png')
x0,y0,x1,y1=370,275,445,315
yy,xx=np.indices((y1-y0,x1-x0));cx=(x1-x0-1)/2;cy=(y1-y0-1)/2;dist=((xx-cx)/(cx-1))**2+((yy-cy)/(cy-1))**2
r=ref[y0:y1,x0:x1].astype('float32');a=aligned[y0:y1,x0:x1].astype('float32');skin=(dist>.55)&(dist<.9)&(r[:,:,0]>150)&(r[:,:,1]>100)&(r[:,:,0]>r[:,:,2])&(a[:,:,0]>150)&(a[:,:,1]>100)&(a[:,:,0]>a[:,:,2]);delta=np.median(r[skin]-a[skin],axis=0) if skin.sum()>10 else np.zeros(3);a=np.clip(a+np.clip(delta,-25,25),0,255).astype('uint8');alpha=(np.clip((1-dist)/.25,0,1)*255).astype('uint8')
item=items['mouth_closed'];Image.fromarray(np.dstack((a,alpha))).save(layout/item['image']['path']);item['rect']={'left':x0,'top':y0,'width':x1-x0,'height':y1-y0};item['image'].update(width=x1-x0,height=y1-y0)
m['name']='kohako-v16';path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');(p/'v6/out/v16-mouth-align.json').write_text(json.dumps({'ecc':score,'warp':warp.tolist(),'skin_delta':delta.tolist()},indent=2))
