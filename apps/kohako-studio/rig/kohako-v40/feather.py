"""Feather the outside of eye-white artwork, leaving the iris/lash files alone."""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
p=Path('/tmp/boxp441/v6/layout')
for side in ('left','right'):
 path=p/f'eye_{side}_white.png'
 a=np.array(Image.open(path).convert('RGBA'))
 alpha=a[:,:,3].astype(np.float32)
 # Distance from transparent pixels (including the area beyond the image).
 mask=np.pad((alpha>0).astype('uint8'),1)
 distance=cv2.distanceTransform(mask,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)[1:-1,1:-1]
 a[:,:,3]=np.minimum(alpha,np.clip(distance/4,0,1)*255).astype('uint8')
 Image.fromarray(a).save(path)
