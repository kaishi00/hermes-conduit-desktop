// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
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
