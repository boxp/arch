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
# Measured chin outline, including the curved shoulders into the jaw. Smooth the
# interpolated points; keeping two pixels below the line preserves its dark ink.
xs=np.arange(face.shape[1]); points_x=[0,350,400,450,490,530,570,600,625,650,680,720,760,800,850,900,1253]
points_y=[920,920,933,965,991,1012,1032,1048,1056,1051,1038,1017,990,963,930,920,920]
cut=np.interp(xs,points_x,points_y).astype(np.float32); cut=cv2.GaussianBlur(cut.reshape(1,-1),(31,1),0).ravel()
yy=np.arange(face.shape[0])[:,None]; coverage=np.clip(cut[None,:]+2-yy,0,1)
face[:,:,3]=(face[:,:,3]*coverage).astype(np.uint8)
rect=(445,85,253,321)
face_render=warp(face,rect,.3205,372.1,67.0)
# The forehead is covered by hair; do not expose the kit scalp above the hair.
save('face',face_render[242:,:,:],(445,206,253,200))
eye=keyed('kit-eyes-1.png'); scale=.1535; tx=452.6; ty=254.5
for side,sl in [('right',(0,768)),('left',(768,1536))]:
 for row,kind in [(0,'open'),(1,'mid'),(2,'closed')]:
  part=eye[row*341:(row+1)*341,sl[0]:sl[1]].copy()
  rect=(486,265,75,50) if side=='right' else (585,265,75,50)
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
 # Keep the upper line and corners fixed; stretch only below their curved line.
 if row:
  h,w=part.shape[:2]; xx=np.arange(w); line=210-50*((xx-768)/270)**2
  line=np.clip(line,158,210); yy=np.arange(h)[:,None].astype(np.float32)
  factor=1.45 if row==1 else 1.8
  mapy=np.where(yy>line[None,:],line[None,:]+(yy-line[None,:])/factor,yy).astype(np.float32)
  mapx=np.broadcast_to(xx.astype(np.float32),(h,w)).copy()
  part=cv2.remap(part,mapx,mapy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 save(id,warp(part,rect,.074,516.8,338.5),rect)
d['name']='kohako-full-v11b'; (root/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
