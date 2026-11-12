import { it, expect } from 'vitest'
import { validateViews, mapsUrl, htmlSrcdoc, sanitizeHtml } from './views'
it('validates and constructs a fixed maps URL', () => {
  const v = { kind: 'map' as const, title: '地図', destination: { name: 'javascript:alert(1)', address: '東京' }, origin: '大阪', mode: 'walking' as const }
  const u = new URL(mapsUrl(v, true)); expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/'); expect(u.searchParams.get('destination')).toBe('javascript:alert(1) 東京'); expect(u.searchParams.get('origin')).toBe('大阪'); expect(new URL(mapsUrl(v, false)).searchParams.has('origin')).toBe(false)
  expect(validateViews([{ ...v, extra: 1 }, { kind: 'usage' }])).toEqual([{ kind: 'usage' }])
  expect(validateViews([{ kind: 'html', title: 'x', html: 'a'.repeat(20001) }, { kind: 'usage', title: '\u0001' }])).toEqual([])
})
it('places the CSP before untrusted HTML', () => { const s = htmlSrcdoc('<script>ok()</script>'); expect(s.startsWith('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"')).toBe(true); expect(s.indexOf('Content-Security-Policy')).toBeLessThan(s.indexOf('<script>')); expect(s).toContain("script-src 'none'"); expect(s).not.toMatch(/script-src[^;]*unsafe-inline/) })
it('refuses to parse untrusted HTML in a document with a browsing context', () => { expect(() => sanitizeHtml('<img src="http://x/">', { defaultView: {} } as unknown as Document)).toThrow() })
it('validates geo and builds only numeric OpenStreetMap URLs', async () => {
  const { osmUrl } = await import('./views')
  const geo = { lat: 35.6812, lon: 139.7671, bbox: [139.7631, 35.6772, 139.7711, 35.6852] as [number, number, number, number], precision: 'exact' as const, label: '東京駅', source: 'openstreetmap' as const }
  const view = { kind: 'map', title: '地図', destination: { name: '東京駅' }, geo }
  expect(validateViews([view])).toEqual([view])
  const url = new URL(osmUrl(geo)); expect(url.origin + url.pathname).toBe('https://www.openstreetmap.org/export/embed.html'); expect(url.searchParams.get('bbox')).toBe(geo.bbox.join(',')); expect(url.searchParams.get('marker')).toBe('35.6812,139.7671')
  expect(new URL(osmUrl({ ...geo, precision: 'area' })).searchParams.has('marker')).toBe(false)
  for (const bad of [{ ...geo, lat: '35' }, { ...geo, bbox: ['1&x=2', 0, 2, 3] }, { ...geo, lon: 181 }, { ...geo, precision: 'other' }, { ...geo, label: '' }, { ...geo, source: 'other' }]) expect(validateViews([{ ...view, geo: bad }])).toEqual([])
})
