from PIL import Image, ImageDraw
from pathlib import Path
p=Path('/work'); out=p/'sheets'; out.mkdir(exist_ok=True)
for kind in ['eye','mouth']:
 sheet=Image.new('RGB',(1680,840),'white'); draw=ImageDraw.Draw(sheet)
 for i in range(21):
  im=Image.open(p/'states'/f'{kind}-{i:02}.jpg').crop((290,90,550,390)).resize((240,255),Image.Resampling.LANCZOS)
  x=i%7*240; y=i//7*280;sheet.paste(im,(x,y+25));draw.text((x+8,y+5),f'{1-i/20:.2f}' if kind=='eye' else f'{i/20:.2f}',fill='black')
 sheet.save(out/f'{kind}.jpg',quality=87,optimize=True)
poses=['rest','idle4','idle10','xminus','xplus','zminus','zplus','bodyminus','bodyplus']
sheet=Image.new('RGB',(6*240,3*310),'white'); draw=ImageDraw.Draw(sheet)
for i,name in enumerate(poses):
 for j,ver in enumerate(['j','k']):
  im=Image.open(p/ver/f'{name}-magenta.png').crop((250,60,590,460)).resize((240,280),Image.Resampling.LANCZOS);x=(i%3*2+j)*240;y=(i//3)*310;sheet.paste(im,(x,y+30));draw.text((x+5,y+5),f'{name} '+('v10k' if j==0 else 'v11c'),fill='black')
sheet.save(out/'poses.jpg',quality=87,optimize=True)
sheet=Image.new('RGB',(1200,1740),'white');draw=ImageDraw.Draw(sheet)
for i,name in enumerate(['xminus','xplus','zminus','zplus']):
 for j,ver in enumerate(['j','b','k']):
  im=Image.open(p/ver/f'{name}-magenta.png').crop((325,170,515,365)).resize((400,410),Image.Resampling.LANCZOS);x=j*400;y=i*435;sheet.paste(im,(x,y+25));draw.text((x+5,y+5),name+' '+['v10k','v11b','v11c'][j],fill='black')
sheet.save(out/'cheeks.jpg',quality=87,optimize=True)
sheet=Image.new('RGB',(1600,1000),'white');draw=ImageDraw.Draw(sheet)
im=Image.open(p/'original.png').convert('RGB').crop((275,385,755,880)).resize((400,410),Image.Resampling.LANCZOS);sheet.paste(im,(0,30))
for j,ver in enumerate(['j','b','k'],1):
 im=Image.open(p/ver/'rest-magenta.png').convert('RGB').crop((325,170,515,365)).resize((400,410),Image.Resampling.LANCZOS);sheet.paste(im,(j*400,30))
im=Image.open(p/'original-full.jpg').convert('RGB').crop((240,60,1300,1450)).resize((400,525),Image.Resampling.LANCZOS);sheet.paste(im,(0,470))
for j,ver in enumerate(['j','b','k'],1):
 im=Image.open(p/ver/'rest-magenta.png').convert('RGB').resize((400,525),Image.Resampling.LANCZOS);sheet.paste(im,(j*400,470))
for x,label in enumerate(['original v0','v10k Chromium','v11b Chromium','v11c Chromium']):draw.text((x*400+8,8),label,fill='black');draw.text((x*400+8,448),label,fill='black')
sheet.save(out/'static.jpg',quality=88,optimize=True)
