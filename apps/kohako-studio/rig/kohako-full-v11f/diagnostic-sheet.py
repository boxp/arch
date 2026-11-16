from PIL import Image,ImageDraw
from pathlib import Path
p=Path('/home/boxp/b441work/full11f/diag')
ids=['ArtMeshEyewhiteL','ArtMeshEyewhiteR','ArtMeshIridesL','ArtMeshIridesR','ArtMeshEyelashL','ArtMeshEyelashR','ArtMeshFaceDetail4','ArtMeshFaceDetail5','ArtMeshEyeCloseL','ArtMeshEyeCloseR','ArtMeshFace']
for mode in ['only','omit']:
 out=Image.new('RGB',(1200,12*160),'white');d=ImageDraw.Draw(out)
 for row,name in enumerate(['all']+ids):
  for col,v in enumerate([.85,.75,.65]):
   f=f'{v}-'+('all' if name=='all' else mode+'-'+name)+'.png'; im=Image.open(p/f).convert('RGB').crop((325,210,515,275)).resize((400,137));out.paste(im,(col*400,row*160+23));d.text((col*400+2,row*160+3),f'{v} {mode} {name}',fill='black')
 out.save(f'/home/boxp/b441work/full11f/{mode}.jpg',quality=90)
