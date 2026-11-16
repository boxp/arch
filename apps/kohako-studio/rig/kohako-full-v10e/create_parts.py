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
old.insert(i,new.pop(0)); d['layers']=old+new; d['name']='kohako-full-v10e'; (out/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2))
print('transform',M.tolist(), 'layers',len(d['layers']))
# Move dark hair above the shoulders, in the original canvas coordinates.
body_layer=next(x for x in d['layers'] if x['id']=='body')
back_layer=next(x for x in d['layers'] if x['id']=='back_hair')
b=np.array(Image.open(out/body_layer['image']['path']).convert('RGBA'))
hb=np.array(Image.open(out/back_layer['image']['path']).convert('RGBA'))
br=body_layer['rect']; hr=back_layer['rect']
yy,xx=np.indices(b.shape[:2]); cx=xx+br['left']; cy=yy+br['top']
# Hair is dark and lies outside the central neck, before the gold shoulders begin.
hair=(b[:,:,3]>0)&(cy<455)&((cx<470)|(cx>674))&(b[:,:,:3].max(axis=2)<135)
# Include antialiased hair edges, but never the white matte.
hair=cv2.dilate(hair.astype('uint8'),np.ones((3,3),np.uint8)).astype(bool)&(b[:,:,3]>0)&(cy<455)&((cx<470)|(cx>674))&(b[:,:,:3].min(axis=2)<180)
ys,xs=np.where(hair); hy=ys+br['top']-hr['top']; hx=xs+br['left']-hr['left']; valid=(hy>=0)&(hy<hb.shape[0])&(hx>=0)&(hx<hb.shape[1]); ys,xs,hy,hx=ys[valid],xs[valid],hy[valid],hx[valid]
s=b[ys,xs].astype(float); t=hb[hy,hx].astype(float); sa=s[:,3:4]/255; da=t[:,3:4]/255; oa=sa+da*(1-sa)
hb[hy,hx,:3]=np.round((s[:,:3]*sa+t[:,:3]*da*(1-sa))/np.maximum(oa,1e-6)).astype('uint8'); hb[hy,hx,3]=np.round(oa[:,0]*255).astype('uint8'); b[ys,xs,3]=0
# Remove near-white matte only along the exposed upper outside edge.
white=(cy<455)&((cx<470)|(cx>674))&(b[:,:,:3].min(axis=2)>225)&(b[:,:,3]>0)
b[white,3]=0
Image.fromarray(b).save(out/body_layer['image']['path']); Image.fromarray(hb).save(out/back_layer['image']['path'])
print('moved hair pixels',len(xs),'removed white pixels',int(white.sum()))
# Close only narrow transparent gaps in the back-hair silhouette; extend nearby
# existing hair colors into newly covered pixels, leaving the body untouched.
mask=(hb[:,:,3]>128).astype('uint8')
closed=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
fill=(closed>0)&(hb[:,:,3]==0)
_, labels=cv2.distanceTransformWithLabels((1-mask).astype('uint8'),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
coords=np.column_stack(np.where(mask))
if fill.any():
 indices=labels[fill]-1
 hb[fill]=hb[coords[indices,0],coords[indices,1]]
Image.fromarray(hb).save(out/back_layer['image']['path'])
print('back hair gap pixels filled',int(fill.sum()))
# Bridge the transparent gap within the existing neck texture with nearby neck
# pixels. Limit the change to the upper neck; do not alter body or back hair.
neck_layer=next(x for x in d['layers'] if x['id']=='neck')
neck=np.asarray(Image.open(out/neck_layer['image']['path']).convert('RGBA')).copy()
mask=(neck[:,:,3]>128).astype('uint8')
closed=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_RECT,(3,31)))
fill=(closed>0)&(neck[:,:,3]==0); fill[75:]=False
_, labels=cv2.distanceTransformWithLabels((1-mask).astype('uint8'),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
coords=np.column_stack(np.where(mask)); indices=labels[fill]-1
neck[fill]=neck[coords[indices,0],coords[indices,1]]
Image.fromarray(neck).save(out/neck_layer['image']['path'])
print('neck gap pixels filled',int(fill.sum()))
