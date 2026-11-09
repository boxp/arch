import os, json, hashlib
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw
src=Path(os.environ['SOURCE']); out=Path(os.environ['OUT']); out.mkdir(parents=True,exist_ok=True)
assert hashlib.sha256(src.read_bytes()).hexdigest()=='4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84'
original=np.array(Image.open(src).convert('RGB')); im=Image.fromarray(original).resize((1143,2048),Image.Resampling.LANCZOS); rgb=np.array(im); h,w=rgb.shape[:2]
# Connected near-white background only, including the floor reflection below the shoes.
near=(rgb.min(axis=2)>238).astype('uint8'); n,lab,stats,_=cv2.connectedComponentsWithStats(near,8); ids=np.unique(np.concatenate([lab[0,:],lab[-1,:],lab[:,0],lab[:,-1]])); bg=np.isin(lab,ids)&(near>0); # Treat pale enclosed gaps outside the central costume as background, preserving
# white collar, eye whites and narrow highlights within the figure.
Y,X=np.indices((h,w)); pale=(rgb.min(axis=2)>220)&((rgb.max(axis=2)-rgb.min(axis=2))<24)
gaps=((Y>320)&(Y<1050)&((X<400)|(X>745))) | ((Y>1780)&((X<430)|(X>715)))
n2,l2,st2,_=cv2.connectedComponentsWithStats((pale & gaps).astype('uint8'),8)
for j in range(1,n2):
 if st2[j,cv2.CC_STAT_AREA]>=35: bg[l2==j]=True
# Remove small pale background fragments only in the outer hair region.
small_region = (Y > 340) & (Y < 950) & ((X < 385) | (X > 758))
n3,l3,st3,_=cv2.connectedComponentsWithStats((pale & small_region).astype('uint8'),8)
for j in range(1,n3):
 if st3[j,cv2.CC_STAT_AREA] <= 150: bg[l3==j]=True
# Restrict floor removal to the region below the actual boot silhouette.
# The boots have a dark outline; remove only lighter floor below the final
# outline in each shoe column. Preserve the bottom outline itself.
for x in range(w):
 dark_y=np.where((rgb[1850:,x].min(axis=1)<135))[0]
 if len(dark_y):
  bottom=1850+int(dark_y[-1]); bg[bottom+2:,x]=True
 else: bg[1850:,x]=True
alpha=(~bg).astype('uint8')*255; rgba=np.dstack((rgb,alpha)); Image.fromarray(rgba).save(out/'source.png')
# Mutually exclusive regions; later entries take precedence. Coordinates are on 1143x2048.
def poly(points):
 m=np.zeros((h,w),np.uint8); cv2.fillPoly(m,[np.array(points,np.int32)],1); return m.astype(bool)
regions=[
 ('back_hair',['hair','back'],[(180,80),(960,80),(970,1000),(180,1000)]),
 ('leg_right',['leg','right'],[(407,930),(570,930),(570,1790),(410,1790)]),('leg_left',['leg','left'],[(570,930),(737,930),(725,1790),(570,1790)]),
 ('foot_right',['foot','right'],[(420,1760),(570,1760),(570,2020),(420,2020)]),('foot_left',['foot','left'],[(570,1760),(730,1760),(730,2020),(570,2020)]),
 ('body',['top'],[(406,405),(738,405),(725,1000),(405,1000)]),
 ('panel_right',['bottom','right'],[(405,780),(505,800),(445,1260),(265,1260)]),('panel_left',['bottom','left'],[(640,800),(740,780),(880,1260),(700,1260)]),
 ('arm_right',['arm','right'],[(380,450),(460,440),(460,760),(315,950),(240,940),(270,700)]),('arm_left',['arm','left'],[(682,440),(765,450),(870,700),(905,940),(830,950),(682,760)]),
 ('hand_right',['arm','right'],[(265,900),(325,900),(310,1035),(175,1080),(175,1000)]),('hand_left',['arm','left'],[(820,900),(880,900),(970,1000),(970,1080),(835,1035)]),
 ('neck',['neck'],[(525,365),(615,365),(635,455),(505,455)]),
 ('face',['face'],[(477,195),(665,195),(678,347),(620,398),(565,410),(506,380),(470,330)]),
 ('eye_right',['eye','right'],[(489,261),(555,261),(555,308),(489,308)]),('eye_left',['eye','left'],[(584,261),(657,261),(657,308),(584,308)]),
 ('mouth',['mouth'],[(548,345),(600,345),(600,365),(548,365)]),
 ('braid_right',['hair','side','right'],[(449,300),(508,300),(512,595),(445,595)]),('braid_left',['hair','side','left'],[(631,300),(700,300),(700,595),(631,595)]),
 ('front_hair',['hair','front'],[(415,80),(720,80),(726,245),(666,320),(645,245),(610,205),(535,210),(486,250),(470,317),(419,300)])]
# Start with body, assign explicit shape masks; avoid categorising white empty pixels.
owner=np.full((h,w),-1,np.int16)
for i,(name,_,p) in enumerate(regions):
 if name in ('eye_right','eye_left','mouth'): continue
 region=poly(p)&(alpha>0)
 if name.startswith('braid_'):
  hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV); H,S,V=cv2.split(hsv)
  region &= ~(((H>=133)&(S>=78)&(V>=105)) | ((H<25)&(S>45)&(V>85)) | ((S<35)&(V>185)))
 owner[region]=i
# Transfer dark, low-saturation hair along the outside of the sleeves to back hair.
hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV); H,S,V=cv2.split(hsv); yy,xx=np.indices((h,w))
outer=(((xx < (380-(yy-450)*0.20)) | (xx > (763+(yy-450)*0.20))) & (yy>450)&(yy<940))
hair=((V<105)|((H>=110)&(H<=132)&(S<90)&(V<225))) & ~((H>=133)&(S>=78)&(V>=105)) & ~((H<25)&(S>45)&(V>85))
owner[outer & hair & (alpha>0)]=0
# Any residual foreground is retained in a back layer.
owner[(owner<0)&(alpha>0)]=0
# Move colour-classified hair out of arm/body polygons in the side silhouette.
side=((xx<410)|(xx>733)) & (yy>440)&(yy<950)
owner[side & hair & (alpha>0)]=0
# Feature masks are constructed at source resolution, then area-resampled without thresholding.
face_index=next(i for i,r in enumerate(regions) if r[0]=='face')
extras=[]; feature=np.zeros((h,w),np.uint8)
H0,W0=original.shape[:2]; sx=W0/w; sy=H0/h
Y0,X0=np.indices((H0,W0))
def ellipse_full(cx,cy,rx,ry):
 m=np.zeros((H0,W0),np.uint8); cv2.ellipse(m,(round(cx*sx),round(cy*sy)),(round(rx*sx),round(ry*sy)),0,0,360,255,-1); return m
def down(mask): return cv2.resize(mask,(w,h),interpolation=cv2.INTER_AREA)
def feather(mask): return cv2.GaussianBlur(mask,(0,0),2.0)
for side_name,cx in [('right',522),('left',620)]:
 full=ellipse_full(cx,286,34,22); owner[down(full)>0]=face_index
 # Dilate beyond dark lash pixels before inpainting so the fill cannot sample them.
 feature=cv2.bitwise_or(feature,cv2.dilate(down(full),np.ones((21,21),np.uint8)))
 # Three complementary regions: the top lash band and the remaining eye split
 # by local chroma/value. All retain their original RGB and soft edge alpha.
 fy=Y0/sy; fx=X0/sx
 lash=(fy < 278).astype('uint8')*255
 val=original.max(axis=2); sat=val-original.min(axis=2)
 iris=((val<180)&(fy>=278)).astype('uint8')*255
 white=cv2.bitwise_not(lash)  # Retain the complete lower eye beneath the fragmented iris mesh.
 for part,selector in [('white',white),('iris',iris),('lash',lash)]:
  alpha0=cv2.bitwise_and(feather(full),selector)
  extras.append(('eye_'+side_name+'_'+part,['eye',part,side_name],down(alpha0),rgb))
full=ellipse_full(574,354,25,10); owner[down(full)>0]=face_index
feature=cv2.bitwise_or(feature,cv2.dilate(down(full),np.ones((13,13),np.uint8)))
extras.append(('mouth_open',['mouth','open'],down(feather(full)),rgb))
extras.append(('mouth_rest',['face','detail'],down(feather(full)),rgb))
# Replace each eye aperture with nearby skin copied from below and feathered.
face_rgb=cv2.inpaint(rgb,feature,7,cv2.INPAINT_TELEA)
for cx in (522,620):
 patch=cv2.GaussianBlur(ellipse_full(cx,286,36,24),(0,0),5.0); weight=down(patch).astype('float32')/255
 shifted=cv2.GaussianBlur(np.roll(rgb,-50,axis=0),(0,0),5.0)
 face_rgb=np.clip(face_rgb*(1-weight[:,:,None])+shifted*weight[:,:,None],0,255).astype('uint8')
layers=[]; counts={}
for i,(name,tags,_) in enumerate(regions):
 mask=owner==i; fill=None; extended=None
 # v35: close narrow enclosed slits; v38: discard tiny detached components.
 if name in ('back_hair','braid_right','braid_left'):
  solid=mask.astype('uint8'); n, labels, stats, _=cv2.connectedComponentsWithStats(solid,8)
  for component in range(1,n):
   if stats[component,cv2.CC_STAT_AREA]<20: mask[labels==component]=False
  closed=cv2.morphologyEx(mask.astype('uint8'),cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5))).astype(bool)
  interior=closed & ~cv2.dilate((~closed).astype('uint8'),np.ones((3,3),np.uint8)).astype(bool)
  mask |= interior & (alpha>0) & (rgb.max(axis=2)<150)
 # Extend covered edges beneath subsequent foreground parts using nearest local
 # colours; limit extension to foreground pixels so the exterior stays clear.
 if name in ('body','arm_right','arm_left','leg_right','leg_left'):
  expanded=cv2.dilate(mask.astype('uint8'),np.ones((31,31),np.uint8)).astype(bool)
  fill=expanded & (owner>i) & (alpha>0)
  if fill.any():
   missing=(~mask).astype('uint8')*255
   extended=cv2.inpaint(rgb,missing,3,cv2.INPAINT_TELEA)
   mask |= fill
 ys,xs=np.where(mask)
 if not len(xs): continue
 x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
 part=rgba[y0:y1,x0:x1].copy();
 if fill is not None and extended is not None:
  local=fill[y0:y1,x0:x1]; part[:,:,:3][local]=extended[y0:y1,x0:x1][local]
 if name=='face': part[:,:,:3]=face_rgb[y0:y1,x0:x1]
 part[:,:,3]=np.where(mask[y0:y1,x0:x1],part[:,:,3],0)
 Image.fromarray(part).save(out/(name+'.png')); counts[name]=int(mask.sum())
 layers.append({'id':name,'name':name,'image':{'path':name+'.png','width':int(x1-x0),'height':int(y1-y0)},'rect':{'left':int(x0),'top':int(y0),'width':int(x1-x0),'height':int(y1-y0)},'tags':tags})
for name,tags,mask,colors in extras:
 ys,xs=np.where(mask>0)
 if not len(xs): continue
 x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
 part=np.dstack((colors[y0:y1,x0:x1],mask[y0:y1,x0:x1].astype('uint8')))
 Image.fromarray(part).save(out/(name+'.png')); counts[name]=int((mask>0).sum())
 layers.append({'id':name,'name':name,'image':{'path':name+'.png','width':int(x1-x0),'height':int(y1-y0)},'rect':{'left':int(x0),'top':int(y0),'width':int(x1-x0),'height':int(y1-y0)},'tags':tags})
manifest={'format' :'psd2live-layout','version':1,'name':'kohako-full-v8','canvas':{'width':w,'height':h},'layers':layers}; (out/'layout.json').write_text(json.dumps(manifest,indent=2)); (out/'counts.json').write_text(json.dumps(counts,indent=2))
# Contact sheet on grey, using unmodified source pixels.
thumbw,thumbh=180,330; sheet=Image.new('RGB',(thumbw*5,thumbh*((len(layers)+4)//5)),(160,160,160)); d=ImageDraw.Draw(sheet)
for i,item in enumerate(layers):
 p=Image.open(out/item['image']['path']).convert('RGBA'); p.thumbnail((thumbw-10,thumbh-35)); x=(i%5)*thumbw+(thumbw-p.width)//2; y=(i//5)*thumbh+25; sheet.paste(p,(x,y),p); d.text(((i%5)*thumbw+4,(i//5)*thumbh+4),item['id'],fill='black')
sheet.save(out/'parts-contact.jpg',quality=85)
