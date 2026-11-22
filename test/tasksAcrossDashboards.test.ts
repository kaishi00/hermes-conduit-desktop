// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useCron, type CronSource } from '../src/renderer/src/state/useCron'
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
  if (path.startsWith('/api/plugins/kanban/board')) return { ok: true, result: { columns: [{ name: 'todo', tasks: [] }] } }
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
})

afterEach(() => vi.useRealTimers())

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
