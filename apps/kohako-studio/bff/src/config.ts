export function readConfig(env: NodeJS.ProcessEnv) {
  const team = env.KOHAKO_ACCESS_TEAM_DOMAIN ?? '', audience = env.KOHAKO_ACCESS_AUD ?? '', ownerEmails = (env.KOHAKO_OWNER_EMAILS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
  const hermesUrl = env.KOHAKO_HERMES_URL, hermesKey = env.KOHAKO_HERMES_KEY, sttUrl = env.KOHAKO_STT_URL
  const origin = (x: string, https = false) => { try { const u = new URL(x); return u.origin === x && (https ? u.protocol === 'https:' : ['https:', 'http:'].includes(u.protocol)) } catch { return false } }
  if (team && (!origin(team, true) || !audience || !/^[a-f\d]+$/i.test(audience) || ownerEmails.length !== 1 || !/^[^@\s]+@[^@\s]+$/.test(ownerEmails[0]))) throw Error('invalid access configuration')
  if ((hermesUrl || hermesKey) && (!hermesUrl || !origin(hermesUrl) || !hermesKey || hermesKey.length < 32)) throw Error('invalid Hermes configuration')
  if (sttUrl && !origin(sttUrl)) throw Error('invalid STT configuration')
  const port = Number(env.KOHAKO_BFF_PORT ?? '8787'); if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid port')
  return { team, audience, ownerEmails, hermesUrl, hermesKey, sttUrl, port, host: env.KOHAKO_BFF_HOST ?? '0.0.0.0', verifierEnabled: env.KOHAKO_VERIFIER_ENABLED === 'true', verifierUsername: env.KOHAKO_VERIFIER_USERNAME ?? 'system:serviceaccount:codex-workspace:codex-workspace', allowedToolsets: (env.KOHAKO_HERMES_TOOLSETS ?? '').split(',').map(x => x.trim()).filter(Boolean) }
}
