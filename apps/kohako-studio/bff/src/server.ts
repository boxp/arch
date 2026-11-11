import { createServer } from 'node:http'
import { readConfig } from './config.js'
import { createJwksProvider } from './jwks.js'
import { createAuth } from './auth.js'
import { createHermes } from './hermes.js'
import { createStatus } from './status.js'
import { createPush } from './push.js'
import { createNotifications } from './notifications.js'
import { createApp } from './app.js'
const config = readConfig(process.env)
const jwks = createJwksProvider({ url: `${config.team}/cdn-cgi/access/certs`, fetch, now: Date.now })
const authenticate = createAuth({ jwks, issuer: config.team, audience: config.audience, ownerEmails: config.ownerEmails, verifierEnabled: config.verifierEnabled, verifierUsername: config.verifierUsername, notifierEnabled: config.notifierEnabled, notifierUsername: config.notifierUsername, now: Date.now })
const hermes = config.hermesUrl && config.hermesKey ? createHermes({ url: config.hermesUrl, key: config.hermesKey, fetch, allowedToolsets: config.allowedToolsets }) : undefined
const push = config.dataDir ? await createPush(config.dataDir, { subject: config.pushSubject, quietHours: config.quietHours }) : undefined
const notifications = config.dataDir && push ? await createNotifications(config.dataDir, push.send) : undefined
createServer(createApp({ authenticate, hermes, push, notifications, status: createStatus({ fetch, now: Date.now, quotaUrl: config.quotaUrl, boardUrl: config.boardUrl }), sttUrl: config.sttUrl })).listen(config.port, config.host)
