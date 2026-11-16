"""Reuse the aligned v17 upper lip, filling the mouth below it with nearby skin."""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image
p=Path('/tmp/boxp441'); layout=p/'v6/layout'; path=layout/'layout.json'; m=json.loads(path.read_text())
half=np.array(Image.open(layout/'mouth_half.png').convert('RGBA'))
rgb=half[:,:,:3]; h,w=rgb.shape[:2]
# Within the mouth bounds locate the first dark pixel in each column. Retain
# its upper edge and a slightly deeper strip at either corner, not teeth or tongue.
line=np.zeros((h,w),np.uint8)
for x in range(18,56):
    ys=np.flatnonzero(rgb[8:19,x,0]<230)
    if not len(ys): continue
    y=8+int(ys[0]); depth=4 if x<23 or x>50 else 2
    line[max(0,y-1):min(h,y+depth+1),x]=1
# Remove all mouth colour from an ellipse before restoring the selected pixels.
yy,xx=np.indices((h,w)); removal=(((xx-37)/23)**2+((yy-16)/9)**2<1).astype('uint8')*255
skin=cv2.inpaint(rgb,removal,7,cv2.INPAINT_TELEA)
line &= (rgb[:,:,0] < 225).astype("uint8")
closed=skin.copy(); closed[line!=0]=rgb[line!=0]
item=next(x for x in m['layers'] if x['id']=='mouth_closed')
half_item=next(x for x in m['layers'] if x['id']=='mouth_half')
item['rect']=dict(half_item['rect']); item['image'].update(width=w,height=h)
Image.fromarray(np.dstack((closed,half[:,:,3]))).save(layout/item['image']['path'])
Image.fromarray(line*255).save(p/'v6/out/v22-upper-mask.png')
m['name']='kohako-v22'; path.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
