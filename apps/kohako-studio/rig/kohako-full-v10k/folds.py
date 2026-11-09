import json
from pathlib import Path
P=Path('/work')
for version in ['j','k']:
 r=json.loads((P/version/'rest-geom.json').read_text()); refs={m['id']:m for m in r['meshes']}
 def area(v,i,j,k):
  x1,y1=v[2*i:2*i+2]; x2,y2=v[2*j:2*j+2];x3,y3=v[2*k:2*k+2];return (x2-x1)*(y3-y1)-(x3-x1)*(y2-y1)
 for pose in ['rest','xminus','xplus','zminus','zminus5','zplus5','zplus','bodyminus','bodyplus']:
  ms={m['id']:m for m in json.loads((P/version/(pose+'-geom.json')).read_text())['meshes']}
  out=[]
  for name in ['ArtMeshLayerL','ArtMeshLayerR']:
   m=ms[name]; ref=refs[name]; ind=m['indices']; rv=ref['v'];v=m['v']; vals=[(area(rv,*ind[i:i+3]),area(v,*ind[i:i+3])) for i in range(0,len(ind),3)];valid=[(a,b) for a,b in vals if abs(a)>1e-10];out.append((name,sum(a*b<0 for a,b in valid),len(valid)))
  print(version,pose,out)
