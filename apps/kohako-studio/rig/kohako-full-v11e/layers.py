from PIL import Image, ImageDraw
from pathlib import Path
import json
root=Path('/work'); out=Image.new('RGB',(1200,568),'white'); draw=ImageDraw.Draw(out)
for row,version in enumerate(['v10k','v11b']):
 d=root/version; layout=json.loads((d/'layout.json').read_text()); layers={v['id']:v for v in layout['layers']}
 for col,ids in enumerate([['face'],['hair_front'],['hair_side_left','hair_side_right'],['face','hair_side_left','hair_side_right','hair_front']]):
  canvas=Image.new('RGBA',(1143,600),(255,0,255,255))
  for id in ids:
   l=layers[id]; r=l['rect']; img=Image.open(d/l['image']['path']).convert('RGBA').resize((r['width'],r['height']),Image.Resampling.LANCZOS); canvas.alpha_composite(img,(r['left'],r['top']))
  im=canvas.crop((420,175,710,420)).resize((300,254),Image.Resampling.LANCZOS).convert('RGB');out.paste(im,(col*300,row*284+30));draw.text((col*300+5,row*284+8),version+' '+['face','hair_front','side hair','composite'][col],fill='black')
out.save(root/'layers.jpg',quality=87,optimize=True)
