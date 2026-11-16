"""Compose v1/v2 pose tiles and detailed crops from view_render_poses output."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw
v1,v2,out=map(Path,sys.argv[1:4]); out.mkdir(parents=True,exist_ok=True)
def tiles(path):
 result=[]
 for file in sorted(path.glob('poses-*.json')):
  data=json.loads(file.read_text()); img=Image.open(file.with_suffix('.png')).convert('RGB')
  for tile in data['tiles']:
   x,y,w,h=map(int,tile['imageRect']); result.append(img.crop((x,y,x+w,y+h)))
 return result
a,b=tiles(v1),tiles(v2)
# v1 lacks explicit eye=1; its default pose has EyeOpen=1.
a.insert(9,a[0]); names=['rest','AngleX +30','AngleX -30','AngleY +20','AngleY -20','BodyX +10','BodyX -10','Eye 0','Eye .5','Eye 1','Mouth 0','Mouth .5','Mouth 1','Hair +1','Hair -1','Combined']
if len(a)!=16 or len(b)!=16: raise RuntimeError(f'pose counts {len(a)}, {len(b)}')
w,h=150,269
sheet=Image.new('RGB',(w*8,(h+25)*4),'white'); draw=ImageDraw.Draw(sheet)
for i,(label,x,y) in enumerate(zip(names,a,b)):
 col=(i%4)*2; row=i//4
 for j,img in enumerate((x,y)):
  img=img.resize((w,h),Image.Resampling.LANCZOS);sheet.paste(img,((col+j)*w,row*(h+25)+25))
 draw.text((col*w+3,row*(h+25)+3),label+'  v1 | v2',fill='black')
sheet.save(out/'kohako-full-v2-compare.jpg',quality=85,optimize=True)
# Crops are extracted from matching render tiles in normalized canvas coordinates.
regions={'eyes':(470,245,675,320),'mouth':(520,320,625,380),'hair-arms':(170,350,970,1050),'feet':(400,1750,750,2048)}
for name,(x0,y0,x1,y1) in regions.items():
 canvas=Image.new('RGB',(600,420*4),'white'); d=ImageDraw.Draw(canvas)
 for row,i in enumerate([0,1,7,15]):
  for col,img in enumerate((a[i],b[i])):
   W,H=img.size; crop=img.crop((int(x0*W/1143),int(y0*H/2048),int(x1*W/1143),int(y1*H/2048)))
   scale=min(290/crop.width,390/crop.height); crop=crop.resize((max(1,round(crop.width*scale)),max(1,round(crop.height*scale))),Image.Resampling.LANCZOS);canvas.paste(crop,(col*300+(300-crop.width)//2,row*420+25))
  d.text((5,row*420+4),names[i]+'  v1 | v2',fill='black')
 canvas.save(out/(name+'-crops.jpg'),quality=90)
