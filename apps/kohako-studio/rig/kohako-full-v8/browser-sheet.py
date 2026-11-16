from pathlib import Path
from PIL import Image, ImageDraw
import sys
src=Path(sys.argv[1]); out=Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
poses=['rest','xp','xm','yp','ym','bp','bm','eye0','eye015','eye05','eye1','mouth0','mouth05','mouth1','combined']
for frame in ('full','upper'):
    tw,th=140,210
    sheet=Image.new('RGB',(tw*8,(th+26)*8),'white'); draw=ImageDraw.Draw(sheet)
    for device_index,device in enumerate(('pc','pixel7')):
      for i,pose in enumerate(poses):
        row=device_index*4+i//4; col=(i%4)*2
        for j,model in enumerate(('v7','v8')):
            im=Image.open(src/f'{device}-kohako-full-{model}-{frame}-{pose}.png').convert('RGB'); im.thumbnail((tw,th),Image.Resampling.LANCZOS)
            sheet.paste(im,((col+j)*tw+(tw-im.width)//2,row*(th+26)+26))
        draw.text((col*tw+3,row*(th+26)+3),device+' '+pose+' v7 | v8',fill='black')
    sheet.save(out/f'kohako-full-v8-browser-{frame}.jpg',quality=85,optimize=True)
