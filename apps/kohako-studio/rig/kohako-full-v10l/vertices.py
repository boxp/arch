import json, math
from pathlib import Path
P=Path('/work')
for pose in ['rest','xminus','xplus','zminus','zminus5','zplus5','zplus','bodyminus','bodyplus']:
 a=json.loads((P/'j'/f'{pose}-geom.json').read_text());b=json.loads((P/'k'/f'{pose}-geom.json').read_text());T=a['transform'];A={m['id']:m for m in a['meshes']};B={m['id']:m for m in b['meshes']}
 print(pose)
 for name in sorted(A):
  if not any(x in name.lower() for x in ['face','eye','mouth','fronthair','layerl','layerr']):continue
  if name not in B or len(A[name]['v'])!=len(B[name]['v']):print(name,'incompatible');continue
  v=A[name]['v'];w=B[name]['v'];delta=[math.hypot((v[i]-w[i])*T[0]*419,(v[i+1]-w[i+1])*T[1]*555) for i in range(0,len(v),2)]
  print(name, 'max',round(max(delta,default=0),3))
