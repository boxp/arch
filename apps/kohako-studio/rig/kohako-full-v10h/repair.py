import json,sys,shutil
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
src,dst,stage=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
shutil.copytree(src,dst,dirs_exist_ok=True)
d=json.loads((dst/'layout.json').read_text()); h=d['canvas']['height']; w=d['canvas']['width']; alpha=np.zeros((h,w),np.uint8)
skip={'eye_closed_left','eye_closed_right','eye_mid_left_v44','eye_mid_right_v44','mouth_open','face_smile'}
for l in d['layers']:
 if l['id'] in skip: continue
 a=np.asarray(Image.open(dst/l['image']['path']).convert('RGBA'))[:,:,3]; r=l['rect']; s=alpha[r['top']:r['top']+a.shape[0],r['left']:r['left']+a.shape[1]]; np.maximum(s,a,out=s)
labels,n=ndi.label(alpha<128); border=set(np.unique(np.concatenate([labels[0],labels[-1],labels[:,0],labels[:,-1]]))); mask=np.zeros((h,w),bool)
for i,sl in enumerate(ndi.find_objects(labels),1):
 if sl is None or i in border: continue
 y,x=sl
 if stage=='H1' and y.stop<=390 and y.start>=200: mask[sl] |= labels[sl]==i
 if stage=='H2' and y.start>=390 and y.stop<=420 and x.start>=500 and x.stop<=640: mask[sl] |= labels[sl]==i
mask=ndi.binary_dilation(mask,iterations=3)
name='back_hair' if stage=='H1' else 'neck'; layer=next(l for l in d['layers'] if l['id']==name); r=layer['rect']; old=np.asarray(Image.open(dst/layer['image']['path']).convert('RGBA')); canvas=np.zeros((h,w,4),np.uint8); canvas[r['top']:r['top']+old.shape[0],r['left']:r['left']+old.shape[1]]=old
valid=canvas[:,:,3]>=128; inds=ndi.distance_transform_edt(~valid,return_distances=False,return_indices=True); fill=mask & ~valid; canvas[fill]=canvas[inds[0][fill],inds[1][fill]]; canvas[fill,3]=255
ys,xs=np.where(canvas[:,:,3]>0); left,top,right,bottom=xs.min(),ys.min(),xs.max()+1,ys.max()+1; cropped=canvas[top:bottom,left:right]; Image.fromarray(cropped).save(dst/layer['image']['path']); layer['rect']={'left':int(left),'top':int(top),'width':int(right-left),'height':int(bottom-top)}; layer['image']['width']=int(right-left);layer['image']['height']=int(bottom-top); (dst/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2));print(stage,'pixels',int(fill.sum()),'rect',layer['rect'])
