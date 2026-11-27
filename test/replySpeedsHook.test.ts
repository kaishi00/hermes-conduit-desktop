// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useReplySpeeds } from '../src/renderer/src/state/useReplySpeeds'

type Props = { running: boolean }
let answer: () => { ok: boolean; result?: unknown; status?: number; error?: string }

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
    expect(hook.result()?.unsaved).toBe(55)
    expect(hook.result()?.byRow.get(7)).toBe(42)

    answer = () => ({ ok: false, status: 503, error: 'restarting' })
    hook.rerender({ running: true })
    await settle()
    expect(hook.result()?.unsaved).toBeUndefined()
    expect(hook.result()?.byRow.get(7)).toBe(42)

    // The turn ends and its read fails: still no earlier turn's speed on its reply.
    hook.rerender({ running: false })
    await settle()
    expect(hook.result()?.unsaved).toBeUndefined()
    expect(hook.result()?.byRow.get(7)).toBe(42)
    hook.unmount()
  })

  it('shows nothing while Show reply speed is off', async () => {
    localStorage.setItem('conduit.showReplySpeed', 'false')
    const hook = renderHook(({ running }: Props) => useReplySpeeds('a', undefined, true, running), { running: false })
    await settle()
    expect(hook.result()).toBeUndefined()
    hook.unmount()
  })
})
