// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
let mounted: { unmount: () => void }[] = []
afterEach(() => {
  mounted.forEach(hook => hook.unmount())
  mounted = []
})

const words = (state: { items: { kind: string; text?: string }[] }) => state.items.map(i => i.text ?? i.kind)
type Props = { storedId: string | null; connected: boolean; url?: string }
// As App calls it: each dashboard keeps its own transcripts (desktop#233).
const chatInApp = ({ storedId, connected, url }: Props) => useChat(storedId, undefined, false, connected, false, undefined, url)
const mount: typeof renderHook = (hook, props) => {
  const rendered = renderHook(hook, props)
  mounted.push(rendered)
  return rendered
}
const emit = (event: Event) => act(() => listeners.forEach(l => l(event)))

describe("the transcript cache's wiring (desktop#218)", () => {
  it('draws a chat left a moment ago at once while its resume runs', async () => {
    resumes.a = { messages: history('one') }
    resumes.b = { messages: history('two') }
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
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
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
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
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
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
    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1' })
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
      const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
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

describe('a chat too long to resume whole (Hermes 4130)', () => {
  const TOO_LONG = 'This session is too long to reload safely (20001 messages; limit 20000).'
  const steps = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => {
      const id = from + i
      return id % 2
        ? { id, role: 'tool', tool_name: 'terminal', tool_call_id: `c${id - 1}`, content: 'ok' }
        : { id, role: 'assistant', content: '', tool_calls: [{ id: `c${id}`, function: { name: 'terminal', arguments: '{}' } }] }
    })
  let paths: string[] = []
  let resumeParams: Record<string, unknown>[] = []

  const serve = (pages: unknown[][], compactRefused = false) => {
    paths = []
    resumeParams = []
    const conduit = (window as unknown as { conduit: Record<string, unknown> }).conduit
    conduit.rpcOutcome = (method: string, params: Record<string, unknown>) => {
      if (method !== 'session.resume') return Promise.resolve({ ok: true, result: {} })
      resumeParams.push(params)
      if (!params.omit_messages || compactRefused) return Promise.resolve({ ok: false, error: TOO_LONG, code: 4130 })
      return Promise.resolve({ ok: true, result: { session_id: 'live-long', stored_session_id: 'long', messages: [] } })
    }
    conduit.httpOutcome = async (_method: string, path: string) => {
      paths.push(path)
      const offset = Number(/offset=(\d+)/.exec(path)?.[1] ?? 0)
      return { ok: true, result: { messages: pages[offset / 500] ?? [] } }
    }
  }

  it('opens compact and draws the newest stored rows, under a note saying why', async () => {
    serve([[{ id: 1, role: 'user', content: 'check my mail' }, { id: 2, role: 'assistant', content: 'Two new mails.' }]])
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(resumeParams.map(p => p.omit_messages === true)).toEqual([false, true])
    expect(paths[0]).toContain('/api/sessions/long/messages?order=latest&limit=500&offset=0&include_compacted=true')
    expect(hook.result().error).toBeNull()
    expect(words(hook.result().transcript)).toEqual([
      'This chat is too long to open whole, so Conduit shows its newest messages.',
      'check my mail',
      'Two new mails.'
    ])
  })

  it('reads the page before one of only tool steps, so the chat opens on words', async () => {
    serve([steps(1000, 500), [{ id: 999, role: 'user', content: 'New mail arrived' }]])
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(paths.map(p => /offset=(\d+)/.exec(p)?.[1])).toEqual(['0', '500'])
    const items = hook.result().transcript.items
    expect(items[1]).toMatchObject({ kind: 'user', text: 'New mail arrived' })
    const tool = items.find(i => i.kind === 'tool') as { name: string; result?: string } | undefined
    expect(tool?.name).toBe('terminal')
    expect(tool?.result).toBe('ok')
  })

  it('keeps each stored row once when the chat wrote more while its pages were read', async () => {
    // The newest page shifted by two rows between the reads: page 2 serves page 1's oldest two again.
    serve([steps(1000, 500), [...steps(1000, 2), { id: 999, role: 'user', content: 'New mail arrived' }]])
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    const keys = hook.result().transcript.items.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('reads a running chat again after its pages, and its newest rows when its turn ended meanwhile', async () => {
    serve([[{ id: 1, role: 'user', content: 'check my mail' }]])
    let compacts = 0
    const conduit = (window as unknown as { conduit: Record<string, unknown> }).conduit
    conduit.rpcOutcome = (method: string, params: Record<string, unknown>) => {
      if (method !== 'session.resume') return Promise.resolve({ ok: true, result: {} })
      resumeParams.push(params)
      if (!params.omit_messages) return Promise.resolve({ ok: false, error: TOO_LONG, code: 4130 })
      compacts++
      const result = { session_id: 'live-long', stored_session_id: 'long', messages: [], running: compacts === 1 }
      if (compacts === 2) {
        conduit.httpOutcome = async () => ({
          ok: true,
          result: { messages: [{ id: 1, role: 'user', content: 'check my mail' }, { id: 2, role: 'assistant', content: 'All sorted.' }] }
        })
      }
      return Promise.resolve({ ok: true, result })
    }
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(compacts).toBe(2)
    expect(hook.result().transcript.running).toBe(false)
    expect(words(hook.result().transcript).slice(1)).toEqual(['check my mail', 'All sorted.'])
  })

  it('shows the refusal when the compact resume is refused too', async () => {
    serve([], true)
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(hook.result().error).toBe(TOO_LONG)
    expect(paths).toEqual([])
  })
})
