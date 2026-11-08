import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
p=Path(sys.argv[1]); out=Path(sys.argv[2]); out.mkdir(exist_ok=True,parents=True)
d=json.loads((p/'layout.json').read_text()); h=d['canvas']['height']; w=d['canvas']['width']; A=np.zeros((h,w),np.uint8); layers={}
skip={'eye_closed_left','eye_closed_right','eye_mid_left_v44','eye_mid_right_v44','mouth_open','face_smile'}
for l in d['layers']:
 if l['id'] in skip: continue
 r=l['rect']; a=np.array(Image.open(p/l['image']['path']).convert('RGBA'))[:,:,3]; z=np.zeros((h,w),np.uint8); z[r['top']:r['top']+a.shape[0],r['left']:r['left']+a.shape[1]]=a; layers[l['id']]=z; np.maximum(A,z,out=A)
lab,n=ndi.label(A<128); border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]]))); result=[]
for i in range(1,n+1):
 if i in border: continue
 m=lab==i; y,x=np.where(m); ring=ndi.binary_dilation(m,iterations=2)&~m
 result.append({'id':i,'area':len(x),'bbox':[int(x.min()),int(y.min()),int(x.max()),int(y.max())], 'adjacent':[k for k,v in layers.items() if np.any((v>=128)&ring)]})
result.sort(key=lambda x:-x['area']); (out/'holes.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)); print('holes',len(result),'area',sum(x['area'] for x in result)); print(json.dumps(result[:40],ensure_ascii=False))
