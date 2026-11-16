"""Create original/v17/v21 pose comparisons from captured MCP renders."""
from pathlib import Path
import json, sys
from PIL import Image, ImageDraw, ImageFont
root=Path(sys.argv[1]); dest=Path(sys.argv[2]); dest.mkdir(parents=True,exist_ok=True)
ref=Image.open(root/'kohako/layout2/reference.png').convert('RGBA'); font=ImageFont.load_default(size=18)
values=['0','0.15','0.2','0.25','0.3','0.4','0.5','0.75','1']
for name,rect,labels in [('mouth',(350,265,470,335),[f'X {x} mouth {v}' for x in ['0','-20','+20'] for v in values]),('full',(100,0,680,650),['front','X -20 Y -10','X -20 Y +10','X +20 Y -10','X +20 Y +10'])]:
    tile=((rect[2]-rect[0])*4,(rect[3]-rect[1])*4) if name=='mouth' else (290,325)
    sheet=Image.new('RGB',(tile[0]*3,(tile[1]+30)*len(labels)),'white'); draw=ImageDraw.Draw(sheet)
    for row,label in enumerate(labels):
        for col,version in enumerate(['original','v17','v19']):
            if col==0: im=ref.crop(rect)
            else:
                path=root/('v17' if version=='v19' else version)/'out'; j = (row//9)*10 + (row%9 if row%9 == 0 else row%9+1); capture = 'mouth-'+str(j//3) if name=='mouth' else name; index = j%3 if name=='mouth' else row; meta=json.loads((path/('v19-'+capture+'.json')).read_text()); x,y,w,h=meta['tiles'][index]['imageRect']; im=Image.open(path/('v19-'+capture+'.png')).convert('RGBA').crop((x,y,x+w,y+h))
            im=im.resize(tile,Image.Resampling.LANCZOS); bg=Image.new('RGBA',tile,'white'); bg.alpha_composite(im); x=col*tile[0]; y=row*(tile[1]+30); sheet.paste(bg.convert('RGB'),(x,y+30)); draw.text((x+4,y+4),('v21 (same as v17)' if version=='v19' else version)+' '+label,fill='black',font=font)
    sheet.save(dest/('kohako-v21-compare-'+name+'.jpg'),quality=75,optimize=True)
