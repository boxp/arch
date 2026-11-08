import { chromium } from 'playwright'; import fs from 'node:fs'; import Jimp from 'jimp';
const H='http://kohako-studio.kohako-studio.svc.cluster.local'; const model=process.argv[2]||'kohako-v30'; const out=process.argv[3]||'hr';
fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const ctx=await b.newContext({viewport:{width:900,height:1200},deviceScaleFactor:2});
if (process.env.OVERRIDE_P2LRT){const body=fs.readFileSync(process.env.OVERRIDE_P2LRT); await ctx.route(u=>u.pathname.endsWith('/'+model+'.p2lrt'),r=>r.fulfill({status:200,contentType:'application/octet-stream',body}));}
const p=await ctx.newPage(); await p.goto(H+'/kohako/live2d.html?model='+model,{waitUntil:'load'});
await p.waitForFunction(()=>window.__rigPreview?.player,null,{timeout:20000}); await p.waitForTimeout(1500);
const X=+(process.env.X??14.4), Y=+(process.env.Y??6.8);
const ids=await p.evaluate(([X,Y])=>{const pr=window.__rigPreview.player; pr.play(null); pr.expression(null); pr.lookAt(0,0); pr.behaviors(0);
 for(const r of pr.parameterRanges()) pr.setParameter(r.id,r.default); pr.setParameter('ParamAngleX',X); pr.setParameter('ParamAngleY',Y);
 window.__skip=new Set(); window.__only=null; const orig=pr.drawCommand.bind(pr);
 pr.drawCommand=(m,t)=>{ if(window.__skip.has(m)) return; if(window.__only!==null && window.__only!==m) return; return orig(m,t) }; return pr.meshIds },[X,Y]);
fs.writeFileSync(out+'/ids.json',JSON.stringify(ids));
const canvas=await p.$('canvas'); const box=await canvas.boundingBox();
const shot=async(name)=>{ await p.waitForTimeout(400); await canvas.screenshot({path:out+'/'+name+'.png'}) };
await shot('all');
const want=(process.env.MESHES||'').split(',').filter(Boolean);
for(const id of (want.length?want:ids)){ const i=ids.indexOf(id); if(i<0) continue;
  await p.evaluate(i=>{window.__skip=new Set([i]); window.__only=null},i); await shot('without-'+id);
  await p.evaluate(i=>{window.__skip=new Set(); window.__only=i},i); await shot('only-'+id); }
await p.evaluate(()=>{window.__skip=new Set(); window.__only=null});
// wireframe of each mesh
const wf=await p.evaluate(()=>{const pr=window.__rigPreview.player; const T=pr.transform; const c=pr.canvas; const res={};
 pr.meshIds.forEach((id,m)=>{ const v=pr.meshVertices(m); const idx=pr.meshes[m].indices; const pts=[]; for(let k=0;k<v.length;k+=2){ const nx=v[k]*T[0]+T[2], ny=v[k+1]*T[1]+T[3]; pts.push([(nx+1)/2*c.width,(1-ny)/2*c.height]) } res[id]={pts,idx:Array.from(idx)} }); return {res,w:c.width,h:c.height}});
fs.writeFileSync(out+'/wire.json',JSON.stringify(wf)); console.log('ok',box,ids.length); await b.close();
