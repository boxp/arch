"""Inspect source overlays and alpha continuity of locally prepared layers."""
import json, sys
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw
layout, source, out = map(Path, sys.argv[1:]); out.mkdir(parents=True, exist_ok=True)
m=json.loads((layout/'layout.json').read_text()); original=Image.open(source).convert('RGB').resize((1143,2048),Image.Resampling.LANCZOS)
canvas=original.convert('RGBA'); face=next(x for x in m['layers'] if x['id']=='face'); r=face['rect']; canvas.alpha_composite(Image.open(layout/face['image']['path']).convert('RGBA'),(r['left'],r['top'])); metrics={}
for item in m['layers']:
 if not (item['id'].startswith('eye_') or item['id']=='mouth_open'): continue
 part=Image.open(layout/item['image']['path']).convert('RGBA'); rect=item['rect']; canvas.alpha_composite(part,(rect['left'],rect['top']))
 a=np.array(part)[:,:,3]; n,_,stats,_=cv2.connectedComponentsWithStats((a>0).astype('uint8'),8)
 metrics[item['id']]={'alpha_nonzero':int((a>0).sum()),'components':int(n-1),'largest':int(stats[1:,cv2.CC_STAT_AREA].max()) if n>1 else 0}
# Diagnostic only: original dark mouth pixels in a bounded source-space ROI.
# This is not used to construct the visible mouth layer.
src=np.array(Image.open(source).convert('RGB')); H,W=src.shape[:2]
roi=np.zeros((H,W),np.uint8); x0,x1=[round(x*W/1143) for x in (548,600)]; y0,y1=[round(y*H/2048) for y in (345,365)]
roi[y0:y1,x0:x1]=(src[y0:y1,x0:x1].max(axis=2)<200).astype('uint8')*255
small=cv2.resize(roi,(1143,2048),interpolation=cv2.INTER_AREA); n,_,stats,_=cv2.connectedComponentsWithStats((small>0).astype('uint8'),8)
metrics['mouth_dark_diagnostic']={'alpha_nonzero':int((small>0).sum()),'components':int(n-1),'largest':int(stats[1:,cv2.CC_STAT_AREA].max()) if n>1 else 0}
can=Image.new('RGB',(1000,480),'white'); d=ImageDraw.Draw(can)
for col,im in enumerate((original,canvas.convert('RGB'))):
 crop=im.crop((470,245,675,380)); crop.thumbnail((490,450)); crop=crop.resize((crop.width*2,crop.height*2),Image.Resampling.NEAREST); crop.thumbnail((490,450)); can.paste(crop,(col*500,25)); d.text((col*500+5,5),['original','layer overlay'][col],fill='black')
can.save(out/'feature-overlay.jpg',quality=90); (out/'alpha-metrics.json').write_text(json.dumps(metrics,indent=2))
