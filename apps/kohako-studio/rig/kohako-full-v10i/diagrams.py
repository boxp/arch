import json
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
P=Path('/work'); F=ImageFont.load_default(); cases=[('idle10',(290,300),'ArtMeshBackHair','ArtMeshLayerR'),('bodyplus',(569,300),'ArtMeshBackHair','ArtMeshLayerL'),('zplus',(362,355),'ArtMeshNeck','ArtMeshLayerR')]; W,H=200,150; out=Image.new('RGB',(W*5,H*3+30*3),'white'); d=ImageDraw.Draw(out)
for row,(pose,(cx,cy),a,b) in enumerate(cases):
 for col,mode in enumerate(['all','only-'+a,'without-'+a,'only-'+b,'without-'+b]):
  im=Image.open(P/f'layer-{pose}-{mode}.png').convert('RGB');im=im.crop((cx-W//2,cy-H//2,cx+W//2,cy+H//2));out.paste(im,(col*W,row*(H+30)+30));d.text((col*W+3,row*(H+30)+4),f'{pose} {mode}',fill='black',font=F)
out.save(P/'diag-layers.jpg',quality=87,optimize=True)
wire=Image.new('RGB',(W*3,H+30),'white');draw=ImageDraw.Draw(wire)
for col,(pose,(cx,cy),a,b) in enumerate(cases):
 im=Image.open(P/f'layer-{pose}-all.png').convert('RGB');geom=json.load(open(P/f'{pose}-geom.json')); ov=ImageDraw.Draw(im);T=geom['transform'];w,h=im.size
 for m in geom['meshes']:
  if m['id'] not in [a,b]:continue
  v=m['v']; pts=[((v[i]*T[0]+T[2]+1)*.5*w,(1-(v[i+1]*T[1]+T[3]))*.5*h) for i in range(0,len(v),2)]; idx=m['indices'];color='cyan' if m['id']==a else 'yellow'
  for i in range(0,len(idx),3):
   tri=[pts[idx[i]],pts[idx[i+1]],pts[idx[i+2]]];ov.line(tri+[tri[0]],fill=color,width=1)
 wire.paste(im.crop((cx-W//2,cy-H//2,cx+W//2,cy+H//2)),(col*W,30));draw.text((col*W+2,5),pose+' cyan=1 yellow=2',fill='black',font=F)
wire.save(P/'diag-wire.jpg',quality=88,optimize=True)
