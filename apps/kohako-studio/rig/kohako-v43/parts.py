"""Register generated half-blink to the v38 eye crop and create two patches."""
import copy,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=Path('/tmp/boxp441'); layout=p/'v6/layout'
ref=np.asarray(Image.open(p/'eyes-ref.png').convert('RGB'))
src=np.asarray(Image.open(p/'eyes-v43.png').convert('RGB').resize((536,279),Image.Resampling.LANCZOS))
mask=np.zeros((279,536),np.uint8); mask[:80,:]=255; mask[200:,:]=255; mask[80:200,220:300]=255
warp=np.eye(2,3,dtype=np.float32)
score,warp=cv2.findTransformECC(cv2.cvtColor(ref,cv2.COLOR_RGB2GRAY),cv2.cvtColor(src,cv2.COLOR_RGB2GRAY),warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,300,1e-6),mask,5)
aligned=cv2.warpAffine(src,warp,(536,279),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
canvas=np.zeros((650,680,3),np.uint8); canvas[160:280,300:530]=cv2.resize(aligned,(230,120))
Image.fromarray(canvas).save(p/'v6/out/v43-aligned.png')
m=json.loads((layout/'layout.json').read_text()); anchor=next(l for l in m['layers'] if l['id']=='face_smile')
for side,rect in [('right',(319,193,398,244)),('left',(424,202,504,252))]:
 x0,y0,x1,y1=rect; w=x1-x0;h=y1-y0; y,x=np.indices((h,w)); d=((x-w/2)/(w*.49))**2+((y-h*.50)/(h*.48))**2
 alpha=(np.clip((1-d)/.24,0,1)*255).astype('uint8'); Image.fromarray(np.dstack((canvas[y0:y1,x0:x1],alpha))).save(layout/f'eye_mid_{side}_v43.png')
 layer=copy.deepcopy(anchor);layer.update(id=f'eye_mid_{side}_v43',name=f'eye mid {side} v43',rect=dict(left=x0,top=y0,width=w,height=h));layer['image']={'path':f'eye_mid_{side}_v43.png','width':w,'height':h};m['layers'].insert(m['layers'].index(anchor)+1,layer)
(layout/'layout.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
(p/'v6/out/v43-align.json').write_text(json.dumps({'ecc':float(score),'warp_reference_to_source':warp.tolist(),'ref_to_canvas':{'left':300,'top':160,'scale_x':230/536,'scale_y':120/279}},indent=2))
print('v43 alignment',score,warp.tolist(),flush=True)
