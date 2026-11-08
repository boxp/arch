"""Experimental replacement of the mouth-open texture, aligned to the source bust."""
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
# The existing open-mouth mesh and its geometry remain unchanged. Restrict replacement to its rectangle.
patch=aligned[286:306,382:431]
y,x=np.indices((20,49)); d=((x-24)/23)**2+((y-9.5)/9)**2
alpha=(np.clip((1-d)/.3,0,1)*255).astype('uint8')
Image.fromarray(np.dstack((patch,alpha))).save(p/'v6/layout/mouth_open.png')
(p/'v6/out/v41-align.json').write_text(json.dumps({'ecc':float(score),'warp':warp.tolist(),'rect':[382,286,431,306]},indent=2))
print('v41 ECC',score,warp.tolist(),flush=True)
