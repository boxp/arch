import cv2, numpy as np, json
from PIL import Image, ImageDraw
from pathlib import Path
p=Path('/tmp/boxp441/kohako'); lay=p/'layout2'; out=p/'out2'; lay.mkdir(exist_ok=True); out.mkdir(exist_ok=True)
im=np.array(Image.open(p/'source.png').convert('RGB'))[60:710,300:980].copy(); h,w=im.shape[:2]
# Only near-neutral light pixels connected to the outside are background.
hi=im.max(2); lo=im.min(2); bg=((lo>=235)&((hi-lo)<=16)).astype(np.uint8)
n,labels=cv2.connectedComponents(bg,8); border=np.unique(np.concatenate([labels[0],labels[-1],labels[:,0],labels[:,-1]])); outside=np.isin(labels,border[border!=0]);
# Feather only pixels immediately next to the connected background.
alpha=np.full((h,w),255,np.uint8); alpha[outside]=0
near=cv2.dilate(outside.astype('uint8'),np.ones((3,3),np.uint8))>0
edge=near & ~outside & (lo>210) & ((hi-lo)<35)
alpha[edge]=np.clip((255-lo[edge])*255/35,0,255).astype('uint8')
rgba=np.dstack([im,alpha]); Image.fromarray(rgba).save(lay/'reference.png')
# Coordinates refer to the original source; keep full original pixels inside each mask.
polys={'eye_right':[(625,274),(634,264),(648,258),(664,257),(681,262),(691,273),(687,287),(680,296),(646,296),(634,290)],'eye_left':[(730,282),(740,271),(754,266),(770,267),(785,273),(795,284),(790,297),(782,305),(749,303),(738,296)],'mouth_open':[(682,349),(690,346),(706,347),(718,349),(730,351),(725,358),(718,364),(705,365),(694,361),(687,356)]}
masks={}
for name,pts in polys.items():
 mask=np.zeros((h,w),np.uint8); cv2.fillPoly(mask,[np.array([(x-300,y-60) for x,y in pts],np.int32)],255); masks[name]=mask
# Inpainting extends slightly outside feature masks, then replace with identical feature pixels at open state.
allmask=np.maximum.reduce(list(masks.values())); expanded=cv2.dilate(allmask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)))
base=cv2.inpaint(im,expanded,5,cv2.INPAINT_TELEA)
# Eye sockets sit against dark hair; standard inpaint drags that edge into skin.
# Derive skin colors from the original immediately below each socket, then blur.
for name, sample_y in [('eye_right',300),('eye_left',309)]:
 mask=cv2.dilate(masks[name],cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)))>0
 ys,xs=np.where(mask); x1,x2=xs.min(),xs.max()+1
 strip=im[sample_y-60:sample_y-60+8,x1:x2].astype(np.float32).mean(axis=0)
 strip=cv2.GaussianBlur(strip.reshape(1,-1,3),(0,0),5).reshape(-1,3)
 for y in range(ys.min(),ys.max()+1):
  row=mask[y,x1:x2]; base[y,x1:x2][row]=strip[row].astype('uint8')
Image.fromarray(np.dstack([base,alpha])).save(lay/'body_base.png')
layers=[{'id':'body_base','name':'body base','image':{'path':'body_base.png','width':w,'height':h},'rect':{'left':0,'top':0,'width':w,'height':h},'tags':['body']}]
def part(name,rgba,box,tags):
 x,y,x2,y2=box; arr=rgba[y:y2,x:x2]; Image.fromarray(arr).save(lay/(name+'.png')); layers.append({'id':name,'name':name.replace('_',' '),'image':{'path':name+'.png','width':x2-x,'height':y2-y},'rect':{'left':x,'top':y,'width':x2-x,'height':y2-y},'tags':tags})
for name in polys:
 m=masks[name]; ys,xs=np.where(m); x,y,x2,y2=xs.min(),ys.min(),xs.max()+1,ys.max()+1
 if not name.startswith('eye'):
  part(name,np.dstack([im,m]),(int(x),int(y),int(x2),int(y2)),['mouth','open']); continue
 side='right' if name=='eye_right' else 'left'; inside=m>0
 R,G,B=[im[...,i].astype(int) for i in range(3)]; V=im.max(2).astype(int); lo=im.min(2).astype(int)
 # v2: split the original eye into white / iris / lash by colour (no new drawing except hidden white under the iris).
 blue=inside&(B-R>28)&(B>90)
 n,lab,st,_=cv2.connectedComponentsWithStats(blue.astype('uint8'),8); k=1+int(np.argmax(st[1:,cv2.CC_STAT_AREA]))
 hull=np.zeros((h,w),np.uint8); cv2.fillPoly(hull,[cv2.convexHull(np.argwhere(lab==k)[:,::-1].astype(np.int32))],255); hull=(cv2.dilate(hull,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))>0)&inside
 lash=inside&(V<125)&(B-R<25)&~hull
 lash=lash|(inside&~hull&(V<170)&(B-R<15)&(cv2.dilate(lash.astype('uint8'),np.ones((3,3),np.uint8))>0))
 white=inside&~lash  # everything in the socket that is not lash, so the open composite equals the source
 wcol=np.median(im[inside&~lash&~hull&(lo>200)&(R-B<18)],axis=0).astype('uint8') if (inside&~lash&~hull&(lo>200)&(R-B<18)).any() else np.array([235,235,245],'uint8')
 wimg=im.copy(); wimg[hull]=wcol
 box=(int(x),int(y),int(x2),int(y2))
 part(name+'_white',np.dstack([wimg,(white*255).astype('uint8')]),box,['eye','white',side])
 part(name+'_iris',np.dstack([im,(hull*255).astype('uint8')]),box,['eye','iris',side])
 part(name+'_lash',np.dstack([im,(lash*255).astype('uint8')]),box,['eye','lash',side])
# Supersampled strokes, hand drawn in colors sampled from nearby original linework.
for side, coords in [('right',[(629,275),(644,282),(658,284),(674,281),(688,274)]),('left',[(734,282),(748,289),(763,292),(778,289),(792,282)])]:
 scale=4; drawim=Image.new('RGBA',(w*scale,h*scale)); d=ImageDraw.Draw(drawim); pts=[((x-300)*scale,(y-60)*scale) for x,y in coords]; d.line(pts,fill=(53,39,53,255),width=3*scale,joint='curve'); drawim=drawim.resize((w,h),Image.Resampling.LANCZOS); a=np.array(drawim); ys,xs=np.where(a[:,:,3]>0); part('eye_closed_'+side,a,(int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)),['eye','closed',side])
drawim=Image.new('RGBA',(w*4,h*4)); d=ImageDraw.Draw(drawim); d.line([((x-300)*4,(y-60)*4) for x,y in [(688,351),(699,354),(709,355),(719,354),(728,351)]],fill=(92,44,55,255),width=8,joint='curve'); a=np.array(drawim.resize((w,h),Image.Resampling.LANCZOS)); ys,xs=np.where(a[:,:,3]>0); part('mouth_closed',a,(int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)),['mouth','closed'])
manifest={'format':'psd2live-layout','version':1,'name':'kohako-min-v2','canvas':{'width':w,'height':h},'layers':layers}; (lay/'layout.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
def composite(names,filename):
 result=Image.open(lay/'body_base.png').convert('RGBA')
 for layer in layers[1:]:
  if layer['id'] in names: result.alpha_composite(Image.open(lay/layer['image']['path']).convert('RGBA'),(layer['rect']['left'],layer['rect']['top']))
 result.save(out/filename); return np.array(result)
opened=composite(['eye_right_white','eye_right_iris','eye_right_lash','eye_left_white','eye_left_iris','eye_left_lash','mouth_open'],'composite-open-open.png'); composite(['eye_right_white','eye_right_iris','eye_right_lash','eye_left_white','eye_left_iris','eye_left_lash','mouth_closed'],'composite-open-closed.png'); composite(['eye_closed_right','eye_closed_left','mouth_closed'],'composite-closed-closed.png')
valid=(expanded==0)&(alpha==255); diff=np.abs(opened[:,:,:3].astype(int)-im.astype(int)); stats={'source_crop':[300,60,980,710],'non_feature_opaque_pixels':int(valid.sum()),'non_feature_mae_rgb':float(diff[valid].mean()),'non_feature_max_rgb':int(diff[valid].max()),'open_feature_inpaint_fringe_pixels':int(((expanded>0)&(allmask==0)).sum()),'background_connected_pixels':int(outside.sum())}; (out/'composite-diff.json').write_text(json.dumps(stats,indent=2)); print(json.dumps(stats))
