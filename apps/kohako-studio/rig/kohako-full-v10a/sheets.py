from PIL import Image,ImageDraw
from pathlib import Path
import json
src=Path('/work/captures'); out=Path('/work/sheets'); out.mkdir(exist_ok=True)
poses=['rest','xp','xm','eye1','eye05','eye015','eye0','mouth0','mouth05','mouth1']
for frame in ['full','upper']:
 for device in ['pc','pixel7']:
  tw,th=240,360; sheet=Image.new('RGB',(tw*5,(th+25)*2),'white'); d=ImageDraw.Draw(sheet)
  for i,p in enumerate(poses):
   im=Image.open(src/f'{device}-kohako-full-v10a-{frame}-{p}.png').convert('RGB'); im.thumbnail((tw,th)); x=i%5*tw; y=i//5*(th+25); sheet.paste(im,(x+(tw-im.width)//2,y+25)); d.text((x+5,y+5),p,fill='black')
  sheet.save(out/f'poses-{device}-{frame}.jpg',quality=90)
 times=json.loads(Path(f'/work/natural-{frame}.json').read_text())['timestamps']
 tw,th=240,360; sheet=Image.new('RGB',(tw*6,(th+25)*6),'white'); d=ImageDraw.Draw(sheet)
 for i in range(31):
  im=Image.open(src/f'natural-{frame}-{i:02}.png').convert('RGB'); im.thumbnail((tw,th)); x=i%6*tw; y=i//6*(th+25); sheet.paste(im,(x+(tw-im.width)//2,y+25)); d.text((x+5,y+5),f'{times[i]:.2f}s',fill='black')
 sheet.save(out/f'natural-{frame}.jpg',quality=90)
# Upper-body head and neck close-up at the recorded timestamps.
times=json.loads(Path('/work/natural-upper.json').read_text())['timestamps']
sheet=Image.new('RGB',(300*6,240*6),'white'); d=ImageDraw.Draw(sheet)
for i in range(31):
 im=Image.open(src/f'natural-upper-{i:02}.png').convert('RGB'); w,h=im.size
 im=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39))); im.thumbnail((300,210))
 x=i%6*300; y=i//6*240; sheet.paste(im,(x+(300-im.width)//2,y+25)); d.text((x+5,y+5),f'{times[i]:.2f}s',fill='black')
sheet.save(out/'natural-upper-detail.jpg',quality=92)
poses=['eye1','eye05','eye015','eye0','mouth0','mouth05','mouth1']
sheet=Image.new('RGB',(240*7,300*2),'white');d=ImageDraw.Draw(sheet)
for row,model in enumerate(['kohako-v45','kohako-full-v10a']):
 for i,pose in enumerate(poses):
  im=Image.open(src/f'pc-{model}-upper-{pose}.png').convert('RGB');w,h=im.size
  if model=='kohako-full-v10a': im=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39)))
  else: im=im.crop((int(w*.15),int(h*.05),int(w*.85),int(h*.55)))
  im.thumbnail((240,270));x=i*240;y=row*300;sheet.paste(im,(x+(240-im.width)//2,y+25));d.text((x+4,y+4),f'{model} {pose}',fill='black')
sheet.save(out/'v45-v10a-eye-mouth.jpg',quality=92)
times=json.loads(Path('/work/thinking-upper.json').read_text())['timestamps']
sheet=Image.new('RGB',(300*6,240*6),'white'); d=ImageDraw.Draw(sheet)
for i in range(31):
 im=Image.open(src/f'thinking-upper-{i:02}.png').convert('RGB'); w,h=im.size
 im=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39))); im.thumbnail((300,210))
 x=i%6*300; y=i//6*240; sheet.paste(im,(x+(300-im.width)//2,y+25)); d.text((x+5,y+5),f'{times[i]:.2f}s',fill='black')
sheet.save(out/'thinking-upper-detail.jpg',quality=92)
