// BOXP-505 TD-01: 頭をなでたとき、最終描画で頭が見て分かるほど傾き、離すと戻ることを画素から確かめる回帰検査。
// setParameter や petFollow の数値ではなく、画面のスクリーンショットから頭の傾き（度。BOXP-525 でなで中は目を閉じるため、瞳の線ではなく頭全体を待機画像へ回転照合して求める）と首肩のずれ（px）を推定する。
// 実行: Playwright 1.56.1 のコンテナで `node petvisible.mjs <build の dist> <出力先>`（BFF は完全にモック、token 不要）。
// 失敗した項目があれば終了コード 1。連続フレームの画像と測定値を出力先に保存する。
import { chromium, devices } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2] ?? '/site', OUT = process.argv[3] ?? '/out'
fs.mkdirSync(OUT, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8773)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const SEPARATION_MIN = 10, SHIFT_MIN = 3, IDLE_MAX = 3, RETURN_MARGIN = 2.5, SHOULDER_MAX = 6
const failures = [], result = {}
const check = (ok, what) => { if (!ok) failures.push(what) }

async function open(name, config, prefs) {
  const context = await browser.newContext(config), page = await context.newPage()
  await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); const data = p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {}; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }) })
  if (prefs) await context.addInitScript(p => { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v) }, prefs)
  await page.goto('http://localhost:8773/kohako/home.html'); await page.waitForFunction(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline', null, { timeout: 60000 })
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    window.__img = async b64 => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0); const d = g.getImageData(0, 0, bm.width, bm.height), gray = new Float32Array(bm.width * bm.height); for (let i = 0; i < gray.length; i++) gray[i] = (d.data[4 * i] + d.data[4 * i + 1] + d.data[4 * i + 2]) / 3; return { w: bm.width, h: bm.height, gray, rgba: d.data } }
    // 左右の瞳（青）の重心を結ぶ線の傾き（度、画面で時計回り＝頭頂が右へ傾くと正）。顔の向き（左右の振り向き）では両目が同じ向きへ動くので傾きにならない。
    window.__eyes = (B, box) => { const mid = box.x + box.w / 2, acc = [[0, 0, 0], [0, 0, 0]]; for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { const i = 4 * (y * B.w + x), r = B.rgba[i], g = B.rgba[i + 1], b = B.rgba[i + 2]; if (b > 110 && b > r + 45 && b > g + 25) { const s = acc[x < mid ? 0 : 1]; s[0] += x; s[1] += y; s[2]++ } } const [L, R] = acc; if (L[2] < 4 || R[2] < 4) return null; const l = [L[0] / L[2], L[1] / L[2]], r = [R[0] / R[2], R[1] / R[2]]; return +(Math.atan2(r[1] - l[1], r[0] - l[0]) * 180 / Math.PI).toFixed(1) }
    const at = (B, x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= B.w || yi >= B.h ? null : B.gray[yi * B.w + xi] }
    window.__shift = (A, B, box, R = 6) => { let best = { dx: 0, dy: 0, e: Infinity }; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { let e = 0, n = 0; for (let y = box.y; y < box.y + box.h; y += 2) for (let x = box.x; x < box.x + box.w; x += 2) { const v = at(B, x + dx, y + dy); if (v == null) continue; e += Math.abs(A.gray[y * A.w + x] - v); n++ } e /= n; if (e < best.e) best = { dx, dy, e } } return best }
    // BOXP-525: なで中は目を閉じるので、瞳の線ではなく、頭全体（前髪・輪郭・顔）を待機画像に回転・平行移動で重ねて最も合う角度（度、時計回り正）を傾きとする。
    window.__rot = (A, B, box, c) => {
      const err = (deg, dx, dy) => { const t = -deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t); let e = 0, n = 0; for (let y = box.y; y < box.y + box.h; y += 3) for (let x = box.x; x < box.x + box.w; x += 3) { const px = x - c[0] - dx, py = y - c[1] - dy, v = at(A, cs * px - sn * py + c[0], sn * px + cs * py + c[1]); if (v == null) continue; e += Math.abs(B.gray[y * B.w + x] - v); n++ } return n ? e / n : Infinity }
      let best = { deg: 0, dx: 0, dy: 0, e: Infinity }
      for (let deg = -14; deg <= 14; deg += 1) for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) { const e = err(deg, dx, dy); if (e < best.e) best = { deg, dx, dy, e } }
      const c0 = best; for (let deg = c0.deg - 1; deg <= c0.deg + 1; deg += 0.25) for (let dy = c0.dy - 1; dy <= c0.dy + 1; dy++) for (let dx = c0.dx - 1; dx <= c0.dx + 1; dx++) { const e = err(deg, dx, dy); if (e < best.e) best = { deg, dx, dy, e } }
      return +best.deg.toFixed(2)
    }
  })
  const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head), pad = 40
  const clip = { x: Math.round(a.x - pad), y: Math.round(a.y - pad), width: Math.round(a.w + 2 * pad), height: Math.round(a.h * 2 + pad) }
  // 顔（目・口・前髪）と、その下の首肩。
  const face = { x: pad + Math.round(a.w * 0.2), y: pad + Math.round(a.h * 0.3), w: Math.round(a.w * 0.6), h: Math.round(a.h * 0.55) }
  const shoulder = { x: pad, y: pad + Math.round(a.h * 1.3), w: Math.round(a.w), h: Math.round(a.h * 0.4) }
  const head = { x: pad, y: pad, w: Math.round(a.w), h: Math.round(a.h) }
  const shot = async () => (await page.screenshot({ clip, scale: 'css' })).toString('base64')
  await page.evaluate(async b => { window.__rest = await window.__img(b) }, await shot())
  const measure = async (label, file) => {
    const b = await shot(); if (file) fs.writeFileSync(`${OUT}/${name}-${file}.png`, Buffer.from(b, 'base64'))
    const m = await page.evaluate(async ([b, face, shoulder, head]) => { const B = await window.__img(b); return { tilt: window.__rot(window.__rest, B, head, [head.x + head.w / 2, head.y + head.h]), eyeTilt: window.__eyes(B, face), shoulder: window.__shift(window.__rest, B, shoulder) } }, [b, face, shoulder, head])
    const pet = await page.evaluate(() => window.__kohakoHome.report.petFollow)
    return { label, tilt: m.tilt, eyeTilt: m.eyeTilt, shoulderDx: m.shoulder.dx, shoulderDy: m.shoulder.dy, headZ: pet && +pet.headZ.toFixed(2) }
  }
  return { context, page, a, measure }
}

// 押して往復してなでる。touch のときは CDP の touch event を使う。
async function stroke(page, touch, from, to, times) {
  const cdp = touch ? await page.context().newCDPSession(page) : null
  const down = async p => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p[0], y: p[1] }] }) : (await page.mouse.move(...p), page.mouse.down())
  const move = async (p, q) => { for (let i = 1; i <= 6; i++) { const x = p[0] + (q[0] - p[0]) * i / 6, y = p[1] + (q[1] - p[1]) * i / 6; if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); else await page.mouse.move(x, y) } }
  const up = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up()
  await down(from)
  return { frames: async (measure, label, file) => { const frames = []; for (let i = 0; i < times; i++) { await move(from, to); await move(to, from); if (i % 2 === 1) frames.push(await measure(`${label}${i}`, i === times - 1 ? file : null)) } return frames }, up }
}

const mean = xs => { const v = xs.filter(x => typeof x === 'number'); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const r1 = x => Math.round(x * 10) / 10
async function scenario(name, config, prefs, touch, expectMotion) {
  const { context, page, a, measure } = await open(name, config, prefs)
  const cx = a.x + a.w / 2, cy = a.y + a.h * 0.35, out = { head: a }
  // 待機クリップも頭を揺らすので、まず触らずに 8 回測って待機の幅を取る（目の線は待機でも数度ゆれる）。
  out.idle = []; for (let i = 0; i < 8; i++) { out.idle.push(await measure(`idle${i}`, i ? null : 'idle')); await page.waitForTimeout(300) }
  const idle = mean(out.idle.map(d => d.tilt)), sway = Math.max(...out.idle.map(d => typeof d.tilt === 'number' ? Math.abs(d.tilt - idle) : 0))
  // 離した後は待機クリップへ戻るので、待機で測った揺れ幅＋RETURN_MARGIN の内側なら戻ったとみなす。
  const back = r1(sway + RETURN_MARGIN)
  // 縦のなでは touch では既定でページのスクロール（#rig の touch-action: pan-y）になるので PC だけで確かめる。
  const kinds = [['right', [cx + a.w * 0.1, cy], [cx + a.w * 0.4, cy]], ['left', [cx - a.w * 0.4, cy], [cx - a.w * 0.1, cy]], ['across', [cx - a.w * 0.3, cy], [cx + a.w * 0.3, cy]], ...(touch ? [] : [['vertical', [cx, cy - a.h * 0.25], [cx, cy + a.h * 0.2]]])]
  for (const [kind, f, t] of kinds) {
    const s = await stroke(page, touch, f, t, 8), during = await s.frames(measure, 'during', `${kind}-1-during`)
    // 離したらカーソルを窓の外へ出す（BOXP-516 の視線追従で隅を見たまま測らないよう、待機と同じ「カーソルなし」の状態で比べる）。
    await s.up(); if (!touch) { await page.mouse.move(5, 5); await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }))) }
    await page.waitForTimeout(400); const release = await measure('after0.4', `${kind}-2-release`)
    await page.waitForTimeout(2600); const after = await measure('after3', `${kind}-3-after`)
    out[kind] = { during, release, after, shift: r1(mean(during.map(d => d.tilt)) - idle) }
    check(Math.abs(after.tilt - idle) <= back, `${name} ${kind}: 離して 3 秒後も待機より ${r1(after.tilt - idle)}° 傾いたまま（許容 ${back}°）`)
    check([...during, after].every(d => Math.abs(d.shoulderDx) <= SHOULDER_MAX && Math.abs(d.shoulderDy) <= SHOULDER_MAX), `${name} ${kind}: 首肩が ${SHOULDER_MAX}px を超えてずれた`)
  }
  const sep = r1(mean(out.right.during.map(d => d.tilt)) - mean(out.left.during.map(d => d.tilt)))
  out.separation = sep
  if (expectMotion) {
    // 右側をなでると頭頂が右へ、左側では左へ傾く（目の線で 10° 以上の差、それぞれ待機の平均から 3° 以上）。
    check(sep >= SEPARATION_MIN, `${name}: 右なでと左なでの傾きの差が ${sep}°（${SEPARATION_MIN}° 未満）`)
    check(out.right.shift >= SHIFT_MIN && out.left.shift <= -SHIFT_MIN, `${name}: 待機からの傾き 右 ${out.right.shift}° / 左 ${out.left.shift}° が手の側へ ${SHIFT_MIN}° 以上でない`)
    if (out.vertical) check(Math.abs(out.vertical.shift) >= SHIFT_MIN, `${name}: 縦のなでで待機から ${out.vertical.shift}° しか傾かない`)
    check(Math.abs(out.across.shift) >= SHIFT_MIN, `${name}: 中央をまたぐ往復で待機から ${out.across.shift}° しか傾かない`)
  } else {
    check(Math.abs(sep) <= IDLE_MAX, `${name}: 無効設定なのに右なでと左なでで ${sep}° の差`)
    for (const k of ['right', 'left', 'across']) check(Math.abs(out[k].shift) <= IDLE_MAX, `${name} ${k}: 無効設定なのに待機から ${out[k].shift}° 傾いた`)
  }
  if (!touch) {
    // 押さずに頭の上を往復するだけ（ホバー）は動かさない。
    await page.mouse.move(cx - a.w * 0.3, cy); const hover = []; for (let i = 0; i < 6; i++) { await page.mouse.move(cx + (i % 2 ? -1 : 1) * a.w * 0.3, cy, { steps: 6 }); if (i % 2) hover.push(await measure('hover', i === 5 ? 'hover' : null)) }
    out.hover = { during: hover, shift: r1(mean(hover.map(d => d.tilt)) - idle) }
    check(hover.every(d => !d.headZ && Math.abs(d.tilt - idle) <= back), `${name} hover: 押していないのに追従した（待機比 ${out.hover.shift}°、許容 ${back}°）`)
  }
  result[name] = out; await context.close()
  console.log(name, `idle ${r1(idle)}° [${out.idle.map(d => d.tilt).join(',')}]`, Object.entries(out).filter(([k, v]) => v?.during).map(([k, v]) => `${k}: during ${v.during.map(d => d.tilt).join(',')}° (Z ${v.during.at(-1).headZ}) → 待機比 ${v.shift}° / release ${v.release?.tilt ?? '-'}° / after ${v.after?.tilt ?? '-'}°`).join(' | '), `| 右−左 ${sep}°`)
}

const pc = { viewport: { width: 1280, height: 800 } }
const only = (process.env.ONLY || 'pc,pixel7,reduced,touchoff').split(',')
if (only.includes('pc')) await scenario('pc', pc, null, false, true)
if (only.includes('pixel7')) await scenario('pixel7', devices['Pixel 7'], null, true, true)
if (only.includes('reduced')) await scenario('reduced', { ...pc, reducedMotion: 'reduce' }, null, false, false)
if (only.includes('touchoff')) await scenario('touchoff', pc, { 'kohako-home-prefs': JSON.stringify({ touch: false }) }, false, false)
fs.writeFileSync(`${OUT}/petvisible.json`, JSON.stringify({ result, failures }, null, 1))
console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS')
await browser.close(); srv.close(); process.exit(failures.length ? 1 : 0)
