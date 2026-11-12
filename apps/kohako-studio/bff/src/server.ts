import { createServer } from 'node:http'
import { readConfig } from './config.js'
import { createJwksProvider } from './jwks.js'
import { createAuth } from './auth.js'
import { createHermes } from './hermes.js'
import { createStatus } from './status.js'
import { createPush } from './push.js'
import { createNotifications } from './notifications.js'
import { createGeocoder } from './geocode.js'
import { createConversation } from './conversation.js'
import { createApp } from './app.js'
const config = readConfig(process.env)
const jwks = createJwksProvider({ url: `${config.team}/cdn-cgi/access/certs`, fetch, now: Date.now })
const authenticate = createAuth({ jwks, issuer: config.team, audience: config.audience, ownerEmails: config.ownerEmails, verifierEnabled: config.verifierEnabled, verifierUsername: config.verifierUsername, notifierEnabled: config.notifierEnabled, notifierUsername: config.notifierUsername, now: Date.now })
const hermes = config.hermesUrl && config.hermesKey ? createHermes({ url: config.hermesUrl, key: config.hermesKey, fetch, allowedToolsets: config.allowedToolsets }) : undefined
const push = config.dataDir ? await createPush(config.dataDir, { subject: config.pushSubject, quietHours: config.quietHours, minimal: config.pushMinimal }) : undefined
const notifications = config.dataDir && push ? await createNotifications(config.dataDir, push.send) : undefined
const geocode = createGeocoder({ fetcher: fetch })
const conversations = hermes ? { owner: createConversation({ now: Date.now, hermes, prefix: 'kohako-web', store: config.dataDir, geocode }), verifier: createConversation({ now: Date.now, hermes, prefix: 'kohako-verify', store: config.dataDir, geocode }) } : undefined
await Promise.all([conversations?.owner.restore(), conversations?.verifier.restore()])
const server = createServer(createApp({ authenticate, hermes, conversations, push, notifications, status: createStatus({ fetch, now: Date.now, quotaUrl: config.quotaUrl, boardUrl: config.boardUrl }), sttUrl: config.sttUrl }))
server.listen(config.port, config.host)
let closing = false
const shutdown = () => {
  if (closing) process.exit(0)
  closing = true; console.log('kohako bff shutting down')
  const timeout = setTimeout(() => { server.closeAllConnections(); process.exit(0) }, 20_000)
  server.close(() => { void (async () => { await Promise.all([notifications?.flush(), conversations?.owner.flush(), conversations?.verifier.flush()]); await push?.flush(); clearTimeout(timeout); process.exit(0) })() })
  server.closeIdleConnections()
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
