from PIL import Image, ImageDraw, ImageChops
from pathlib import Path
import json
root=Path('/tmp/work'); poses=['idle4','idle10','bodyminus','bodyplus','angleminus','angleplus','zminus','zplus','rest']; counts={}; sheet=Image.new('RGB',(len(poses)*230,660),'white'); d=ImageDraw.Draw(sheet)
for j,m in enumerate(['kohako-full-v10g','kohako-full-v10h']):
 for i,p in enumerate(poses):
  im=Image.open(root/'background'/f'{m}-{p}.png').convert('RGB'); w,h=im.size; crop=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39))); counts[m+'-'+p]=sum(1 for r,g,b in crop.getdata() if r>245 and g<10 and b>245); crop.thumbnail((230,300)); sheet.paste(crop,(i*230+(230-crop.width)//2,j*330+25));d.text((i*230+3,j*330+3),f'{m[-4:]} {p} {counts[m+"-"+p]}',fill='black')
sheet.save(root/'background.jpg',quality=85);(root/'counts.json').write_text(json.dumps(counts,indent=2))
for mode in ('natural','thinking'):
 sheet=Image.new('RGB',(1920,1620),'white');d=ImageDraw.Draw(sheet)
 for i in range(31):
  x=i%6*320;y=i//6*270
  for j,folder in enumerate((root/'before',root)):
   times=json.loads((folder/f'{mode}-upper.json').read_text())['timestamps']; im=Image.open(folder/'captures'/f'{mode}-upper-{i:02}.png').convert('RGB');w,h=im.size;im=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39))); im.thumbnail((160,230));sheet.paste(im,(x+j*160+(160-im.width)//2,y+25));d.text((x+j*160,y+4),f'{"g" if j==0 else "h"} {times[i]:.2f}',fill='black')
 sheet.save(root/f'{mode}-detail.jpg',quality=85)
a=Image.open(root/'normal-g.png').convert('RGB'); b=Image.open(root/'normal-h.png').convert('RGB'); diff=ImageChops.difference(a,b); diff.save(root/'rest-difference.png'); (root/'rest-changed.txt').write_text(str(sum(1 for v in diff.getdata() if v!=(0,0,0))))
