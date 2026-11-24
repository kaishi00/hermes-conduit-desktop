// @vitest-environment happy-dom
/**
 * Settings > Usage and Capabilities > Plugins both wait on a dashboard route that
 * takes ten seconds or more on a host with a large library (desktop#444): the usage
 * route alone measured 14.7 s, the plugins hub 11.9 s. The pane must not wait for
 * them one after another, and it must say it is still working rather than sit on a
 * bare "Loading…".
 */
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '../src/shared/i18n'
import { setKeptAnswersHost } from '../src/renderer/src/state/keptAnswers'
import { settle } from './hookHarness'

type Asked = { method: string; path: string }
const asked: Asked[] = []
const pending = new Map<string, (value: unknown) => void>()

/** A read that answers only when the test says so, like a route that takes its time. */
function held(key: string): Promise<unknown> {
  return new Promise(resolve => pending.set(key, resolve))
}

const http = vi.fn((_method: string, path: string) => {
  asked.push({ method: 'GET', path })
  return held(path)
})
const rpc = vi.fn((method: string, _params?: unknown) => {
  asked.push({ method: 'RPC', path: `rpc:${method}` })
  return held(`rpc:${method}`)
})

vi.mock('../src/renderer/src/gateway', () => ({
  gateway: {
    http: (...args: unknown[]) => http(args[0] as string, args[1] as string),
    rpc: (...args: unknown[]) => rpc(args[0] as string, args[1] as unknown)
  },
  GatewayError: class extends Error {}
}))

const text = (host: HTMLElement) => host.textContent ?? ''

// Paths the node typecheck doesn't follow: these components are the renderer's, checked by tsconfig.web.json.
const USAGE_PANE = '../src/renderer/src/components/UsagePage.tsx'
const PLUGINS_TAB = '../src/renderer/src/components/PluginsTab.tsx'

async function mount(file: string, name: string, props: Record<string, unknown>) {
  const loaded = (await import(/* @vite-ignore */ file)) as Record<string, ComponentType<never>>
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(createElement(loaded[name]!, props as never)))
  return { host, unmount: () => act(() => root.unmount()) }
}

let hostCount = 0

beforeEach(() => {
  setLanguage('en')
  // A host of its own per test: the kept answers' memory outlives localStorage.clear().
  setKeptAnswersHost(`http://host.test/${++hostCount}`)
  asked.length = 0
  pending.clear()
  http.mockClear()
  rpc.mockClear()
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('Settings > Usage', () => {
  it('asks the totals, the models and the quotas together, so the pane waits for the slowest, not their sum', async () => {
    // Fake timers only after the mount: the reads go out on the effect, which needs no time.
    const view = await mount(USAGE_PANE, 'UsagePage', { bots: [{ name: 'default', title: 'Hermes' }], profile: 'default', onBack: () => {} })
    await settle()
    try {
      expect(asked.map(a => a.path).sort()).toEqual([
        '/api/analytics/models?days=30',
        '/api/analytics/usage?days=30',
        'rpc:model.options'
      ])
    } finally {
      view.unmount()
    }
  })

  it('draws the totals without waiting for the quota read', async () => {
    const view = await mount(USAGE_PANE, 'UsagePage', { bots: [{ name: 'default', title: 'Hermes' }], profile: 'default', onBack: () => {} })
    await settle()
    try {
      await act(async () => {
        pending.get('/api/analytics/usage?days=30')!({ totals: { total_input: 1000, total_output: 500 } })
        pending.get('/api/analytics/models?days=30')!({ models: [] })
        // rpc:model.options stays in flight: its own section never holds the totals.
      })
      await settle()
      expect(text(view.host)).toContain('Totals')
      expect(text(view.host)).not.toContain('Loading…')
    } finally {
      view.unmount()
    }
  })

  it('draws a quick return from the answer it kept, without asking the slow route again', async () => {
    const props = { bots: [{ name: 'default', title: 'Hermes' }], profile: 'default', onBack: () => {} }
    const first = await mount(USAGE_PANE, 'UsagePage', props)
    await settle()
    await act(async () => {
      pending.get('/api/analytics/usage?days=30')!({ totals: { total_input: 1000, total_output: 500 } })
      pending.get('/api/analytics/models?days=30')!({ models: [] })
      pending.get('rpc:model.options')!({ options: [] })
    })
    await settle()
    expect(text(first.host)).toContain('Totals')
    first.unmount()

    // Back into the pane a moment later: the kept answer draws and nothing is asked.
    asked.length = 0
    pending.clear()
    const again = await mount(USAGE_PANE, 'UsagePage', props)
    await settle()
    try {
      expect(text(again.host)).toContain('Totals')
      expect(asked).toEqual([])
    } finally {
      again.unmount()
    }
  })

  it('drops a read for the period left when the period come back to draws its kept answer', async () => {
    const view = await mount(USAGE_PANE, 'UsagePage', { bots: [{ name: 'default', title: 'Hermes' }], profile: 'default', onBack: () => {} })
    await settle()
    try {
      await act(async () => {
        pending.get('/api/analytics/usage?days=30')!({ totals: { total_input: 1000, total_output: 500 } })
        pending.get('/api/analytics/models?days=30')!({ models: [] })
        pending.get('rpc:model.options')!({ options: [] })
      })
      await settle()
      const radios = () => [...view.host.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      const thirty = radios().findIndex(radio => radio.getAttribute('aria-checked') === 'true')
      const other = radios().findIndex((_, index) => index !== thirty)
      // Away to another period, whose read stays out, and back inside the window.
      act(() => radios()[other]!.click())
      await settle()
      act(() => radios()[thirty]!.click())
      await settle()
      const shown = text(view.host)
      const late = [...pending.keys()].find(key => key.startsWith('/api/analytics/usage?days=') && !key.endsWith('=30'))!
      await act(async () => {
        pending.get(late)!({ totals: { total_input: 987_654_321, total_output: 1 } })
      })
      await settle()
      expect(text(view.host)).toBe(shown)
      const refresh = [...view.host.querySelectorAll('button')].find(button => button.textContent?.includes('Refresh'))!
      expect(refresh.disabled).toBe(false)
    } finally {
      view.unmount()
    }
  })

  it('draws the totals while the per-model route is still out', async () => {
    const view = await mount(USAGE_PANE, 'UsagePage', { bots: [{ name: 'default', title: 'Hermes' }], profile: 'default', onBack: () => {} })
    await settle()
    try {
      await act(async () => {
        pending.get('/api/analytics/usage?days=30')!({ totals: { total_input: 1000, total_output: 500 } })
        // /api/analytics/models stays in flight: the totals never wait on it.
      })
      await settle()
      expect(text(view.host)).toContain('Totals')
      expect(text(view.host)).not.toContain('Loading…')
    } finally {
      view.unmount()
    }
  })

  it('says it is still working past ten seconds, then draws the answer that lands', async () => {
    vi.useFakeTimers()
    const view = await mount(USAGE_PANE, 'UsagePage', { bots: [{ name: 'default', title: 'Hermes' }], profile: 'default', onBack: () => {} })
    await settle()
    expect(text(view.host)).toContain('Loading…')

    act(() => void vi.advanceTimersByTime(10_000))
    await settle()
    expect(text(view.host)).toContain('This is taking longer than usual.')

    await act(async () => {
      pending.get('/api/analytics/usage?days=30')!({ totals: { total_input: 1000, total_output: 500 } })
      pending.get('/api/analytics/models?days=30')!({ models: [] })
      pending.get('rpc:model.options')!({ options: [] })
    })
    await settle()
    expect(text(view.host)).not.toContain('This is taking longer than usual.')
    expect(text(view.host)).toContain('Totals')
    view.unmount()
  })
})

describe('Capabilities > Plugins', () => {
  it('says it is still working when the plugins hub takes longer than usual', async () => {
    vi.useFakeTimers()
    const view = await mount(PLUGINS_TAB, 'PluginsTab', { profile: 'default', query: '', host: undefined })
    await settle()
    expect(text(view.host)).toContain('Loading…')

    act(() => void vi.advanceTimersByTime(10_000))
    await settle()
    expect(text(view.host)).toContain('This is taking longer than usual.')
    view.unmount()
  })
})

describe('Capabilities > Plugins, one answer at a time', () => {
  it('draws the installed list while the catalog is still out', async () => {
    // Catalog is a separate route, and the slower one: the list must not wait for it.
    const view = await mount(PLUGINS_TAB, 'PluginsTab', { profile: 'default', query: '', host: undefined })
    await settle()
    try {
      await act(async () => {
        pending.get('/api/dashboard/plugins/hub')!({ plugins: [{ name: 'zeta', source: 'git', can_update_git: true }] })
      })
      await settle()
      const installedOnly = view.host.querySelectorAll('.cap-row').length
      expect(installedOnly).toBe(1)
      // The catalog's rows join when their own route answers, without a second look at the list.
      await act(async () => {
        pending.get('/api/dashboard/plugins/catalog')!({ entries: [{ name: 'alpha', title: 'Alpha' }, { name: 'beta', title: 'Beta' }] })
      })
      await settle()
      expect(view.host.querySelectorAll('.cap-row').length).toBe(installedOnly + 2)
    } finally {
      view.unmount()
    }
  })

})
