import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const root=process.env.SITE, out=process.argv[2]
fs.mkdirSync(out,{recursive:true})
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'}
const server=http.createServer((req,res)=>{const p=path.join(root,new URL(req.url,'http://localhost').pathname);fs.readFile(p,(e,d)=>{res.writeHead(e?404:200,{'content-type':types[path.extname(p)]||'application/octet-stream'});res.end(e?'missing':d)})}).listen(8845)
const browser=await chromium.launch({executablePath:process.env.CHROME,args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
const results=[]
try{
for(const [name,width,height,mobile] of [['pc',1280,800,false],['phone',390,844,true],['landscape',844,390,true]]){
 const ctx=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,permissions:['microphone'],serviceWorkers:'block'})
 const page=await ctx.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await ctx.addInitScript(()=>{const now=Date.now();sessionStorage.setItem('kohako-home-reauth',JSON.stringify({v:1,draft:'復元する草稿',queue:[],at:now-1000,reloadAt:now-1000}))})
 await ctx.route('**/kohako/api/v1/**',route=>{const p=new URL(route.request().url()).pathname.split('/v1/')[1];let data={};let status=200
 if(p==='me')data={authenticated:true}
 else if(p==='conversation')data={enabled:true,stt:true}
 else if(p==='status')data={schema:'kohako-home-status/v1',quota:{state:'ok',pools:[]},tasks:{state:'ok',inProgress:{total:0,complete:true,byAgent:[],conflicts:[]}}}
 else if(p==='messages'){status=202;data={}}
 else if(p.startsWith('requests/'))data={status:'pending'}
 else if(p==='transcriptions')data={text:'音声からの文'}
 else {status=404}
 return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})})
 await page.goto('http://localhost:8845/kohako/home.html?acting=0&face=static')
 await page.waitForFunction(()=>document.querySelector('#connection').textContent==='接続中')
 const history=await page.locator('#history').textContent()
 if(!history.includes('再認証前の入力を戻しました')||history.includes('送信待ち 0 件'))throw Error(`${name}: draft notice`)
 await page.locator('#settings-open').click();await page.screenshot({path:path.join(out,`${name}-settings.png`)})
 const overflow=await page.evaluate(()=>[...document.querySelectorAll('#settings .opt-text')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent))
 if(overflow.length)throw Error(`${name}: settings overflow ${overflow}`)
 await page.locator('#settings-close').click()
 await page.locator('#record').click();await page.waitForFunction(()=>document.querySelector('#record').textContent==='■ 録音終了')
 const record=await page.locator('#record').evaluate(e=>({label:e.getAttribute('aria-label'),fits:e.scrollWidth<=e.clientWidth+1,rect:e.getBoundingClientRect().toJSON()}))
 if(!record.fits||record.label!=='録音を終えて文字にする')throw Error(`${name}: record label`)
 await page.screenshot({path:path.join(out,`${name}-record.png`)})
 await page.locator('#record-cancel').click()
 await page.locator('#message').fill('表示確認');await page.locator('#send').click()
 await page.waitForFunction(()=>document.querySelector('#send').textContent==='送信待ちに追加')
 const inputWidth=await page.locator('#message').evaluate(e=>e.getBoundingClientRect().width)
 if(width<600 && inputWidth<200)throw Error(`${name}: input squeezed ${inputWidth}`)
 const send=await page.locator('#send').evaluate(e=>({text:e.textContent,fits:e.scrollWidth<=e.clientWidth+1,rect:e.getBoundingClientRect().toJSON()}))
 if(!send.fits||send.rect.x+send.rect.width>width+1)throw Error(`${name}: send overflow`)
 await page.screenshot({path:path.join(out,`${name}-queue.png`)})
 if(errors.length)throw Error(`${name}: ${errors}`)
 results.push({name,width,height,draftNotice:true,settingsOverflow:overflow,record,send,inputWidth,errors})
 await ctx.close()
}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,results},null,2))
}finally{await browser.close();server.close()}
