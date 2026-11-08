import { chromium } from 'playwright'; import fs from 'node:fs';
const H='http://kohako-studio.kohako-studio.svc.cluster.local'; const token=fs.readFileSync(process.env.TOKEN_FILE,'utf8').trim();
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']}); const ctx=await b.newContext({viewport:{width:1100,height:820}});
await ctx.route(u=>u.pathname.startsWith('/kohako/api/'), r=>r.continue({headers:{...r.request().headers(), authorization:'Bearer '+token}}));
const p=await ctx.newPage(); const log=[]; p.on('response', r=>{ if(r.url().includes('/kohako/api/')) log.push([Date.now(), r.request().method(), r.url().split('/kohako/')[1], r.status()]) }); p.on('console', m=>{ if(m.type()==='error') log.push(['console', m.text()]) });
await p.goto(H+'/kohako/studio.html?model=kohako-v25',{waitUntil:'load'}); await p.waitForTimeout(5000);
const info=async()=>p.evaluate(()=>({conn:document.getElementById('connection').textContent, state:document.getElementById('state').textContent, err:document.getElementById('error').textContent, features:document.getElementById('features').textContent, sendDisabled:document.getElementById('send').disabled}));
console.log(JSON.stringify(await info()));
await p.fill('#message','こんにちは'); await p.click('#send'); 
for(let i=0;i<20;i++){ await p.waitForTimeout(3000); console.log(i*3, JSON.stringify(await info())); }
console.log(JSON.stringify(log.slice(0,40))); await b.close();
