// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './hookHarness'

vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: vi.fn() } }))
vi.mock('../src/renderer/src/state/hostActions', () => ({ hermesUpdateRunning: () => false }))
const { gateway } = await import('../src/renderer/src/gateway')
const { POLL_MS } = await import('../src/renderer/src/state/gatewayWork')
const { setDashboardProfilesHost } = await import('../src/renderer/src/state/dashboardProfile')

const http = gateway.http as unknown as ReturnType<typeof vi.fn>

const GATEWAY_WORK = 'gateway-work'
const STATUS_PATH = '/api/plugins/conduit_push/capabilities'
const WORK_BODY = {
  units: [{ kind: 'chat', bot: 'Furina', title: 'Trip plan', session_id: 's1', profile: 'furina', elapsed_s: 600 }],
  count: 1,
  draining: true
}

const deferred = (): { promise: Promise<unknown>; resolve: (v: unknown) => void } => {
  let done!: (v: unknown) => void
  const promise = new Promise<unknown>(resolve => {
    done = resolve
  })
  return { promise, resolve: v => done(v) }
}

/** How many asks the capabilities route has seen. */
const asks = () => http.mock.calls.filter(([, path]) => path === STATUS_PATH).length

/** Render the component and let its first effects settle. */
async function mount(capabilities?: string[] | null) {
  // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
  const path = '../src/renderer/src/components/GatewayWait.tsx'
  const { GatewayWait } = (await import(/* @vite-ignore */ path)) as {
    GatewayWait: (p: { capabilities?: string[] | null }) => null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  const render = (next?: string[] | null) =>
    act(() => root.render(createElement(GatewayWait, next === undefined ? {} : { capabilities: next })))
  render(capabilities)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return { host, root, render, button: () => host.querySelector('.gateway-restart-now') }
}

/** Let the ask loop's promises settle through the next `advanceTimersByTimeAsync`. */
const flush = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

describe("Restart Gateway's GatewayWait (desktop#378)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setDashboardProfilesHost('https://a.example')
  })
  afterEach(() => {
    vi.useRealTimers()
    http.mockReset()
  })

  it('asks again after an unreadable answer, stops on a reported answer, and shows Restart Now', async () => {
    const responses: (() => Promise<unknown>)[] = [
      async () => {
        throw new Error('gateway unreachable')
      },
      async () => ({ version: '0.178.0', capabilities: [GATEWAY_WORK] })
    ]
    let seen = 0
    http.mockImplementation(async (_method: string, path: string) => {
      if (path !== STATUS_PATH) return {}
      return responses[Math.min(seen++, responses.length - 1)]()
    })

    const { root, button } = await mount()
    expect(asks()).toBe(1) // the first ask
    expect(button()).toBeNull()

    // The unreadable answer asks again on the next poll; the reported one stops the asking
    // and turns Restart Now on.
    await flush(POLL_MS)
    expect(asks()).toBe(2)
    expect(button()).not.toBeNull()

    // It stopped: three more polls add no asks (only the work reads tick now).
    await flush(POLL_MS * 3)
    expect(asks()).toBe(2)
    act(() => root.unmount())
  })

  it('a drain-time 404 is definitive: it stops the asking and shows nothing', async () => {
    http.mockImplementation(async (_method: string, path: string) => {
      if (path !== STATUS_PATH) return {}
      throw Object.assign(new Error('Not Found'), { code: 404 })
    })

    const { root, button } = await mount()
    expect(asks()).toBe(1)
    expect(button()).toBeNull()

    // Definitive: three more polls add no asks.
    await flush(POLL_MS * 3)
    expect(asks()).toBe(1)
    act(() => root.unmount())
  })

  it('reads the work list one at a time: a slow answer holds the polls, the next read waits for it', async () => {
    const pending: ((v: unknown) => void)[] = []
    http.mockImplementation((_method: string, _path: string) => {
      const d = deferred()
      pending.push(d.resolve)
      return d.promise
    })

    // The capability is known, so only the work-read loop runs (the ask loop is skipped).
    const { host, root } = await mount([GATEWAY_WORK])
    expect(http).toHaveBeenCalledTimes(1) // the first read
    expect(host.querySelector('.gateway-restart-now')).not.toBeNull()

    // The read is slow: three polls go by, each held by the guard — still one read.
    await flush(POLL_MS * 3)
    expect(http).toHaveBeenCalledTimes(1)

    // The read lands: the work lines show, and the next poll reads again.
    await act(async () => {
      pending[0](WORK_BODY)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(host.querySelector('.gateway-wait-lines')).not.toBeNull()
    await flush(POLL_MS)
    expect(http).toHaveBeenCalledTimes(2)

    // A slow second read holds the polls again.
    await flush(POLL_MS * 2)
    expect(http).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })

  it('the ask loop stops on unmount: no ask waits out a pending answer', async () => {
    http.mockImplementation(async () => deferred().promise)

    const { root, button } = await mount()
    expect(asks()).toBe(1)
    act(() => root.unmount())

    // Unmounted with the first ask still pending: three polls later the interval has added none.
    await flush(POLL_MS * 3)
    expect(asks()).toBe(1)
    expect(button()).toBeNull()
  })

  it('capabilities handed down mid-drain end the asking', async () => {
    http.mockImplementation(async () => deferred().promise)

    const { render, button } = await mount()
    expect(asks()).toBe(1)
    expect(button()).toBeNull()

    // The page learns the capabilities while the ask is still out: the loop cleans up and the
    // capability comes from the prop now.
    render([GATEWAY_WORK])
    await flush(POLL_MS * 3)
    expect(asks()).toBe(1)
    expect(button()).not.toBeNull()
  })
})
