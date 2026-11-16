"""Create v45/v46 eye sequences from the individual capture outputs."""
import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
v46,dest=map(Path,sys.argv[1:]);dest.mkdir(parents=True,exist_ok=True)
for i,angle in enumerate(('front','X -30','X +30','Y -20','Y +20')):
 sheets=[]
 for label,root,prefix in [('v45',v46,'v45'),('v46',v46,'candidate')]:
  img=Image.open(root/f'{prefix}-eyes{i}.png').convert('RGB'); tiles=json.loads((root/f'{prefix}-eyes{i}.json').read_text())['tiles']; frames=[]
  for t in tiles[:21]:
   x,y,w,h=t['imageRect']; frames.append(img.crop((x,y,x+w,y+h)).resize((300,156)))
  sheet=Image.new('RGB',(7*300,6*180),'white'); draw=ImageDraw.Draw(sheet)
  for n,j in enumerate(list(range(21))+list(range(19,-1,-1))):
   x=n%7*300;y=n//7*180;sheet.paste(frames[j],(x,y+24));draw.text((x+4,y+4),f'{label} {angle} {j/20:.2f}',fill='black')
  sheets.append(sheet)
 out=Image.new('RGB',(2100,2160),'white');out.paste(sheets[0]);out.paste(sheets[1],(0,1080));out.save(dest/f'kohako-v46-sequence-{i}.jpg',quality=78,optimize=True)
