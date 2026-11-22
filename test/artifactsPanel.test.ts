// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: (...args: unknown[]) => http(...args) },
  GatewayError: class extends Error {}
}))

const FAR = 'https://far.example'
const row = (path: string, seconds: number, exists = true) => ({
  kind: 'image',
  source: 'written',
  session_id: 's1',
  session_title: 'Chat',
  message_id: seconds,
  timestamp: seconds,
  path,
  exists
})
let farPaths: string[] = []

beforeEach(() => {
  localStorage.clear()
  http.mockReset()
  farPaths = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    keptHttp: async (_url: string, path: string) => {
      farPaths.push(path)
      if (path === '/api/profiles') return { ok: true, result: { profiles: [{ name: 'default' }] } }
      return { ok: true, result: { ok: true, items: [row('/far/old.png', 1_000)], next_before: null } }
    }
  }
})

describe('the Artifacts page across combined dashboards', () => {
  it("pages this host past a page with none of the chip's before another host's older rows, and hides gone files", async () => {
    // This host's newest page of a long history holds no images; its next one does.
    http.mockImplementation(async (_method: string, path: string) =>
      path.includes('before=30')
        ? { ok: true, items: [row('/here/new.png', 5_000)], next_before: null }
        : { ok: true, items: [], next_before: 30 }
    )
    const path = '../src/renderer/src/components/ArtifactsPanel.tsx'
    const { ArtifactsPanel } = (await import(/* @vite-ignore */ path)) as { ArtifactsPanel: unknown }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(ArtifactsPanel as never, {
          page: true,
          sessionIds: [],
          kept: [{ url: FAR, state: 'live' }],
          dashboards: [
            { url: 'https://here.example', name: 'Here', badge: null },
            { url: FAR, name: 'Far', badge: null }
          ]
        } as never)
      )
    )
    await settle()
    // Gone files are left out by default, on both hosts.
    expect(http.mock.calls[0]![1]).toContain('missing=hide')
    expect(farPaths.some(p => p.includes('missing=hide'))).toBe(true)
    // The far host's old row waits: this host may hold newer ones.
    expect(host.textContent).not.toContain('old.png')
    const more = [...host.querySelectorAll('button')].find(b => b.textContent === 'Show More')!
    act(() => more.click())
    await settle()
    const names = [...host.querySelectorAll('.artifact-name')].map(n => n.textContent)
    expect(names).toEqual(['new.png', 'old.png'])
    act(() => root.unmount())
  })

  it('lists a file once when the other dashboard is the same Hermes at another address', async () => {
    http.mockImplementation(async () => ({ ok: true, items: [row('/here/new.png', 5_000), row('/far/old.png', 1_000)], next_before: null }))
    const path = '../src/renderer/src/components/ArtifactsPanel.tsx'
    const { ArtifactsPanel } = (await import(/* @vite-ignore */ path)) as { ArtifactsPanel: unknown }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(ArtifactsPanel as never, {
          page: true,
          sessionIds: [],
          kept: [{ url: FAR, state: 'live' }],
          dashboards: [
            { url: 'https://here.example', name: 'Here', badge: null },
            { url: FAR, name: 'Far', badge: null }
          ]
        } as never)
      )
    )
    await settle()
    expect([...host.querySelectorAll('.artifact-name')].map(n => n.textContent)).toEqual(['new.png', 'old.png'])
    act(() => root.unmount())
  })

  it("keeps another dashboard's link that this host has too, and says so when a dashboard shown alone can't be read", async () => {
    const link = { kind: 'link', source: 'link', session_id: 's1', session_title: 'Chat', message_id: 9, timestamp: 9_000, url: 'https://example.com/a' }
    http.mockImplementation(async () => ({ ok: true, items: [link], next_before: null }))
    let farDown = false
    ;(window as unknown as { conduit: unknown }).conduit = {
      keptHttp: async (_url: string, path: string) =>
        path === '/api/profiles'
          ? { ok: true, result: { profiles: [{ name: 'default' }] } }
          : farDown
            ? { ok: false, error: 'Far is offline' }
            : { ok: true, result: { ok: true, items: [{ ...link, timestamp: 8_000 }], next_before: null } }
    }
    const path = '../src/renderer/src/components/ArtifactsPanel.tsx'
    const { ArtifactsPanel } = (await import(/* @vite-ignore */ path)) as { ArtifactsPanel: unknown }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(ArtifactsPanel as never, {
          page: true,
          sessionIds: [],
          kept: [{ url: FAR, state: 'live' }],
          dashboards: [
            { url: 'https://here.example', name: 'Here', badge: null },
            { url: FAR, name: 'Far', badge: null }
          ]
        } as never)
      )
    )
    await settle()
    expect(host.querySelectorAll('.artifact-name')).toHaveLength(2)
    farDown = true
    const chip = [...host.querySelectorAll('button')].find(b => b.textContent === 'Far')!
    act(() => chip.click())
    await settle()
    expect(host.textContent).toContain('Far is offline')
    act(() => root.unmount())
  })
})

describe('the Artifacts page: #304 review leftovers (desktop#308)', () => {
  const PANEL = '../src/renderer/src/components/ArtifactsPanel.tsx'
  const render = async (props: Record<string, unknown>) => {
    const { ArtifactsPanel } = (await import(/* @vite-ignore */ PANEL)) as { ArtifactsPanel: unknown }
    const host = document.createElement('div')
    const root = createRoot(host)
    const draw = (next: Record<string, unknown>) => act(() => root.render(createElement(ArtifactsPanel as never, { page: true, sessionIds: [], ...next } as never)))
    draw(props)
    await settle()
    return { host, root, draw }
  }
  const names = (host: HTMLElement) => [...host.querySelectorAll('.artifact-name')].map(n => n.textContent)
  const asks = (paths: string[]) => paths.filter(p => p === '/api/profiles').length

  it('lists a file once when one other Hermes is saved at two addresses, and keeps a different Hermes\'s file at the same path', async () => {
    const [A, B] = ['https://a.example', 'https://a-too.example']
    http.mockImplementation(async () => ({ ok: true, items: [{ ...row('/shared/plan.png', 5_000), session_id: 'here-chat' }], next_before: null }))
    ;(window as unknown as { conduit: unknown }).conduit = {
      keptHttp: async (_url: string, path: string) =>
        path === '/api/profiles'
          ? { ok: true, result: { profiles: [{ name: 'default' }] } }
          : { ok: true, result: { ok: true, items: [{ ...row('/shared/plan.png', 1_000), session_id: 'far-chat' }], next_before: null } }
    }
    const kept = [A, B].map(url => ({ url, state: 'live' }))
    const dashboards = [{ url: 'https://here.example', name: 'Here', badge: null }, ...[A, B].map(url => ({ url, name: url, badge: null }))]
    const { host, root } = await render({ kept, dashboards })
    // This host's file and the other Hermes's, once though it's saved at two addresses.
    expect(names(host)).toEqual(['plan.png', 'plan.png'])
    act(() => root.unmount())
  })

  it('stops narrowing to a dashboard whose chip left with it', async () => {
    const C = 'https://c.example'
    http.mockImplementation(async () => ({ ok: true, items: [row('/here/new.png', 5_000)], next_before: null }))
    const kept = [{ url: C, state: 'live' }]
    const both = [{ url: 'https://here.example', name: 'Here', badge: null }, { url: C, name: 'Far C', badge: null }]
    const { host, root, draw } = await render({ kept, dashboards: both })
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Far C')!.click())
    await settle()
    expect(names(host)).toEqual(['old.png'])
    draw({ kept: [], dashboards: both.slice(0, 1) })
    await settle()
    expect(names(host)).toEqual(['new.png'])
    act(() => root.unmount())
  })

  it("reads another dashboard's profiles once, not on every reload", async () => {
    const D = 'https://d.example'
    http.mockImplementation(async () => ({ ok: true, items: [], next_before: null }))
    const props = { kept: [{ url: D, state: 'live' }], dashboards: [{ url: 'https://here.example', name: 'Here', badge: null }, { url: D, name: 'D', badge: null }] }
    const first = await render(props)
    act(() => first.root.unmount())
    const second = await render(props)
    expect(asks(farPaths)).toBe(1)
    act(() => second.root.unmount())
  })

  it('frees Show More when the filter changes while a page is out', async () => {
    http.mockImplementation((_method: string, path: string) =>
      path.includes('before=30') ? new Promise(() => {}) : Promise.resolve({ ok: true, items: [row('/here/new.png', 5_000)], next_before: 30 })
    )
    const { host, root } = await render({})
    const end = () => host.querySelector('.artifact-more')
    act(() => (end() as HTMLButtonElement).click())
    await settle()
    expect(end()?.textContent).toBe('Loading…')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Images')!.click())
    await settle()
    expect(end()?.textContent).toBe('Show More')
    act(() => root.unmount())
  })
})
