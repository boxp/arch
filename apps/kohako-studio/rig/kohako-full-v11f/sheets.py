from PIL import Image, ImageDraw
from pathlib import Path
p=Path('/home/boxp/b441work/full11f/capture'); dest=Path('apps/kohako-studio/web/public/kohako/live2d/compare'); pref='kohako-full-v11f-'
# Same physical crop for every frame and model, explicitly including both eyes.
out=Image.new('RGB',(1600,21*170),'white'); d=ImageDraw.Draw(out)
for i in range(21):
 for j,v in enumerate('ef'):
  im=Image.open(p/f'{v}-eye-{i:02}.png').convert('RGB').crop((325,210,515,275)).resize((800,145),Image.Resampling.LANCZOS);out.paste(im,(j*800,i*170+25));d.text((j*800+5,i*170+5),f'v11{v} eye {1-i/20:.2f}',fill='black')
out.save(dest/(pref+'eye.jpg'),quality=86,optimize=True)
poses=['rest','idle4','idle10','xminus','xplus','zminus','zplus','bodyminus','bodyplus']; out=Image.new('RGB',(1440,930),'white');d=ImageDraw.Draw(out)
for i,name in enumerate(poses):
 for j,v in enumerate('ef'):
  im=Image.open(p/f'{v}-{name}.png').convert('RGB').crop((250,60,590,460)).resize((240,280),Image.Resampling.LANCZOS);x=(i%3*2+j)*240;y=i//3*310;out.paste(im,(x,y+30));d.text((x+5,y+5),f'{name} v11{v}',fill='black')
out.save(dest/(pref+'poses.jpg'),quality=87,optimize=True)
out=Image.new('RGB',(1600,4*300),'white');d=ImageDraw.Draw(out)
for i,name in enumerate(['xminus','xplus','zminus','zplus']):
 for j,v in enumerate('ef'):
  im=Image.open(p/f'{v}-{name}.png').convert('RGB').crop((325,170,515,275)).resize((800,275),Image.Resampling.LANCZOS);out.paste(im,(j*800,i*300+25));d.text((j*800+5,i*300+5),f'{name} v11{v}',fill='black')
out.save(dest/(pref+'angles.jpg'),quality=87,optimize=True)
out=Image.new('RGB',(1200,440),'white');d=ImageDraw.Draw(out)
im=Image.open('/home/boxp/b441work/full11e/sheets-work/original.png').convert('RGB').crop((275,385,755,880)).resize((400,410),Image.Resampling.LANCZOS);out.paste(im,(0,30))
for i,v in enumerate('ef',1):
 im=Image.open(p/f'{v}-rest.png').convert('RGB').crop((325,170,515,365)).resize((400,410),Image.Resampling.LANCZOS);out.paste(im,(i*400,30))
for i,l in enumerate(['original v0','v11e','v11f']):d.text((i*400+5,5),l,fill='black')
out.save(dest/(pref+'static.jpg'),quality=87,optimize=True)
for name in poses:
 e=Image.open(p/f'e-{name}.png').convert('RGB');f=Image.open(p/f'f-{name}.png').convert('RGB');count=0
 for y in range(60,400):
  for x in range(280,560):
   a=e.getpixel((x,y));b=f.getpixel((x,y));mag=lambda c:c[0]>245 and c[1]<10 and c[2]>245
   count+= mag(b) and not mag(a)
 print(name,count)
