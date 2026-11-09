export type SentenceEvents = { onSentence(index: number, sentence: string): void; onEnd(): void; onError(message: string): void }
export function createSentenceSpeaker(deps: { synth: { speak(u: unknown): void; cancel(): void }; makeUtterance(text: string): { onstart: unknown; onend: unknown; onerror: unknown } }) {
  let generation = 0
  function cancel() { generation++; deps.synth.cancel() }
  function speak(sentences: string[], events: SentenceEvents) {
    cancel(); const current = generation
    const next = (index: number) => {
      if (current !== generation) return
      if (index >= sentences.length) { generation++; events.onEnd(); return }
      const utterance = deps.makeUtterance(sentences[index])
      utterance.onstart = () => { if (current === generation) events.onSentence(index, sentences[index]) }
      utterance.onend = () => { if (current === generation) next(index + 1) }
      utterance.onerror = (event: { error?: string }) => {
        if (current !== generation) return
        generation++
        if (event.error === 'interrupted' || event.error === 'canceled') events.onEnd()
        else events.onError(event.error ?? 'unknown')
      }
      try { deps.synth.speak(utterance) } catch (e) { if (current === generation) { generation++; events.onError(e instanceof Error ? e.message : String(e)) } }
    }
    next(0)
  }
  return { speak, cancel }
}
export function createSilentSentencer(deps: { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void }) {
  let generation = 0, timer: number | undefined
  function cancel() { generation++; if (timer !== undefined) deps.clearTimeout(timer); timer = undefined }
  function run(sentences: string[], secondsFor: (sentence: string) => number, events: SentenceEvents) {
    cancel(); const current = generation
    // 音声同期ではなく文の長さに応じた時間配分。
    const next = (index: number) => {
      if (generation !== current) return
      if (index >= sentences.length) { timer = undefined; generation++; events.onEnd(); return }
      events.onSentence(index, sentences[index])
      if (generation !== current) return
      timer = deps.setTimeout(() => next(index + 1), secondsFor(sentences[index]) * 1000)
    }
    next(0)
  }
  return { run, cancel }
}
