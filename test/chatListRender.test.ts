import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

describe('the chat list draws', () => {
  it('its rows, the open one current and a running one with its status', async () => {
    const { ChatList } = await import('../src/renderer/src/components/ChatList')
    const now = Date.now()
    const rows = [
      { id: 'a', title: 'Alpha', activeAt: now, pinned: true },
      { id: 'b', title: 'Beta', preview: 'hello', activeAt: now - 1000, pinned: false }
    ]
    const html = renderToStaticMarkup(
      createElement(ChatList as never, {
        rows,
        error: null,
        selectedId: 'b',
        runningIds: new Set(['b']),
        runningStatus: 'reading files',
        onSelect: () => {},
        onNewChat: () => {},
        onPin: () => {}
      } as never)
    )
    expect(html).toContain('Alpha')
    expect(html).toMatch(/aria-current="true"[^>]*>.*Beta/)
    expect(html).toContain('reading files')
  })
})
