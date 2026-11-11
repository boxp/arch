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
