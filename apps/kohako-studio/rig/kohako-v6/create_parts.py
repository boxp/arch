from pathlib import Path
import json, shutil
import numpy as np, cv2
from PIL import Image
base=Path('/tmp/boxp441/v5b/layout'); dest=Path('/tmp/boxp441/v6/layout')
shutil.copytree(base,dest,dirs_exist_ok=True)
m=json.loads((dest/'layout.json').read_text()); m['name']='kohako-v6'; layers={x['id']:x for x in m['layers']}
f=np.asarray(Image.open(dest/'face.png').convert('RGBA')).copy(); rgb=f[:,:,:3].copy(); mask=np.zeros(f.shape[:2],np.uint8)
# Local canvas coordinates: the outside fragments above the prepared eye apertures.
for side,box in [('right',(326,197,345,205)),('left',(486,210,497,219))]:
 x1,y1,x2,y2=box; sub=rgb[y1-137:y2-137,x1-313:x2-313]; lum=sub.min(axis=2); a=np.clip((175-lum.astype(float))*4,0,255).astype('uint8'); a[lum>165]=0
 # Only move dark strokes, preserving their color; expand the lash rectangle as needed.
 item=layers['eye_'+side+'_lash']; r=item['rect']; old=Image.open(dest/item['image']['path']).convert('RGBA'); nx=min(x1,r['left']); ny=min(y1,r['top']); ex=max(x2,r['left']+r['width']); ey=max(y2,r['top']+r['height']); canvas=Image.new('RGBA',(ex-nx,ey-ny)); canvas.alpha_composite(old,(r['left']-nx,r['top']-ny)); patch=Image.fromarray(np.dstack((sub,a))); canvas.alpha_composite(patch,(x1-nx,y1-ny)); canvas.save(dest/item['image']['path']); r.update(left=nx,top=ny,width=ex-nx,height=ey-ny); item['image'].update(width=ex-nx,height=ey-ny)
 local=mask[y1-137:y2-137,x1-313:x2-313]; local[:]=np.maximum(local,cv2.dilate((a>0).astype('uint8')*255,np.ones((3,3),np.uint8)))
# Remove residual mouth line/ghost using surrounding skin.
cv2.ellipse(mask,(407-313,296-137),(35,16),0,0,360,255,-1)
f[:,:,:3]=cv2.inpaint(rgb,mask,5,cv2.INPAINT_TELEA)
# Neutral skin beneath opaque center bangs, leaving the visible default hair shadow intact.
hair=np.asarray(Image.open(dest/'hair_front.png').convert('RGBA'))[:,:,3]; covered=np.zeros((650,680),np.uint8); covered[17:17+hair.shape[0],250:250+hair.shape[1]]=hair
Y,X=np.indices(f.shape[:2]); xx=X+313; yy=Y+137
region=(xx>=386)&(xx<=425)&(yy>=190)&(yy<=209)
w=cv2.GaussianBlur(region.astype('float32'),(0,0),2.5)
skin=np.array([253,226,216],dtype='float32'); f[:,:,:3]=np.clip(f[:,:,:3]*(1-w[:,:,None])+skin*w[:,:,None],0,255).astype('uint8')
Image.fromarray(f).save(dest/'face.png')
layers['mouth_closed']['rect']['top']-=3
layers['mouth_closed']['rect']['left']-=2
(dest/'layout.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
