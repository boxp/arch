export type View = { kind: 'usage'; title?: string } | { kind: 'map'; title: string; destination: { name: string; address?: string }; origin?: string; mode?: 'transit' | 'walking' | 'driving' | 'bicycling' } | { kind: 'html'; title: string; html: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k))
const str = (v: unknown, max: number, html = false) => typeof v === 'string' && v.length > 0 && v.length <= max && !(html ? /[\x00-\x08\x0b-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/).test(v)
export function validateView(v: unknown): View | null {
  if (!object(v)) return null
  if (v.kind === 'usage') return keys(v, ['kind', 'title']) && (v.title === undefined || str(v.title, 60)) ? v as View : null
  if (!str(v.title, 60)) return null
  if (v.kind === 'html') return keys(v, ['kind', 'title', 'html']) && str(v.html, 20000, true) ? v as View : null
  if (v.kind === 'map' && keys(v, ['kind', 'title', 'destination', 'origin', 'mode']) && object(v.destination) && keys(v.destination, ['name', 'address']) && str(v.destination.name, 80) && (v.destination.address === undefined || str(v.destination.address, 120)) && (v.origin === undefined || str(v.origin, 120)) && (v.mode === undefined || ['transit', 'walking', 'driving', 'bicycling'].includes(v.mode as string))) return v as View
  return null
}

export function validateViews(v: unknown): View[] { return Array.isArray(v) ? v.map(validateView).filter((x): x is View => x !== null).slice(0, 1) : [] }
export function mapsUrl(view: Extract<View, { kind: 'map' }>, useOrigin: boolean): string {
  const p = new URLSearchParams({ api: '1', destination: [view.destination.name, view.destination.address].filter(Boolean).join(' ') })
  if (view.mode) p.set('travelmode', view.mode)
  if (useOrigin && view.origin) p.set('origin', view.origin)
  return `https://www.google.com/maps/dir/?${p}`
}
export function htmlSrcdoc(html: string): string { return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>` }
