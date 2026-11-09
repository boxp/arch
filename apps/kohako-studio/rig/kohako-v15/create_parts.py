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
d.polygon([(250,215),(292,215),(295,285),(302,336),(291,370),(269,388),(232,397),(211,426),(181,452),(160,483),(155,470),(190,407),(215,348),(237,275)],fill=255)
d.polygon([(510,215),(550,215),(554,270),(565,320),(582,369),(597,398),(584,403),(565,389),(545,375),(521,367),(510,342)],fill=255)
d.polygon([(580,372),(598,390),(620,425),(644,474),(660,523),(663,580),(653,582),(639,537),(621,487),(602,444),(589,409)],fill=255)
inside=np.asarray(region)>0
# Dark pixels, including anti-aliased edge but excluding white background.
dark=(ref[:,:,:3].max(axis=2)<165)&(ref[:,:,3]>0)
mask=inside & dark & (body[:,:,3]>0)
yy,xx=np.indices(mask.shape)
# Keep the hand and glove intact where the outer strand passes behind them.
mask &= ~((yy>=365) & (xx<180))
ys,xs=np.nonzero(mask); ba=body[ys,xs,3].astype('float32')/255; ha=back[ys,xs,3].astype('float32')/255
alpha=ba+ha*(1-ba)
back[ys,xs,:3]=np.rint((body[ys,xs,:3]*ba[:,None]+back[ys,xs,:3]*(ha*(1-ba))[:,None])/np.maximum(alpha[:,None],1e-8)).clip(0,255).astype('uint8')
back[ys,xs,3]=np.rint(alpha*255).astype('uint8'); body[ys,xs,3]=0
for name,rgba in [('body',body),('hair_back',back)]:
 ys,xs=np.nonzero(rgba[:,:,3]); x0,x1,y0,y1=int(xs.min()),int(xs.max()+1),int(ys.min()),int(ys.max()+1); item=items[name]
 Image.fromarray(rgba[y0:y1,x0:x1]).save(layout/item['image']['path']); item['rect']={'left':x0,'top':y0,'width':x1-x0,'height':y1-y0}; item['image'].update(width=x1-x0,height=y1-y0)
overlay=ref.copy(); overlay[mask,:3]=(overlay[mask,:3].astype(float)*.3+np.array([255,0,255])*.7).astype('uint8'); Image.fromarray(overlay).save(p/'v6/out/v15-mask.png')
m['name']='kohako-v15'; path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n'); print('Transferred pixels:',int(mask.sum()),flush=True)
