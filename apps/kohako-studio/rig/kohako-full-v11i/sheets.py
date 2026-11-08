"""Build labelled comparison sheets from real Chromium captures."""
from PIL import Image, ImageDraw
import cv2, numpy as np, os
from pathlib import Path
p=Path(os.environ['WORK']); base=Path(os.environ['BASELINE']); out=p/'sheets';out.mkdir(exist_ok=True)
poses=['rest','idle4','idle10','xminus','xplus','zminus','zplus','bodyminus','bodyplus']
for kind in ['eye']:
 sheet=Image.new('RGB',(7*240,6*280),'white');d=ImageDraw.Draw(sheet)
 for ver,folder in enumerate([base/'states',p/'states']):
  for i in range(21):
   im=Image.open(folder/f'{kind}-{i:02}.jpg').crop((290,90,550,390)).resize((240,255),Image.Resampling.LANCZOS);x=i%7*240;y=(ver*3+i//7)*280;sheet.paste(im,(x,y+25));d.text((x+5,y+5),f'v11{["g","i"][ver]} {1-i/20:.2f}',fill='black')
 sheet.save(out/f'{kind}.jpg',quality=86,optimize=True)
vals=[.10,.11,.12,.13,.14,.15,.16,.57,.58,.59,.60,.61,.62,.63]
sheet=Image.new('RGB',(7*240,2*280),'white');d=ImageDraw.Draw(sheet)
for i,v in enumerate(vals):
 im=Image.open(p/'states'/f'fine-{v:.2f}.jpg').crop((290,90,550,390)).resize((240,255),Image.Resampling.LANCZOS);x=i%7*240;y=i//7*280;sheet.paste(im,(x,y+25));d.text((x+5,y+5),f'v11i {v:.2f}',fill='black')
sheet.save(out/'eye-fine.jpg',quality=86,optimize=True)
for kind in ['poses','cheeks']:
 names=poses if kind=='poses' else ['xminus','xplus','zminus','zplus']
 size=(1440,930) if kind=='poses' else (800,1740);sheet=Image.new('RGB',size,'white');d=ImageDraw.Draw(sheet)
 for i,name in enumerate(names):
  for j,folder in enumerate([base/'g',p/'i']):
   im=Image.open(folder/f'{name}-magenta.png')
   if kind=='poses': im=im.crop((250,60,590,460)).resize((240,280));x=(i%3*2+j)*240;y=i//3*310
   else: im=im.crop((325,170,515,365)).resize((400,410));x=j*400;y=i*435
   sheet.paste(im,(x,y+25));d.text((x+5,y+5),f'{name} v11{["g","i"][j]}',fill='black')
 sheet.save(out/f'{kind}.jpg',quality=87,optimize=True)
source=Image.open('/home/boxp/b441work/full11b/original-full.jpg').convert('RGB'); images=[source]+[Image.open(folder/'rest-magenta.png').convert('RGB') for folder in [base/'g',p/'i']]
def iris(im,original):
 a=cv2.cvtColor(np.array(im),cv2.COLOR_RGB2HSV);m=((a[:,:,0]>95)&(a[:,:,0]<125)&(a[:,:,1]>70)&(a[:,:,2]>90)).astype('uint8');allowed=np.zeros_like(m)
 if original: allowed[250:560,520:1020]=1
 else: allowed[180:330,325:515]=1
 m*=allowed;m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((3,3),np.uint8));n,l,st,c=cv2.connectedComponentsWithStats(m); ids=sorted(range(1,n),key=lambda i:-st[i,4])[:2]; assert len(ids)==2
 return sorted([c[i] for i in ids],key=lambda q:q[0])
faces=[]
for i,im in enumerate(images):
 a,b=iris(im,i==0);scale=200/(b[0]-a[0]);mx=(a[0]+b[0])/2;my=(a[1]+b[1])/2;mat=np.array([[scale,0,200-scale*mx],[0,scale,155-scale*my]],np.float32);faces.append(Image.fromarray(cv2.warpAffine(np.array(im),mat,(400,410),flags=cv2.INTER_LANCZOS4,borderValue=(255,255,255))));print('iris render',i,a,b)
for grid in [False,True]:
 sheet=Image.new('RGB',(1200,1000),'white');d=ImageDraw.Draw(sheet)
 for i,face in enumerate(faces):
  sheet.paste(face,(400*i,30));d.text((400*i+8,8),['original v0','v11g Chromium','v11i Chromium'][i],fill='black')
  if grid:
   for xx in [100,200,300]:d.line((400*i+xx,30,400*i+xx,440),fill=(0,210,90))
   d.line((400*i,185,400*i+400,185),fill=(0,210,90))
  else:
   upper=source.crop((240,60,1300,1450)).resize((400,525),Image.Resampling.LANCZOS) if i==0 else images[i].resize((400,525),Image.Resampling.LANCZOS);sheet.paste(upper,(400*i,470))
 sheet.save(out/('grid.jpg' if grid else 'static.jpg'),quality=88,optimize=True)
for name in poses:
 a=np.asarray(Image.open(base/'g'/f'{name}-magenta.png').convert('RGB'))[60:400,280:560];b=np.asarray(Image.open(p/'i'/f'{name}-magenta.png').convert('RGB'))[60:400,280:560];mag=lambda x:(x[:,:,0]>245)&(x[:,:,1]<10)&(x[:,:,2]>245);print(name,int(np.count_nonzero(mag(b)&~mag(a))))
