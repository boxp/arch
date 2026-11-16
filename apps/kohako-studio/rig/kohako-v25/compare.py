from PIL import Image, ImageChops, ImageDraw
from pathlib import Path
p=Path('/tmp/boxp441/v6/out')
for name in ('mouth','poses','eyes'):
 a=Image.open(p/f'compare24-{name}.png').convert('RGB'); b=Image.open(p/f'v25-{name}.png').convert('RGB')
 print(name, 'identical:',ImageChops.difference(a,b).getbbox() is None, flush=True)
 if name=='eyes': continue
 w=1200; h=int(a.height*w/a.width); a=a.resize((w,h)); b=b.resize((w,h)); im=Image.new('RGB',(w*2,h+38),'white'); im.paste(a,(0,38)); im.paste(b,(w,38)); d=ImageDraw.Draw(im); d.text((12,10),'v24',fill='black'); d.text((w+12,10),'v25',fill='black'); im.save(p/f'kohako-v25-vs-v24-{ "full" if name=="poses" else name}.jpg',quality=80,optimize=True)
