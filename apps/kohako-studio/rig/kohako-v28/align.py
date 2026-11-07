import cv2,numpy as np
from PIL import Image,ImageDraw
from pathlib import Path
p=Path('/home/boxp/b441work/work/v28'); ref=np.array(Image.open('/home/boxp/b441work/work/kohako/bust-smile.png').convert('RGB')); src=np.array(Image.open('/home/boxp/Documents/obsidian-headless/BOXP/Projects/kohako-openamika-ui/live2d/gen/codex-shoulder-underlay-v28-1.png').convert('RGB').resize((680,650)))
a=cv2.cvtColor(ref,cv2.COLOR_RGB2GRAY);b=cv2.cvtColor(src,cv2.COLOR_RGB2GRAY); mask=np.zeros(a.shape,np.uint8); mask[20:650,10:670]=255; mask[180:560,140:640]=0; mask[140:340,300:520]=0
warp=np.eye(2,3,dtype=np.float32)
try:
 score,warp=cv2.findTransformECC(a,b,warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,500,1e-7),mask,5); print('ECC',score,warp.tolist())
 aligned=cv2.warpAffine(src,warp,(680,650),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_CONSTANT,borderValue=(255,255,255))
except cv2.error as e:
 print('ECC failed',e);aligned=src
Image.fromarray(aligned).save(p/'aligned.png')
out=Image.new('RGB',(1360,690),'white');out.paste(Image.fromarray(ref),(0,40));out.paste(Image.fromarray(aligned),(680,40));d=ImageDraw.Draw(out);d.text((10,10),'Original',fill='black');d.text((690,10),'Generated aligned',fill='black');out.save(p/'underlay-comparison.jpg',quality=90)
