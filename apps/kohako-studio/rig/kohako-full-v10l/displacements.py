import json
from pathlib import Path
P=Path('/work')
poses=['xminus','xplus','zminus','zminus5','zplus5','zplus','bodyminus','bodyplus','yminus','yplus','bodyzminus','bodyzplus']
meshes=['ArtMeshFace','ArtMeshLayerL','ArtMeshLayerR','ArtMeshTopwear']
for version,sub in [('v10j','j/'),('v10k','k/')]:
 rest=json.loads((P/sub/'rest-geom.json').read_text()); refs={m['id']:m for m in rest['meshes']}; T=rest['transform']
 def xy(v,i): return ((v[2*i]*T[0]+T[2]+1)*419,(1-(v[2*i+1]*T[1]+T[3]))*555)
 anchors={}
 for name in meshes:
  v=refs[name]['v']; coords=[xy(v,i) for i in range(len(v)//2)]; xs=[x for x,y in coords]; ys=[y for x,y in coords]
  fractions=[.15,.85] if 'Layer' in name else [.5]
  for f in fractions:
   target=((min(xs)+max(xs))/2,min(ys)+(max(ys)-min(ys))*f); i=min(range(len(coords)),key=lambda i:(coords[i][0]-target[0])**2+(coords[i][1]-target[1])**2)
   anchors[name+(' upper' if f==.15 else ' lower' if f==.85 else '')]=(name,i,coords[i])
 print(version,'anchors', {k:[i,round(x,1),round(y,1)] for k,(n,i,(x,y)) in anchors.items()})
 for pose in poses:
  geom=json.loads((P/sub/(pose+'-geom.json')).read_text()); ms={m['id']:m for m in geom['meshes']}; row={}
  for key,(name,i,(x,y)) in anchors.items():
   xx,yy=xy(ms[name]['v'],i); row[key]=[round(xx-x,1),round(yy-y,1)]
  print(pose,row)
