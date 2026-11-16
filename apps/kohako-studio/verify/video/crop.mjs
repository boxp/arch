import Jimp from 'jimp'; import fs from 'node:fs';
const [dir,cx,cy,cw,ch,sc,outp,...names]=process.argv.slice(2);
const ims=[]; for(const n of names){ const im=await Jimp.read(dir+'/'+n+'.png'); const W=im.bitmap.width,Hh=im.bitmap.height;
 im.crop(Math.round(W*cx),Math.round(Hh*cy),Math.round(W*cw),Math.round(Hh*ch)).scale(+sc,Jimp.RESIZE_NEAREST_NEIGHBOR); ims.push(im) }
const w=ims[0].bitmap.width,h=ims[0].bitmap.height; const cols=Math.min(ims.length,3); const rows=Math.ceil(ims.length/cols);
const o=new Jimp(w*cols+4*(cols-1),(h+16)*rows,0xffffffff); const f=await Jimp.loadFont(Jimp.FONT_SANS_14_BLACK);
ims.forEach((im,i)=>{const x=(i%cols)*(w+4), y=Math.floor(i/cols)*(h+16); o.composite(im,x,y+16); o.print(f,x,y,names[i])}); await o.writeAsync(outp); console.log(outp,o.bitmap.width,o.bitmap.height);
