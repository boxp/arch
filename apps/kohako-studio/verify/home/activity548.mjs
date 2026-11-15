// BOXP-548: 実行中の手順と完了後の表示を BFF モックで検証する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8808)
fs.mkdirSync(out, { recursive: true })
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.wasm':'application/wasm' }
const server = http.createServer((req,res) => { const p = decodeURIComponent(new URL(req.url,'http://localhost').pathname); fs.readFile(path.join(site,p),(err,data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200,{'content-type':types[path.extname(p)] || 'application/octet-stream'}); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] }), results = {}, failures = [], external = []
for (const [device,viewport,mobile] of [['pc',{width:1440,height:900},false],['pixel7',{width:412,height:915},true]]) {
  const checks = results[device] = {}, ctx = await browser.newContext({ viewport,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block' }), page = await ctx.newPage(); let stage = 0, requestId = ''
  page.on('request', req => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) }); await page.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await page.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status,data) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
    if (p === 'me') return json(200,{authenticated:true})
    if (p === 'conversation') return json(200,{enabled:true,stt:false})
    if (p === 'status') return json(200,{schema:'kohako-home-status/v1',quota:{state:'ok',pools:[]},tasks:{state:'ok',inProgress:{total:0,complete:true,byAgent:[],conflicts:[]}}})
    if (p === 'notifications') return json(200,{items:[],unread:0})
    if (p === 'messages') { requestId = req.postDataJSON().requestId; return json(202,{requestId,status:'pending'}) }
    if (p === 'approvals' || p.endsWith('/cancel')) return json(200,{})
    if (p.startsWith('requests/')) {
      const web = {id:'t1',kind:'tool',tool:'web_search',status:stage >= 3 ? 'done':'running',startedAt:Date.now(),...(stage < 3 ? {runningMs:1000} : {}),...(stage >= 3 ? {durationMs:1200} : {}),extra:'SECRET-THOUGHT'}, terminal = {id:'t2',kind:'tool',tool:'terminal',status:stage >= 4 ? 'failed':'running',startedAt:Date.now(),detail:'curl',...(stage < 4 ? {runningMs:1000} : {})}
      const activity = {steps:stage < 3 ? [web] : [web,terminal],writing:stage === 4,dropped:0,reasoning:'SECRET-THOUGHT'}
      return json(200,{requestId,status:stage === 5 ? 'done' : stage === 3 ? 'approval' : 'pending',...(stage ? {activity} : {}),...(stage === 3 ? {approval:{approvalId:'approval-123456',summary:'確認してください',expiresAt:Date.now()+60000}} : {}),...(stage === 5 ? {reply:{text:'返答です',at:Date.now()}} : {})})
    }
    return json(200,{})
  })
  const check = (name,ok) => { checks[name] = ok ? 'PASS':'FAIL'; if (!ok) failures.push(`${device}: ${name}`) }, advance = async n => { stage = n; await page.waitForTimeout(1250) }
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`); await page.waitForFunction(() => !document.querySelector('#send').disabled, null, {timeout:30000})
    await page.locator('#message').fill('テスト'); await page.locator('#send').click(); await page.waitForTimeout(1250); check('開始時は非表示',await page.locator('#activity').isHidden())
    await advance(2); check('検索中の見出し',(await page.locator('.activity-title').innerText()) === 'Web を検索しています'); await page.locator('.activity-head').click(); check('一覧が開く',await page.locator('#activity-steps').isVisible()); check('検索中',await page.locator('[data-status="running"]').count() === 1)
    await advance(3); check('承認中も開いたまま',await page.locator('#activity-steps').isVisible()); check('実行状態',await page.locator('[data-status="done"]').count() === 1 && await page.locator('[data-status="running"]').count() === 1); check('停止ボタン',await page.locator('#stop').isEnabled()); check('拒否ボタン',await page.getByRole('button',{name:'拒否',exact:true}).isEnabled())
    const boxes = await page.evaluate(() => { const rect = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom} }; return {activity:rect('#activity'),form:rect('#form'),stop:rect('#stop'),approval:rect('#approval'),width:innerWidth} }); const overlap = (a,b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; check('画面内と操作欄に重ならない',!!boxes.activity && boxes.activity.left >= 0 && boxes.activity.right <= boxes.width && !overlap(boxes.activity,boxes.form) && !overlap(boxes.activity,boxes.stop));
    // 承認ダイアログは従来どおり吹き出しの上に重なるモーダル。手順表示が開いていても、承認・拒否・停止・入力欄が最前面で押せることを画面上の点で確かめる。
    const hit = await page.evaluate(() => Object.fromEntries(['allow','deny','stop','message','send'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [id, !!top && (top === e || e.contains(top))] }))); check('承認・拒否・停止・入力が最前面', Object.values(hit).every(Boolean)); await page.screenshot({path:path.join(out,`${device}-approval.png`)})
    await advance(4); check('返答中の見出し',(await page.locator('.activity-title').innerText()) === '返答を書いています'); await advance(5); check('完了後の見出し',(await page.locator('.activity-title').innerText()) === 'ツールを 2 回使いました（web_search、terminal）（うち失敗 1）'); check('返答表示',(await page.locator('#reply').innerText()).includes('返答です')); check('思考と未知項目を表示しない',!(await page.locator('body').innerText()).includes('SECRET-THOUGHT')); await page.screenshot({path:path.join(out,`${device}-done.png`)})
  } catch(e) { checks.exception = e.message; failures.push(`${device}: ${e.message}`); await page.screenshot({path:path.join(out,`${device}-failure.png`)}).catch(() => {}) }
  await ctx.close()
}
await browser.close(); server.close(); fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results,failures,external},null,2)); console.log(JSON.stringify({results,failures,external},null,2)); process.exitCode = failures.length || external.length ? 1 : 0
