// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useReplySpeeds } from '../src/renderer/src/state/useReplySpeeds'

type Props = { running: boolean }
type Outcome = { ok: boolean; result?: unknown; status?: number; error?: string }
let answer: () => Outcome | Promise<Outcome>

beforeEach(() => {
  localStorage.setItem('conduit.showReplySpeed', 'true')
  answer = () => ({ ok: true, result: { session_id: 'a', replies: [{ row_id: 7, tokens_per_s: 42 }, { row_id: null, tokens_per_s: 55 }] } })
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: async () => answer(),
    onEvent: () => () => undefined
  }
})

describe('the reply speeds hook', () => {
  it('drops the newest turn’s speed when the next turn starts or a read fails, and keeps the saved rows’', async () => {
    const hook = renderHook(({ running }: Props) => useReplySpeeds('a', undefined, true, running), { running: false })
    await settle()
    expect(hook.result().rows?.unsaved).toBe(55)
    expect(hook.result().rows?.byRow.get(7)).toBe(42)

    answer = () => ({ ok: false, status: 503, error: 'restarting' })
    hook.rerender({ running: true })
    await settle()
    expect(hook.result().rows?.unsaved).toBeUndefined()
    expect(hook.result().rows?.byRow.get(7)).toBe(42)

    // The turn ends and its read fails: still no earlier turn's speed on its reply.
    hook.rerender({ running: false })
    await settle()
    expect(hook.result().rows?.unsaved).toBeUndefined()
    expect(hook.result().rows?.byRow.get(7)).toBe(42)
    hook.unmount()
  })

  it('shows nothing while Show reply speed is off', async () => {
    localStorage.setItem('conduit.showReplySpeed', 'false')
    const hook = renderHook(({ running }: Props) => useReplySpeeds('a', undefined, true, running), { running: false })
    await settle()
    expect(hook.result().rows).toBeUndefined()
    expect(hook.result().composer).toBeUndefined()
    hook.unmount()
  })

  it('shows the newest reply’s speed in the composer on its own switch, dimmed until the next turn’s is read', async () => {
    localStorage.setItem('conduit.showReplySpeed', 'false')
    localStorage.setItem('conduit.showReplySpeedInComposer', 'true')
    const hook = renderHook(({ running }: Props) => useReplySpeeds('a', undefined, true, running), { running: false })
    await settle()
    expect(hook.result().rows).toBeUndefined()
    expect(hook.result().composer).toEqual({ rate: 55, stale: false })

    // The next turn runs: the last speed stays, dimmed, and stays so when the turn's read fails.
    answer = () => ({ ok: false, status: 503, error: 'restarting' })
    hook.rerender({ running: true })
    await settle()
    expect(hook.result().composer).toEqual({ rate: 55, stale: true })
    hook.rerender({ running: false })
    await settle()
    expect(hook.result().composer).toEqual({ rate: 55, stale: true })

    // The next read brings the new turn's speed.
    answer = () => ({ ok: true, result: { session_id: 'a', replies: [{ row_id: 7, tokens_per_s: 42 }, { row_id: 9, tokens_per_s: 61 }] } })
    hook.rerender({ running: true })
    await settle()
    hook.rerender({ running: false })
    await settle()
    expect(hook.result().composer).toEqual({ rate: 61, stale: false })
    hook.unmount()
    localStorage.removeItem('conduit.showReplySpeedInComposer')
  })

  it('keeps the chip dimmed when a read asked before the next turn started answers during it', async () => {
    localStorage.setItem('conduit.showReplySpeedInComposer', 'true')
    const hook = renderHook(({ running }: Props) => useReplySpeeds('a', undefined, true, running), { running: false })
    await settle()
    expect(hook.result().composer).toEqual({ rate: 55, stale: false })

    // A turn ends and its read hangs; the next turn starts before it answers.
    let release: (outcome: Outcome) => void = () => undefined
    answer = () => new Promise<Outcome>(resolve => (release = resolve))
    hook.rerender({ running: true })
    await settle()
    hook.rerender({ running: false })
    await settle()
    hook.rerender({ running: true })
    release({ ok: true, result: { session_id: 'a', replies: [{ row_id: 7, tokens_per_s: 42 }, { row_id: 9, tokens_per_s: 61 }] } })
    await settle()
    expect(hook.result().composer).toEqual({ rate: 55, stale: true })

    // That turn's own read fails: still dimmed, never gone.
    answer = () => ({ ok: false, status: 503, error: 'restarting' })
    hook.rerender({ running: false })
    await settle()
    expect(hook.result().composer).toEqual({ rate: 55, stale: true })
    hook.unmount()
    localStorage.removeItem('conduit.showReplySpeedInComposer')
  })

  it('starts another chat with no composer speed', async () => {
    localStorage.setItem('conduit.showReplySpeedInComposer', 'true')
    const hook = renderHook(({ id }: { id: string }) => useReplySpeeds(id, undefined, true, false), { id: 'a' })
    await settle()
    expect(hook.result().composer?.rate).toBe(55)
    answer = () => ({ ok: true, result: { session_id: 'b', replies: [] } })
    hook.rerender({ id: 'b' })
    expect(hook.result().composer).toBeUndefined()
    await settle()
    expect(hook.result().composer).toBeUndefined()
    hook.unmount()
    localStorage.removeItem('conduit.showReplySpeedInComposer')
  })
})
