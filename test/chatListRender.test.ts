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

  it('sits out a saved source the chats shown don’t come from, rather than empty the list', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    const now = Date.now()
    localStorage.setItem('conduit.chatFilters', JSON.stringify(['source:telegram']))
    const rows = [
      { id: 'a', title: 'Alpha', activeAt: now, pinned: false, profile: 'coder' },
      { id: 't', title: 'Tele', activeAt: now, pinned: false, profile: 'writer', sourceKind: 'telegram' }
    ]
    const render = (profile: string | null) =>
      renderToStaticMarkup(
        createElement(ChatList as never, {
          rows,
          error: null,
          selectedId: null,
          runningIds: new Set(),
          onSelect: () => {},
          onNewChat: () => {},
          profile,
          marks: { stars: [], seen: {}, baseline: now + 1, unread: [] }
        } as never)
      )
    const coder = render('coder')
    expect(coder).toContain('Alpha')
    expect(coder).not.toContain('filter-active')
    const all = render(null)
    expect(all).toContain('Tele')
    expect(all).not.toContain('Alpha')
    expect(all).toContain('filter-active')
    localStorage.removeItem('conduit.chatFilters')
  })
  it('leaves out the projects Filter › Projects hides, names them on the chip, and keeps pinned chats and searches', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    const now = Date.now()
    localStorage.setItem('conduit.hiddenChatProjects', JSON.stringify({ 'https://host\tcoder': ['site'] }))
    const rows = [
      { id: 'h', title: 'Loose', activeAt: now, pinned: false, profile: 'coder' },
      { id: 's1', title: 'Website copy', activeAt: now, pinned: false, profile: 'coder' },
      { id: 's2', title: 'Website pinned', activeAt: now, pinned: true, profile: 'coder' }
    ]
    const list = [
      { id: 'home', title: 'Home', isHome: true, isAuto: false, count: 1, previews: [{ id: 'h', title: 'Loose' }] },
      { id: 'site', title: 'Site', isHome: false, isAuto: false, count: 2, previews: [{ id: 's1', title: 'Website copy' }, { id: 's2', title: 'Website pinned' }] }
    ]
    const render = (extra: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(ChatList as never, {
          rows,
          error: null,
          selectedId: null,
          runningIds: new Set(),
          onSelect: () => {},
          onNewChat: () => {},
          profile: 'coder',
          searchScope: 'https://host',
          marks: { stars: [], seen: {}, baseline: now + 1, unread: [] },
          ...extra
        } as never)
      )
    const shown = render({ projects: { profile: 'coder', list } })
    expect(shown).toContain('Loose')
    expect(shown).not.toContain('Website copy')
    expect(shown).toContain('Website pinned')
    expect(shown).toContain('1 project hidden')
    // With no filter chosen the chip names only what's hidden, as the phone's does.
    expect(shown).not.toMatch(/filter-active-chip[^>]*>All/)
    // Until the tree loads nothing is hidden, and without a tree (All with several profiles) nothing is offered.
    expect(render({ projects: { profile: 'coder', list: null } })).toContain('Website copy')
    expect(render({})).toContain('Website copy')
    localStorage.removeItem('conduit.hiddenChatProjects')
  })
  it('shows only another dashboard’s profile under its face, with no Filter menu or chip for this one’s chats', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    const now = Date.now()
    localStorage.setItem('conduit.chatFilters', JSON.stringify(['unread']))
    const html = renderToStaticMarkup(
      createElement(ChatList as never, {
        rows: [{ id: 'a', title: 'Here chat', activeAt: now, pinned: false, profile: 'coder' }],
        otherRows: [
          { host: 'https://lab', id: 'f1', title: 'Far ops chat', activeAt: now, pinned: false, profile: 'ops' },
          { host: 'https://lab', id: 'f2', title: 'Far writer chat', activeAt: now, pinned: false, profile: 'writer' }
        ],
        otherProfile: { host: 'https://lab', name: 'ops' },
        error: null,
        selectedId: null,
        runningIds: new Set(),
        onSelect: () => {},
        onNewChat: () => {},
        profile: null,
        marks: { stars: [], seen: {}, baseline: now + 1, unread: [] }
      } as never)
    )
    expect(html).toContain('Far ops chat')
    expect(html).not.toContain('Far writer chat')
    expect(html).not.toContain('Here chat')
    expect(html).not.toContain('filter-button')
    expect(html).not.toContain('filter-active')
    localStorage.removeItem('conduit.chatFilters')
  })
})
