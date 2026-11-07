import Jimp from 'jimp'; import fs from 'node:fs';
const [dir,base,mesh,outn]=process.argv.slice(2); const wf=JSON.parse(fs.readFileSync(dir+'/wire.json'));
const im=await Jimp.read(dir+'/'+base+'.png'); const sx=im.bitmap.width/wf.w, sy=im.bitmap.height/wf.h;
const {pts,idx}=wf.res[mesh]; const col=0xff0000ff;
const line=(a,b)=>{let [x0,y0]=[a[0]*sx,a[1]*sy],[x1,y1]=[b[0]*sx,b[1]*sy]; const n=Math.ceil(Math.max(Math.abs(x1-x0),Math.abs(y1-y0))); for(let i=0;i<=n;i++){const x=Math.round(x0+(x1-x0)*i/n), y=Math.round(y0+(y1-y0)*i/n); if(x>=0&&y>=0&&x<im.bitmap.width&&y<im.bitmap.height) im.setPixelColor(col,x,y)}};
for(let k=0;k<idx.length;k+=3){ const a=pts[idx[k]],b=pts[idx[k+1]],c=pts[idx[k+2]]; line(a,b);line(b,c);line(c,a) }
await im.writeAsync(dir+'/'+outn+'.png'); console.log('wire',pts.length,idx.length/3);
