from PIL import Image, ImageDraw
from pathlib import Path
import json
root=Path('/work'); out=root/'sheets'; out.mkdir(exist_ok=True)
def crop(p):
 im=Image.open(p).convert('RGB'); w,h=im.size; return im.crop((int(w*.23),int(h*.045),int(w*.77),int(h*.39)))
# Same saved diagnose.json parameter values; single frame, layer selection.
sheet=Image.new('RGB',(4*330,2*280),'white'); draw=ImageDraw.Draw(sheet)
for y,model in enumerate(['kohako-full-v10a','kohako-full-v10c']):
 for x,mode in enumerate(['all','body-only','back-only','no-body']):
  im=crop(root/f'{model}-{mode}.png'); im.thumbnail((330,250)); sheet.paste(im,(x*330+(330-im.width)//2,y*280+25)); draw.text((x*330+4,y*280+4),f'{model} {mode}',fill='black')
sheet.save(out/'diagnosis.jpg',quality=92)
# Match captures by actual timestamp nearest requested instant.
sheet=Image.new('RGB',(5*330,4*280),'white'); draw=ImageDraw.Draw(sheet)
for k,mode in enumerate(['natural','thinking']):
 for row,(name,folder) in enumerate([('v10a',root/'before'),('v10c',root)]):
  times=json.loads((folder/f'{mode}-upper.json').read_text())['timestamps']
  for x,target in enumerate([1,4,7.5,10,12.5]):
   i=min(range(len(times)),key=lambda i:abs(times[i]-target)); im=crop(folder/'captures'/f'{mode}-upper-{i:02}.png'); im.thumbnail((330,250)); y=k*2+row; sheet.paste(im,(x*330+(330-im.width)//2,y*280+25)); draw.text((x*330+4,y*280+4),f'{mode} {name} {times[i]:.2f}s',fill='black')
sheet.save(out/'before-after.jpg',quality=92)
# BodyAngleX independent test.
sheet=Image.new('RGB',(3*330,2*280),'white'); draw=ImageDraw.Draw(sheet)
for y,(model,folder) in enumerate([('kohako-full-v10a',root/'before'),('kohako-full-v10c',root)]):
 for x,pose in enumerate(['bm','rest','bp']):
  im=crop(folder/'captures'/f'pc-{model}-upper-{pose}.png'); im.thumbnail((330,250)); sheet.paste(im,(x*330+(330-im.width)//2,y*280+25)); draw.text((x*330+4,y*280+4),f'{model} {pose}',fill='black')
sheet.save(out/'body-angle.jpg',quality=92)
