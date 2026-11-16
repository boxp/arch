from PIL import Image,ImageDraw
import cv2,numpy as np
from pathlib import Path
import os
p=Path(os.environ['WORK']); old=Path(os.environ['BASELINE']); out=p/'sheets'; out.mkdir(exist_ok=True)
poses=['rest','idle4','idle10','xminus','xplus','zminus','zplus','bodyminus','bodyplus']
for kind in ['eye','mouth']:
 sheet=Image.new('RGB',(1680,840),'white');draw=ImageDraw.Draw(sheet)
 for i in range(21):
  im=Image.open(p/'states'/f'{kind}-{i:02}.jpg').crop((290,90,550,390)).resize((240,255),Image.Resampling.LANCZOS);x=i%7*240;y=i//7*280;sheet.paste(im,(x,y+25));draw.text((x+8,y+5),f'{1-i/20:.2f}' if kind=='eye' else f'{i/20:.2f}',fill='black')
 sheet.save(out/f'{kind}.jpg',quality=87,optimize=True)
sheet=Image.new('RGB',(1440,930),'white');draw=ImageDraw.Draw(sheet)
for i,name in enumerate(poses):
 for j,folder in enumerate([old/'e',p/'g']):
  im=Image.open(folder/f'{name}-magenta.png').crop((250,60,590,460)).resize((240,280),Image.Resampling.LANCZOS);x=(i%3*2+j)*240;y=i//3*310;sheet.paste(im,(x,y+30));draw.text((x+5,y+5),f'{name} v11'+('e' if j==0 else 'g'),fill='black')
sheet.save(out/'poses.jpg',quality=87,optimize=True)
sheet=Image.new('RGB',(800,1740),'white');draw=ImageDraw.Draw(sheet)
for i,name in enumerate(['xminus','xplus','zminus','zplus']):
 for j,folder in enumerate([old/'e',p/'g']):
  im=Image.open(folder/f'{name}-magenta.png').crop((325,170,515,365)).resize((400,410),Image.Resampling.LANCZOS);x=j*400;y=i*435;sheet.paste(im,(x,y+25));draw.text((x+5,y+5),name+' v11'+('e' if j==0 else 'g'),fill='black')
sheet.save(out/'cheeks.jpg',quality=87,optimize=True)
source=Image.open(old/'original-full.jpg').convert('RGB'); images=[source]+[Image.open(folder/'rest-magenta.png').convert('RGB') for folder in [old/'j',old/'e',p/'g']]
# Find iris pixels in the rest view, then register the midpoint and distance.
def iris(im,original=False):
 a=cv2.cvtColor(np.array(im),cv2.COLOR_RGB2BGR); hsv=cv2.cvtColor(a,cv2.COLOR_BGR2HSV); m=((hsv[:,:,0]>95)&(hsv[:,:,0]<125)&(hsv[:,:,1]>70)&(hsv[:,:,2]>90)).astype('uint8'); allowed=np.zeros_like(m);allowed[250:560,520:1020]=1 if original else 0
 if not original: allowed[180:330,325:515]=1
 m*=allowed;m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((3,3),np.uint8));n,l,st,c=cv2.connectedComponentsWithStats(m);ids=sorted(range(1,n),key=lambda i:-st[i,4])[:2];assert len(ids)==2
 return sorted([c[i] for i in ids],key=lambda q:q[0])
faces=[]; pts=[]
for i,im in enumerate(images):
 a,b=iris(im,i==0); scale=200/(b[0]-a[0]); mx=(a[0]+b[0])/2; my=(a[1]+b[1])/2;mat=np.array([[scale,0,200-scale*mx],[0,scale,155-scale*my]],np.float32); face=cv2.warpAffine(np.array(im),mat,(400,410),flags=cv2.INTER_LANCZOS4,borderValue=(255,255,255));faces.append(Image.fromarray(face));pts.append((a,b));print('iris',i,a,b)
for grid in [False,True]:
 sheet=Image.new('RGB',(1600,1000),'white'); draw=ImageDraw.Draw(sheet)
 for i,face in enumerate(faces):
  sheet.paste(face,(400*i,30)); draw.text((400*i+8,8),['original v0','v10k Chromium','v11e Chromium','v11g Chromium'][i],fill='black')
  if grid:
   dr=ImageDraw.Draw(sheet); x=400*i
   for xx in [100,200,300]:dr.line((x+xx,30,x+xx,440),fill=(0,210,90),width=1)
   dr.line((x,185,x+400,185),fill=(0,210,90),width=1)
   for xx in [100,300]:dr.ellipse((x+xx-4,181,x+xx+4,189),outline=(0,210,90),width=2)
 if not grid:
  im=source.crop((240,60,1300,1450)).resize((400,525),Image.Resampling.LANCZOS);sheet.paste(im,(0,470))
  for j,im in enumerate(images[1:],1):sheet.paste(im.resize((400,525),Image.Resampling.LANCZOS),(j*400,470))
 sheet.save(out/('grid.jpg' if grid else 'static.jpg'),quality=88,optimize=True)
for name in poses:
 a=np.asarray(Image.open(old/'e'/f'{name}-magenta.png').convert('RGB'))[60:400,280:560];b=np.asarray(Image.open(p/'g'/f'{name}-magenta.png').convert('RGB'))[60:400,280:560];mag=lambda x:(x[:,:,0]>245)&(x[:,:,1]<10)&(x[:,:,2]>245);print(name,int(np.count_nonzero(mag(b)&~mag(a))))
