export function chatEntries<T extends { who: string; text: string }>(history: readonly T[], bubbleText: string): T[] {
  const entries = history.slice(-50)
  const last = entries.at(-1)
  if (last?.who === 'コハコ' && last.text === bubbleText) entries.pop()
  return entries
}
