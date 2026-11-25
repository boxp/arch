import { createServer } from 'node:http'
import { readConfig } from './config.js'
import { createJwksProvider } from './jwks.js'
import { createAuth } from './auth.js'
import { createHermes } from './hermes.js'
import { createModelTrial } from './model-trial.js'
import { createStatus } from './status.js'
import { createPush } from './push.js'
import { createNotifications } from './notifications.js'
import { createGeocoder } from './geocode.js'
import { createConversation } from './conversation.js'
import { createAttachments } from './attachments.js'
import { createTts } from './tts.js'
import { createApp } from './app.js'
import { createBoardSummary, createG2Reference, createSharedContext } from './g2-context.js'
const config = readConfig(process.env)
const jwks = createJwksProvider({ url: `${config.team}/cdn-cgi/access/certs`, fetch, now: Date.now })
const authenticate = createAuth({
  jwks,
  issuer: config.team,
  audience: config.audience,
  ownerEmails: config.ownerEmails,
  verifierEnabled: config.verifierEnabled,
  verifierUsername: config.verifierUsername,
  notifierEnabled: config.notifierEnabled,
  notifierUsername: config.notifierUsername,
  g2Enabled: !!config.g2Mode,
  g2Username: config.g2Username,
  g2Audience: config.g2Audience,
  now: Date.now,
})
const hermes =
  config.hermesUrl && config.hermesKey
    ? createHermes({ url: config.hermesUrl, key: config.hermesKey, fetch, allowedToolsets: config.allowedToolsets })
    : undefined
// BOXP-657 段2: 眼鏡発の turn の指示文にだけ添える参照。env で明示した時だけ作る（既定は付けない）。
const g2Reference =
  config.g2Mode && (config.g2BoardContext || config.g2SharedContext)
    ? createG2Reference({
        board: config.g2BoardContext ? createBoardSummary({ url: config.boardUrl, fetch, now: Date.now }) : undefined,
        shared:
          hermes && config.g2SharedContext && config.g2TelegramUserId
            ? createSharedContext({ hermes, userId: config.g2TelegramUserId, now: Date.now })
            : undefined,
        now: Date.now,
      })
    : undefined
const push = config.dataDir
  ? await createPush(config.dataDir, {
      subject: config.pushSubject,
      quietHours: config.quietHours,
      minimal: config.pushMinimal,
    })
  : undefined
const notifications = config.dataDir && push ? await createNotifications(config.dataDir, push.send) : undefined
const geocode = createGeocoder({ fetcher: fetch })
// BOXP-706: 家の会話（owner）にだけ渡す。検証用の会話には渡さない。
const modelTrial =
  hermes && config.modelTrial && config.dataDir
    ? createModelTrial({ config: config.modelTrial, now: Date.now, store: config.dataDir })
    : undefined
await modelTrial?.restore()
const conversations = hermes
  ? {
      owner: createConversation({
        now: Date.now,
        hermes,
        prefix: 'kohako-web',
        store: config.dataDir,
        geocode,
        modelTrial,
      }),
      verifier: createConversation({ now: Date.now, hermes, prefix: 'kohako-verify', store: config.dataDir, geocode }),
    }
  : undefined
await Promise.all([conversations?.owner.restore(), conversations?.verifier.restore()])
const server = createServer(
  createApp({
    attachments: createAttachments(config.dataDir),
    authenticate,
    g2Mode: config.g2Mode,
    g2Reference,
    hermes,
    conversations,
    push,
    notifications,
    status: createStatus({ fetch, now: Date.now, quotaUrl: config.quotaUrl, boardUrl: config.boardUrl }),
    sttUrl: config.sttUrl,
    tts: config.ttsUrl
      ? createTts({ url: config.ttsUrl, fetcher: fetch, now: Date.now, concurrency: config.ttsConcurrency })
      : undefined,
  }),
)
server.listen(config.port, config.host)
let closing = false
const shutdown = () => {
  if (closing) process.exit(0)
  closing = true
  console.log('kohako bff shutting down')
  const timeout = setTimeout(() => {
    server.closeAllConnections()
    process.exit(0)
  }, 20_000)
  server.close(() => {
    void (async () => {
      await Promise.all([notifications?.flush(), conversations?.owner.flush(), conversations?.verifier.flush()])
      await push?.flush()
      clearTimeout(timeout)
      process.exit(0)
    })()
  })
  server.closeIdleConnections()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
