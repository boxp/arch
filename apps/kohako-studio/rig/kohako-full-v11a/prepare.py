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
 rgb=a.copy(); rgb[:,:,1]=np.minimum(rgb[:,:,1],np.maximum(rgb[:,:,0],rgb[:,:,2])+12)
 return np.dstack((rgb,alpha*255)).astype(np.uint8)
def save(id, arr, rect, density=2):
 l=layers[id]; x,y,w,h=rect
 l['rect']=dict(left=x,top=y,width=w,height=h); l['image'].update(width=w*density,height=h*density)
 Image.fromarray(arr).save(root/l['image']['path'])
def warp(src,rect,scale,tx,ty,density=2):
 x,y,w,h=rect; mat=np.array([[scale*density,0,(tx-x)*density],[0,scale*density,(ty-y)*density]],dtype=np.float32)
 return cv2.warpAffine(src,mat,(w*density,h*density),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT)
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
# Discard neck below the original drawn chin outline, not a rectangular crop.
xs=np.arange(face.shape[1]); cut=np.interp(xs,[0,480,630,765,1253],[970,985,1056,985,970]); yy=np.arange(face.shape[0])[:,None]
face[:,:,3][yy>cut[None,:]+2]=0
face_render=warp(face,(445,85,253,321),.3205,372.1,67.0)
# Retain the established face silhouette, avoiding new exposure around the hair.
old_alpha=cv2.resize(np.asarray(Image.open(root/'face.png').convert('RGBA'))[:,:,3],(364,392),interpolation=cv2.INTER_LINEAR)
silhouette=np.zeros(face_render.shape[:2],np.uint8); silhouette[(206-85)*2:(206-85)*2+392,(481-445)*2:(481-445)*2+364]=old_alpha
face_render[:,:,3]=np.minimum(face_render[:,:,3],silhouette)
save('face',face_render[242:634,72:436],(481,206,182,196))
eye=keyed('kit-eyes-1.png'); scale=.1535; tx=452.6; ty=254.5
for side,sl in [('right',(0,768)),('left',(768,1536))]:
 for row,kind in [(0,'open'),(1,'mid'),(2,'closed')]:
  part=eye[row*341:(row+1)*341,sl[0]:sl[1]].copy()
  rect=(486,265,75,50) if side=='right' else (585,265,75,50)
  rendered=warp(part,rect,scale,tx+sl[0]*scale,ty)
  if kind=='open':
   rgb=rendered[:,:,:3].astype(int); a=rendered[:,:,3].copy(); r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
   white=(r>175)&(g>165)&(b>165)&(np.abs(r-b)<55)
   iris=(b>r*1.08)&(b>g*.95)&(b>55)&~white
   for name,mask in [('white',white),('iris',iris),('lash',~(white|iris))]:
    z=rendered.copy()
    # Iris is clipped by the eye-white mesh in the rig: its backing must cover the iris too.
    if name=='white':
     mask=white|iris; z[:,:,:3][iris]=[245,244,250]
    z[:,:,3]=np.where(mask,a,0); save('eye_'+side+'_'+name,z,rect)
  else: save(('eye_mid_'+side+'_v44') if kind=='mid' else ('eye_closed_'+side),rendered,rect)
mouth=keyed('kit-mouth-1.png'); base=layers['face_smile'].copy(); base['id']=base['name']='mouth_mid'; base['image']=dict(base['image'],path='mouth_mid.png'); d['layers'].insert(d['layers'].index(layers['face_smile'])+1,base); layers['mouth_mid']=base
for row,id in enumerate(['face_smile','mouth_mid','mouth_open']):
 part=mouth[row*315:row*315+341]; rect=(548,345,49,22)
 save(id,warp(part,rect,.074,516.8,338.5),rect)
d['name']='kohako-full-v11a'; (root/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
