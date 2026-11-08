#!/usr/bin/env python3
"""Fill back hair only beneath eroded, fully opaque braid pixels, on a copied layout."""
import json, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion, distance_transform_edt
src,dst=map(Path,sys.argv[1:3]);shutil.copytree(src,dst,dirs_exist_ok=True)
layout=json.loads((dst/'layout.json').read_text()); layers={x['id']:x for x in layout['layers']}
b=layers['back_hair']; rect=b['rect']; path=dst/b['image']['path']; back=np.array(Image.open(path).convert('RGBA')); original=back.copy(); nearest=distance_transform_edt(original[:,:,3]<248,return_distances=False,return_indices=True)
mask=np.zeros(back.shape[:2],dtype=bool)
for side in ['left','right']:
 layer=layers['braid_'+side]; r=layer['rect']; braid=np.array(Image.open(dst/layer['image']['path']).convert('RGBA'))
 opaque=binary_erosion(braid[:,:,3]==255,iterations=3)
 for y in range(opaque.shape[0]):
  canvas_y=r['top']+y
  if not 340<=canvas_y<=450: continue
  by=canvas_y-rect['top']; x0=r['left']-rect['left']; mask[by,x0:x0+opaque.shape[1]] |= opaque[y]
mask &= original[:,:,3] < 8
back[mask,:3]=original[nearest[0][mask],nearest[1][mask],:3];back[mask,3]=255
Image.fromarray(back).save(path)
print('filled pixels',int(mask.sum()))
