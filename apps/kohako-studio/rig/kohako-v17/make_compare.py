from pathlib import Path
import json,sys
from PIL import Image,ImageDraw,ImageFont
root=Path(sys.argv[1]); dest=Path(sys.argv[2]); dest.mkdir(parents=True,exist_ok=True)
ref=Image.open(root/'kohako/layout2/reference.png').convert('RGBA'); font=ImageFont.load_default(size=18)
for name,versions,rect,labels in [('eyes',['v16','v17'],(300,170,510,280),['1','0.5','0.3','0.2','0']),('mouth',['v16','v17'],(350,265,470,335),['0','0.15','0.25','0.4','0.5','0.75','1','X -20','X +20']),('full',['v16','v17'],(100,0,680,650),['front','X -20 Y -10','X -20 Y +10','X +20 Y -10','X +20 Y +10'])]:
 tile=((rect[2]-rect[0])*4,(rect[3]-rect[1])*4) if name!='full' else (290,325)
 sheet=Image.new('RGB',(tile[0]*3,(tile[1]+30)*len(labels)),'white'); draw=ImageDraw.Draw(sheet)
 for row,label in enumerate(labels):
  for col,version in enumerate(['original']+versions):
   if col==0: im=ref.crop(rect)
   else:
    path=root/version/'out'; meta=json.loads((path/('v17-'+name+'.json')).read_text()); x,y,w,h=meta['tiles'][row]['imageRect']; im=Image.open(path/('v17-'+name+'.png')).convert('RGBA').crop((x,y,x+w,y+h))
   im=im.resize(tile,Image.Resampling.LANCZOS); bg=Image.new('RGBA',tile,'white');bg.alpha_composite(im);x=col*tile[0];y=row*(tile[1]+30);sheet.paste(bg.convert('RGB'),(x,y+30));draw.text((x+4,y+4),version+' '+label,fill='black',font=font)
 sheet.save(dest/('kohako-v17-compare-'+name+'.jpg'),quality=80,optimize=True)
