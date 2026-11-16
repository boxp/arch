"""Compare the v2 and v3 pose renders and the original artwork."""
import json,sys
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
v2,v3,source,out=map(Path,sys.argv[1:]); out.mkdir(parents=True,exist_ok=True)
def tiles(path):
 result=[]
 for f in sorted(path.glob('poses-*.json')):
  data=json.loads(f.read_text()); im=Image.open(f.with_suffix('.png')).convert('RGB')
  for t in data['tiles']:
   x,y,w,h=map(int,t['imageRect']); result.append(im.crop((x,y,x+w,y+h)))
 return result
a,b=tiles(v2),tiles(v3); a.insert(8,a[7]); names=['rest','AngleX +30','AngleX -30','AngleY +20','AngleY -20','BodyX +10','BodyX -10','Eye 0','Eye .15','Eye .5','Eye 1','Mouth 0','Mouth .5','Mouth 1','Hair +1','Hair -1','Combined']
assert len(a)==len(b)==len(names),(len(a),len(b))
w,h=140,251; sheet=Image.new('RGB',(w*8,(h+24)*5),'white');d=ImageDraw.Draw(sheet)
for i,(label,x,y) in enumerate(zip(names,a,b)):
 col=i%4*2; row=i//4
 for j,img in enumerate((x,y)): sheet.paste(img.resize((w,h),Image.Resampling.LANCZOS),((col+j)*w,row*(h+24)+24))
 d.text((col*w+3,row*(h+24)+3),label+' v2 | v3',fill='black')
sheet.save(out/'kohako-full-v3-compare.jpg',quality=85,optimize=True)
original=Image.open(source).convert('RGB').resize((1143,2048),Image.Resampling.LANCZOS)
regions={'eyes':(470,245,675,320),'mouth':(520,320,625,380),'hair-arms':(170,350,970,1050),'feet':(400,1750,750,2048)}
for name,(x0,y0,x1,y1) in regions.items():
 canvas=Image.new('RGB',(900,420*4),'white'); d=ImageDraw.Draw(canvas)
 for row,i in enumerate([0,1,7,16]):
  for col,img in enumerate((original,a[i],b[i])):
   W,H=img.size; crop=img.crop((round(x0*W/1143),round(y0*H/2048),round(x1*W/1143),round(y1*H/2048))); scale=min(290/crop.width,390/crop.height); crop=crop.resize((max(1,round(crop.width*scale)),max(1,round(crop.height*scale))),Image.Resampling.LANCZOS);canvas.paste(crop,(col*300+(300-crop.width)//2,row*420+25))
  d.text((5,row*420+4),names[i]+' original | v2 | v3',fill='black')
 canvas.save(out/(name+'-crops.jpg'),quality=85,optimize=True)
# Render tile is resampled; report mean absolute RGB differences after resizing to canvas.
rest=b[0].resize((1143,2048),Image.Resampling.LANCZOS); src=np.asarray(original,dtype=np.int16); rendered=np.asarray(rest,dtype=np.int16)
diffs={name:float(np.abs(src[y0:y1,x0:x1]-rendered[y0:y1,x0:x1]).mean()) for name,(x0,y0,x1,y1) in regions.items() if name in ('eyes','mouth')}
(out/'pixel-diff.json').write_text(json.dumps(diffs,indent=2)); print(diffs)
