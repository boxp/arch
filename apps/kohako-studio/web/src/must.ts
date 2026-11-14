export function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a value')
  return value
}
