#!/usr/bin/env python3
"""Prepare the supplied green-screen kit in the existing 1143-wide layout."""
import json, os
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
root=Path(os.environ.get('LAYOUT','/w/layout')); kit=Path(os.environ.get('KIT','/w/kit'))
d=json.loads((root/'layout.json').read_text()); layers={x['id']:x for x in d['layers']}
def keyed(file):
 a=np.asarray(Image.open(kit/file).convert('RGB')).astype(np.float32)
 # Distance from key: estimate foreground coverage, remove green contribution.
 alpha=np.clip((np.sqrt(a[:,:,0]**2+(255-a[:,:,1])**2+a[:,:,2]**2)-10)/70,0,1)
 rgb=a.copy(); rgb[:,:,1]=np.minimum(rgb[:,:,1],np.maximum(rgb[:,:,0],rgb[:,:,2]))
 return np.dstack((rgb,alpha*255)).astype(np.uint8)
def save(id, arr, rect, density=2):
 l=layers[id]; x,y,w,h=rect
 l['rect']=dict(left=x,top=y,width=w,height=h); l['image'].update(width=w*density,height=h*density)
 Image.fromarray(arr).save(root/l['image']['path'])
def warp(src,rect,scale,tx,ty,density=2):
 x,y,w,h=rect
 # Filter premultiplied color and coverage together to avoid key-color fringes.
 f=src.astype(np.float32)/255; f[:,:,:3]*=f[:,:,3:4]
 sw=max(1,round(src.shape[1]*scale*density)); sh=max(1,round(src.shape[0]*scale*density))
 f=cv2.resize(f,(sw,sh),interpolation=cv2.INTER_AREA)
 mat=np.array([[1,0,(tx-x)*density],[0,1,(ty-y)*density]],dtype=np.float32)
 f=cv2.warpAffine(f,mat,(w*density,h*density),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 alpha=f[:,:,3:4]; f[:,:,:3]=np.divide(f[:,:,:3],alpha,out=np.zeros_like(f[:,:,:3]),where=alpha>1e-6)
 return np.clip(f*255,0,255).astype(np.uint8)
# The original eyebrows are in face, while hair_front is transparent there.
original=np.asarray(Image.open(root/'face.png').convert('RGBA')).copy()
mask=np.zeros(original.shape[:2],np.uint8)
for pts in [[(29,43),(38,40),(48,39),(58,39),(67,41)],[(119,42),(129,40),(140,40),(151,42),(163,46)]]:
 cv2.polylines(mask,[np.array(pts,dtype=np.int32)],False,255,4,cv2.LINE_AA)
mask=np.minimum(mask, np.where(np.max(original[:,:,:3],axis=2)<155,original[:,:,3],0).astype(np.uint8))
original[:,:,3]=mask
brow={'id':'face_brow','name':'face brow','image':{'path':'face_brow.png','width':364,'height':392},'rect':{'left':481,'top':206,'width':182,'height':196},'tags':['face','detail']}
d['layers'].insert(d['layers'].index(layers['hair_front']),brow);layers['face_brow']=brow
Image.fromarray(original).resize((364,392),Image.Resampling.LANCZOS).save(root/'face_brow.png')
face=keyed('kit-face-1.png')
# Preserve the original face's hair, outline and exact canvas rectangle.
l=layers['face']; rect=tuple(l['rect'][k] for k in ('left','top','width','height'))
base=cv2.resize(np.asarray(Image.open(root/'face.png').convert('RGBA')), (rect[2]*2,rect[3]*2), interpolation=cv2.INTER_LANCZOS4)
kitface=warp(face,rect,.3205,372.1,67.0)
r,g,b=[base[:,:,i].astype(np.int16) for i in range(3)]
skin=((r>155)&(g>95)&(b>90)&(r>g*1.025)&(r>b*1.015)&(base[:,:,3]>250)).astype(np.uint8)
# Keep only the connected skin component containing the central cheek.
n,labels,stats,centroids=cv2.connectedComponentsWithStats(skin,8)
label=1+np.argmax(stats[1:,cv2.CC_STAT_AREA]); skin=(labels==label).astype(np.uint8)
# No blur may spill over the eroded boundary, or touch hair/ink pixels.
safe=cv2.erode(skin,np.ones((13,13),np.uint8))
distance=cv2.distanceTransform(skin,cv2.DIST_L2,3)
weight=np.clip((distance-6)/12,0,1)*(kitface[:,:,3]/255.)
assert not np.any(weight[skin==0]), 'replacement must not cover non-skin pixels'
# Low-frequency color correction tends to the underlying skin at the seam,
# while retaining high-frequency kit shading, including the blush.
base_rgb=base[:,:,:3].astype(np.float32); kit_rgb=kitface[:,:,:3].astype(np.float32)
valid=(safe>0)&(kitface[:,:,3]>250)
diff=np.median((base_rgb-kit_rgb)[valid],axis=0) if valid.any() else np.zeros(3)
corrected=np.clip(kit_rgb+diff,0,255)
# Fade the residual low-frequency difference near the edge of the mask.
blurmask=cv2.GaussianBlur(skin.astype(np.float32),(0,0),12)[:,:,None]+1e-5
low_base=cv2.GaussianBlur(base_rgb*skin[:,:,None],(0,0),12)/blurmask
low_kit=cv2.GaussianBlur(corrected*skin[:,:,None],(0,0),12)/blurmask
edge=np.clip(1-(distance-6)/35,0,1)[:,:,None]
corrected=np.clip(corrected+(low_base-low_kit)*edge,0,255)
base[:,:,:3]=np.clip(base_rgb*(1-weight[:,:,None])+corrected*weight[:,:,None],0,255).astype(np.uint8)
save('face',base,rect)
eye=keyed('kit-eyes-1.png'); scale=.165
# Sheet centroids measured on the open iris; one transform per side for every state.
centers={'right': (489.3, 215.0, 524.6, 285.2), 'left': (1050.9, 217.6, 626.0, 287.9)}
for side,sl in [('right',(0,768)),('left',(768,1536))]:
 cx,cy,target_x,target_y=centers[side]; tx=target_x-cx*scale; ty=target_y-cy*scale
 for row,kind in [(0,'open'),(1,'mid'),(2,'closed')]:
  part=eye[row*341:(row+1)*341,sl[0]:sl[1]].copy()
  rect=(480,260,86,60) if side=='right' else (580,260,86,60)
  if kind=='open':
   rgb=part[:,:,:3].astype(float); r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
   white=(r>175)&(g>165)&(b>165)&(np.abs(r-b)<55)
   iris=(b>r*1.08)&(b>g*.95)&(b>55)&~white
   for name,mask in [('white',white|iris),('iris',iris),('lash',~(white|iris))]:
    z=part.copy(); soft=cv2.GaussianBlur(mask.astype(np.float32),(5,5),1.0)
    if name=='lash': soft=cv2.dilate(soft,np.ones((3,3),np.uint8))
    if name=='white': z[:,:,:3][iris]=[245,244,250]
    z[:,:,3]=(z[:,:,3].astype(float)*soft).astype(np.uint8)
    save('eye_'+side+'_'+name,warp(z,rect,scale,tx+sl[0]*scale,ty),rect)
  else: save(('eye_mid_'+side+'_v44') if kind=='mid' else ('eye_closed_'+side),warp(part,rect,scale,tx+sl[0]*scale,ty),rect)
mouth=keyed('kit-mouth-1.png'); base=layers['face_smile'].copy(); base['id']=base['name']='mouth_mid'; base['image']=dict(base['image'],path='mouth_mid.png'); d['layers'].insert(d['layers'].index(layers['face_smile'])+1,base); layers['mouth_mid']=base
for row,id in enumerate(['face_smile','mouth_mid','mouth_open']):
 part=mouth[row*315:row*315+341].copy(); rect=(548,345,49,30)
 # Replace the dark line's RGB, retaining coverage and leaving red mouth and teeth intact.
 rgb=part[:,:,:3].astype(np.int16); r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
 line=(np.max(rgb,axis=2)<155)&(r<g*1.35)&(part[:,:,3]>0)
 part[:,:,:3][line]=[122,83,79]
 # Keep the upper line and corners fixed; stretch only below their curved line.
 if row:
  h,w=part.shape[:2]; xx=np.arange(w); line=210-50*((xx-768)/270)**2
  line=np.clip(line,158,210); yy=np.arange(h)[:,None].astype(np.float32)
  factor=1.45 if row==1 else 1.8
  mapy=np.where(yy>line[None,:],line[None,:]+(yy-line[None,:])/factor,yy).astype(np.float32)
  mapx=np.broadcast_to(xx.astype(np.float32),(h,w)).copy()
  part=cv2.remap(part,mapx,mapy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 save(id,warp(part,rect,.074,516.8,338.5),rect)
d['name']='kohako-full-v11h'; (root/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
# Restore only diffuse temple shadows; protect sharp ink and the outer contour.
p=root/'face.png'; rgba=np.asarray(Image.open(p).convert('RGBA')).copy(); before=rgba.copy()
rgb=rgba[:,:,:3].astype(np.float32); gray=cv2.cvtColor(rgba[:,:,:3],cv2.COLOR_RGB2GRAY)
gx=cv2.Sobel(gray,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(gray,cv2.CV_32F,0,1,ksize=3)
edge=(cv2.magnitude(gx,gy)>200).astype(np.uint8)
edge=cv2.dilate(edge,np.ones((3,3),np.uint8)); protect=1-np.clip(cv2.distanceTransform(1-edge,cv2.DIST_L2,3)/8,0,1)
mask=np.zeros(gray.shape,np.uint8)
for poly in [[(22,147),(31,141),(49,145),(59,158),(59,193),(48,202),(34,190),(25,171)],[(310,145),(329,141),(341,146),(344,165),(334,184),(319,198),(308,193),(307,160)]]:
 cv2.fillPoly(mask,[np.array(poly,np.int32)],255)
# A smooth feather remains entirely within each polygon and fully opaque face pixels.
dist=cv2.distanceTransform(mask,cv2.DIST_L2,3); weight=np.clip(dist/7,0,1)*(1-np.clip(protect,0,1)); weight*=rgba[:,:,3]==255; weight[edge>0]=0
# Continue the low-frequency cheek colour horizontally from nearby clear skin.
blur=cv2.GaussianBlur(rgb,(0,0),5)
target=rgb.copy()
for x0,x1,anchor in [(0,65,66),(300,364,298)]:
 target[:,x0:x1,:]=blur[:,anchor:anchor+1,:]
rgba[:,:,:3]=np.clip(rgb*(1-weight[:,:,None])+target*weight[:,:,None],0,255).astype(np.uint8)
changed=np.any(rgba!=before,axis=2); assert np.array_equal(rgba[:,:,3],before[:,:,3]); assert not np.any(changed & (mask==0)); Image.fromarray(rgba).save(p)
print('temple changed pixels',int(changed.sum()),'bounds',[(int(np.where(changed & (np.indices(changed.shape)[1]<182))[1].min()),int(np.where(changed & (np.indices(changed.shape)[1]<182))[1].max())),(int(np.where(changed & (np.indices(changed.shape)[1]>182))[1].min()),int(np.where(changed & (np.indices(changed.shape)[1]>182))[1].max()))])
