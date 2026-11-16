from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json, sys
root=Path(sys.argv[1]); out=Path(sys.argv[2]); out.mkdir(exist_ok=True)
ref=Image.open(root/'kohako/layout2/reference.png').convert('RGBA'); box=(160,10,650,560); scale=3; tile=((box[2]-box[0])*scale,(box[3]-box[1])*scale); labels=['default','X-20 Y-10','X+20 Y+10','X-30','X+30','HairBack -1','HairBack +1']; versions=['original','v13','v14','v15','v15b','v15c']
font=ImageFont.load_default(size=24); sheet=Image.new('RGB',(tile[0]*len(versions),(tile[1]+54)*len(labels)),'white'); d=ImageDraw.Draw(sheet); frames=[]
for row,label in enumerate(labels):
 y=row*(tile[1]+54); d.text((10,y+2),label,fill='black',font=font)
 for col,version in enumerate(versions):
  if version=='original': im=ref
  else:
   group=(row//3)*3; k=row%3; folder=root/version/'out'; meta=json.loads((folder/('v14-poses-%d.json'%group)).read_text()); x0,y0,w,h=meta['tiles'][k]['imageRect']; frame=Image.open(folder/('v14-poses-%d.png'%group)).convert('RGBA').crop((x0,y0,x0+w,y0+h)).resize((580,650),Image.Resampling.LANCZOS); im=Image.new('RGBA',(680,650)); im.alpha_composite(frame,(100,0))
  piece=im.crop(box).resize(tile,Image.Resampling.LANCZOS); bg=Image.new('RGBA',tile,'white'); bg.alpha_composite(piece); sheet.paste(bg.convert('RGB'),(col*tile[0],y+54)); d.text((col*tile[0]+10,y+27),version,fill='black',font=font)
  if version=='v15' and row<3:
   small=Image.new('RGBA',(680,650),'white'); small.alpha_composite(im); frames.append(small.crop(box).convert('RGB').quantize(colors=256))
sheet.save(out/'kohako-v15-compare-hair.png',compress_level=1)
# Preserve 3x detail in the PNG; downsize the web/Vault copy only if needed for 1.5 MB.
w=sheet.width
while True:
 small=sheet if w==sheet.width else sheet.resize((w,round(sheet.height*w/sheet.width)),Image.Resampling.LANCZOS)
 small.save(out/'kohako-v15-compare-hair.jpg',quality=85,optimize=True)
 if (out/'kohako-v15-compare-hair.jpg').stat().st_size<=1500000: break
 w=int(w*.85)
frames[1].save(out/'kohako-v15-shake.gif',save_all=True,append_images=[frames[0],frames[2],frames[0]],duration=350,loop=0,disposal=2)
Image.open(root/'v15/out/v15-mask.png').convert('RGB').save(out/'kohako-v15-mask.jpg',quality=85,optimize=True)
print('web width',w)
