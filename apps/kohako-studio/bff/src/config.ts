import { isAbsolute } from 'node:path'
export function readConfig(env: NodeJS.ProcessEnv) {
  const team = env.KOHAKO_ACCESS_TEAM_DOMAIN ?? '', audience = env.KOHAKO_ACCESS_AUD ?? '', ownerEmails = (env.KOHAKO_OWNER_EMAILS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
  const hermesUrl = env.KOHAKO_HERMES_URL, hermesKey = env.KOHAKO_HERMES_KEY, sttUrl = env.KOHAKO_STT_URL
  const origin = (x: string, https = false) => { try { const u = new URL(x); return u.origin === x && (https ? u.protocol === 'https:' : ['https:', 'http:'].includes(u.protocol)) } catch { return false } }
  if (team && (!origin(team, true) || !audience || !/^[a-f\d]+$/i.test(audience) || ownerEmails.length !== 1 || !/^[^@\s]+@[^@\s]+$/.test(ownerEmails[0]))) throw Error('invalid access configuration')
  if ((hermesUrl || hermesKey) && (!hermesUrl || !origin(hermesUrl) || !hermesKey || hermesKey.length < 32)) throw Error('invalid Hermes configuration')
  if (sttUrl && !origin(sttUrl)) throw Error('invalid STT configuration')
  const dataDir = env.KOHAKO_DATA_DIR || undefined, pushSubject = env.KOHAKO_PUSH_SUBJECT ?? 'https://kohako-home.b0xp.io', quietHours = env.KOHAKO_PUSH_QUIET_HOURS ?? '2-9'
  if (dataDir && !isAbsolute(dataDir)) throw Error('invalid data directory')
  if (!origin(pushSubject, true) && !/^mailto:[^\s@]+@[^\s@]+$/.test(pushSubject)) throw Error('invalid push subject')
  if (!/^(?:[01]?\d|2[0-3])-(?:[01]?\d|2[0-3])$/.test(quietHours)) throw Error('invalid quiet hours')
  const port = Number(env.KOHAKO_BFF_PORT ?? '8787'); if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid port')
  return { dataDir, pushSubject, quietHours, pushMinimal: env.KOHAKO_PUSH_CONTENT === 'minimal', notifierEnabled: env.KOHAKO_NOTIFIER_ENABLED === 'true', notifierUsername: env.KOHAKO_NOTIFIER_USERNAME ?? 'system:serviceaccount:codex-workspace:codex-workspace', quotaUrl: env.KOHAKO_STATUS_QUOTA_URL ?? 'http://codex-workspace-ai-ops-metrics.codex-workspace.svc.cluster.local:9464/metrics', boardUrl: env.KOHAKO_STATUS_BOARD_URL ?? 'http://codex-task-board-kohako.codex-workspace.svc.cluster.local:8090/api/kohako/board', team, audience, ownerEmails, hermesUrl, hermesKey, sttUrl, port, host: env.KOHAKO_BFF_HOST ?? '0.0.0.0', verifierEnabled: env.KOHAKO_VERIFIER_ENABLED === 'true', verifierUsername: env.KOHAKO_VERIFIER_USERNAME ?? 'system:serviceaccount:codex-workspace:codex-workspace', allowedToolsets: (env.KOHAKO_HERMES_TOOLSETS ?? '').split(',').map(x => x.trim()).filter(Boolean) }
}
