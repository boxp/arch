from PIL import Image,ImageDraw
from pathlib import Path
import json
root=Path('/home/boxp/b441work/full10g')
for mode in ('natural','thinking'):
 sheet=Image.new('RGB',(6*320,6*270),'white');d=ImageDraw.Draw(sheet)
 for i in range(31):
  x=i%6*320;y=i//6*270
  for j,folder in enumerate((root/'before',root)):
   times=json.loads((folder/f'{mode}-upper.json').read_text())['timestamps']; im=Image.open(folder/'captures'/f'{mode}-upper-{i:02}.png').convert('RGB');w,h=im.size;im=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39)));im.thumbnail((160,230));sheet.paste(im,(x+j*160+(160-im.width)//2,y+25));d.text((x+j*160,y+4),f'{"e" if j==0 else "g"} {times[i]:.2f}',fill='black')
 sheet.save(root/f'{mode}-detail.jpg',quality=85)
