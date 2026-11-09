"""Compare original, rebuilt v17, and v22 static MCP captures."""
from pathlib import Path
import json, sys
from PIL import Image, ImageDraw, ImageFont
root=Path(sys.argv[1]); dest=Path(sys.argv[2]); dest.mkdir(parents=True,exist_ok=True)
ref=Image.open(root/'kohako/layout2/reference.png').convert('RGBA'); font=ImageFont.load_default(size=18)
for name,rect,labels in [('mouth',(350,265,470,335),['mouth '+v for v in ['0','0.1','0.2','0.25','0.3','0.4','0.5','0.75','1']]+['closed X -30','closed X +30']),('full',(100,0,680,650),['front','X -20 Y -10','X -20 Y +10','X +20 Y -10','X +20 Y +10'])]:
    tile=(480,280) if name=='mouth' else (290,325)
    sheet=Image.new('RGB',(tile[0]*3,(tile[1]+30)*len(labels)),'white'); draw=ImageDraw.Draw(sheet)
    for row,label in enumerate(labels):
        for col,version in enumerate(['original','v17','v22']):
            if col==0: im=ref.crop(rect)
            else:
                path=root/version/'out'; capture='mouth-'+str(row//3) if name=='mouth' else name; index=row%3 if name=='mouth' else row
                meta=json.loads((path/('v22-'+capture+'.json')).read_text()); x,y,w,h=meta['tiles'][index]['imageRect']; im=Image.open(path/('v22-'+capture+'.png')).convert('RGBA').crop((x,y,x+w,y+h))
            im=im.resize(tile,Image.Resampling.LANCZOS); bg=Image.new('RGBA',tile,'white'); bg.alpha_composite(im); x=col*tile[0]; y=row*(tile[1]+30); sheet.paste(bg.convert('RGB'),(x,y+30)); draw.text((x+4,y+4),version+' '+label,fill='black',font=font)
    sheet.save(dest/('kohako-v22-compare-'+name+'.jpg'),quality=75,optimize=True)
