// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  // Every bridge call the faces' modules make is a no-op here.
  const values: Record<string, unknown> = { platform: 'win32', appIcon: 'dark' }
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy(values, {
    get: (target, key: string) =>
      key in target ? target[key] : key.startsWith('on') ? () => () => {} : () => Promise.resolve([])
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

const bot = (name: string, title: string) => ({ name, title, pinned: false, hidden: false, isDefault: false, hasAvatar: false, face: 0, meta: {} })
const own = (name: string, title: string) => ({ key: name, host: 'https://here.example', bot: bot(name, title), own: true })
const far = (name: string, title: string) => ({ key: `https://far.example ${name}`, host: 'https://far.example', bot: bot(name, title), own: false })

async function mount(props: Record<string, unknown>) {
  const path = '../src/renderer/src/components/RailFaces.tsx'
  const { RailFaces } = (await import(/* @vite-ignore */ path)) as { RailFaces: unknown }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(createElement(RailFaces as never, props as never)))
  return host
}

describe('collapsed strip of faces', () => {
  it('draws each bot in order, marks the open one and the busy one, and opens on click', async () => {
    const tiles = [own('default', 'Conduit'), own('furina', 'Furina'), own('yelan', 'Yelan')]
    const onOpen = vi.fn()
    const host = await mount({ tiles, open: { profile: 'furina' }, running: new Set(['yelan']), onOpen })
    const faces = [...host.querySelectorAll<HTMLButtonElement>('.rail-faces .rail-face')]
    expect(faces.map(f => f.getAttribute('aria-label'))).toEqual(['Conduit', 'Furina', 'Yelan · Working'])
    expect(faces.map(f => f.getAttribute('aria-current'))).toEqual([null, 'page', null])
    expect(faces.map(f => !!f.querySelector('.work-ring.working'))).toEqual([false, false, true])
    act(() => faces[2].click())
    expect(onOpen).toHaveBeenCalledWith(tiles[2])
  })

  it("draws other dashboards' bots with their badge, and marks a far Bot Chat on its own host only", async () => {
    const tiles = [own('default', 'Conduit'), far('default', 'Mira')]
    const badgeFor = (tile: { own: boolean }) => (tile.own ? null : { letter: 'T', color: '#123456', name: 'Test' })
    const onOpen = vi.fn()
    const host = await mount({ tiles, open: { profile: 'default', host: 'https://far.example' }, running: new Set(['default']), badgeFor, onOpen })
    const faces = [...host.querySelectorAll<HTMLButtonElement>('.rail-face')]
    expect(faces.map(f => f.getAttribute('aria-label'))).toEqual(['Conduit · Working', 'Mira · Test'])
    expect(faces.map(f => f.getAttribute('aria-current'))).toEqual([null, 'page'])
    expect(faces.map(f => !!f.querySelector('.host-badge'))).toEqual([false, true])
    // Running is this dashboard's: the far bot of the same name shows no dot.
    expect(faces.map(f => !!f.querySelector('.work-ring'))).toEqual([true, false])
    act(() => faces[1].click())
    expect(onOpen).toHaveBeenCalledWith(tiles[1])
  })

  it("shows the Bots list's work: a ring for a bot at work, a needs-you ring with its count that wins over it", async () => {
    const tiles = [own('default', 'Conduit'), own('furina', 'Furina'), far('mira', 'Mira')]
    const work: Record<string, { working: number; needsYou: number }> = {
      furina: { working: 1, needsYou: 2 },
      mira: { working: 3, needsYou: 0 }
    }
    const host = await mount({ tiles, running: new Set(), workOf: (tile: { bot: { name: string } }) => work[tile.bot.name], onOpen: () => {} })
    const faces = [...host.querySelectorAll<HTMLButtonElement>('.rail-face')]
    expect(faces.map(f => f.querySelector('.work-ring')?.className ?? null)).toEqual([null, 'work-ring needs', 'work-ring working'])
    // The count of what needs you rides on the ring.
    expect(faces[1].querySelector('.work-ring-count')?.textContent).toBe('2')
    expect(faces.map(f => f.getAttribute('aria-label'))).toEqual(['Conduit', 'Furina · 2 needs you', 'Mira · Working'])
  })

  it('keeps right-clicks off the rail\'s section menu', async () => {
    const path = '../src/renderer/src/components/RailFaces.tsx'
    const { RailFaces } = (await import(/* @vite-ignore */ path)) as { RailFaces: unknown }
    const railMenu = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    act(() =>
      createRoot(host).render(
        createElement(
          'nav',
          { onContextMenu: railMenu },
          createElement(RailFaces as never, { tiles: [own('default', 'Conduit')], running: new Set(), onOpen: () => {} } as never)
        )
      )
    )
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => {
      host.querySelector('.rail-face')!.dispatchEvent(event)
    })
    expect(railMenu).not.toHaveBeenCalled()
    // Nor Electron's edit menu, which shows when the page leaves the event alone.
    expect(event.defaultPrevented).toBe(true)
    // The strip's blank space still belongs to the rail.
    act(() => {
      host.querySelector('.rail-faces')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(railMenu).toHaveBeenCalledTimes(1)
  })

  it('draws nothing without bots', async () => {
    const host = await mount({ tiles: [], running: new Set(), onOpen: () => {} })
    expect(host.querySelector('.rail-faces')).toBeNull()
  })

  it('marks the edited bot, wears its badge and names its state in the tooltip', async () => {
    const host = await mount({
      tiles: [own('kaleb', 'Kaleb')],
      open: { profile: 'kaleb' },
      running: new Set<string>(),
      workOf: () => ({ needsYou: 2, working: 0 }),
      badgeFor: () => ({ letter: 'A', color: '#fff', name: 'Alpha' }),
      onOpen: () => {}
    })
    const face = host.querySelector<HTMLButtonElement>('.rail-face')!
    expect(face.getAttribute('aria-current')).toBe('page')
    expect(face.querySelector('.host-badge')).not.toBeNull()
    expect(face.getAttribute('title')).toBe('Kaleb · Alpha · 2 needs you')
  })

})
