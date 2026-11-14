/** 外部から届いた JSON（非信頼）のうち、配列でない object だけを通す。 */
export const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
