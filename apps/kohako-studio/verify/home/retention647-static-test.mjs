// BOXP-647 静的配信の境界を実 HTTP リクエストで検証する。
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { createStaticServer } from './retention647-static.mjs'

const tmp = await mkdtemp(path.join(process.cwd(), '.retention647-'))
const site = path.join(tmp, 'site')
let server
try {
  await mkdir(site)
  await mkdir(`${site}-other`)
  await writeFile(path.join(site, 'index.html'), 'html')
  await writeFile(path.join(site, 'app.js'), 'js')
  await writeFile(path.join(site, 'image.png'), 'png')
  await writeFile(path.join(tmp, 'secret'), 'secret')
  await writeFile(path.join(`${site}-other`, 'secret'), 'secret')
  await symlink(path.join(tmp, 'secret'), path.join(site, 'link'))
  await symlink(`${site}-other`, path.join(site, 'sibling'))
  server = createStaticServer(site)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  assert.equal(server.address().address, '127.0.0.1')
  const request = url => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
  for (const [url, body] of [['/index.html', 'html'], ['/app.js', 'js'], ['/image.png', 'png']]) assert.deepEqual(await request(url), { status: 200, body })
  for (const url of ['/%2e%2e%2fsecret', '/../secret', '/..%2fsite-other/secret', '/%2fetc/passwd', '/%5csecret', '/%00', '/link', '/sibling/secret', 'http://example.com/secret', '/%']) {
    const result = await request(url)
    assert.ok(result.status >= 400 && result.status < 500, `${url}: ${result.status}`)
    assert.notEqual(result.body, 'secret')
  }
  assert.deepEqual(await request('/index.html'), { status: 200, body: 'html' })
  console.log('static server boundary checks passed')
} finally {
  if (server?.listening) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  await rm(tmp, { recursive: true, force: true })
}
