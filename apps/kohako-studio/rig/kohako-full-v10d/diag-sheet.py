from PIL import Image,ImageDraw
from pathlib import Path
p=Path('/work'); modes=['all','background','body-only','back-only','neck-only','face-only','no-body','no-back','no-neck','no-face']; poses=['idle4','idle10','bodyminus','bodyplus']
out=Image.new('RGB',(330*5,270*8),'white'); d=ImageDraw.Draw(out)
for row,pose in enumerate(poses):
 for i,mode in enumerate(modes):
  im=Image.open(p/f'{pose}-{mode}.png').convert('RGB'); w,h=im.size; im=im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39))); im.thumbnail((330,240)); x=(i%5)*330; y=(row*2+i//5)*270; out.paste(im,(x+(330-im.width)//2,y+25)); d.text((x+4,y+4),f'{pose} {mode}',fill='black')
out.save(p/'diagnosis.jpg',quality=92)
