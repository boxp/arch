# BOXP-441 TD-08 kohako-v5: v3 layout + 三つ編み下の衣装局所補完
# 1) align.py: Codex 組込み image_gen 生成の衣装局所補完 (codex-outfit-local-v5-1.png) を正本胸像 crop に ECC affine で位置合わせ
import cv2, numpy as np, json, sys
from PIL import Image
p='/tmp/boxp441/'
box=(175,335,600,575); W,H=box[2]-box[0],box[3]-box[1]
bust=np.array(Image.open(p+'kohako/bust-smile.png').convert('RGB'))[box[1]:box[3],box[0]:box[2]]
defect=np.array(Image.open(p+'v5/ref/outfit-defect.png').convert('RGB').resize((W,H),Image.Resampling.NEAREST))
hole=((defect[:,:,0]>230)&(defect[:,:,1]<40)&(defect[:,:,2]>230))
res={}
for k in (1,2):
  g=np.array(Image.open(p+f'v5/gen/codex-outfit-local-v5-{k}.png').convert('RGB').resize((W,H),Image.Resampling.LANCZOS))
  valid=(~cv2.dilate(hole.astype('uint8'),np.ones((15,15),np.uint8)).astype(bool)).astype('uint8')
  a=cv2.cvtColor(bust,cv2.COLOR_RGB2GRAY).astype('float32')/255; b=cv2.cvtColor(g,cv2.COLOR_RGB2GRAY).astype('float32')/255
  warp=np.eye(2,3,dtype='float32')
  try:
    cc,warp=cv2.findTransformECC(a,b,warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,300,1e-6),valid,5)
  except cv2.error as e: cc=None; print('ecc fail',k,e)
  gw=cv2.warpAffine(g,warp,(W,H),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
  ring=(cv2.dilate(hole.astype('uint8'),np.ones((25,25),np.uint8)).astype(bool))&~cv2.dilate(hole.astype('uint8'),np.ones((5,5),np.uint8)).astype(bool)
  before=float(np.abs(g.astype(int)-bust.astype(int))[valid.astype(bool)].mean()); after=float(np.abs(gw.astype(int)-bust.astype(int))[valid.astype(bool)].mean())
  ringd=float(np.abs(gw.astype(int)-bust.astype(int))[ring].mean())
  res[k]={'ecc':cc,'warp':warp.tolist(),'mae_before':before,'mae_after':after,'ring_mae':ringd}
  Image.fromarray(gw).save(p+f'v5b/outfit-aligned-{k}.png')
  # preview: original with hole filled by aligned gen
  prev=bust.copy(); prev[hole]=gw[hole]; Image.fromarray(np.hstack([bust,prev,gw])).resize((W*3*2,H*2)).save(p+f'v5b/fill-preview-{k}.png')
np.save(p+'v5b/hole.npy',hole)
print(json.dumps(res,indent=1))

# 2) create.py: v3 body の三つ編み不透明域(>=250)の内側だけを差し替え
import json, shutil, cv2, numpy as np
from pathlib import Path
from PIL import Image
p=Path('/tmp/boxp441'); dst=p/'v5b'; (dst/'out').mkdir(parents=True,exist_ok=True)
shutil.copytree(p/'v3/layout',dst/'layout',dirs_exist_ok=True)
m=json.loads((dst/'layout/layout.json').read_text()); m['name']='kohako-v5'; (dst/'layout/layout.json').write_text(json.dumps(m,ensure_ascii=False,indent=2))
it=next(x for x in m['layers'] if x['id']=='body'); r=it['rect']; body=np.array(Image.open(dst/'layout/body.png').convert('RGBA'))
canvas=np.zeros((650,680,4),np.uint8); x,y=r['left'],r['top']; canvas[y:y+body.shape[0],x:x+body.shape[1]]=body
box=(175,335,600,575)
g=np.array(Image.open(dst/'outfit-aligned-1.png').convert('RGB')); hole=np.load(dst/'hole.npy')
full=np.zeros((650,680),bool); full[box[1]:box[3],box[0]:box[2]]=hole
gf=np.zeros((650,680,3),np.uint8); gf[box[1]:box[3],box[0]:box[2]]=g
# feather 2px inward only (hole is already 9px-dilated braid alpha), restrict to opaque body
ba=np.zeros((650,680),np.uint8)
for it2 in m['layers']:
 if it2['id'] in ('hair_side_left','hair_side_right'):
  a=np.array(Image.open(dst/'layout'/it2['image']['path']).convert('RGBA'))[:,:,3]; rr=it2['rect']; sl=ba[rr['top']:rr['top']+a.shape[0],rr['left']:rr['left']+a.shape[1]]; np.maximum(sl,a,out=sl)
cov=full&(ba>=250)
w=cv2.GaussianBlur(cov.astype('float32'),(0,0),2)*cov*(canvas[:,:,3]>0)
canvas[:,:,:3]=np.clip(canvas[:,:,:3]*(1-w[:,:,None])+gf*w[:,:,None],0,255).astype('uint8')
Image.fromarray(canvas[y:y+body.shape[0],x:x+body.shape[1]]).save(dst/'layout/body.png')
ref=np.array(Image.open(p/'kohako/layout2/reference.png').convert('RGBA')); comp=Image.new('RGBA',(680,650))
for it in m['layers']:
 if it['id'] in {'eye_closed_right','eye_closed_left','mouth_closed'}: continue
 comp.alpha_composite(Image.open(dst/'layout'/it['image']['path']).convert('RGBA'),(it['rect']['left'],it['rect']['top']))
comp.save(dst/'out/composite-default.png'); res=np.array(comp); valid=ref[:,:,3]==255; valid[195:247,320:500]=False; valid[285:307,380:435]=False
d=np.abs(res[:,:,:3].astype(int)-ref[:,:,:3].astype(int))
diff={'pixels':int(valid.sum()),'mean_rgb':float(d[valid].mean()),'max_rgb':int(d[valid].max()),'pct_pixel_max_gt_16':float((d.max(2)[valid]>16).mean()*100),'changed_body_pixels':int((w>0).sum())}
(dst/'out/composite-diff.json').write_text(json.dumps(diff,indent=2)); print(diff)
Image.fromarray(canvas).crop((240,340,550,555)).resize((930,645)).save(dst/'out/body-candidate.png')
