// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reads: string[] = []
let fsListFails = 0
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: {
    http: async (_method: string, path: string) => {
      const url = new URL(path, 'http://x')
      if (url.pathname === '/api/fs/list') {
        if (fsListFails > 0) {
          fsListFails--
          throw new Error('Hermes didn’t answer')
        }
        return { entries: [{ name: 'c.txt', path: '/elsewhere/c.txt' }] }
      }
      if (url.pathname.endsWith('/list')) {
        return { entries: [{ name: 'a.txt', path: '/r/a.txt', mtime: 1 }, { name: 'b.txt', path: '/r/b.txt', mtime: 1 }] }
      }
      if (url.pathname.endsWith('/read-text')) {
        const file = url.searchParams.get('path')!
        reads.push(file)
        return { path: file, text: `text of ${file}` }
      }
      return {}
    }
  },
  GatewayError: class extends Error {}
}))

beforeEach(() => {
  reads.length = 0
  fsListFails = 0
  localStorage.clear()
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy(
    { platform: 'linux' } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : () => () => {}) }
  )
})

const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
})

describe('the Folder’s file tabs (issue 454)', () => {
  it('opens each file in a tab, goes back to a tab without reading it again, and Back keeps the tabs', async () => {
    const path = '../src/renderer/src/components/FilesPanel.tsx'
    const { FilesPanel } = (await import(/* @vite-ignore */ path)) as { FilesPanel: unknown }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(FilesPanel as never, { root: '/r', refreshKey: 0, onInsertPath: () => {}, onClose: () => {} } as never)))
    await settle()

    const row = (name: string) => [...host.querySelectorAll('.ws-tree .ws-row')].find(b => b.textContent?.includes(name)) as HTMLButtonElement
    act(() => row('a.txt').click())
    await settle()
    expect(host.querySelector('.ws-code')?.textContent).toContain('text of /r/a.txt')
    // One file: no tab strip yet, as on the phone.
    expect(host.querySelector('.ws-tabs')).toBeNull()

    // Back to the tree keeps the tab, which shows over the tree.
    act(() => (host.querySelector('[data-back]') as HTMLButtonElement).click())
    await settle()
    expect([...host.querySelectorAll('.ws-tab [role="tab"]')].map(b => b.textContent)).toEqual(['a.txt'])

    act(() => row('b.txt').click())
    await settle()
    const tabs = () => [...host.querySelectorAll('.ws-tab [role="tab"]')] as HTMLButtonElement[]
    expect(tabs().map(b => b.textContent)).toEqual(['a.txt', 'b.txt'])
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true')

    act(() => tabs()[0].click())
    await settle()
    expect(host.querySelector('.ws-code')?.textContent).toContain('text of /r/a.txt')
    expect(reads).toEqual(['/r/a.txt', '/r/b.txt'])

    // Closing the shown tab shows the other.
    act(() => (host.querySelector('.ws-tab.on .ws-tab-close') as HTMLButtonElement).click())
    await settle()
    expect(host.querySelector('.ws-code')?.textContent).toContain('text of /r/b.txt')
    expect(host.querySelector('.ws-tabs')).toBeNull()
    act(() => root.unmount())
  })

  it('a folder a reply named that couldn’t be listed shows its tab, and a click lists it again', async () => {
    fsListFails = 1
    const path = '../src/renderer/src/components/FilesPanel.tsx'
    const { FilesPanel } = (await import(/* @vite-ignore */ path)) as { FilesPanel: unknown }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() =>
      root.render(createElement(FilesPanel as never, { root: '/r', refreshKey: 0, reveal: { path: '/elsewhere/', id: 1 }, onInsertPath: () => {}, onClose: () => {} } as never))
    )
    await settle()
    expect(host.querySelector('.ws-viewer .error-text')?.textContent).toContain('Hermes didn’t answer')
    const tab = host.querySelector('.ws-tab [role="tab"]') as HTMLButtonElement
    expect(tab).not.toBeNull()
    act(() => tab.click())
    await settle()
    expect(host.querySelector('.ws-viewer .error-text')).toBeNull()
    expect(host.querySelector('.ws-folder')?.textContent).toContain('c.txt')
    act(() => root.unmount())
  })
})
