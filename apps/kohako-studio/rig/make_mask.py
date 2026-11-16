import json, cv2, numpy as np
from PIL import Image
from pathlib import Path
root=Path('/tmp/boxp441/v3/layout')
m=json.loads((root/'layout.json').read_text())
a=np.zeros((650,680),np.uint8)
for layer in m['layers']:
 if layer['id'] not in ('hair_side_left','hair_side_right'): continue
 im=np.asarray(Image.open(root/layer['image']['path']).convert('RGBA'))[:,:,3]
 x,y=layer['rect']['left'],layer['rect']['top']
 a[y:y+im.shape[0],x:x+im.shape[1]]=np.maximum(a[y:y+im.shape[0],x:x+im.shape[1]],im)
hole=cv2.dilate((a>=250).astype('uint8'),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(19,19)))[335:575,175:600]>0
result=np.zeros((240,425,3),np.uint8); result[hole]=[255,0,255]
Image.fromarray(result).save('/tmp/boxp441/v5/ref/outfit-defect.png')
