import cv2,numpy as np,json
from PIL import Image
from pathlib import Path
p=Path('/home/boxp/b441work/td46')
src=cv2.imread('/home/boxp/Documents/obsidian-headless/BOXP/Projects/kohako-openamika-ui/live2d/gen/gemini-eyes-half-v46-1.jpg');ref=cv2.imread('/home/boxp/b441work/td43/refs/4-v38-eyes.png')
cv2.imwrite(str(p/'gemini.png'),src)
a=cv2.cvtColor(src,cv2.COLOR_BGR2GRAY);b=cv2.cvtColor(ref,cv2.COLOR_BGR2GRAY)
for name,det in [('SIFT',cv2.SIFT_create()),('ORB',cv2.ORB_create(nfeatures=4000))]:
 k1,d1=det.detectAndCompute(a,None);k2,d2=det.detectAndCompute(b,None)
 matcher=cv2.BFMatcher(cv2.NORM_L2 if name=='SIFT' else cv2.NORM_HAMMING)
 pairs=matcher.knnMatch(d1,d2,k=2);good=[x for x,y in pairs if x.distance<.8*y.distance]
 if len(good)<3: print(name,len(good));continue
 x=np.float32([k1[m.queryIdx].pt for m in good]);y=np.float32([k2[m.trainIdx].pt for m in good]);M,inl=cv2.estimateAffinePartial2D(x,y,method=cv2.RANSAC,ransacReprojThreshold=5)
 print(name,len(good),int(inl.sum()) if inl is not None else None,M)
 if M is not None: cv2.imwrite(str(p/f'{name}.jpg'),cv2.warpAffine(src,M,(536,279)))
# RANSAC SIFT initialization, ECC over static hair/skin (eye shape differs intentionally)
det=cv2.SIFT_create();k1,d1=det.detectAndCompute(a,None);k2,d2=det.detectAndCompute(b,None);matches=cv2.BFMatcher().knnMatch(d1,d2,k=2);good=[x for x,y in matches if x.distance<.8*y.distance]; x=np.float32([k1[m.queryIdx].pt for m in good]);y=np.float32([k2[m.trainIdx].pt for m in good]);M,inl=cv2.estimateAffinePartial2D(x,y,method=cv2.RANSAC,ransacReprojThreshold=5)
base=cv2.warpAffine(src,M,(536,279),borderMode=cv2.BORDER_REFLECT); bg=cv2.cvtColor(base,cv2.COLOR_BGR2GRAY)
mask=np.zeros((279,536),np.uint8);mask[:80]=255;mask[200:]=255;mask[80:200,220:300]=255
w=np.eye(2,3,dtype=np.float32)
try: score,w=cv2.findTransformECC(b,bg,w,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,300,1e-6),mask,5)
except cv2.error as e: print('ECC failed',e);score=None
aligned=cv2.warpAffine(base,w,(536,279),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
cv2.imwrite(str(p/'aligned.png'),aligned);cv2.imwrite(str(p/'overlay.jpg'),cv2.addWeighted(ref,.5,aligned,.5,0))
print('ECC',score,w.tolist());print('RANSAC inlier error mean',float(np.mean(np.linalg.norm(cv2.transform(x[inl[:,0]!=0][None,:,:],M)[0]-y[inl[:,0]!=0],axis=1))))
(p/'alignment.json').write_text(json.dumps({'sift_matches':len(good),'inliers':int(inl.sum()),'matrix':M.tolist(),'ecc':score,'ecc_warp':w.tolist()},indent=2))
