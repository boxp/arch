from PIL import Image, ImageDraw, ImageChops
from pathlib import Path
import json
root=Path('/home/boxp/b441work/full10g'); poses=['idle4','idle10','bodyminus','bodyplus','angleminus','angleplus','zminus','zplus','rest']; models=['kohako-full-v10e','kohako-full-v10g']; counts={}
sheet=Image.new('RGB',(len(poses)*230,2*330),'white');d=ImageDraw.Draw(sheet)
for j,m in enumerate(models):
 for i,p in enumerate(poses):
  im=Image.open(root/'background'/f'{m}-{p}.png').convert('RGB'); w,h=im.size; box=(int(w*.23),int(h*.045),int(w*.77),int(h*.39)); crop=im.crop(box); pixels=crop.load(); pos=[(x+box[0],y+box[1]) for y in range(crop.height) for x in range(crop.width) if (lambda c:c[0]>245 and c[1]<10 and c[2]>245)(pixels[x,y])];counts[f'{m}-{p}']={'count':len(pos),'positions':pos};crop.thumbnail((230,300));sheet.paste(crop,(i*230+(230-crop.width)//2,j*330+25));d.text((i*230+3,j*330+3),f'{m[-4:]} {p} {len(pos)}',fill='black')
sheet.save(root/'background.jpg',quality=85)
a=Image.open(root/'background'/f'{models[0]}-rest.png').convert('RGB'); b=Image.open(root/'background'/f'{models[1]}-rest.png').convert('RGB'); diff=ImageChops.difference(a,b); diff.save(root/'rest-difference.png'); changed=sum(1 for v in diff.getdata() if v!=(0,0,0));(root/'counts.json').write_text(json.dumps(counts));(root/'summary.json').write_text(json.dumps({'counts':{k:v['count'] for k,v in counts.items()},'rest_changed':changed},indent=2))
