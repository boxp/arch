// BOXP-647 P1: ふれあい後の返答保持をモックBFFで確認する。
import { chromium } from 'playwright'
import fs from 'node:fs'
const out=process.argv[2] || '/out', base=process.env.BASE_URL || 'http://127.0.0.1:8847', results={}, failures=[], external=[]
fs.mkdirSync(out, {recursive:true})
const browser=await chromium.launch({...(process.env.CHROMIUM ? {executablePath:process.env.CHROMIUM} : {}),args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']})
await Promise.all([['pc',1440,900],['portrait',412,915],['landscape',915,412]].map(async ([name,width,height])=>{
 const ctx=await browser.newContext({viewport:{width,height},isMobile:name!=='pc',hasTouch:name!=='pc',serviceWorkers:'block'}), page=await ctx.newPage(), checks=results[name]={}, ids=new Map(); let replies=0,touches=0
 const check=(s,v)=>{checks[s]=!!v;if(!v)failures.push(`${name}: ${s}`)}
 page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url())})
 await page.route(url=>url.origin!==new URL(base).origin,r=>r.abort())
 await page.route('**/kohako/api/v1/**',async route=>{const req=route.request(), p=new URL(req.url()).pathname.split('/v1/')[1], json=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(p==='me')return json(200,{authenticated:true}); if(p==='conversation')return json(200,{enabled:true,stt:false}); if(p==='status')return json(200,{schema:'kohako-home-status/v1',quota:{state:'ok',pools:[]},tasks:{state:'ok',inProgress:{total:0,complete:true,byAgent:[],conflicts:[]}}}); if(p==='notifications')return json(200,{items:[],unread:0})
 if(p==='messages'){const body=req.postDataJSON(); const text=body.kind==='touch'?`ふれあい${++touches}`:`返答${++replies}`; ids.set(body.requestId,text); return json(202,{status:'accepted'})} if(p.startsWith('requests/'))return json(200,{status:'done',reply:{text:ids.get(p.split('/')[1])}}); return json(200,{})})
 try {
 await page.goto(`${base}/kohako/home.html?acting=0&face=static&daypart=day`); await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:30000}); await page.locator('#speech').uncheck({force:true})
 const send=async text=>{await page.locator('#message').fill(text);await page.locator('#send').click()}; const touch=async()=>{if (await page.locator('#touch-menu').isHidden()) await page.locator('#touch-open').click();await page.locator('#touch-pat').click()}; const wait=async text=>page.waitForFunction(t=>document.querySelector('#reply').textContent.includes(t),text,{timeout:12000})
 await send('最初'); await wait('返答1'); check('返答保持',await page.locator('#bubble').getAttribute('data-retained')==='1'); await page.waitForFunction(() => !['thinking','speaking','listening'].includes(window.__kohakoHome.state), null, {timeout:20000}); await touch(); await wait('ふれあい1'); check('一時表示は非保持',await page.locator('#bubble').getAttribute('data-retained')===null)
 // 実際の15秒制限のみを時刻で進め、4.5秒の表示期限は実時間で保持する。
 await page.evaluate(()=>{const now=Date.now.bind(Date); Date.now=()=>now()+16000}); await touch(); await wait('ふれあい2'); await wait('返答1'); check('連続ふれあい後に本文と保持を復元',await page.locator('#bubble').getAttribute('data-retained')==='1')
 await page.waitForTimeout(67000); check('relax後も本文を表示',await page.evaluate(()=>document.body.dataset.scene==='relax' && document.body.dataset.message==='1' && document.querySelector('#reply').textContent.includes('返答1')) && await page.locator('#reply').isVisible()); await page.screenshot({path:`${out}/${name}-restored.png`})
 await page.evaluate(()=>{const now=Date.now.bind(Date); Date.now=()=>now()+16000}); await touch(); await wait('ふれあい3'); await send('次へ'); await wait('返答2'); await page.waitForTimeout(5000); check('一時表示中の新返答を維持',await page.locator('#reply').textContent()==='返答2' && await page.locator('#bubble').getAttribute('data-retained')==='1'); await page.screenshot({path:`${out}/${name}-next.png`})
 }catch(e){failures.push(`${name}: ${e.message}`);checks.exception=e.message;await page.screenshot({path:`${out}/${name}-failure.png`}).catch(()=>{})} await ctx.close()
}))
await browser.close(); fs.writeFileSync(`${out}/result.json`,JSON.stringify({results,failures,external},null,2)); console.log(JSON.stringify({results,failures,external},null,2)); process.exitCode=failures.length||external.length?1:0
