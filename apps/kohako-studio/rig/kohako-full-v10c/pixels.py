from PIL import Image,ImageDraw
im=Image.open('/data/layout/body.png').convert('RGBA'); box=(0,0,76,65); a=im.crop(box)
pix=list(a.getdata()); print('left crop opaque-white',sum(p[3]==255 and min(p[:3])>225 for p in pix),'partial-white',sum(0<p[3]<255 and min(p[:3])>225 for p in pix),'transparent',sum(p[3]==0 for p in pix))
checker=Image.new('RGBA',a.size,(120,160,180,255)); checker.alpha_composite(a)
alpha=a.getchannel('A').convert('RGB'); white=Image.new('RGB',a.size,(0,0,0)); white.putdata([(255,255,255) if p[3]==255 and min(p[:3])>225 else (255,0,0) if 0<p[3]<255 and min(p[:3])>225 else (0,0,0) for p in pix]);
out=Image.new('RGB',(76*9,65*3+40),'white'); d=ImageDraw.Draw(out)
for i,(name,img) in enumerate([('RGBA over blue',checker.convert('RGB')),('alpha',alpha),('white opaque=white; partial=red',white)]):
 out.paste(img.resize((228,195),Image.Resampling.NEAREST),(i*228,35)); d.text((i*228+3,5),name,fill='black')
out.save('/body-pixels.png')
