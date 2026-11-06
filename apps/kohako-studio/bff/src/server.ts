import { createServer } from 'node:http'
import { readConfig } from './config.js'
import { createJwksProvider } from './jwks.js'
import { createAuth } from './auth.js'
import { createHermes } from './hermes.js'
import { createApp } from './app.js'
const config = readConfig(process.env)
const jwks = createJwksProvider({ url: `${config.team}/cdn-cgi/access/certs`, fetch, now: Date.now })
const authenticate = createAuth({ jwks, issuer: config.team, audience: config.audience, ownerEmails: config.ownerEmails, verifierEnabled: config.verifierEnabled, verifierUsername: config.verifierUsername, now: Date.now })
const hermes = config.hermesUrl && config.hermesKey ? createHermes({ url: config.hermesUrl, key: config.hermesKey, fetch, allowedToolsets: config.allowedToolsets }) : undefined
createServer(createApp({ authenticate, hermes, sttUrl: config.sttUrl })).listen(config.port, config.host)
