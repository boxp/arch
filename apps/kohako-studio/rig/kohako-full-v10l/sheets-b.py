from PIL import Image,ImageDraw,ImageFont,ImageChops
from pathlib import Path
P=Path('/work/b');font=ImageFont.load_default(); frames=[10,30,50,70,90,110,130,150];w,h=120,159
out=Image.new('RGB',(len(frames)*w,2*(h+23)),'white'); d=ImageDraw.Draw(out)
for r,ver in enumerate(['j','k']):
 for col,n in enumerate(frames):
  im=Image.open(P/f'normal-{ver}/{n:04}.jpg').convert('RGB').resize((w,h));out.paste(im,(col*w,r*(h+23)+23));d.text((col*w+2,r*(h+23)+3),f'v10{"k" if ver=="j" else "l"} t={n/8:.1f}s',fill='black',font=font)
out.save(P/'contact.jpg',quality=88,optimize=True)
W,H=94,84;out=Image.new('RGB',(len(frames)*W,4*(H+20)),'white'); d=ImageDraw.Draw(out);regions=[('left',(150,175)),('right',(240,175))]
for j,(name,(cx,cy)) in enumerate(regions):
 for r,ver in enumerate(['j','k']):
  row=j*2+r
  for col,n in enumerate(frames):
   im=Image.open(P/f'magenta-{ver}/{n:04}.jpg').convert('RGB');out.paste(im.crop((cx-W//2,cy-H//2,cx+W//2,cy+H//2)),(col*W,row*(H+20)+20));d.text((col*W+2,row*(H+20)+2),f'{name} {"k" if ver=="j" else "l"} {n/8:.1f}s',fill='black',font=font)
out.save(P/'crops.jpg',quality=88,optimize=True)
