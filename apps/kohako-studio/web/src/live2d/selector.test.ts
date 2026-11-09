import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupSelector } from './selector'

type Stub = { href?: string; children: Stub[]; append: (...items: Stub[]) => void; [key: string]: unknown }

const stubElement = (): Stub => {
  const element: Stub = {
    children: [],
    append: (...items) => { element.children.push(...items) },
    appendChild: (item: Stub) => { element.children.push(item); return item },
    addEventListener: () => undefined,
    setAttribute: () => undefined,
    classList: { add: () => undefined, toggle: () => undefined },
    style: {},
    selectedOptions: [],
  }
  return element
}

const hrefs = (element: Stub): string[] => [
  ...(element.href ? [element.href] : []),
  ...element.children.flatMap(hrefs),
]

const render = (search: string): string[] => {
  vi.stubGlobal('location', { search, pathname: '/kohako/studio.html', hash: '' })
  vi.stubGlobal('document', { body: stubElement(), createElement: stubElement })
  vi.stubGlobal('history', { replaceState: () => undefined })
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => undefined })
  const container = stubElement()
  setupSelector(container as unknown as HTMLElement, true)
  return hrefs(container)
}

describe('試作の比較リンク', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('全身 v11m のリンクは v11m の配信ファイルだけを指す', () => {
    const links = render('?model=kohako-full-v11m').filter(href => href.includes('/compare/'))
    expect(links).toHaveLength(5)
    for (const href of links) {
      expect(href).toContain('/compare/kohako-full-v11m-')
      expect(existsSync(resolve(__dirname, '../../public', href)), href).toBe(true)
    }
  })

  it('全身 v11l のリンクは v11l の配信ファイルだけを指す', () => {
    const links = render('?model=kohako-full-v11l').filter(href => href.includes('/compare/'))
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(href).toContain('/compare/kohako-full-v11l-')
      expect(existsSync(resolve(__dirname, '../../public', href)), href).toBe(true)
    }
  })

  it('全身 v11k のリンクは v11k の配信ファイルだけを指す', () => {
    const links = render('?model=kohako-full-v11k').filter(href => href.includes('/compare/'))
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(href).toContain('/compare/kohako-full-v11k-')
      expect(existsSync(resolve(__dirname, '../../public', href)), href).toBe(true)
    }
  })

  it('studio.html の固定文言に最新版の番号を書かない', () => {
    const footer = readFileSync(resolve(__dirname, '../../studio.html'), 'utf8').match(/<footer>.*<\/footer>/)?.[0]
    expect(footer).toBeDefined()
    expect(footer).not.toMatch(/全身 v\d+/)
  })
})
