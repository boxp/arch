import { isAbsolute } from 'node:path'
import { parseModelTrial } from './model-trial.js'
export function readConfig(env: NodeJS.ProcessEnv) {
  const team = env.KOHAKO_ACCESS_TEAM_DOMAIN ?? '',
    audience = env.KOHAKO_ACCESS_AUD ?? '',
    ownerEmails = (env.KOHAKO_OWNER_EMAILS ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  const hermesUrl = env.KOHAKO_HERMES_URL,
    hermesKey = env.KOHAKO_HERMES_KEY,
    sttUrl = env.KOHAKO_STT_URL,
    ttsUrl = env.KOHAKO_TTS_URL || undefined,
    ttsConcurrency = Number(env.KOHAKO_TTS_CONCURRENCY ?? '1')
  const origin = (x: string, https = false) => {
    try {
      const u = new URL(x)
      return u.origin === x && (https ? u.protocol === 'https:' : ['https:', 'http:'].includes(u.protocol))
    } catch {
      return false
    }
  }
  if (
    team &&
    (!origin(team, true) ||
      !audience ||
      !/^[a-f\d]+$/i.test(audience) ||
      ownerEmails.length !== 1 ||
      !/^[^@\s]+@[^@\s]+$/.test(ownerEmails[0]))
  )
    throw Error('invalid access configuration')
  if ((hermesUrl || hermesKey) && (!hermesUrl || !origin(hermesUrl) || !hermesKey || hermesKey.length < 32))
    throw Error('invalid Hermes configuration')
  if (ttsUrl && !origin(ttsUrl)) throw Error('invalid TTS configuration')
  if (!Number.isInteger(ttsConcurrency) || ttsConcurrency < 1 || ttsConcurrency > 4)
    throw Error('invalid TTS concurrency')
  if (sttUrl && !origin(sttUrl)) throw Error('invalid STT configuration')
  const dataDir = env.KOHAKO_DATA_DIR || undefined,
    pushSubject = env.KOHAKO_PUSH_SUBJECT ?? 'https://kohako-home.b0xp.io',
    quietHours = env.KOHAKO_PUSH_QUIET_HOURS ?? '2-9'
  if (dataDir && !isAbsolute(dataDir)) throw Error('invalid data directory')
  if (!origin(pushSubject, true) && !/^mailto:[^\s@]+@[^\s@]+$/.test(pushSubject)) throw Error('invalid push subject')
  if (!/^(?:[01]?\d|2[0-3])-(?:[01]?\d|2[0-3])$/.test(quietHours)) throw Error('invalid quiet hours')
  // BOXP-657: 眼鏡の入口（principal g2）。未設定なら無効で、今までと同じ動作。read = 履歴と依頼の読み取りだけ、write = 送信・停止・許可も。
  const g2Mode = env.KOHAKO_G2_MODE || undefined,
    g2Audience = env.KOHAKO_G2_ACCESS_AUD ?? '',
    // 既定値は持たない（眼鏡の Pod 専用の ServiceAccount を lolice で作り、その名前を明示する。default の SA では通さない）。
    g2Username = env.KOHAKO_G2_USERNAME ?? ''
  if (g2Mode !== undefined && g2Mode !== 'read' && g2Mode !== 'write') throw Error('invalid G2 mode')
  // 家用の AUD と同じ値は受け付けない（家の画面用の JWT を眼鏡の入口の証明として流用させない）。
  if (
    g2Mode &&
    (!team ||
      !/^[a-f\d]+$/i.test(g2Audience) ||
      g2Audience.toLowerCase() === audience.toLowerCase() ||
      !/^system:serviceaccount:[a-z0-9-]+:[a-z0-9-]+$/.test(g2Username) ||
      g2Username.endsWith(':default'))
  )
    throw Error('invalid G2 configuration')
  // BOXP-657 段2: 眼鏡発の turn の指示文にだけ添える参照（どちらも任意・未設定なら付けない＝今までと同じ指示文）。
  // KOHAKO_G2_BOARD_CONTEXT=summary で Board 要約、KOHAKO_G2_SHARED_CONTEXT=telegram-dm で本人の Telegram DM の直近（読むだけ）。
  const g2BoardContext = env.KOHAKO_G2_BOARD_CONTEXT || undefined,
    g2SharedContext = env.KOHAKO_G2_SHARED_CONTEXT || undefined,
    g2TelegramUserId = env.KOHAKO_G2_TELEGRAM_USER_ID || undefined
  if (
    (g2BoardContext !== undefined && g2BoardContext !== 'summary') ||
    (g2SharedContext !== undefined && g2SharedContext !== 'telegram-dm') ||
    (g2TelegramUserId !== undefined && !/^\d{1,20}$/.test(g2TelegramUserId)) ||
    // 参照する相手は Owner 本人の Telegram user に固定する（未設定なら共有しない＝起動失敗）。
    (g2SharedContext === 'telegram-dm' && (g2TelegramUserId === undefined || !hermesUrl))
  )
    throw Error('invalid G2 context configuration')
  // BOXP-706: 家の会話だけで別のモデルを回数・期限つきで試す設定（JSON）。未設定なら試行なし。
  const modelTrial = parseModelTrial(env.KOHAKO_MODEL_TRIAL)
  // 保存先が無いと回数と失敗の回数が再起動で消え、上限を超えて指定が続くので、試行を始めない。
  if (modelTrial && !dataDir) throw Error('invalid model trial configuration')
  const port = Number(env.KOHAKO_BFF_PORT ?? '8787')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid port')
  return {
    g2Mode: g2Mode as 'read' | 'write' | undefined,
    g2Audience,
    g2Username,
    g2BoardContext: g2BoardContext === 'summary',
    g2SharedContext: g2SharedContext === 'telegram-dm',
    g2TelegramUserId,
    modelTrial,
    dataDir,
    pushSubject,
    quietHours,
    pushMinimal: env.KOHAKO_PUSH_CONTENT === 'minimal',
    notifierEnabled: env.KOHAKO_NOTIFIER_ENABLED === 'true',
    notifierUsername: env.KOHAKO_NOTIFIER_USERNAME ?? 'system:serviceaccount:codex-workspace:codex-workspace',
    quotaUrl:
      env.KOHAKO_STATUS_QUOTA_URL ??
      'http://codex-workspace-ai-ops-metrics.codex-workspace.svc.cluster.local:9464/metrics',
    boardUrl:
      env.KOHAKO_STATUS_BOARD_URL ??
      'http://codex-task-board-kohako.codex-workspace.svc.cluster.local:8090/api/kohako/board',
    team,
    audience,
    ownerEmails,
    hermesUrl,
    hermesKey,
    sttUrl,
    ttsUrl,
    ttsConcurrency,
    port,
    host: env.KOHAKO_BFF_HOST ?? '0.0.0.0',
    verifierEnabled: env.KOHAKO_VERIFIER_ENABLED === 'true',
    verifierUsername: env.KOHAKO_VERIFIER_USERNAME ?? 'system:serviceaccount:codex-workspace:codex-workspace',
    allowedToolsets: (env.KOHAKO_HERMES_TOOLSETS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  }
}
