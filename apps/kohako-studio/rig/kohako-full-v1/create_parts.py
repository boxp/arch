import os, json, hashlib
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw
src=Path(os.environ['SOURCE']); out=Path(os.environ['OUT']); out.mkdir(parents=True,exist_ok=True)
assert hashlib.sha256(src.read_bytes()).hexdigest()=='4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84'
im=Image.open(src).convert('RGB').resize((1143,2048),Image.Resampling.LANCZOS); rgb=np.array(im); h,w=rgb.shape[:2]
# Connected near-white background only, including the floor reflection below the shoes.
near=(rgb.min(axis=2)>238).astype('uint8'); n,lab,stats,_=cv2.connectedComponentsWithStats(near,8); ids=np.unique(np.concatenate([lab[0,:],lab[-1,:],lab[:,0],lab[:,-1]])); bg=np.isin(lab,ids)&(near>0); bg[2004:,:]=True
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
layers=[]; counts={}
for i,(name,tags,_) in enumerate(regions):
 mask=owner==i; ys,xs=np.where(mask)
 if not len(xs): continue
 x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
 part=rgba[y0:y1,x0:x1].copy(); part[:,:,3]=np.where(mask[y0:y1,x0:x1],part[:,:,3],0)
 Image.fromarray(part).save(out/(name+'.png')); counts[name]=int(mask.sum())
 layers.append({'id':name,'name':name,'image':{'path':name+'.png','width':int(x1-x0),'height':int(y1-y0)},'rect':{'left':int(x0),'top':int(y0),'width':int(x1-x0),'height':int(y1-y0)},'tags':tags})
manifest={'format':'psd2live-layout','version':1,'name':'kohako-full-v1','canvas':{'width':w,'height':h},'layers':layers}; (out/'layout.json').write_text(json.dumps(manifest,indent=2)); (out/'counts.json').write_text(json.dumps(counts,indent=2))
# Contact sheet on grey, using unmodified source pixels.
thumbw,thumbh=180,330; sheet=Image.new('RGB',(thumbw*5,thumbh*((len(layers)+4)//5)),(160,160,160)); d=ImageDraw.Draw(sheet)
for i,item in enumerate(layers):
 p=Image.open(out/item['image']['path']).convert('RGBA'); p.thumbnail((thumbw-10,thumbh-35)); x=(i%5)*thumbw+(thumbw-p.width)//2; y=(i//5)*thumbh+25; sheet.paste(p,(x,y),p); d.text(((i%5)*thumbw+4,(i//5)*thumbh+4),item['id'],fill='black')
sheet.save(out/'parts-contact.jpg',quality=85)
