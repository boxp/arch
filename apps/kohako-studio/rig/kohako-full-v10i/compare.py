import json
from pathlib import Path
P=Path('/home/boxp/b441work/full10i'); obj=json.load(open(P/'probe-workspace_inspect.json'))['items']; parents={x['target'].split(':')[-1]:bytes.fromhex(x['parentId'].split(':')[-1]).decode(errors='replace') if x.get('parentId','').startswith('modifier:m1:') else x.get('parentId') for x in obj if x.get('target','').startswith('mesh:')}; overview=json.load(open(P/'probe-workspace_overview.json')); decode=lambda s: bytes.fromhex(s.split(':')[-1]).decode() if s and 'modifier:m1:' in s else s; hierarchy={decode(d['target']):decode(d['parent']) for d in overview['deformers']['items']};
def following(parent):
 chain=[]
 while parent and parent not in chain:
  chain.append(parent);parent=hierarchy.get(parent)
 return 'head' if any('DeformHeadContainer' in (x or '') for x in chain) else ('body' if any('DeformBodyZBreath' in (x or '') for x in chain) else 'other')
baseline=json.load(open(P/'rest-geom.json'));refs={m['id']:m for m in baseline['meshes']};results={};docs={}
for version,sub in [('v10h',''),('v10i','i/')]:
 data=json.load(open(P/sub/'lines.json')); allposes={}
 for pose,cs in data['poses'].items():
  geom=json.load(open(P/sub/f'{pose}-geom.json'));T=geom['transform'];
  for c in cs:
   c['mean_width']=round(c['area']/c['length'],2);c['parents']={n:parents.get(n) for n in set(c['left'])|set(c['right'])};c['displacement_from_rest_device_px']={};center=((c['bbox'][0]+c['bbox'][2])/2,(c['bbox'][1]+c['bbox'][3])/2)
   for m in geom['meshes']:
    if m['id'] not in c['parents']:continue
    v=m['v'];rv=refs[m['id']]['v'];i=min(range(len(v)//2),key=lambda i:((v[2*i]*T[0]+T[2]+1)*419-center[0])**2+((1-(v[2*i+1]*T[1]+T[3]))*555-center[1])**2);c['displacement_from_rest_device_px'][m['id']]=[round((v[2*i]-rv[2*i])*T[0]*419,2),round(-(v[2*i+1]-rv[2*i+1])*T[1]*555,2)]
   c['following']={name:following(parent) for name,parent in c['parents'].items()};c['relative_displacement_device_px']={}
   for left in c['left']:
    for right in c['right']:
     if left != right and left in c['displacement_from_rest_device_px'] and right in c['displacement_from_rest_device_px']:
      a=c['displacement_from_rest_device_px'][left];b=c['displacement_from_rest_device_px'][right];c['relative_displacement_device_px'][left+' - '+right]=[round(a[0]-b[0],2),round(a[1]-b[1],2)]
   for px in c['pixels']:
    for hit in px['meshes']:hit['parent']=parents.get(hit['mesh'])
  def stats(rows):return {'components':len(rows),'area':sum(c['area'] for c in rows),'component_class_counts':{k:sum(c['class']==k for c in rows) for k in ['G','T','F','other']},'pixel_class_counts':{k:sum(c['classes'][k] for c in rows) for k in ['G','T','F','other']}}
  allposes[pose]={'full_roi':stats(cs),'upper_y_below_200_css':stats([c for c in cs if c['bbox'][1]<400])}
 data['parents']=parents;data['note']='component widths include bounding-box width and area/length estimate; left/right probes are +/-4 device pixels; nearest vertex displacement is relative to v10h rest and is not a rigid transform.'
 json.dump(data,open(P/sub/'lines.json','w'),ensure_ascii=False,separators=(',',':'));docs[version]=data;results[version]=allposes
out={'units':'837x1110 internal canvas, device pixels','criterion':'two-background transmittance >=223/255; 8-connected components of interior background or horizontal runs <=8 device px, x=192..641 y=48..519','versions':results}
json.dump(out,open(P/'lines-compare.json','w'),ensure_ascii=False,indent=2)
for p in results['v10h']:
 a=results['v10h'][p]['upper_y_below_200_css'];b=results['v10i'][p]['upper_y_below_200_css']; print(p,a['components'],a['area'],b['components'],b['area'],a['pixel_class_counts'],b['pixel_class_counts'])
