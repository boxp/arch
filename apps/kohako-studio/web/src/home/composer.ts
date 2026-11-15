export function submitAction({
  hasUnconfirmed,
  queueing,
  confirmingBlocked,
}: {
  hasUnconfirmed: boolean
  queueing: boolean
  confirmingBlocked: boolean
}): 'enqueue-and-confirm' | 'enqueue' | 'send' {
  if (hasUnconfirmed && !confirmingBlocked) return 'enqueue-and-confirm'
  return queueing ? 'enqueue' : 'send'
}
