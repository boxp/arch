from PIL import Image,ImageDraw
from pathlib import Path
p=Path('/work'); out=p/'sheets'; out.mkdir(exist_ok=True)
# Head crop from the fixed 837 x 1110 Chromium upper-body stage.
for kind in ['eye','mouth']:
 for detail in [False,True]:
  height=280 if detail else 345
  sheet=Image.new('RGB',(7*240,3*height),'white'); draw=ImageDraw.Draw(sheet)
  for i in range(21):
   source=Image.open(p/'states'/f'{kind}-{i:02}.jpg')
   if detail: source=source.crop((290,90,550,390)); size=(240,255)
   else: size=(240,318)
   im=source.resize(size,Image.Resampling.LANCZOS); x=i%7*240;y=i//7*height;sheet.paste(im,(x,y+25));draw.text((x+8,y+5),f'{1-i/20:.2f}' if kind=='eye' else f'{i/20:.2f}',fill='black')
  sheet.save(out/f"{kind}{'-detail' if detail else ''}.jpg",quality=87,optimize=True)
poses=['rest','idle4','idle10','xminus','xplus','zminus','zplus','bodyminus','bodyplus']
sheet=Image.new('RGB',(6*240,3*310),'white'); draw=ImageDraw.Draw(sheet)
for i,name in enumerate(poses):
 for j,ver in enumerate(['j','k']):
  im=Image.open(p/ver/f'{name}-magenta.png').crop((250,60,590,460)).resize((240,280),Image.Resampling.LANCZOS); x=(i%3*2+j)*240;y=(i//3)*310;sheet.paste(im,(x,y+30));draw.text((x+5,y+5),f'{name} '+('v10k' if j==0 else 'v11b'),fill='black')
sheet.save(out/'poses.jpg',quality=87,optimize=True)
for kind in ['normal']:
 sheet=Image.new('RGB',(4*300,4*420),'white'); draw=ImageDraw.Draw(sheet)
 for i,frame in enumerate(range(0,160,40)):
  for j,ver in enumerate(['j','k']):
   im=Image.open(p/f'{kind}-{ver}'/f'{frame:04}.jpg').resize((300,395),Image.Resampling.LANCZOS); x=(i%2*2+j)*300;y=(i//2)*420;sheet.paste(im,(x,y+25));draw.text((x+5,y+5),f'{frame/8:.1f}s '+('v10k' if j==0 else 'v11b'),fill='black')
 sheet.crop((0,0,1200,840)).save(out/'contact.jpg',quality=86,optimize=True)
# Original v0 framing / v10k / v11a, face and upper-body views.
sheet=Image.new('RGB',(1600,1000),'white'); draw=ImageDraw.Draw(sheet)
original=Image.open(p/'original.png').convert('RGB')
face_orig=original.crop((275,385,755,880)).resize((400,410),Image.Resampling.LANCZOS)
sheet.paste(face_orig,(0,30))
for j,ver in enumerate(['j','a','k'],1):
 im=Image.open(p/ver/'rest-magenta.png').convert('RGB').crop((325,170,515,365)).resize((400,410),Image.Resampling.LANCZOS);sheet.paste(im,(j*400,30))
full=Image.open(p/'original-full.jpg').convert('RGB').crop((240,60,1300,1450)).resize((400,525),Image.Resampling.LANCZOS);sheet.paste(full,(0,470))
for j,ver in enumerate(['j','a','k'],1):
 im=Image.open(p/ver/'rest-magenta.png').convert('RGB').resize((400,525),Image.Resampling.LANCZOS);sheet.paste(im,(j*400,470))
for x,label in enumerate(['original v0','v10k Chromium','v11a Chromium','v11b Chromium']):draw.text((x*400+8,8),label,fill='black');draw.text((x*400+8,448),label,fill='black')
sheet.save(out/'static.jpg',quality=88,optimize=True)

sheet=Image.new('RGB',(480,300),'white'); draw=ImageDraw.Draw(sheet)
for i,v in enumerate(['0.6','0.135']):
 im=Image.open(p/'states'/f'eye-extra-{v}.jpg').crop((290,90,550,390)).resize((240,275),Image.Resampling.LANCZOS);sheet.paste(im,(i*240,25));draw.text((i*240+8,5),v,fill='black')
sheet.save(out/'eye-midpoints.jpg',quality=87,optimize=True)
# Blink is stepped at 60 Hz and photographed every tenth frame (6 Hz).
sheet=Image.new('RGB',(6*240,5*280),'white'); draw=ImageDraw.Draw(sheet)
for i in range(30):
 im=Image.open(p/'states'/f'blink-{i:02}.jpg').crop((290,90,550,390)).resize((240,255),Image.Resampling.LANCZOS)
 x=i%6*240; y=i//6*280; sheet.paste(im,(x,y+25)); draw.text((x+5,y+5),f'{i/6:.2f}s',fill='black')
sheet.save(out/'blink.jpg',quality=87,optimize=True)
