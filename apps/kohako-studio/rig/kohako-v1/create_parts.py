import cv2, numpy as np, json, shutil
from PIL import Image,ImageDraw
from pathlib import Path
p=Path('/tmp/boxp441'); l=p/'v1/layout'; o=p/'v1/out'; l.mkdir(exist_ok=True,parents=True); o.mkdir(exist_ok=True,parents=True)
base=np.array(Image.open(p/'kohako/layout2/body_base.png').convert('RGBA')); ref=np.array(Image.open(p/'kohako/layout2/reference.png').convert('RGBA')); h,w=base.shape[:2]
# Boundaries trace original outer hair contours and braid edges; retain original RGB values.
polys={
'hair_front':[(250,218),(252,183),(250,160),(254,132),(255,111),(251,95),(257,81),(266,80),(272,64),(283,62),(292,49),(304,50),(314,55),(335,35),(364,23),(390,19),(416,23),(443,19),(470,24),(495,37),(518,58),(536,90),(547,120),(551,157),(553,193),(548,225),(536,243),(518,240),(503,228),(496,206),(488,193),(482,176),(474,148),(468,135),(459,157),(450,179),(437,193),(418,202),(400,204),(390,195),(386,170),(382,145),(370,161),(355,174),(338,184),(326,200),(316,222),(317,246),(323,263),(336,275),(322,268),(310,253),(300,233),(298,211),(302,188),(300,159),(298,147),(294,180),(287,207),(278,224),(265,230)],
'hair_side_right':[(300,207),(305,230),(315,257),(326,273),(340,284),(347,310),(347,329),(342,343),(345,358),(338,376),(337,395),(329,414),(331,432),(327,449),(333,473),(334,492),(326,521),(316,538),(300,534),(290,524),(284,510),(285,491),(290,471),(300,450),(306,434),(306,417),(304,397),(304,378),(302,357),(305,338),(300,318),(300,296),(294,271),(293,249),(296,226)],
'hair_side_left':[(521,211),(536,221),(543,242),(541,262),(531,287),(518,307),(509,322),(506,342),(503,356),(502,379),(499,397),(499,417),(500,433),(504,451),(512,471),(517,492),(515,514),(508,529),(493,540),(490,524),(486,510),(479,494),(472,475),(475,453),(478,435),(474,420),(471,401),(472,381),(469,363),(472,346),(472,329),(477,309),(487,290),(499,274),(510,258),(517,240)]}
masks={}
for name,pts in polys.items():
 m=Image.new('L',(w*4,h*4)); ImageDraw.Draw(m).polygon([(x*4,y*4) for x,y in pts],fill=255); masks[name]=np.array(m.resize((w,h),Image.Resampling.LANCZOS))
# Front is drawn above side; prevent duplicate interior texture on the side layers.
for k in ('hair_side_right','hair_side_left'): masks[k]=np.minimum(masks[k],255-masks['hair_front'])
union=np.maximum.reduce(list(masks.values())); cut=(union>32).astype('uint8')*255
# Inpaint the underpainting, while preserving v0 alpha silhouette.
filled=cv2.inpaint(base[:,:,:3],cv2.dilate(cut,np.ones((3,3),np.uint8)),9,cv2.INPAINT_TELEA)
# Hidden forehead skin: generated aligned head, confined strictly to the mask and safe forehead zone.
g='/tmp/boxp441/gen/'
head=Image.open(g+'codex-head-base-v1.png').convert('RGBA'); head=head.resize((int(head.width*.58),int(head.height*.58)),Image.Resampling.LANCZOS); hc=Image.new('RGBA',(w,h)); hc.paste(head,(-35,1)); ha=np.array(hc); yy,xx=np.indices((h,w)); use=(cut>0)&(xx>342)&(xx<485)&(yy>125)&(yy<190)&(ha[:,:,3]>240); filled[use]=ha[:,:,:3][use]
# Replace inpaint's white crown with dark source hair and use nearby suit pixels beneath the hanging braids.
bg_source=Image.open(g+'codex-hair_back-v1.png').convert('RGBA').resize((420,600),Image.Resampling.LANCZOS)
bgc=Image.new('RGBA',(w,h)); bgc.paste(bg_source,(205,20)); bgarr=np.array(bgc)
top=(cut>0)&(yy<130)&(bgarr[:,:,3]>200); filled[top]=bgarr[:,:,:3][top]
for x1,x2,offset in [(280,350,55),(465,525,-55)]:
 zone=(cut>0)&(yy>=365)&(yy<545)&(xx>=x1)&(xx<x2)
 ys,xs=np.where(zone); filled[ys,xs]=base[ys,np.clip(xs+offset,0,w-1),:3]
body=base.copy(); body[:,:,:3][cut>0]=filled[cut>0]; Image.fromarray(body).save(l/'body.png')
# Generated back-hair clipped to the original opaque silhouette, and wholly under the body.
bg=Image.open(g+'codex-hair_back-v1.png').convert('RGBA'); bg=bg.resize((420,600),Image.Resampling.LANCZOS); c=Image.new('RGBA',(w,h)); c.paste(bg,(205,20)); back=np.array(c); back[:,:,3]=np.minimum(back[:,:,3],ref[:,:,3]); Image.fromarray(back).save(l/'hair_back.png')
layers=[]
def add(id,tags,rgba):
 a=rgba[:,:,3]; ys,xs=np.where(a>0); x,y,x2,y2=int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1); Image.fromarray(rgba[y:y2,x:x2]).save(l/(id+'.png')); layers.append({'id':id,'name':id.replace('_',' '),'image':{'path':id+'.png','width':x2-x,'height':y2-y},'rect':{'left':x,'top':y,'width':x2-x,'height':y2-y},'tags':tags})
add('hair_back',['hair','back'],back); add('body',['top'],body)
old=json.loads((p/'kohako/layout2/layout.json').read_text())
for item in old['layers'][1:]:
 shutil.copy2(p/'kohako/layout2'/item['image']['path'],l/item['image']['path']); layers.append(item)
for name in ('hair_side_right','hair_side_left','hair_front'):
 alpha=np.minimum(masks[name],ref[:,:,3]); rgba=np.dstack((ref[:,:,:3],alpha)); add(name,['hair','front']+(['side',name.split('_')[-1]] if name!='hair_front' else []),rgba)
manifest={'format':'psd2live-layout','version':1,'name':'kohako-v1','canvas':{'width':w,'height':h},'layers':layers}; (l/'layout.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
canvas=Image.new('RGBA',(w,h)); skip={'eye_closed_right','eye_closed_left','mouth_closed'}
for it in layers:
 if it['id'] in skip: continue
 canvas.alpha_composite(Image.open(l/it['image']['path']).convert('RGBA'),(it['rect']['left'],it['rect']['top']))
canvas.save(o/'composite-default.png'); result=np.array(canvas); valid=(ref[:,:,3]==255); valid[195:247,320:500]=False; valid[285:307,380:435]=False
D=np.abs(result[:,:,:3].astype(int)-ref[:,:,:3].astype(int)); diff={'pixels':int(valid.sum()),'mean_rgb':float(D[valid].mean()),'max_rgb':int(D[valid].max()),'pct_pixel_max_gt_16':float((D.max(2)[valid]>16).mean()*100),'pct_pixel_max_gt_32':float((D.max(2)[valid]>32).mean()*100)}; (o/'composite-diff.json').write_text(json.dumps(diff,indent=2)); print(diff)
thumbs=Image.new('RGB',(4*250,((len(layers)+3)//4)*260),'white'); draw=ImageDraw.Draw(thumbs)
for i,it in enumerate(layers):
 im=Image.open(l/it['image']['path']).convert('RGBA'); im.thumbnail((240,220)); x=(i%4)*250; y=(i//4)*260; thumbs.paste(im,(x,y+25),im); draw.text((x+2,y+3),it['id'],fill='black')
thumbs.save(o/'layers-contact.png')
