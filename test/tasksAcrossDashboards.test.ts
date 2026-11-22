// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { KEPT_CRON_POLL_MS, useCron, type CronSource } from '../src/renderer/src/state/useCron'
import { FAR_BOARDS_POLL_MS, useKanban } from '../src/renderer/src/state/useKanban'

const FAR = 'https://far.example'
type Outcome = { ok: true; result: unknown } | { ok: false; error: string }
type Call = { host: string | null; method: string; path: string }
let calls: Call[] = []

const job = (id: string, profile: string) => ({ id, name: id, enabled: true, profile })
function answer(host: string | null, path: string): Outcome {
  if (path.startsWith('/api/cron/jobs')) {
    const profile = new URLSearchParams(path.split('?')[1] ?? '').get('profile')
    const all = host ? [job('far-1', 'nova'), job('far-2', 'atlas')] : [job('own-1', 'default'), job('own-2', 'mira')]
    return { ok: true, result: { jobs: all.filter(j => !profile || profile === 'all' || j.profile === profile) } }
  }
  if (path.startsWith('/api/plugins/kanban/boards')) return { ok: true, result: { boards: host ? [{ slug: 'releases', name: 'Releases', is_current: true }] : [{ slug: 'seabag', name: 'SeaBag', is_current: true }] } }
  if (path.startsWith('/api/plugins/kanban/board')) return { ok: true, result: { columns: [{ name: 'todo', tasks: host ? [{ id: 't1', title: 'Ship it' }] : [] }] } }
  return { ok: true, result: {} }
}

beforeEach(() => {
  localStorage.clear()
  calls = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: async (method: string, path: string) => {
      calls.push({ host: null, method, path })
      return answer(null, path)
    },
    keptHttp: async (url: string, path: string, method?: string) => {
      calls.push({ host: url, method: method ?? 'GET', path })
      return answer(url, path)
    },
    onEvent: () => () => undefined
  }
})

describe('Scheduled across combined dashboards', () => {
  it("All lists this dashboard's jobs and every kept one's, each tagged with its dashboard", async () => {
    const sources: CronSource[] = [{ host: null, profile: null }, { host: FAR, profile: null }]
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: sources })
    await settle()
    expect(hook.result().jobs?.map(j => [j.id, j.host ?? null])).toEqual([
      ['own-1', null],
      ['own-2', null],
      ['far-1', FAR],
      ['far-2', FAR]
    ])
    hook.unmount()
  })

  it("another dashboard's face lists its profile's jobs, and an action goes to that dashboard", async () => {
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: [{ host: FAR, profile: 'nova' }] })
    await settle()
    expect(hook.result().jobs?.map(j => j.id)).toEqual(['far-1'])
    await hook.result().act('pause', hook.result().jobs![0])
    expect(calls.find(c => c.method === 'POST')).toEqual({ host: FAR, method: 'POST', path: '/api/cron/jobs/far-1/pause?profile=nova' })
    hook.unmount()
  })

  it("a dashboard whose read fails leaves the others' jobs listed", async () => {
    const conduit = (window as unknown as { conduit: { keptHttp: unknown } }).conduit
    conduit.keptHttp = async (): Promise<Outcome> => ({ ok: false, error: 'down' })
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: [{ host: null, profile: null }, { host: FAR, profile: null }] })
    await settle()
    expect(hook.result().jobs?.map(j => j.id)).toEqual(['own-1', 'own-2'])
    expect(hook.result().error).toBeNull()
    hook.unmount()
  })

  it("a dashboard that answered once and then fails keeps its last jobs in All", async () => {
    vi.useFakeTimers()
    const conduit = (window as unknown as { conduit: { keptHttp: (url: string, path: string) => Promise<Outcome> } }).conduit
    let up = true
    conduit.keptHttp = async (url, path) => (up ? answer(url, path) : { ok: false, error: 'down' })
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: [{ host: null, profile: null }, { host: FAR, profile: null }] })
    await settle()
    expect(hook.result().jobs?.map(j => j.id)).toEqual(['own-1', 'own-2', 'far-1', 'far-2'])
    up = false
    await vi.advanceTimersByTimeAsync(KEPT_CRON_POLL_MS)
    await settle()
    expect(hook.result().jobs?.map(j => j.id)).toEqual(['own-1', 'own-2', 'far-1', 'far-2'])
    hook.unmount()
  })
})

afterEach(() => vi.useRealTimers())

describe('Scheduled after a change', () => {
  it("a job deleted on another dashboard stays gone when the refresh after it fails", async () => {
    const conduit = (window as unknown as { conduit: { keptHttp: (url: string, path: string, method?: string) => Promise<Outcome> } }).conduit
    let up = true
    conduit.keptHttp = async (url, path, method) => {
      calls.push({ host: url, method: method ?? 'GET', path })
      if (method === 'DELETE') {
        up = false
        return { ok: true, result: {} }
      }
      return up ? answer(url, path) : { ok: false, error: 'down' }
    }
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: [{ host: null, profile: null }, { host: FAR, profile: null }] })
    await settle()
    const gone = hook.result().jobs!.find(j => j.id === 'far-1')!
    expect(await hook.result().remove(gone)).toBeNull()
    await settle()
    expect(hook.result().jobs?.map(j => j.id)).toEqual(['own-1', 'own-2', 'far-2'])
    hook.unmount()
  })

  it("a far job paused stays paused when the refresh after it fails", async () => {
    const conduit = (window as unknown as { conduit: { keptHttp: (url: string, path: string, method?: string) => Promise<Outcome> } }).conduit
    let up = true
    conduit.keptHttp = async (url, path, method) => {
      if (method === 'POST') {
        up = false
        return { ok: true, result: {} }
      }
      return up ? answer(url, path) : { ok: false, error: 'down' }
    }
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: [{ host: null, profile: null }, { host: FAR, profile: null }] })
    await settle()
    expect(await hook.result().act('pause', hook.result().jobs!.find(j => j.id === 'far-1')!)).toBeNull()
    await settle()
    expect(hook.result().jobs?.find(j => j.id === 'far-1')?.enabled).toBe(false)
    hook.unmount()
  })

  it('an edited far job keeps its edit when the refresh after it fails (desktop#348)', async () => {
    const conduit = (window as unknown as { conduit: { keptHttp: (url: string, path: string, method?: string) => Promise<Outcome> } }).conduit
    let up = true
    conduit.keptHttp = async (url, path, method) => {
      if (method === 'PUT') {
        up = false
        return { ok: true, result: { job: { ...job('far-1', 'nova'), name: 'Morning digest' } } }
      }
      return up ? answer(url, path) : { ok: false, error: 'down' }
    }
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: [{ host: null, profile: null }, { host: FAR, profile: null }] })
    await settle()
    await hook.result().update(hook.result().jobs!.find(j => j.id === 'far-1')!, { name: 'Morning digest' })
    await settle()
    expect(hook.result().jobs?.find(j => j.id === 'far-1')).toMatchObject({ name: 'Morning digest', host: FAR, profile: 'nova' })
    hook.unmount()
  })

  it('a new far job is listed when the refresh after it fails (desktop#348)', async () => {
    const conduit = (window as unknown as { conduit: { keptHttp: (url: string, path: string, method?: string) => Promise<Outcome> } }).conduit
    let up = true
    conduit.keptHttp = async (url, path, method) => {
      if (method === 'POST') {
        up = false
        return { ok: true, result: { job: { id: 'far-3', name: 'far-3', enabled: true } } }
      }
      return up ? answer(url, path) : { ok: false, error: 'down' }
    }
    const hook = renderHook(({ s }: { s: CronSource[] }) => useCron(s, true), { s: [{ host: null, profile: null }, { host: FAR, profile: null }] })
    await settle()
    const made = await hook.result().create({ name: 'far-3' }, 'atlas', FAR)
    expect(made).toMatchObject({ id: 'far-3', profile: 'atlas', host: FAR })
    await settle()
    expect(hook.result().jobs?.map(j => j.id)).toEqual(['own-1', 'own-2', 'far-1', 'far-2', 'far-3'])
    hook.unmount()
  })

  it('a kept far pick shows again only while its dashboard lists that profile (desktop#348)', async () => {
    const path = '../src/renderer/src/components/ScheduledJobs.tsx'
    const { ScheduledJobs } = (await import(/* @vite-ignore */ path)) as { ScheduledJobs: unknown }
    const bot = (name: string) => ({ name, title: name, pinned: false, hidden: false, isDefault: false })
    const own = { key: 'own\tmira', host: 'https://own.example', bot: bot('mira'), own: true }
    const nova = { key: `${FAR}\tnova`, host: FAR, bot: bot('nova'), own: false }
    const box = document.createElement('div')
    document.body.append(box)
    const root = createRoot(box)
    const draw = (tiles: unknown[]) =>
      act(() =>
        root.render(createElement(ScheduledJobs as never, { bots: [], connected: true, profile: 'mira', onProfile: () => {}, tiles, onOpenRun: () => {}, segment: null } as never))
      )
    const face = () => [...box.querySelectorAll<HTMLButtonElement>('button.profile-column-face')].find(b => b.getAttribute('aria-label')?.startsWith('nova'))
    const readsMira = async (from: number) => {
      await settle()
      return calls.slice(from).some(c => c.host === null && c.path.includes('profile=mira'))
    }
    draw([own, nova])
    await settle()
    act(() => face()!.click())
    await settle()
    expect(face()!.getAttribute('aria-selected')).toBe('true')
    // Its dashboard leaves the column: the list falls back to Chats' profile.
    let before = calls.length
    draw([own])
    expect(await readsMira(before)).toBe(true)
    // Back again: the far face is picked again and its profile is read there.
    before = calls.length
    draw([own, nova])
    await settle()
    expect(face()!.getAttribute('aria-selected')).toBe('true')
    expect(calls.slice(before).some(c => c.host === FAR && c.path.includes('profile=nova'))).toBe(true)
    // The dashboard is back but no longer lists that profile (renamed): Chats' profile, not a profile that's gone.
    before = calls.length
    draw([own, { ...nova, key: `${FAR}\tnova2`, bot: bot('nova2') }])
    expect(await readsMira(before)).toBe(true)
    expect(calls.slice(before).some(c => c.host === FAR && c.path.includes('profile=nova'))).toBe(false)
    act(() => root.unmount())
    box.remove()
  })

  it("tapping the chosen far face again goes back to Chats' profile, not to All", async () => {
    const path = '../src/renderer/src/components/ScheduledJobs.tsx'
    const { ScheduledJobs } = (await import(/* @vite-ignore */ path)) as { ScheduledJobs: unknown }
    const bot = (name: string) => ({ name, title: name, pinned: false, hidden: false, isDefault: false })
    const tiles = [
      { key: 'own\tmira', host: 'https://own.example', bot: bot('mira'), own: true },
      { key: `${FAR}\tnova`, host: FAR, bot: bot('nova'), own: false }
    ]
    const picked: (string | null)[] = []
    const box = document.createElement('div')
    document.body.append(box)
    const root = createRoot(box)
    act(() =>
      root.render(
        createElement(ScheduledJobs as never, { bots: [], connected: true, profile: 'mira', onProfile: (p: string | null) => picked.push(p), tiles, onOpenRun: () => {}, segment: null } as never)
      )
    )
    await settle()
    const face = () => [...box.querySelectorAll<HTMLButtonElement>('button.profile-column-face')].find(b => b.getAttribute('aria-label')?.startsWith('nova'))!
    act(() => face().click())
    await settle()
    expect(face().getAttribute('aria-selected')).toBe('true')
    const before = calls.length
    act(() => face().click())
    await settle()
    expect(face().getAttribute('aria-selected')).toBe('false')
    expect(picked).toEqual([])
    expect(calls.slice(before).some(c => c.host === null && c.path.includes('profile=mira'))).toBe(true)
    act(() => root.unmount())
    box.remove()
  })
})

describe("Board's boards across combined dashboards", () => {
  it('a dashboard still connecting when Board opens lists its boards once it answers', async () => {
    vi.useFakeTimers()
    const conduit = (window as unknown as { conduit: { keptHttp: (url: string, path: string) => Promise<Outcome> } }).conduit
    let up = false
    conduit.keptHttp = async (url, path) => (up ? answer(url, path) : { ok: false, error: 'Not connected to that Hermes.' })
    const hook = renderHook(({ far }: { far: string[] }) => useKanban(true, true, far), { far: [FAR] })
    await settle()
    expect(hook.result().lists.map(l => l.host)).toEqual([null])
    up = true
    await vi.advanceTimersByTimeAsync(FAR_BOARDS_POLL_MS)
    await settle()
    expect(hook.result().lists.map(l => l.host)).toEqual([null, FAR])
    hook.unmount()
  })

  it("lists each kept dashboard's boards, and a far pick is read there and kept for next time", async () => {
    const hook = renderHook(({ far }: { far: string[] }) => useKanban(true, true, far), { far: [FAR] })
    await settle()
    expect(hook.result().lists.map(l => [l.host, l.boards.map(b => b.slug)])).toEqual([
      [null, ['seabag']],
      [FAR, ['releases']]
    ])
    hook.result().pickBoard('releases', FAR)
    await settle()
    expect(hook.result().host).toBe(FAR)
    expect(calls.some(c => c.host === FAR && c.path.startsWith('/api/plugins/kanban/board?board=releases'))).toBe(true)
    hook.unmount()

    // Next time, the far pick comes back while its dashboard is kept...
    const again = renderHook(({ far }: { far: string[] }) => useKanban(true, true, far), { far: [FAR] })
    await settle()
    expect([again.result().host, again.result().slug]).toEqual([FAR, 'releases'])
    // ...and this dashboard's board shows once it isn't.
    again.rerender({ far: [] })
    await settle()
    expect(again.result().host).toBeNull()
    again.unmount()
  })
})

describe('Board', () => {
  it("closes a far board's open task when that dashboard leaves the group", async () => {
    // No slug on either side: only the dashboard changes, so the reset must follow the host.
    localStorage.setItem('conduit.kanbanFarBoard', JSON.stringify({ host: FAR, slug: null }))
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const path = '../src/renderer/src/components/KanbanBoard.tsx'
    const { KanbanBoard } = (await import(/* @vite-ignore */ path)) as { KanbanBoard: unknown }
    const bot = { name: 'nova', title: 'Nova', pinned: false, hidden: false, isDefault: false }
    const far = [{ key: `${FAR}\tnova`, host: FAR, bot, own: false }]
    const box = document.createElement('div')
    document.body.append(box)
    const root = createRoot(box)
    const draw = (tiles: unknown[]) => act(() => root.render(createElement(KanbanBoard as never, { connected: true, bots: [], tiles, segment: null } as never)))
    draw(far)
    await settle()
    const card = [...box.querySelectorAll<HTMLButtonElement>('button.card')].find(b => b.textContent?.includes('Ship it'))
    expect(card).toBeTruthy()
    act(() => card!.click())
    await settle()
    expect(box.querySelector('aside.task-panel')).not.toBeNull()
    draw([])
    await settle()
    expect(box.querySelector('aside.task-panel')).toBeNull()
    act(() => root.unmount())
    box.remove()
  })
})
