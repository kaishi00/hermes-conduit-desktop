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
    const bots = [bot('default', 'Conduit'), bot('furina', 'Furina'), bot('yelan', 'Yelan')]
    const onOpen = vi.fn()
    const host = await mount({ bots, openProfile: 'furina', running: new Set(['yelan']), onOpen })
    const faces = [...host.querySelectorAll<HTMLButtonElement>('.rail-faces .rail-face')]
    expect(faces.map(f => f.getAttribute('aria-label'))).toEqual(['Conduit', 'Furina', 'Yelan'])
    expect(faces.map(f => f.getAttribute('aria-current'))).toEqual([null, 'page', null])
    expect(faces.map(f => !!f.querySelector('.rail-face-running'))).toEqual([false, false, true])
    act(() => faces[2].click())
    expect(onOpen).toHaveBeenCalledWith(bots[2])
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
          createElement(RailFaces as never, { bots: [bot('default', 'Conduit')], running: new Set(), onOpen: () => {} } as never)
        )
      )
    )
    act(() => {
      host.querySelector('.rail-face')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    expect(railMenu).not.toHaveBeenCalled()
  })

  it('draws nothing without bots', async () => {
    const host = await mount({ bots: [], running: new Set(), onOpen: () => {} })
    expect(host.querySelector('.rail-faces')).toBeNull()
  })
})
