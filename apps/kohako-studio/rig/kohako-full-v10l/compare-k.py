import json
from pathlib import Path
P=Path('/work'); data={v:json.loads((P/v/'lines.json').read_text()) for v in ['j','k']}
for pose in data['j']['poses']:
 print(pose,end=' ')
 for version in ['j','k']:
  cs=data[version]['poses'][pose]
  def counts(c):return '/'.join(str(sum(x['classes'][k] for x in c)) for k in ['G','T','F'])
  full=counts(cs);upper=counts([x for x in cs if x['bbox'][1]<400])
  print(version,full,upper,end='; ')
 def pixels(version):
  return {(p['x'],p['y']) for c in data[version]['poses'][pose] for p in c['pixels'] if p['class']=='G'}
 new=pixels('k')-pixels('j')
 if new:
  xs=[x for x,y in new];ys=[y for x,y in new];print('new G',len(new),'bbox',min(xs),min(ys),max(xs),max(ys))
 else:print('new G 0')
