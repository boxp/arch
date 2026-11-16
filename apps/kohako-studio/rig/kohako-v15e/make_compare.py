from pathlib import Path
import json,sys
from PIL import Image,ImageDraw,ImageFont
root=Path(sys.argv[1]); out=Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
ref=Image.open(root/'kohako/layout2/reference.png').convert('RGBA'); labels=['default closed','X -20 closed','X +20 closed']; versions=['original (open)','v13','v15e']; tile=(840,440); sheet=Image.new('RGB',(2520,(440+54)*3),'white'); d=ImageDraw.Draw(sheet); font=ImageFont.load_default(size=22)
for row,label in enumerate(labels):
 y=row*(tile[1]+54); d.text((5,y),label,fill='black',font=font)
 for col,version in enumerate(versions):
  if col==0: frame=ref.crop((300,170,510,280))
  else:
   folder=root/version/'out'; meta=json.loads((folder/'v15e-eyes.json').read_text()); x0,y0,w,h=meta['tiles'][row]['imageRect']; frame=Image.open(folder/'v15e-eyes.png').convert('RGBA').crop((x0,y0,x0+w,y0+h))
  frame=frame.resize(tile,Image.Resampling.LANCZOS); bg=Image.new('RGBA',tile,'white'); bg.alpha_composite(frame); sheet.paste(bg.convert('RGB'),(col*tile[0],y+54)); d.text((col*tile[0]+5,y+26),version,fill='black',font=font)
sheet.save(out/'kohako-v15e-compare-eyes.png',compress_level=1); sheet.save(out/'kohako-v15e-compare-eyes.jpg',quality=85,optimize=True)
