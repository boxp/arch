from PIL import Image,ImageDraw
import json
from pathlib import Path
p=Path('/work'); data=json.loads((p/'browser-results.json').read_text()); poses=['rest','mouth0','mouth05','mouth1','eye0','eye015','eye05','eye1']; canvas=Image.new('RGB',(1200,2*len(poses)*125),'white');d=ImageDraw.Draw(canvas)
for di,device in enumerate(('pc','pixel7')):
 for i,pose in enumerate(poses):
  y=(di*len(poses)+i)*125
  for col,variant in enumerate(('v6baseline','v6mip')):
   item=next(e for e in data if e['device']==device and e['variant']==variant);r=item['info']['box']; im=Image.open(p/f'{device}-{variant}-{pose}.png').convert('RGB');scale=im.width/(1280 if device=='pc' else 412)
   box=((r['x']+r['width']*.40)*scale,(r['y']+r['height']*.12)*scale,(r['x']+r['width']*.60)*scale,(r['y']+r['height']*.20)*scale)
   face=im.crop(tuple(round(v) for v in box));face=face.resize((round(face.width/scale),round(face.height/scale)),Image.Resampling.LANCZOS);face.thumbnail((145,48));x=col*400;d.text((x+4,y+2),f'{device} {pose} {variant} CSS / 2x',fill='black');canvas.paste(face,(x+4,y+23));canvas.paste(face.resize((face.width*2,face.height*2),Image.Resampling.NEAREST),(x+155,y+23))
canvas.save(p/'browser-faces.jpg',quality=85,optimize=True)
