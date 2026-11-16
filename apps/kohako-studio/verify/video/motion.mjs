// BOXP-441 TD-26: 顔・前髪・衣装・後ろ髪(縦6帯)の変形後頂点の平均変位を測る。usage: node motion.mjs <model> <out.json> static|nat|idle（OVERRIDE_P2LRT 可）
import { chromium } from 'playwright'; import fs from 'node:fs';
const H=process.env.H||'http://kohako-studio.kohako-studio.svc.cluster.local'; const model=process.argv[2]||'kohako-v35'; const out=process.argv[3]||'m.json'; const mode=process.argv[4]||'static';
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const ctx=await b.newContext({viewport:{width:900,height:1200}});
if (process.env.OVERRIDE_P2LRT){const body=fs.readFileSync(process.env.OVERRIDE_P2LRT); await ctx.route(u=>u.pathname.endsWith('/'+model+'.p2lrt'),r=>r.fulfill({status:200,contentType:'application/octet-stream',body}));}
const p=await ctx.newPage(); await p.goto(H+'/kohako/live2d.html?model='+model,{waitUntil:'load'});
await p.waitForFunction(()=>window.__rigPreview?.player,null,{timeout:20000}); await p.waitForTimeout(800);
await p.evaluate(()=>{ const pr=window.__rigPreview.player;
 const ids=pr.meshIds; const fi=ids.indexOf('ArtMeshFace'), hi=ids.indexOf('ArtMeshBackHair'), ti=ids.indexOf('ArtMeshTopwear'), fh=ids.indexOf('ArtMeshFrontHair');
 const rest=(m)=>pr.meshVertices(m).slice();
 // 現在値で rest を取るため、既定値にしてから更新
 window.__P=['ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamBodyAngleZ','ParamHairBack','ParamHairFront','ParamBreath'].map(id=>pr.parameters.indexOf(id));
 window.__setup=()=>{ window.__R={face:rest(fi),hair:rest(hi),top:rest(ti),fh:rest(fh)};
   const hy=window.__R.hair; let mn=1e9,mx=-1e9; for(let k=1;k<hy.length;k+=2){mn=Math.min(mn,hy[k]);mx=Math.max(mx,hy[k])}
   window.__band=(y)=>Math.min(5,Math.floor((y-mn)/(mx-mn+1e-6)*6)); window.__hr=[mn,mx]; };
 window.__meas=()=>{ const R=window.__R; const mean=(m,r)=>{const v=pr.meshVertices(m);let dx=0,dy=0,n=0;for(let k=0;k<v.length;k+=2){dx+=v[k]-r[k];dy+=v[k+1]-r[k+1];n++}return [+(dx/n).toFixed(2),+(dy/n).toFixed(2)]};
   const v=pr.meshVertices(hi); const s=[...Array(6)].map(()=>[0,0,0]); for(let k=0;k<v.length;k+=2){const bb=window.__band(R.hair[k+1]); s[bb][0]+=v[k]-R.hair[k]; s[bb][1]+=v[k+1]-R.hair[k+1]; s[bb][2]++}
   const pv=pr.parameterValues();
   return {p:window.__P.map(i=>+pv[i].toFixed(3)), face:mean(fi,R.face), fh:mean(fh,R.fh), top:mean(ti,R.top), hair:s.map(a=>[+(a[0]/a[2]).toFixed(2),+(a[1]/a[2]).toFixed(2)])} };
});
let res={};
if(mode==='static'){
 const cases=[['rest',{}],['AX+20',{ParamAngleX:20}],['AX-20',{ParamAngleX:-20}],['AY+20',{ParamAngleY:20}],['AY-20',{ParamAngleY:-20}],['AZ+10',{ParamAngleZ:10}],['AZ-10',{ParamAngleZ:-10}],['BX+10',{ParamBodyAngleX:10}],['BZ+10',{ParamBodyAngleZ:10}],['HB+1',{ParamHairBack:1}],['HB-1',{ParamHairBack:-1}],['AX+20AY+10',{ParamAngleX:20,ParamAngleY:10}]];
 await p.evaluate(()=>{const pr=window.__rigPreview.player; pr.stop(); pr.lipSync=()=>{}; pr.play(null); pr.expression(null); pr.lookAt(0,0); pr.behaviors(0); for(const r of pr.parameterRanges()) pr.setParameter(r.id,r.default); pr.resetSimulation(); for(let i=0;i<240;i++) pr.update(1/60); window.__setup();});
 res.hairRange=await p.evaluate(()=>window.__hr);
 for(const [n,ps] of cases){
  // 物理なし相当: reset直後1step / 物理定常: 3秒
  res[n]=await p.evaluate(ps=>{const pr=window.__rigPreview.player; for(const r of pr.parameterRanges()) pr.setParameter(r.id,r.default); for(const [k,v] of Object.entries(ps)) pr.setParameter(k,v); pr.resetSimulation(); pr.update(1/60); const a=window.__meas(); for(let i=0;i<180;i++) pr.update(1/60); const s=window.__meas(); return {step1:a,settled:s}},ps);
 }
} else {
 // 時系列: ページ通常の behaviors 有効のまま、状態を切り替えて各描画frameを記録
 await p.evaluate(()=>{const pr=window.__rigPreview.player; window.__setup(); window.__ts=[]; const d=pr.draw.bind(pr); const T=performance.now(); pr.draw=()=>{d(); window.__ts.push([+(performance.now()-T).toFixed(0), window.__meas()])}});
 const ap=async(s,ms)=>{await p.evaluate(s=>{window.__ts.push(['ev',s]); window.__rigPreview.apply(s)},s); await p.waitForTimeout(ms)};
 if(mode==='nat'){ await ap('idle',4000); await ap('thinking',6000); await ap('speaking',4000); await ap('failed',4000); await ap('idle',3000); }
 else if(mode==='idle'){ await ap('idle',10000); }
 res.ts=await p.evaluate(()=>window.__ts); res.hairRange=await p.evaluate(()=>window.__hr);
}
res.P=['AX','AY','AZ','BX','BZ','HB','HF','Br'];
fs.writeFileSync(out,JSON.stringify(res)); await b.close(); console.log('ok');
