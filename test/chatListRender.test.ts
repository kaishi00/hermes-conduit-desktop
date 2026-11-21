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
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
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

  it("its profiles in a column beside it, another dashboard's badged, and one Filter button for the filters", async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    const now = Date.now()
    const bot = (name: string) => ({ name, title: name[0].toUpperCase() + name.slice(1), hasAvatar: false })
    const rows = [
      { id: 'a', title: 'Alpha', activeAt: now, pinned: false, profile: 'coder' },
      { id: 'b', title: 'Beta', activeAt: now - 1000, pinned: false, profile: 'writer' }
    ]
    const tiles = [
      { key: 'coder', host: 'https://home', bot: bot('coder'), own: true },
      { key: 'writer', host: 'https://home', bot: bot('writer'), own: true },
      { key: 'ops', host: 'https://lab', bot: bot('ops'), own: false }
    ]
    const html = renderToStaticMarkup(
      createElement(ChatList as never, {
        rows,
        error: null,
        selectedId: null,
        runningIds: new Set(),
        waitingIds: new Set(['a', 'b']),
        onSelect: () => {},
        onNewChat: () => {},
        bots: tiles.filter(t => t.own).map(t => t.bot),
        profile: 'coder',
        onProfile: () => {},
        profileTiles: tiles,
        tileBadge: (tile: { own: boolean }) => (tile.own ? null : { letter: 'L', color: '#34c759', name: 'Lab' }),
        otherWaits: () => 2,
        marks: { stars: [], seen: {}, baseline: now - 10_000, unread: [] }
      } as never)
    )
    expect(html).toContain('class="chatlist has-column"')
    expect(html).toMatch(/aria-selected="true" aria-label="Coder"/)
    expect(html).toContain('aria-label="Ops, Lab"')
    expect(html).toMatch(/profile-column-waits[^>]*>1</)
    expect(html).toMatch(/profile-column-waits[^>]*>2</)
    expect(html).toContain('filter-button')
    expect(html).toContain('filter-dot')
    expect(html).not.toContain('filter-chips')
    expect(html).not.toContain('Group by profile')
  })
})
