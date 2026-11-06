"""Align generated half mouth using non-feature facial surroundings."""
from pathlib import Path
import copy,json,cv2,numpy as np
from PIL import Image
p=Path('/tmp/boxp441'); layout=p/'v6/layout'; path=layout/'layout.json'; m=json.loads(path.read_text())
ref=np.asarray(Image.open(p/'kohako/layout2/reference.png').convert('RGB'))
src=np.asarray(Image.open(p/'gen/codex-mouth-half-v17-1.png').convert('RGB').resize((680,650),Image.Resampling.LANCZOS))
template=cv2.cvtColor(ref,cv2.COLOR_RGB2GRAY); moving=cv2.cvtColor(src,cv2.COLOR_RGB2GRAY)
mask=np.zeros((650,680),np.uint8);mask[115:335,300:530]=255;mask[185:253,315:505]=0;mask[280:315,375:445]=0
warp=np.eye(2,3,dtype=np.float32)
score,warp=cv2.findTransformECC(template,moving,warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,200,1e-6),mask,5)
if np.linalg.norm(warp[:,:2]-np.eye(2))>.25 or np.linalg.norm(warp[:,2])>60: raise ValueError('unstable mouth alignment')
aligned=cv2.warpAffine(src,warp,(680,650),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
# The generated upper lip is two canvas pixels below the source upper lip.
aligned=cv2.warpAffine(aligned,np.float32([[1,0,0],[0,1,-2]]),(680,650),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
Image.fromarray(aligned).save(p/'v6/out/v17-mouth-aligned.png')
x0,y0,x1,y1=370,275,445,315
yy,xx=np.indices((y1-y0,x1-x0));cx=(x1-x0-1)/2;cy=(y1-y0-1)/2;dist=((xx-cx)/(cx-1))**2+((yy-cy)/(cy-1))**2
r=ref[y0:y1,x0:x1].astype('float32');a=aligned[y0:y1,x0:x1].astype('float32');skin=(dist>.55)&(dist<.9)&(r[:,:,0]>150)&(r[:,:,1]>100)&(r[:,:,0]>r[:,:,2])&(a[:,:,0]>150)&(a[:,:,1]>100)&(a[:,:,0]>a[:,:,2]);delta=np.median(r[skin]-a[skin],axis=0) if skin.sum()>10 else np.zeros(3);a=np.clip(a+np.clip(delta,-25,25),0,255).astype('uint8');alpha=(np.clip((1-dist)/.25,0,1)*255).astype('uint8')
Image.fromarray(np.dstack((a,alpha))).save(layout/'mouth_half.png')
base=next(x for x in m['layers'] if x['id']=='mouth_closed');item=copy.deepcopy(base);item.update(id='mouth_half',name='mouth half');item['image'].update(path='mouth_half.png',width=x1-x0,height=y1-y0);item['rect']={'left':x0,'top':y0,'width':x1-x0,'height':y1-y0};item['tags']=['mouth','open'];m['layers'].insert(m['layers'].index(base)+1,item)
m['name']='kohako-v17';path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');(p/'v6/out/v17-mouth-align.json').write_text(json.dumps({'ecc':score,'warp':warp.tolist(),'skin_delta':delta.tolist(),'lip_shift_y':-2},indent=2));print('v17 alignment',score,delta.tolist(),flush=True)
