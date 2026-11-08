import { existsSync } from 'node:fs'
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

  it('全身 v11k のリンクは v11k の配信ファイルだけを指す', () => {
    const links = render('?model=kohako-full-v11k').filter(href => href.includes('/compare/'))
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(href).toContain('/compare/kohako-full-v11k-')
      expect(existsSync(resolve(__dirname, '../../public', href)), href).toBe(true)
    }
  })
})
