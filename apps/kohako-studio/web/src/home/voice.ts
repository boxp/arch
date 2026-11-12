// CPU ローカル合成は実時間より遅く(本番相当 2〜4 CPU で音声 8.8 秒に約 20〜40 秒)、120 字文をそのまま送ると
// nginx/Cloudflare の応答待ち上限を超え得る。1 要求を短く保ち、合成待ちと初回再生までの時間を抑える。
export const VOICE_CHUNK_MAX = 60
export function splitVoiceSentences(sentences: string[]): string[] {
  const result: string[] = []
  for (const sentence of sentences) {
    let rest = sentence
    while (rest.length > VOICE_CHUNK_MAX) { let cut = rest.lastIndexOf('、', VOICE_CHUNK_MAX - 1) + 1; if (!cut) cut = VOICE_CHUNK_MAX; if (cut < rest.length && /[\uD800-\uDBFF]/.test(rest[cut - 1]) && /[\uDC00-\uDFFF]/.test(rest[cut])) cut--; result.push(rest.slice(0, cut)); rest = rest.slice(cut) }
    if (rest) result.push(rest)
  }
  return result
}
type Events = { onSentence(index: number, sentence: string, durationSeconds: number): void; onChunkEnd?(index: number): void; onEnd(): void; onError(code: string, index: number): void }
export function createVoicePlayer(deps: { fetcher: typeof fetch; audio: HTMLAudioElement; createUrl(blob: Blob): string; revokeUrl(url: string): void; retryDelay?(): Promise<void> }) {
  let generation = 0, controller = new AbortController(), url: string | undefined, settle: (() => void) | undefined
  // fetch はレシーバ付き(deps.fetcher(...))で呼ぶと Chrome で Illegal invocation になり送信前に失敗するため、レシーバなしで呼ぶ。
  const audio = deps.audio
  function cancel() { generation++; controller.abort(); settle?.(); settle = undefined; controller = new AbortController(); audio.pause(); audio.onended = null; audio.onerror = null; audio.onplaying = null; audio.removeAttribute('src'); audio.load(); if (url) deps.revokeUrl(url); url = undefined }
  function speak(input: string[], events: Events, start = 0) {
    cancel(); const current = generation, signal = controller.signal
    const groups: { first: number; last: number; text: string }[] = []
    for (let i = start; i < input.length;) {
      const first = i; let text = input[i++]
      if (first !== start) {
        while (i < input.length) {
          const length = text.length + input[i].length
          const ended = /(?:[。！？!?…][」』）]*|\n)$/.test(text)
          if (length > 160 || (length > 120 && ended)) break
          text += input[i++]
        }
      }
      groups.push({ first, last: i - 1, text })
    }
    const fetchOnce = async (sentence: string) => { const fetcher = deps.fetcher; const r = await fetcher('/kohako/api/v1/tts', { method: 'POST', credentials: 'same-origin', redirect: 'manual', cache: 'no-store', headers: { 'content-type': 'application/json', 'X-Kohako-Request': '1' }, body: JSON.stringify({ text: sentence }), signal }); if (!r.ok) throw Error('fetch_failed'); return r.blob() }
    const fetchSentence = async (sentence: string) => { try { return await fetchOnce(sentence) } catch (e) { if (signal.aborted || current !== generation || (e instanceof Error && e.name === 'AbortError')) throw e; await (deps.retryDelay?.() ?? new Promise<void>(resolve => setTimeout(resolve, 1000))); if (signal.aborted || current !== generation) throw e; return fetchOnce(sentence) } }
    let index = start, next = 0, started = 0, fetching = false, failed = false
    type Result = { blob: Blob; error?: never } | { blob?: never; error: unknown }
    const results: Promise<Result>[] = []
    // CPU 合成は実時間より遅いため先読みを続け、文の途中での区切りも避ける。
    const pump = () => {
      if (fetching || failed || current !== generation || next >= groups.length || next - started >= 2) return
      const group = groups[next++]; fetching = true
      const result: Promise<Result> = fetchSentence(group.text).then(blob => ({ blob }), error => ({ error }))
      results.push(result)
      void result.then(value => { fetching = false; if ('error' in value) failed = true; else pump() })
    }
    const run = async () => {
      pump()
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i]; index = group.first
        // 前の再生開始時に pump がこのグループの要求を用意する。
        const result = await results[i]
        if (current !== generation) return
        if ('error' in result) throw result.error
        url = deps.createUrl(result.blob); audio.src = url
        await new Promise<void>((resolve, reject) => {
          let playing = false; settle = resolve
          audio.onplaying = () => { if (!playing && current === generation) { playing = true; started++; pump(); events.onSentence(group.first, group.text, Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0) } }
          audio.onended = () => { if (!playing) { playing = true; started++; pump() } resolve() }; audio.onerror = () => reject(Error('decode_failed'))
          try { void audio.play().catch(reject) } catch (e) { reject(e) }
        })
        if (current !== generation) return
        settle = undefined; events.onChunkEnd?.(group.last)
        if (url) deps.revokeUrl(url); url = undefined
      }
      if (current === generation) { generation++; events.onEnd() }
    }
    void run().catch(e => { if (current !== generation) return; cancel(); events.onError(e instanceof Error ? e.name === 'NotAllowedError' ? e.name : e.message : 'unknown', index) })
  }
  return { speak, cancel }
}
