"""Move additional exposed dark outer-hair pixels from the torso to back hair.

Candidate for comparison only. Restricted polygons avoid the face, flower and
hand; RGB comes from the v14 body. Existing partially transferred pixels are collapsed into the back layer at their current composite colour.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw
p=Path('/tmp/boxp441'); layout=p/'v6/layout'; path=layout/'layout.json'
m=json.loads(path.read_text()); items={i['id']:i for i in m['layers']}
def canvas(name):
 i=items[name]; r=i['rect']; im=np.asarray(Image.open(layout/i['image']['path']).convert('RGBA')); a=np.zeros((650,680,4),dtype=np.uint8); a[r['top']:r['top']+im.shape[0],r['left']:r['left']+im.shape[1]]=im; return a
body=canvas('body'); back=canvas('hair_back'); ref=np.asarray(Image.open(p/'kohako/layout2/reference.png').convert('RGBA'))
region=Image.new('L',(680,650)); d=ImageDraw.Draw(region)
d.polygon([(250,230),(287,230),(298,342),(280,365),(228,385),(198,430),(167,450),(194,387),(224,310)],fill=255)
d.polygon([(518,230),(553,230),(567,315),(585,365),(601,397),(574,388),(550,367),(515,350)],fill=255)
# Narrow strand outside the right shoulder; avoid the garment and its outline.
d.polygon([(584,375),(600,395),(632,455),(658,520),(663,577),(653,580),(642,540),(625,485),(610,445),(593,405)],fill=255)
inside=np.asarray(region)>0; dark=(ref[:,:,:3].max(axis=2)<135)&(ref[:,:,3]>250)
mask=inside & dark & (body[:,:,3]>0)
# Collapse the current body-over-back composite into the back layer. This
# keeps the default composite while eliminating the two competing copies.
ys,xs=np.nonzero(mask)
ba=body[ys,xs,3].astype('float32')/255
ha=back[ys,xs,3].astype('float32')/255
alpha=ba+ha*(1-ba)
colors=(body[ys,xs,:3].astype('float32')*ba[:,None]+back[ys,xs,:3].astype('float32')*(ha*(1-ba))[:,None])/np.maximum(alpha[:,None],1e-8)
back[ys,xs,:3]=np.rint(colors).clip(0,255).astype('uint8')
back[ys,xs,3]=np.rint(alpha*255).clip(0,255).astype('uint8')
body[ys,xs,3]=0
for name,rgba in [('body',body),('hair_back',back)]:
 ys,xs=np.nonzero(rgba[:,:,3]); x0,x1,y0,y1=int(xs.min()),int(xs.max()+1),int(ys.min()),int(ys.max()+1); item=items[name]
 Image.fromarray(rgba[y0:y1,x0:x1]).save(layout/item['image']['path']); item['rect']={'left':x0,'top':y0,'width':x1-x0,'height':y1-y0}; item['image'].update(width=x1-x0,height=y1-y0)
m['name']='kohako-v14b'; path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print('Collapsed body-hair pixels:',int(mask.sum()),flush=True)
