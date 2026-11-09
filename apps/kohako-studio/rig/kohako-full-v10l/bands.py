import json, math
from pathlib import Path
P=Path('/work')
for version in ['j','k']:
 d=P/version
 if not (d/'rest-geom.json').exists(): continue
 rest=json.loads((d/'rest-geom.json').read_text()); T=rest['transform']; R={m['id']:m for m in rest['meshes']}
 def xy(m,i):
  v=m['v'];return ((v[i*2]*T[0]+T[2]+1)*419,(1-(v[i*2+1]*T[1]+T[3]))*555)
 print(version)
 for side,bid,x in [('left','ArtMeshLayerR',300),('right','ArtMeshLayerL',478)]:
  braid=R[bid]; back=R['ArtMeshBackHair']
  for y in range(330,461,20):
   bi=min(range(len(braid['v'])//2), key=lambda i: (xy(braid,i)[0]-x)**2+(xy(braid,i)[1]-y)**2)
   bx,by=xy(braid,bi)
   hi=min(range(len(back['v'])//2), key=lambda i:(xy(back,i)[0]-bx)**2+(xy(back,i)[1]-by)**2)
   hx,hy=xy(back,hi)
   print(side,y,'rest vertices',tuple(round(z,1) for z in (bx,by,hx,hy)),end=' ')
   for pose in ['zminus','zminus5','zplus5','zplus']:
    f=d/(pose+'-geom.json')
    if not f.exists(): continue
    M={m['id']:m for m in json.loads(f.read_text())['meshes']}; xx,yy=xy(M[bid],bi); xx2,yy2=xy(M['ArtMeshBackHair'],hi)
    db=(xx-bx,yy-by); dh=(xx2-hx,yy2-hy)
    print(pose,tuple(round(z,1) for z in (*dh,*db,db[0]-dh[0],db[1]-dh[1])),end='; ')
   print()
