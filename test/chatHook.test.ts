// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChat } from '../src/renderer/src/state/useChat'
import { forgetTranscripts } from '../src/renderer/src/state/transcriptCache'

type Event = { type: string; session_id?: string; payload?: unknown }
let listeners: ((event: Event) => void)[] = []
let resumes: Record<string, { messages: unknown[]; held?: boolean }> = {}
let pendingResumes: (() => void)[] = []
let holdResumes = false
let calls: string[] = []

beforeEach(() => {
  forgetTranscripts()
  listeners = []
  resumes = {}
  pendingResumes = []
  holdResumes = false
  calls = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    rpcOutcome: (method: string, params: Record<string, unknown>) => {
      calls.push(method)
      if (method === 'session.resume') {
        const id = String(params.session_id)
        const answer = { ok: true, result: { session_id: `live-${id}`, stored_session_id: id, messages: resumes[id]?.messages ?? [] } }
        if (!holdResumes) return Promise.resolve(answer)
        return new Promise(resolve => pendingResumes.push(() => resolve(answer)))
      }
      if (method === 'session.create') return Promise.resolve({ ok: true, result: { session_id: 'live-new', stored_session_id: 'new' } })
      return Promise.resolve({ ok: true, result: {} })
    },
    httpOutcome: async () => ({ ok: false, error: 'none', code: 404 }),
    onEvent: (listener: (event: Event) => void) => {
      listeners.push(listener)
      return () => (listeners = listeners.filter(l => l !== listener))
    }
  }
})

const history = (...texts: string[]) => texts.flatMap(text => [
  { role: 'user', content: text },
  { role: 'assistant', content: `re: ${text}` }
])
const words = (state: { items: { kind: string; text?: string }[] }) => state.items.map(i => i.text ?? i.kind)
type Props = { storedId: string | null; connected: boolean; url?: string }
// As App calls it: each dashboard keeps its own transcripts (desktop#233).
const chatInApp = ({ storedId, connected, url }: Props) => useChat(storedId, undefined, false, connected, false, undefined, url)
const emit = (event: Event) => act(() => listeners.forEach(l => l(event)))

describe("the transcript cache's wiring (desktop#218)", () => {
  it('draws a chat left a moment ago at once while its resume runs', async () => {
    resumes.a = { messages: history('one') }
    resumes.b = { messages: history('two') }
    const hook = renderHook(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    await settle()
    hook.rerender({ storedId: 'b', connected: true, url: 'h1' })
    await settle()
    holdResumes = true
    hook.rerender({ storedId: 'a', connected: true, url: 'h1' })
    expect(words(hook.result().transcript)).toEqual(['one', 're: one'])
  })

  it.each([
    ['with a chat open', 'b' as string | null],
    ['with none open', null]
  ])('forgets every kept transcript when the connection drops, %s', async (_label, open) => {
    resumes.a = { messages: history('one') }
    const hook = renderHook(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    await settle()
    hook.rerender({ storedId: open, connected: true, url: 'h1' })
    await settle()
    hook.rerender({ storedId: open, connected: false, url: 'h1' })
    hook.rerender({ storedId: open, connected: true, url: 'h1' })
    await settle()
    holdResumes = true
    hook.rerender({ storedId: 'a', connected: true, url: 'h1' })
    expect(hook.result().transcript.items).toEqual([])
  })

  it("keeps each dashboard's transcripts apart, and the old one's for coming back", async () => {
    resumes.a = { messages: history('one') }
    const hook = renderHook(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    await settle()
    holdResumes = true
    // Another dashboard's chat of the same id never draws this one's rows.
    hook.rerender({ storedId: 'a', connected: true, url: 'h2' })
    expect(hook.result().transcript.items).toEqual([])
    hook.rerender({ storedId: 'a', connected: true, url: 'h1' })
    expect(words(hook.result().transcript)).toEqual(['one', 're: one'])
  })

  it('keeps a chat created here on its first leave, without resuming it', async () => {
    resumes.b = { messages: history('two') }
    const hook = renderHook(chatInApp, { storedId: null, connected: true, url: 'h1' })
    await settle()
    await act(async () => {
      await hook.result().send('hello')
    })
    emit({ type: 'message.start', session_id: 'live-new' })
    emit({ type: 'message.complete', session_id: 'live-new', payload: { text: 'hi there' } })
    hook.rerender({ storedId: 'new', connected: true, url: 'h1' })
    await settle()
    expect(calls).not.toContain('session.resume')
    const drawn = words(hook.result().transcript)
    hook.rerender({ storedId: 'b', connected: true, url: 'h1' })
    await settle()
    holdResumes = true
    hook.rerender({ storedId: 'new', connected: true, url: 'h1' })
    expect(words(hook.result().transcript)).toEqual(drawn)
    expect(drawn).toContain('hello')
  })
})

describe("a reply's delta queue (desktop#212)", () => {
  it('flushes waiting deltas before any other change, and drops them after a chat switch', async () => {
    vi.useFakeTimers()
    try {
      resumes.a = { messages: [] }
      resumes.b = { messages: [] }
      const hook = renderHook(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
      await settle()
      emit({ type: 'message.start', session_id: 'live-a' })
      emit({ type: 'message.delta', session_id: 'live-a', payload: { text: 'Hel' } })
      emit({ type: 'message.delta', session_id: 'live-a', payload: { text: 'lo' } })
      // Still waiting for a frame…
      expect(words(hook.result().transcript)).not.toContain('Hello')
      // …until another event goes: the deltas go first, so the reply reads in order.
      emit({ type: 'message.complete', session_id: 'live-a', payload: {} })
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(hook.result().transcript.running).toBe(false)
      expect(words(hook.result().transcript)).toEqual(['Hello'])

      emit({ type: 'message.start', session_id: 'live-a' })
      emit({ type: 'message.delta', session_id: 'live-a', payload: { text: 'stale' } })
      hook.rerender({ storedId: 'b', connected: true, url: 'h1' })
      await settle()
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(words(hook.result().transcript).join(' ')).not.toContain('stale')
    } finally {
      vi.useRealTimers()
    }
  })
})
