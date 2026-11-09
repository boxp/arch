from PIL import Image
import numpy as np
from pathlib import Path
import sys
p=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/work')
for name in ['rest','idle4','idle10','xminus','xplus','zminus','zplus','bodyminus','bodyplus']:
 a=np.asarray(Image.open(p/'k'/f'{name}-magenta.png').convert('RGB'))[60:400,280:560]
 b=np.asarray(Image.open(p/'e'/f'{name}-magenta.png').convert('RGB'))[60:400,280:560]
 def magenta(x):return (x[:,:,0]>245)&(x[:,:,1]<10)&(x[:,:,2]>245)
 print(name,int(np.count_nonzero(magenta(b)&~magenta(a))))
