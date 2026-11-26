// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  // Every bridge call the brand's modules make is a no-op here.
  const values: Record<string, unknown> = { platform: 'win32', appIcon: 'dark' }
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy(values, {
    get: (target, key: string) =>
      key in target ? target[key] : key.startsWith('on') ? () => () => {} : () => Promise.resolve([])
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function load() {
  const path = '../src/renderer/src/components/TitleBar.tsx'
  return (await import(/* @vite-ignore */ path)) as { TitleBar: unknown; Brand: unknown }
}

const hosts = [
  { url: 'https://a.example', method: 'password' },
  { url: 'https://b.example', method: 'password' }
]

function mount(el: unknown, props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(createElement(el as never, props as never)))
  return host
}

describe('brand in the rail (floating glass shell)', () => {
  it('a bare title bar keeps the drag strip, and its brand only for when a banner holds the island down', async () => {
    const { TitleBar } = await load()
    const host = mount(TitleBar, { bare: true, hosts, currentUrl: hosts[0].url, onSwitch: () => {} })
    const bar = host.querySelector('header.titlebar')!
    expect(bar.classList.contains('bare')).toBe(true)
    // app.css hides it unless the window shows a banner.
    expect(bar.querySelector(':scope > .brand')).not.toBeNull()
  })

  it('right-clicking the rail brand opens no menu', async () => {
    const { Brand } = await load()
    const host = mount(Brand, { inRail: true, hosts, currentUrl: hosts[0].url, onSwitch: () => {} })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => {
      host.querySelector('.rail-brand-button')!.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
  })

  it('the title bar on the sign-in screens still carries the brand', async () => {
    const { TitleBar } = await load()
    const host = mount(TitleBar, { hosts, currentUrl: hosts[0].url, onSwitch: () => {} })
    expect(host.querySelector('header.titlebar.bare')).toBeNull()
    expect(host.querySelector('header.titlebar .brand-mark')).not.toBeNull()
  })

  it('the rail brand opens the Hermes list and switches', async () => {
    const { Brand } = await load()
    const onSwitch = vi.fn()
    const host = mount(Brand, { inRail: true, hosts, currentUrl: hosts[0].url, onSwitch })
    const button = host.querySelector<HTMLButtonElement>('.rail-brand button.rail-brand-button')!
    expect(button).not.toBeNull()
    act(() => button.click())
    const items = [...host.querySelectorAll<HTMLButtonElement>('.rail-brand .host-menu [role="menuitemradio"]')]
    expect(items.map(i => i.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    act(() => items[1].click())
    expect(onSwitch).toHaveBeenCalledWith('https://b.example')
    expect(host.querySelector('.host-menu')).toBeNull()
  })

  it('with one Hermes the rail brand is a mark, not a button', async () => {
    const { Brand } = await load()
    const host = mount(Brand, { inRail: true, hosts: hosts.slice(0, 1), currentUrl: hosts[0].url, onSwitch: () => {} })
    expect(host.querySelector('.rail-brand button')).toBeNull()
    expect(host.querySelector('.rail-brand .brand-mark')).not.toBeNull()
  })
})

describe('the Hermes list by keyboard', () => {
  it('focuses the Hermes you are on, moves with the arrows, and gives focus back on Escape', async () => {
    const { Brand } = await load()
    const three = [...hosts, { url: 'https://c.example', method: 'password' }]
    const host = mount(Brand, { inRail: true, hosts: three, currentUrl: three[1].url, onSwitch: () => {} })
    const button = host.querySelector<HTMLButtonElement>('.rail-brand-button')!
    act(() => button.click())
    const items = [...host.querySelectorAll<HTMLButtonElement>('.host-menu [role="menuitemradio"]')]
    expect(document.activeElement).toBe(items[1])
    const key = (k: string) =>
      act(() => {
        ;(document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      })
    key('ArrowDown')
    expect(document.activeElement).toBe(items[2])
    key('ArrowDown')
    expect(document.activeElement).toBe(items[0])
    key('End')
    expect(document.activeElement).toBe(items[2])
    key('Home')
    expect(document.activeElement).toBe(items[0])
    key('Escape')
    expect(host.querySelector('.host-menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})

describe('the Hermes list closes', () => {
  async function opened() {
    const { Brand } = await load()
    const host = mount(Brand, { inRail: true, hosts, currentUrl: hosts[0].url, onSwitch: () => {} })
    const button = host.querySelector<HTMLButtonElement>('.rail-brand-button')!
    act(() => button.click())
    expect(host.querySelector('.host-menu')).not.toBeNull()
    return { host, button }
  }

  it('on a press outside it, but not on one inside', async () => {
    const { host } = await opened()
    act(() => {
      host.querySelector('.host-menu [role="menuitemradio"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(host.querySelector('.host-menu')).not.toBeNull()
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(host.querySelector('.host-menu')).toBeNull()
  })

  it('when the window loses focus', async () => {
    const { host } = await opened()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(host.querySelector('.host-menu')).toBeNull()
  })

  it('when focus tabs out of it, but not when it moves inside it', async () => {
    const { host } = await opened()
    const outside = document.createElement('button')
    document.body.append(outside)
    const items = [...host.querySelectorAll<HTMLButtonElement>('.host-menu [role="menuitemradio"]')]
    act(() => items[1].focus())
    expect(host.querySelector('.host-menu')).not.toBeNull()
    act(() => outside.focus())
    expect(host.querySelector('.host-menu')).toBeNull()
  })
})

describe('the brand is in one place (app.css)', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it("hides the bare title bar's brand without a banner, and the rail's with one", () => {
    const rule = /\.app:not\(:has\(> \.banner\)\) > \.titlebar\.bare > \.brand,\s*\.app:has\(> \.banner\) \.rail-brand \{\s*display: none;/
    expect(css).toMatch(rule)
  })
  it('lifts the island only without a banner', () => {
    expect(css).toMatch(/\.app:has\(> \.titlebar\.bare\):not\(:has\(> \.banner\)\) > \.body > \.rail,/)
  })
})

describe('you on this Hermes, at the top of the rail', () => {
  const picture = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  it('draws your picture with the dashboard badge in place of the app mark', async () => {
    const { Brand } = await load()
    const host = mount(Brand, { inRail: true, hosts, currentUrl: hosts[0].url, onSwitch: () => {}, picture, badge: { letter: 'F', color: '#123456', name: 'Furina' } })
    const you = host.querySelector('.rail-brand .brand-you')!
    expect(you.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(you.querySelector('.host-badge')?.textContent).toBe('F')
  })

  it('keeps the app mark without a picture, and in the title bar', async () => {
    const { Brand, TitleBar } = await load()
    const rail = mount(Brand, { inRail: true, hosts, currentUrl: hosts[0].url, onSwitch: () => {}, picture: null })
    expect(rail.querySelector('.brand-you')).toBeNull()
    expect(rail.querySelector('img.brand-mark')).not.toBeNull()
    const bar = mount(TitleBar, { hosts, currentUrl: hosts[0].url, onSwitch: () => {} })
    expect(bar.querySelector('.brand-you')).toBeNull()
  })

  it('opens Your Picture from the list, with one Hermes too', async () => {
    const { Brand } = await load()
    const onPicture = vi.fn()
    const host = mount(Brand, { inRail: true, hosts: hosts.slice(0, 1), currentUrl: hosts[0].url, onSwitch: () => {}, onPicture })
    act(() => host.querySelector<HTMLButtonElement>('button.rail-brand-button')!.click())
    const items = [...host.querySelectorAll<HTMLButtonElement>('.host-menu [role="menuitemradio"], .host-menu [role="menuitem"]')]
    expect(items[items.length - 1].textContent?.trim()).toBe('Choose Your Picture…')
    act(() => items[items.length - 1].click())
    expect(onPicture).toHaveBeenCalledOnce()
    expect(host.querySelector('.host-menu')).toBeNull()
  })
})
