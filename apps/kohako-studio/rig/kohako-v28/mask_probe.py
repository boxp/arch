"""Recreate the *rejected*, intentionally approximate v28 probe mask.

This dark-pixel threshold includes parts of the costume and misses bright hair.
Do not use this mask as a completed separation.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw

original = np.asarray(Image.open(sys.argv[1]).convert('RGB'))
if original.shape != (650, 680, 3):
    raise ValueError('expected 680 x 650 bust image')
region = Image.new('L', (680, 650))
draw = ImageDraw.Draw(region)
draw.polygon([(245,215),(320,230),(354,334),(340,440),(340,550),(275,550),(250,420),(155,525),(148,490),(215,340)], fill=255)
draw.polygon([(480,230),(553,210),(565,330),(635,450),(665,590),(620,580),(580,450),(525,550),(470,550),(470,330)], fill=255)
mask = (np.asarray(region) > 0) & (original.max(axis=2) < 160) & (original[:,:,2] >= original[:,:,0] * .8)
Image.fromarray((mask * 255).astype('uint8')).save(sys.argv[2])
print('selected pixels:', int(mask.sum()))
