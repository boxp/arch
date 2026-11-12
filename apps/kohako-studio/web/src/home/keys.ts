export function shouldSubmit(e: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }): boolean { return e.key === 'Enter' && e.shiftKey && !e.isComposing && e.keyCode !== 229 }
