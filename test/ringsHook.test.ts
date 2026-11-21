// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { RINGS_CAPABILITY, RINGS_PATH, useRings } from '../src/renderer/src/state/rings'

let held: ((value: unknown) => void)[] = []

beforeEach(() => {
  held = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: (_method: string, path: string) =>
      path.startsWith(RINGS_PATH)
        ? new Promise(resolve => held.push(resolve))
        : Promise.resolve({ ok: true, result: { version: '1', capabilities: [RINGS_CAPABILITY] } })
  }
})

describe('rings across a dropped connection (desktop#216)', () => {
  it("drops a poll's answer that lands after the reset", async () => {
    const hook = renderHook(({ connected }: { connected: boolean }) => useRings(connected, []), { connected: true })
    await settle()
    expect(held).toHaveLength(1)
    hook.rerender({ connected: false })
    held[0]!({ ok: true, result: { now: 100, rings: [{ id: 'r1', at: 95, state: 'ringing', name: 'Nahida' }] } })
    await settle()
    expect(hook.result().ringing).toEqual([])

    // Back on: the ring is still ringing on the host, so it rings now, read afresh.
    hook.rerender({ connected: true })
    await settle()
    held[1]!({ ok: true, result: { now: 101, rings: [{ id: 'r1', at: 95, state: 'ringing', name: 'Nahida' }] } })
    await settle()
    expect(hook.result().ringing.map(r => r.id)).toEqual(['r1'])
    hook.unmount()
  })
})
