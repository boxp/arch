"""Move selected outer hair from body to existing angle/HairBack mesh.
Coordinates are bust pixels. Output mask exposes the limitations of selection.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw
p=Path('/tmp/boxp441'); layout=p/'v6/layout'; path=layout/'layout.json'
m=json.loads(path.read_text()); items={i['id']:i for i in m['layers']}
def canvas(name):
 i=items[name]; r=i['rect']; im=np.asarray(Image.open(layout/i['image']['path']).convert('RGBA')); a=np.zeros((650,680,4),np.uint8); a[r['top']:r['top']+im.shape[0],r['left']:r['left']+im.shape[1]]=im; return a
body=canvas('body'); back=canvas('hair_back'); ref=np.asarray(Image.open(p/'kohako/layout2/reference.png').convert('RGBA'))
region=Image.new('L',(680,650)); d=ImageDraw.Draw(region)
# Outer silhouette down to shoulders, leaving braid, skin, clothing and hand intact.
d.polygon([(250,120),(295,120),(312,190),(292,230),(255,230),(245,185)],fill=255)
d.polygon([(490,85),(535,85),(551,125),(557,186),(550,232),(510,232),(500,178)],fill=255)
d.polygon([(250,215),(292,215),(295,285),(302,336),(291,370),(269,388),(232,397),(211,426),(181,452),(160,483),(155,470),(190,407),(215,348),(237,275)],fill=255)
d.polygon([(510,215),(550,215),(554,270),(565,320),(582,369),(597,398),(584,403),(565,389),(545,375),(521,367),(510,342)],fill=255)
d.polygon([(580,372),(598,390),(620,425),(644,474),(660,523),(663,580),(653,582),(639,537),(621,487),(602,444),(589,409)],fill=255)
inside=np.asarray(region)>0
# Dark pixels, including anti-aliased edge but excluding white background.
dark=(ref[:,:,:3].max(axis=2)<210)&(ref[:,:,3]>0)
mask=inside & dark & (body[:,:,3]>0)
yy,xx=np.indices(mask.shape)
# Keep the hand and glove intact where the outer strand passes behind them.
mask &= ~((yy>=365) & (xx<180))
# Use original reference RGB, avoiding the pale partial body reconstruction.
ys,xs=np.nonzero(mask)
back[ys,xs,:3]=ref[ys,xs,:3]
back[ys,xs,3]=np.maximum(back[ys,xs,3],ref[ys,xs,3])
# Create a body-following underlay only near the inside shoulders. Nothing is
# painted beyond the figure's alpha silhouette. Hair stays above this layer.
fillmask=(mask.astype('uint8')*255)
inpaint=cv2.inpaint(body[:,:,:3],fillmask,9,cv2.INPAINT_TELEA)
yy,xx=np.indices(mask.shape)
under=mask & (yy>=350) & (yy<420) & (((xx>=225)&(xx<300)) | ((xx>=540)&(xx<595))) & (ref[:,:,3]>0)
fill=np.zeros_like(body); fill[:,:,:3]=inpaint; fill[:,:,3]=np.where(under,ref[:,:,3],0)
if under.any():
 y,x=np.nonzero(under); x0,x1,y0,y1=int(x.min()),int(x.max()+1),int(y.min()),int(y.max()+1)
 Image.fromarray(fill[y0:y1,x0:x1]).save(layout/'body_under_hair.png')
 m['layers'].insert(0,{'id':'body_under_hair','name':'body under hair','image':{'path':'body_under_hair.png','width':x1-x0,'height':y1-y0},'rect':{'left':x0,'top':y0,'width':x1-x0,'height':y1-y0},'tags':['top']})
body[ys,xs,3]=0
for name,rgba in [('body',body),('hair_back',back)]:
 ys,xs=np.nonzero(rgba[:,:,3]); x0,x1,y0,y1=int(xs.min()),int(xs.max()+1),int(ys.min()),int(ys.max()+1); item=items[name]
 Image.fromarray(rgba[y0:y1,x0:x1]).save(layout/item['image']['path']); item['rect']={'left':x0,'top':y0,'width':x1-x0,'height':y1-y0}; item['image'].update(width=x1-x0,height=y1-y0)
overlay=ref.copy(); overlay[mask,:3]=(overlay[mask,:3].astype(float)*.3+np.array([255,0,255])*.7).astype('uint8'); Image.fromarray(overlay).save(p/'v6/out/v15b-mask.png')
m['name']='kohako-v15b'; path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n'); print('Transferred pixels:',int(mask.sum()),flush=True)
