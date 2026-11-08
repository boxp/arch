import json, numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
P=Path('/work/j'); poses=['rest','idle4','idle10','xminus','xplus','zminus','zminus5','zplus5','zplus','bodyminus','bodyplus']; atlas=np.array(Image.open(P/'atlas-0.png').convert('RGBA'))[:,:,3]; AH,AW=atlas.shape
objects=json.load(open(P/'objects.json'))['items']; parents={x['target'].split(':')[-1]:bytes.fromhex(x['parentId'].split(':')[-1]).decode(errors='replace') if x.get('parentId','').startswith('modifier:m1:') else x.get('parentId') for x in objects if x.get('target','').startswith('mesh:')}
result={}
for pose in poses:
 a=np.array(Image.open(P/f'{pose}-magenta.png').convert('RGB')).astype(int);b=np.array(Image.open(P/f'{pose}-lime.png').convert('RGB')).astype(int);h,w=a.shape[:2]
 # Background transmittance independently evidenced by all 3 color channels.
 bg=((a[:,:,0]-b[:,:,0]>=223)&(b[:,:,1]-a[:,:,1]>=223)&(a[:,:,2]-b[:,:,2]>=223))
 lab,n=ndimage.label(bg); exterior=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]]))); interior=bg & ~np.isin(lab,list(exterior))
 # Horizontally bounded background runs up to four CSS pixels (8 device pixels).
 narrow=np.zeros_like(bg)
 for y in range(h):
  row=bg[y]; starts=np.flatnonzero(row & ~np.r_[False,row[:-1]]); ends=np.flatnonzero(row & ~np.r_[row[1:],False]);
  for s,e in zip(starts,ends):
   if s>0 and e<w-1 and e-s+1<=8: narrow[y,s:e+1]=1
 mask=interior|narrow; roi=np.zeros_like(mask);roi[48:min(h,520),192:min(w,642)]=True;mask &= roi
 labels,n=ndimage.label(mask,np.ones((3,3))); slices=ndimage.find_objects(labels); components=[]
 for k,sl in enumerate(slices,1):
  if not sl: continue
  yy,xx=np.where(labels[sl]==k); yy+=sl[0].start;xx+=sl[1].start
  if len(xx)<2: continue
  components.append({'id':k,'bbox':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())],'area':len(xx),'length':int(max(xx.max()-xx.min()+1,yy.max()-yy.min()+1)),'width':int(min(xx.max()-xx.min()+1,yy.max()-yy.min()+1)),'coordinates':np.column_stack([xx,yy])})
 geom=json.load(open(P/f'{pose}-geom.json')); T=geom['transform'];
 if not components: result[pose]=[];continue
 pts=np.concatenate([c['coordinates'] for c in components]); # add lateral probes for identifying neighbours
 points=np.concatenate([pts,pts+[-4,0],pts+[4,0]]).astype(float)+.5; hits=[[] for _ in range(len(points))]
 for mesh in geom['meshes']:
  v=np.array(mesh['v']).reshape(-1,2); uv=np.array(mesh['uv']).reshape(-1,2); ind=np.array(mesh['indices']).reshape(-1,3); xy=np.empty_like(v);xy[:,0]=(v[:,0]*T[0]+T[2]+1)*.5*w;xy[:,1]=(1-(v[:,1]*T[1]+T[3]))*.5*h
  # Record all meshes, including invisible, with evaluated opacity explicitly.
  for ids in ind:
   tri=xy[ids]; lo=tri.min(axis=0);hi=tri.max(axis=0); select=np.flatnonzero((points[:,0]>=lo[0])&(points[:,0]<=hi[0])&(points[:,1]>=lo[1])&(points[:,1]<=hi[1]));
   if len(select)==0: continue
   q=points[select]; x1,y1=tri[0];x2,y2=tri[1];x3,y3=tri[2];den=(y2-y3)*(x1-x3)+(x3-x2)*(y1-y3)
   if abs(den)<1e-10:continue
   a1=((y2-y3)*(q[:,0]-x3)+(x3-x2)*(q[:,1]-y3))/den;b1=((y3-y1)*(q[:,0]-x3)+(x1-x3)*(q[:,1]-y3))/den;c1=1-a1-b1; inside=(a1>=-1e-6)&(b1>=-1e-6)&(c1>=-1e-6)
   for idx,aa,bb,cc in zip(select[inside],a1[inside],b1[inside],c1[inside]):
    U=aa*uv[ids[0]]+bb*uv[ids[1]]+cc*uv[ids[2]];x=np.clip(U[0]*AW-.5,0,AW-1);y=np.clip(U[1]*AH-.5,0,AH-1);ix=int(x);iy=int(y);fx=x-ix;fy=y-iy
    val=(atlas[iy,ix]*(1-fx)*(1-fy)+atlas[iy,min(ix+1,AW-1)]*fx*(1-fy)+atlas[min(iy+1,AH-1),ix]*(1-fx)*fy+atlas[min(iy+1,AH-1),min(ix+1,AW-1)]*fx*fy)
    hits[idx].append({'mesh':mesh['id'],'alpha':round(float(val),2),'opacity':round(mesh['opacity'],3),'parent':parents.get(mesh['id'])})
 counts={'G':0,'T':0,'F':0,'other':0};offset=0
 for c in components:
  size=c['area']; pix=[]; hist={'G':0,'T':0,'F':0,'other':0}; left={};right={}
  for j,(x,y) in enumerate(c.pop('coordinates')):
   hs=hits[offset+j]; active=[q for q in hs if q['opacity']>0]; al=[q['alpha'] for q in hs]; typ='G' if not hs else ('T' if not al or max(al)<8 else ('F' if max(al)<248 else 'other'))
   hist[typ]+=1;counts[typ]+=1
   for table,k in [(left,offset+j+len(pts)),(right,offset+j+2*len(pts))]:
    for q in hits[k]:
     if q['opacity']>0 and q['alpha']>=8:table[q['mesh']]=table.get(q['mesh'],0)+1
   pix.append({'x':int(x),'y':int(y),'class':typ,'meshes':hs})
  offset+=size;c['classes']=hist;c['class']=max(hist,key=hist.get);c['left']=left;c['right']=right;c['pixels']=pix
 result[pose]=components;print(pose,'components',len(components),'pixels',sum(x['area'] for x in components),'classes',counts,flush=True)
json.dump({'units':'device pixels, 2 per CSS pixel','criterion':'background transmittance >= 223/255; interior or horizontal run <=8 device pixels','poses':result},open(P/'lines.json','w'),ensure_ascii=False,indent=1)
