import json
from PIL import Image
d=json.load(open('/home/boxp/b441work/full10e/geometry.json')); sx,sy,ox,oy=d['transform']
layout=json.load(open('/home/boxp/b441work/full10e/rebuild-d/layout/layout.json')); layers={x['id']:x for x in layout['layers']}
for pt in [(284,150),(223,179)]:
 x=((2*(pt[0]+.5)/d['cssWidth']-1)-ox)/sx; y=((1-2*(pt[1]+.5)/d['cssHeight'])-oy)/sy
 print('screen',pt,'deformed canvas',x,y)
 for m in d['meshes']:
  if m['id'] not in ('ArtMeshNeck','ArtMeshBackHair','ArtMeshFace','ArtMeshTopwear'):continue
  found=[]; v=m['v']; idx=m['indices']
  for j in range(0,len(idx),3):
   a,b,c=idx[j:j+3]; ax,ay=v[2*a:2*a+2];bx,by=v[2*b:2*b+2];cx,cy=v[2*c:2*c+2];det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
   if abs(det)<1e-9:continue
   u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/det; w=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/det; z=1-u-w
   if min(u,w,z)>=0:
    rest=m['rest']; rx=sum(q*rest[2*i] for q,i in zip((u,w,z),(a,b,c)));ry=sum(q*rest[2*i+1] for q,i in zip((u,w,z),(a,b,c))); uv=m['uv']; uu=sum(q*uv[2*i] for q,i in zip((u,w,z),(a,b,c)));vv=sum(q*uv[2*i+1] for q,i in zip((u,w,z),(a,b,c))); lid={'ArtMeshNeck':'neck','ArtMeshBackHair':'back_hair','ArtMeshFace':'face','ArtMeshTopwear':'body'}[m['id']]; r=layers[lid]['rect']; px=round(rx-r['left']);py=round(ry-r['top']); im=Image.open('/home/boxp/b441work/full10e/rebuild-d/layout/'+lid+'.png').convert('RGBA'); color=im.getpixel((px,py)) if 0<=px<im.width and 0<=py<im.height else None
    found.append((round(uu,6),round(vv,6),round(rx,2),round(ry,2),px,py,color))
  print(m['id'],found[:4])
