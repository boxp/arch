// BOXP-647 検証用のローカル静的配信。
import http from 'node:http'
import { realpath, readFile } from 'node:fs/promises'
import path from 'node:path'

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function createStaticServer(site) {
  return http.createServer(async (req, res) => {
    try {
      const raw = req.url.split('?')[0]
      if (!raw.startsWith('/') || raw.startsWith('//') || /%2f|%5c/i.test(raw) || raw.includes('\\')) throw new URIError('invalid path')
      const pathname = decodeURIComponent(raw)
      if (pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part === '.')) throw new URIError('invalid path')
      const root = await realpath(site)
      const candidate = path.resolve(root, `.${pathname}`)
      if (!inside(root, candidate)) throw new URIError('outside site')
      const file = await realpath(candidate)
      if (!inside(root, file)) throw new URIError('outside site')
      const data = await readFile(file)
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
      res.end(data)
    } catch (err) {
      res.writeHead(err instanceof URIError ? 400 : 404)
      res.end()
    }
  })
}
