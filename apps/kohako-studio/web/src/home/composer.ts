// BOXP-523: 入力欄は常に新しい発言。受理未確認の控えは送信待ち欄にだけ出し、送信の分岐は本文を比較せず状態だけで決める。
export function submitAction({
  hasUnconfirmed,
  queueing,
  confirmingBlocked,
}: {
  hasUnconfirmed: boolean
  queueing: boolean
  confirmingBlocked: boolean
}): 'enqueue-and-confirm' | 'enqueue' | 'send' {
  // 控えがある間は入力を直接送らない（直接送ると控えの再送に置き換わり入力が失われる）。確認できない間は送信待ちへ積むだけ。
  if (hasUnconfirmed) return confirmingBlocked ? 'enqueue' : 'enqueue-and-confirm'
  return queueing ? 'enqueue' : 'send'
}
