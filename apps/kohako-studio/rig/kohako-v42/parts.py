"""Align the existing generated mouth and construct the intermediate face-detail layer."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
p=Path('/tmp/boxp441')
ref=np.asarray(Image.open(p/'kohako/bust-smile.png').convert('RGB'))
src=np.asarray(Image.open(p/'mouth-v41.png').convert('RGB').resize((680,650),Image.Resampling.LANCZOS))
mask=np.zeros((650,680),np.uint8); mask[115:335,300:530]=255; mask[185:253,315:505]=0; mask[275:320,365:450]=0
warp=np.eye(2,3,dtype=np.float32)
score,warp=cv2.findTransformECC(cv2.cvtColor(ref,cv2.COLOR_RGB2GRAY),cv2.cvtColor(src,cv2.COLOR_RGB2GRAY),warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,200,1e-6),mask,5)
if np.linalg.norm(warp[:,:2]-np.eye(2))>.25 or np.linalg.norm(warp[:,2])>60: raise ValueError('unstable alignment')
aligned=cv2.warpAffine(src,warp,(680,650),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
Image.fromarray(aligned).save(p/'v6/out/v41-aligned.png')
# Add a distinct face/detail layer. Retain the existing closed lip line over the
# generated lower opening so the transition anchors to the original corners.
layout=p/'v6/layout'
closed=Image.open(layout/'mouth_closed.png').convert('RGBA')
patch=aligned[275:315,370:445]
y,x=np.indices((40,75)); d=((x-37)/25)**2+((y-22)/10)**2
alpha=(np.clip((1-d)/.3,0,1)*255).astype('uint8')
mid=Image.fromarray(np.dstack((patch,alpha)))
# Preserve only the closed line, not its opaque skin patch, over the opening.
line=np.array(closed)
dark=np.clip((205-line[:,:,:3].min(axis=2).astype(np.float32))/75,0,1)
line[:,:,3]=(line[:,:,3].astype(np.float32)*dark).astype('uint8')
mid.alpha_composite(Image.fromarray(line))
mid.save(layout/'mouth_mid_v42.png')
m=json.loads((layout/'layout.json').read_text())
closed_layer=next(l for l in m['layers'] if l['id']=='face_smile')
import copy
layer=copy.deepcopy(closed_layer); layer.update(id='face_mid_v42',name='face mid v42')
layer['image']['path']='mouth_mid_v42.png'
m['layers'].insert(m['layers'].index(closed_layer)+1,layer)
(layout/'layout.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
(p/'v6/out/v42-align.json').write_text(json.dumps({'ecc':float(score),'warp':warp.tolist()},indent=2))
print('v42 ECC',score,warp.tolist(),flush=True)
