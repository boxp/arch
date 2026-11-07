import json,cv2,numpy as np
from PIL import Image,ImageDraw
from pathlib import Path
p=Path('/home/boxp/b441work/work'); d=p/'v29-v17-layout'; src=np.array(Image.open(p/'bust29.png').convert('RGB')); m=json.loads((d/'layout.json').read_text()); union=np.zeros(src.shape[:2],np.uint8)
for layer in m['layers']:
 if layer['id'] in ('hair_back','hair_side_left','hair_side_right'):
  r=layer['rect']; a=np.array(Image.open(d/layer['image']['path']).convert('RGBA'))[:,:,3]; y,x=r['top'],r['left'];union[y:y+a.shape[0],x:x+a.shape[1]]=np.maximum(union[y:y+a.shape[0],x:x+a.shape[1]],a)
region=Image.new('L',(680,650)); draw=ImageDraw.Draw(region)
draw.polygon([(245,215),(320,230),(354,334),(340,440),(340,550),(275,550),(250,420),(155,525),(148,490),(215,340)],fill=255)
draw.polygon([(480,230),(553,210),(565,330),(635,450),(665,590),(620,580),(580,450),(525,550),(470,550),(470,330)],fill=255)
# Only below the face and inside the known long-hair region, excluding the hair ornament.
roi=np.asarray(region)>0; hsv=cv2.cvtColor(src,cv2.COLOR_RGB2HSV); color=(hsv[:,:,2]<125)&(hsv[:,:,1]<115)&(src[:,:,2]>=src[:,:,0]*0.90)
outer=np.zeros_like(roi); outer[:,140:201]=roi[:,140:201]; outer[:,600:665]=roi[:,600:665]
base=((union>16)|outer)&roi&color
exclude=Image.new('L',(680,650)); e=ImageDraw.Draw(exclude)
e.polygon([(242,407),(276,397),(287,487),(274,478)],fill=255)
e.polygon([(510,390),(564,406),(523,493),(503,491)],fill=255)
e.polygon([(144,476),(166,484),(164,510),(143,515)],fill=255)
base &= np.asarray(exclude)==0
closed=cv2.morphologyEx(base.astype('uint8'),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8)).astype(bool)&roi&color&(np.asarray(exclude)==0)
alpha=cv2.GaussianBlur(closed.astype('float32'),(0,0),1.0); alpha*=color
rgba=np.dstack((src,(alpha*255).astype('uint8'))); Image.fromarray(rgba).save(p/'v29/hair-only.png'); Image.fromarray((closed*255).astype('uint8')).save(p/'v29/mask.png')
white=np.full_like(src,255); a=rgba[:,:,3:4]/255; out=(src*a+white*(1-a)).astype('uint8');Image.fromarray(out).save(p/'v29/hair-only.jpg',quality=92)
outer=closed & (union<=16);print('selected',closed.sum(),'outer',outer.sum(),'left',outer[:,:250].sum(),'right',outer[:,600:].sum())
