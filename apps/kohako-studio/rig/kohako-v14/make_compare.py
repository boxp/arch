from PIL import Image, ImageDraw, ImageFont
import numpy as np, json, os, sys
from pathlib import Path
root=Path(sys.argv[1]); out=Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
ref=Image.open(root/'kohako/layout2/reference.png').convert('RGBA')
font=ImageFont.load_default(size=22)
# The render viewport is (100,0,580,650), metadata imageRect excludes labels.
box=(160,10,650,560); scale=3; tile=((box[2]-box[0])*scale,(box[3]-box[1])*scale)
labels=['default','X-20 Y-10','X+20 Y+10','X-30','X+30','HairBack -1','HairBack +1']
sheet=Image.new('RGB',(tile[0]*4,(tile[1]+54)*len(labels)),(245,245,245)); d=ImageDraw.Draw(sheet)
for row,label in enumerate(labels):
 y=row*(tile[1]+54); d.text((10,y+1),label,fill='black',font=font)
 for col,version in enumerate(['original','v13','v14','v14b']):
  if version=='original': im=ref
  else:
   group=(row//3)*3; k=row%3
   folder=root/version/'out'; meta=json.loads((folder/('v14-poses-%d.json'%group)).read_text()); x0,y0,w,h=meta['tiles'][k]['imageRect']
   frame=Image.open(folder/('v14-poses-%d.png'%group)).convert('RGBA').crop((x0,y0,x0+w,y0+h)).resize((580,650),Image.Resampling.LANCZOS)
   im=Image.new('RGBA',(680,650)); im.alpha_composite(frame,(100,0))
  piece=im.crop(box).resize(tile,Image.Resampling.LANCZOS); bg=Image.new('RGBA',tile,'white'); bg.alpha_composite(piece)
  sheet.paste(bg.convert('RGB'),(col*tile[0],y+54)); d.text((col*tile[0]+10,y+27),version,fill='black',font=font)
sheet.save(out/'kohako-v14-compare-hair.png',optimize=True)
# Separate transparent renders: effective alpha of back after all foreground layers.
results={}; overlays=[]
for version in ['v13','v14','v14b']:
 results[version]={}
 for label in ['default','xminus20','xplus20','xminus30','xplus30','backminus','backplus']:
  folder=root/version/'out'; back=np.asarray(Image.open(folder/('exposure-%s-back.png'%label)).convert('RGBA')); front=np.asarray(Image.open(folder/('exposure-%s-front.png'%label)).convert('RGBA'))
  if back.shape != (650,680,4) or front.shape != back.shape: raise ValueError((version,label,back.shape,front.shape))
  effective=back[:,:,3].astype(float)/255*(1-front[:,:,3].astype(float)/255); mask=effective>0.05
  ys,xs=np.where(mask); valid=mask & (np.asarray(ref)[:,:,3]>240) & (np.asarray(ref)[:,:,:3].max(axis=2)<155)
  diff=np.abs(back[:,:,:3].astype(float)-np.asarray(ref)[:,:,:3].astype(float));
  results[version][label]={'pixels_gt_5pct':int(mask.sum()),'bbox_xyxy': [int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)] if len(xs) else None,'reference_dark_samples':int(valid.sum()),'mean_abs_rgb_difference_vs_static_reference':round(float(diff[valid].mean()),2) if valid.any() else None}
  if version=='v13':
   comp=Image.alpha_composite(Image.fromarray(back),Image.fromarray(front)); a=np.array(comp); a[mask,:3]=(a[mask,:3].astype(float)*.35+np.array([255,0,255])*.65).astype('uint8'); a[mask,3]=255
   canvas=Image.new('RGBA',(680,650),'white'); canvas.alpha_composite(Image.fromarray(a)); overlays.append((label,canvas.crop(box).resize((860,940),Image.Resampling.LANCZOS).convert('RGB')))
img=Image.new('RGB',(860*4,990*2),'white'); d=ImageDraw.Draw(img)
for i,(name,im) in enumerate(overlays):
 x=(i%4)*860; y=(i//4)*990; d.text((x+8,y+10),name+' magenta: visible back >5%',fill='black',font=font); img.paste(im,(x,y+40))
img.save(out/'kohako-v14-exposure-mask.png',optimize=True)
(out/'exposure-statistics.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
# Three sampled poses repeated in sequence; this is not a physics simulation.
folder=root/'v14'/'out'; meta=json.loads((folder/'v14-poses-0.json').read_text()); source=Image.open(folder/'v14-poses-0.png').convert('RGBA'); frames=[]
for i in [1,0,2,0]:
 x,y,w,h=meta['tiles'][i]['imageRect']; frame=source.crop((x,y,x+w,y+h)).resize((580,650),Image.Resampling.LANCZOS)
 canvas=Image.new('RGBA',(680,650),'white'); canvas.alpha_composite(frame,(100,0)); frames.append(canvas.crop(box).convert('RGB').quantize(colors=256))
frames[0].save(out/'kohako-v14-shake.gif',save_all=True,append_images=frames[1:],duration=350,loop=0,disposal=2)
