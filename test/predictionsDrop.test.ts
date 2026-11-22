// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'

const http = vi.fn(async (method: string) =>
  method === 'GET' ? { version: '0.190.0', capabilities: ['predict'] } : { replies: [{ text: 'Sounds good', p: 0.9 }] }
)
vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: (...args: unknown[]) => http(...(args as [string])) } }))

const { usePredictions } = await import('../src/renderer/src/state/usePredictions')
const { TranscriptStore } = await import('../src/renderer/src/state/transcriptStore')
const { instructionsKey } = await import('../src/renderer/src/state/predictive')

describe("suggested replies when the instructions change in another window (desktop#274)", () => {
  it('drops the replies made under the old instructions', async () => {
    localStorage.setItem('conduit.predictive.replies', 'true')
    const store = new TranscriptStore({
      items: [
        { kind: 'user', key: 'u', text: 'hi' },
        { kind: 'assistant', key: 'a', text: 'Shall I book it?', streaming: false }
      ],
      running: false
    } as never)
    const hook = renderHook(() => usePredictions(store, 'live-a'), undefined)
    await settle()
    await settle()
    expect(hook.result().replies).toEqual(['Sounds good'])
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    await settle()
    expect(hook.result().replies).toEqual(['Sounds good'])
    window.dispatchEvent(new StorageEvent('storage', { key: instructionsKey('replies') }))
    await settle()
    expect(hook.result().replies).toEqual([])
    hook.unmount()
  })
})
