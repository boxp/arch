from PIL import Image,ImageDraw,ImageChops
from pathlib import Path
import json
root=Path('/home/boxp/b441work/full10f'); poses=['idle4','idle10','bodyminus','bodyplus','angleminus','angleplus','rest']; sheet=Image.new('RGB',(7*250,2*350),'white'); d=ImageDraw.Draw(sheet); counts={}
for row,model in enumerate(['kohako-full-v10e','kohako-full-v10f']):
 for i,pose in enumerate(poses):
  im=Image.open(root/'background'/f'{model}-{pose}.png').convert('RGB'); w,h=im.size; crop=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39))); count=sum(1 for r,g,b in crop.getdata() if r>245 and g<10 and b>245); counts[f'{model}-{pose}']=count
  crop.thumbnail((250,320)); sheet.paste(crop,(i*250+(250-crop.width)//2,row*350+25)); d.text((i*250+3,row*350+3),f'{model[-4:]} {pose} {count}',fill='black')
sheet.save(root/'sheets'/'background.jpg',quality=93)
a=Image.open(root/'background/kohako-full-v10e-rest.png').convert('RGB');b=Image.open(root/'background/kohako-full-v10f-rest.png').convert('RGB');ImageChops.difference(a,b).save(root/'sheets'/'rest-difference.png');(root/'background-counts.json').write_text(json.dumps(counts,indent=2))
