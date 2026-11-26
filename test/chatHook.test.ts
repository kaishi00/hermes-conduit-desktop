// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChat } from '../src/renderer/src/state/useChat'
import { forgetTranscripts } from '../src/renderer/src/state/transcriptCache'
import { forgetChatLengths, noteChatLength } from '../src/renderer/src/state/chatLength'
import { settleRunning } from '../src/renderer/src/state/longChat'
import { useTranscript, useTranscriptValue } from '../src/renderer/src/state/transcriptStore'

type Event = { type: string; session_id?: string; payload?: unknown }
let listeners: ((event: Event) => void)[] = []
let resumes: Record<string, { messages: unknown[]; held?: boolean }> = {}
let pendingResumes: (() => void)[] = []
let holdResumes = false
let calls: string[] = []

beforeEach(() => {
  forgetTranscripts()
  forgetChatLengths()
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
type Props = { storedId: string | null; connected: boolean; url?: string; profile?: string; sessionAuthority?: boolean }
// As App calls it: each dashboard keeps its own transcripts (desktop#233).
const chatInApp = ({ storedId, connected, url, profile, sessionAuthority }: Props) => {
  const chat = useChat(storedId, profile, sessionAuthority ?? false, connected, false, undefined, url)
  return { ...chat, transcript: useTranscript(chat.transcriptStore) }
}
const mount: typeof renderHook = (hook, props) => {
  const rendered = renderHook(hook, props)
  mounted.push(rendered)
  return rendered
}
const emit = (event: Event) => act(() => listeners.forEach(l => l(event)))

describe("the open chat's profile", () => {
  it('stays the one its live session opened in on the render after a pick, then becomes the new one', async () => {
    const renders: { liveId: string | null; profile?: string }[] = []
    const hook = mount(
      (props: Props) => {
        const chat = chatInApp(props)
        renders.push({ liveId: chat.chat.liveId, profile: chat.chat.profile })
        return chat
      },
      { storedId: 'a', connected: true, url: 'h1', profile: 'furina' }
    )
    await settle()
    expect(hook.result().chat).toMatchObject({ liveId: 'live-a', profile: 'furina' })
    hook.rerender({ storedId: 'b', connected: true, url: 'h1', profile: 'zhongli' })
    await settle()
    expect(hook.result().chat).toMatchObject({ liveId: 'live-b', profile: 'zhongli' })
    // Every render that still held Furina's session said so.
    expect(renders.filter(r => r.liveId === 'live-a').every(r => r.profile === 'furina')).toBe(true)
  })
})

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

describe("the window around a streaming reply (desktop#212)", () => {
  it('runs only when what it reads changes, while the transcript runs once a frame', async () => {
    vi.useFakeTimers()
    try {
      resumes.a = { messages: [] }
      let transcriptRuns = 0
      // As App reads the open chat: whether a turn runs, and the transcript drawn by a part of its own.
      const window = mount(
        ({ storedId }: { storedId: string }) => {
          const chat = useChat(storedId, undefined, false, true, false, undefined, 'h1')
          return { chat, running: useTranscriptValue(chat.transcriptStore, state => state.running) }
        },
        { storedId: 'a' }
      )
      await settle()
      const drawn = mount(() => {
        transcriptRuns++
        return useTranscript(window.result().chat.transcriptStore)
      }, {})
      emit({ type: 'message.start', session_id: 'live-a' })
      const windowRuns = window.renders()
      const before = transcriptRuns
      for (const text of ['Hel', 'lo', ' there', '!']) {
        emit({ type: 'message.delta', session_id: 'live-a', payload: { text } })
        await act(async () => {
          vi.advanceTimersByTime(120)
        })
      }
      expect(words(drawn.result())).toEqual(['Hello there!'])
      expect(transcriptRuns - before).toBeGreaterThanOrEqual(4)
      expect(window.renders()).toBe(windowRuns)
      expect(window.result().running).toBe(true)
      emit({ type: 'message.complete', session_id: 'live-a', payload: {} })
      expect(window.result().running).toBe(false)
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

  it('reads the page before as the reader scrolls up, as a long chat does (desktop#520)', async () => {
    const words500 = Array.from({ length: 500 }, (_, i) => ({ id: 2000 + i, role: i % 2 ? 'assistant' : 'user', content: `line ${2000 + i}` }))
    // The compact resume is refused too: only the 4130 path opens this chat.
    serve([words500, [{ id: 1, role: 'user', content: 'the first words' }]])
    noteChatLength('long', 10)
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(resumeParams.map(p => p.omit_messages === true)).toEqual([false, true])
    expect(hook.result().olderRows).toBe(true)
    await act(async () => {
      await hook.result().loadOlder()
    })
    const all = words(hook.result().transcript)
    // The note stays on top; the page before goes under it.
    expect(all.slice(0, 2)).toEqual(['This chat is too long to open whole, so Conduit shows its newest messages.', 'the first words'])
    expect(hook.result().olderRows).toBe(false)
  })

  it('reads the page before one of only tool steps, so the chat opens on words', async () => {
    serve([steps(1000, 500), [{ id: 999, role: 'user', content: 'New mail arrived' }]])
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(paths.map(p => /offset=(\d+)/.exec(p)?.[1])).toEqual(['0', '500'])
    const items = hook.result().transcript.items
    // A chat past one stored page opens on its newest page by itself (desktop#291): no note saying why.
    expect(items[0]).toMatchObject({ kind: 'user', text: 'New mail arrived' })
    expect(items.some(i => i.kind === 'notice')).toBe(false)
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

  it('fills in more than a page a running chat wrote while its pages were read', async () => {
    let reads = 0
    serve([])
    const conduit = (window as unknown as { conduit: Record<string, unknown> }).conduit
    conduit.rpcOutcome = (method: string, params: Record<string, unknown>) => {
      if (method !== 'session.resume') return Promise.resolve({ ok: true, result: {} })
      if (!params.omit_messages) return Promise.resolve({ ok: false, error: TOO_LONG, code: 4130 })
      reads++
      if (reads === 2) return Promise.resolve({ ok: false, error: 'busy', code: 5000 })
      // The first read's reply text is stale by the time the pages are read; the read after them is the turn as it is now.
      const assistant = reads === 1 ? 'stale' : 'Sorting the mail'
      return Promise.resolve({ ok: true, result: { session_id: 'live-long', stored_session_id: 'long', messages: [], running: true, inflight: { assistant } } })
    }
    // First read: the prompt. Then 700 tool rows were written: the newest page is ids 202-701, the one before 2-201 plus the prompt.
    let first = true
    conduit.httpOutcome = async (_method: string, path: string) => {
      const offset = Number(/offset=(\d+)/.exec(path)?.[1] ?? 0)
      if (first) {
        first = false
        return { ok: true, result: { messages: [{ id: 1, role: 'user', content: 'check my mail' }] } }
      }
      const all = [{ id: 1, role: 'user', content: 'check my mail' }, ...steps(2, 700)]
      return { ok: true, result: { messages: all.slice(Math.max(0, all.length - offset - 500), all.length - offset) } }
    }
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(hook.result().error).toBeNull()
    const items = hook.result().transcript.items
    expect(items.filter(i => i.kind === 'tool')).toHaveLength(350)
    expect(words(hook.result().transcript)).not.toContain('stale')
  })

  it('a turn that ends while the rows are read opens ended, with its last rows (desktop#264)', async () => {
    serve([[{ id: 1, role: 'user', content: 'check my mail' }]])
    let compacts = 0
    const conduit = (window as unknown as { conduit: Record<string, unknown> }).conduit
    conduit.rpcOutcome = (method: string, params: Record<string, unknown>) => {
      if (method !== 'session.resume') return Promise.resolve({ ok: true, result: {} })
      if (!params.omit_messages) return Promise.resolve({ ok: false, error: TOO_LONG, code: 4130 })
      compacts++
      // Still running on the read after the pages; the turn ends after its rows are read, so its last row
      // only comes from the rows read again once the third read says it ended.
      if (compacts === 3) {
        conduit.httpOutcome = async () => ({
          ok: true,
          result: { messages: [{ id: 1, role: 'user', content: 'check my mail' }, { id: 2, role: 'assistant', content: 'All sorted.' }] }
        })
      }
      const running = compacts < 3
      return Promise.resolve({
        ok: true,
        result: { session_id: 'live-long', stored_session_id: 'long', messages: [], running, inflight: running ? { assistant: 'Sorting' } : null }
      })
    }
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(compacts).toBe(3)
    expect(hook.result().transcript.running).toBe(false)
    expect(words(hook.result().transcript).slice(1)).toEqual(['check my mail', 'All sorted.'])
  })

  it('a failed read again keeps the card waiting on the user, not the stale reply or queue', async () => {
    const first = { running: true, inflight: { assistant: 'stale' }, pending: [{ text: 'queued' }], pending_connection: { id: 'card' } }
    const { result, rows } = await settleRunning(
      () => Promise.reject(new Error('busy')),
      async held => held,
      first,
      [{ role: 'user', content: 'hi' }]
    )
    expect(result.inflight).toBeNull()
    expect(result.pending).toBeUndefined()
    expect(result.pending_connection).toEqual({ id: 'card' })
    expect(rows).toHaveLength(1)
  })

  it('shows the refusal when the stored pages bring no rows', async () => {
    serve([[]])
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(hook.result().error).toBe(TOO_LONG)
  })

  it('shows the refusal when the compact resume is refused too', async () => {
    serve([], true)
    const hook = mount(chatInApp, { storedId: 'long', connected: true, url: 'h1' })
    await settle()
    expect(hook.result().error).toBe(TOO_LONG)
    // The newest page is read first, before any resume (desktop#291): it came back empty, so the refusal stands.
    expect(paths).toHaveLength(1)
  })
})

describe('a send while the chat is still opening (desktop#298)', () => {
  let submitted: unknown[] = []
  beforeEach(() => {
    submitted = []
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const rpc = conduit.rpcOutcome
    conduit.rpcOutcome = (method, params) => {
      if (method === 'prompt.submit') submitted.push(params.session_id)
      return rpc(method, params)
    }
  })

  it('waits for the open and sends into that chat, not a new one', async () => {
    resumes.a = { messages: history('one') }
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    await settle()
    hook.rerender({ storedId: null, connected: true, url: 'h1' })
    await settle()
    holdResumes = true
    hook.rerender({ storedId: 'a', connected: true, url: 'h1' })
    expect(hook.result().loading).toBe(true)
    let created: unknown
    const sending = act(async () => {
      created = await hook.result().send('hello')
    })
    await settle()
    expect(calls).not.toContain('session.create')
    expect(submitted).toEqual([])
    await act(async () => pendingResumes.forEach(resume => resume()))
    await sending
    expect(created).toBeNull()
    expect(calls).not.toContain('session.create')
    expect(submitted).toEqual(['live-a'])
    expect(words(hook.result().transcript)).toEqual(['one', 're: one', 'hello'])
  })

  it('sends nothing when the user moves to another chat meanwhile', async () => {
    holdResumes = true
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    let created: unknown
    const sending = act(async () => {
      created = await hook.result().send('hello')
    })
    await settle()
    hook.rerender({ storedId: 'b', connected: true, url: 'h1' })
    await act(async () => pendingResumes.forEach(resume => resume()))
    await sending
    expect(created).toBe(false)
    expect(calls).not.toContain('session.create')
    expect(submitted).toEqual([])
  })

  it('opens a chat whose open failed once more, and sends into it, not a new chat', async () => {
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const rpc = conduit.rpcOutcome
    let failing = true
    conduit.rpcOutcome = (method, params) =>
      method === 'session.resume' && failing ? Promise.resolve({ ok: false, error: 'busy', code: 500 }) : rpc(method, params)
    resumes.a = { messages: history('one') }
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    await settle()
    expect(hook.result().error).toBeTruthy()
    failing = false
    let created: unknown
    await act(async () => {
      created = await hook.result().send('hello')
    })
    expect(created).toBeNull()
    expect(calls).not.toContain('session.create')
    expect(submitted).toEqual(['live-a'])
    expect(hook.result().error).toBeNull()
    expect(words(hook.result().transcript)).toEqual(['one', 're: one', 'hello'])
  })

  it('gives a command back when the user moves to another chat while it waits', async () => {
    holdResumes = true
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    let outcome: unknown
    const running = act(async () => {
      outcome = await hook.result().command('/compress', [])
    })
    await settle()
    hook.rerender({ storedId: 'b', connected: true, url: 'h1' })
    await act(async () => pendingResumes.forEach(resume => resume()))
    await running
    expect(outcome).toEqual({ kind: 'unsent' })
    expect(calls).not.toContain('session.create')
  })

  it("doesn't leave a draft showing Loading after an abandoned open", async () => {
    holdResumes = true
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    expect(hook.result().loading).toBe(true)
    hook.rerender({ storedId: null, connected: true, url: 'h1' })
    expect(hook.result().loading).toBe(false)
  })
})

describe('a chat picked while offline (desktop#283)', () => {
  it("starts blank instead of showing the last chat's rows, and the open chat stays drawn through a drop", async () => {
    resumes.a = { messages: history('one') }
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    await settle()
    hook.rerender({ storedId: 'a', connected: false, url: 'h1' })
    expect(words(hook.result().transcript)).toEqual(['one', 're: one'])
    hook.rerender({ storedId: 'b', connected: false, url: 'h1' })
    expect(hook.result().chat.storedId).toBe('b')
    expect(hook.result().transcript.items).toEqual([])
  })
})

describe('tool answers on opening a chat again (desktop#293)', () => {
  it.each([
    ['fills them from the kept copy instead of reading the REST page again', true, 1, 'a'],
    ['reads the REST page again for a call the kept copy has no arguments for', false, 2, 'c']
  ])('%s', async (_label, withArgs, reads, id) => {
    const paths: string[] = []
    const conduit = (window as unknown as { conduit: { httpOutcome: unknown } }).conduit
    conduit.httpOutcome = async (_method: string, path: string) => {
      paths.push(path)
      return { ok: true, result: { messages: [{ role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: withArgs ? '{"command":"ls"}' : undefined } }] }, { role: 'tool', tool_call_id: 'c1', content: 'a.txt' }] } }
    }
    resumes[id] = { messages: [{ role: 'user', content: 'list' }, { role: 'tool', tool_call_id: 'c1', name: 'terminal', content: '' }] }
    const hook = mount(chatInApp, { storedId: id, connected: true, url: 'h1' })
    await settle()
    const boardReads = () => paths.filter(p => p.includes(`/api/sessions/${id}/messages`) && !p.includes('include_compacted=true'))
    const tool = () => hook.result().transcript.items.find(i => i.kind === 'tool') as { result?: string } | undefined
    expect(tool()?.result).toBe('a.txt')
    // The page read to size the chat up (desktop#291) isn't a tool-answers read.
    expect(boardReads()).toHaveLength(1)
    hook.rerender({ storedId: 'b', connected: true, url: 'h1' })
    await settle()
    hook.rerender({ storedId: id, connected: true, url: 'h1' })
    await settle()
    expect(tool()?.result).toBe('a.txt')
    expect(boardReads()).toHaveLength(reads)
  })
})

describe("model and run settings before a new chat's first message", () => {
  it('stores model, reasoning, speed and yolo on a draft without making RPC calls', async () => {
    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1' })
    let outcome: unknown
    await act(async () => {
      outcome = await hook.result().setModel('claude-opus-4-6', 'anthropic')
      await hook.result().setReasoning('high')
      await hook.result().setSpeed('fast')
      await hook.result().setYolo(true)
    })
    expect(outcome).toEqual({ kind: 'switched', deferred: false })
    expect(calls).toEqual([])
    expect(hook.result().chat).toMatchObject({
      storedId: null,
      liveId: null,
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      reasoning: 'high',
      speed: 'fast',
      yolo: true
    })
  })

  it('forwards draft picks to session.create and sets yolo via config.set on hermes dashboard', async () => {
    const sentRpc: { method: string; params: Record<string, unknown> }[] = []
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const baseRpc = conduit.rpcOutcome
    conduit.rpcOutcome = (method, params) => {
      sentRpc.push({ method, params })
      if (method === 'session.create') {
        return Promise.resolve({
          ok: true,
          result: {
            session_id: 'live-new',
            stored_session_id: 'new',
            info: { model: params.model, provider: params.provider, reasoning_effort: params.reasoning_effort, fast: true }
          }
        })
      }
      if (method === 'config.set') {
        return Promise.resolve({ ok: true, result: { info: { yolo: true } } })
      }
      return baseRpc(method, params)
    }

    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1', sessionAuthority: false })
    await act(async () => {
      await hook.result().setModel('claude-opus-4-6', 'anthropic')
      await hook.result().setReasoning('high')
      await hook.result().setSpeed('fast')
      await hook.result().setYolo(true)
      await hook.result().send('hello')
    })

    const createCall = sentRpc.find(c => c.method === 'session.create')
    expect(createCall?.params).toMatchObject({
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      reasoning_effort: 'high',
      service_tier: 'priority'
    })
    expect(createCall?.params.yolo).toBeUndefined()
    const yoloIndex = sentRpc.findIndex(c => c.method === 'config.set' && c.params.key === 'yolo')
    const submitIndex = sentRpc.findIndex(c => c.method === 'prompt.submit')
    expect(yoloIndex).toBeGreaterThan(0)
    expect(yoloIndex).toBeLessThan(submitIndex)
    expect(sentRpc[yoloIndex]?.params).toMatchObject({ key: 'yolo', value: '1', session_id: 'live-new' })
    expect(hook.result().chat.yolo).toBe(true)
  })

  it('sends a pick made while session.create is out to the session it made (#431)', async () => {
    const sentRpc: { method: string; params: Record<string, unknown> }[] = []
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const baseRpc = conduit.rpcOutcome
    let made!: () => void
    conduit.rpcOutcome = (method, params) => {
      sentRpc.push({ method, params })
      if (method === 'session.create') {
        return new Promise(resolve => {
          made = () => resolve({ ok: true, result: { session_id: 'live-new', stored_session_id: 'new', info: { model: params.model, provider: params.provider } } })
        })
      }
      if (method === 'config.set') return Promise.resolve({ ok: true, result: { info: { reasoning_effort: 'high' } } })
      return baseRpc(method, params)
    }

    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1', sessionAuthority: false })
    await act(async () => {
      await hook.result().setModel('claude-opus-4-6', 'anthropic')
    })
    let sending!: Promise<unknown>
    let picking!: Promise<unknown>
    await act(async () => {
      sending = hook.result().send('hello')
      await settle()
      // The create is out with the first pick; the Model sheet is still open.
      picking = hook.result().setReasoning('high')
      await settle()
    })
    expect(sentRpc.find(c => c.method === 'session.create')?.params).toMatchObject({ model: 'claude-opus-4-6', provider: 'anthropic' })
    expect(sentRpc.some(c => c.method === 'config.set')).toBe(false)
    await act(async () => {
      made()
      await sending
      await picking
    })
    // The later pick reached the session, so the chip and the session agree.
    const set = sentRpc.find(c => c.method === 'config.set' && c.params.key === 'reasoning')
    expect(set?.params).toMatchObject({ value: 'high', session_id: 'live-new' })
    expect(hook.result().chat.reasoning).toBe('high')
  })

  it('keeps a pick made in a new draft while an earlier chat’s create is still out', async () => {
    const sentRpc: { method: string; params: Record<string, unknown> }[] = []
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const baseRpc = conduit.rpcOutcome
    let made!: () => void
    conduit.rpcOutcome = (method, params) => {
      sentRpc.push({ method, params })
      if (method === 'session.create') {
        return new Promise(resolve => {
          made = () => resolve({ ok: true, result: { session_id: 'live-new', stored_session_id: 'new' } })
        })
      }
      return baseRpc(method, params)
    }

    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1', profile: 'a', sessionAuthority: false })
    let sending!: Promise<unknown>
    await act(async () => {
      sending = hook.result().send('hello')
      await settle()
    })
    // The person moves to a new chat for another bot while the first chat's create is out.
    await act(async () => {
      hook.rerender({ storedId: null, connected: true, url: 'h1', profile: 'b', sessionAuthority: false })
      await settle()
    })
    await act(async () => {
      await hook.result().setReasoning('high')
    })
    expect(hook.result().chat.reasoning).toBe('high')
    await act(async () => {
      made()
      await sending
    })
    expect(hook.result().chat.reasoning).toBe('high')
    expect(sentRpc.some(c => c.method === 'config.set')).toBe(false)
  })

  it('forwards draft reasoning, ultrafast service_tier and yolo directly to session.create under sessionAuthority', async () => {
    const sentRpc: { method: string; params: Record<string, unknown> }[] = []
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const baseRpc = conduit.rpcOutcome
    conduit.rpcOutcome = (method, params) => {
      sentRpc.push({ method, params })
      if (method === 'session.create') {
        return Promise.resolve({
          ok: true,
          result: {
            session_id: 'live-auth',
            stored_session_id: 'auth',
            info: { model: params.model, provider: params.provider, reasoning_effort: params.reasoning, fast: true, service_tier: 'ultrafast', yolo: true }
          }
        })
      }
      return baseRpc(method, params)
    }

    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1', sessionAuthority: true })
    await act(async () => {
      await hook.result().setModel('gpt-5.4', 'openai')
      await hook.result().setReasoning('xhigh')
      await hook.result().setSpeed('ultrafast')
      await hook.result().setYolo(true)
      await hook.result().send('hello')
    })

    const createCall = sentRpc.find(c => c.method === 'session.create')
    expect(createCall?.params).toMatchObject({
      model: 'gpt-5.4',
      provider: 'openai',
      reasoning: 'xhigh',
      service_tier: 'ultrafast',
      yolo: true
    })
    expect(sentRpc.some(c => c.method === 'config.set')).toBe(false)
  })

  it('clears draft overrides when switching profile or opening another chat', async () => {
    const sentRpc: { method: string; params: Record<string, unknown> }[] = []
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const baseRpc = conduit.rpcOutcome
    conduit.rpcOutcome = (method, params) => {
      sentRpc.push({ method, params })
      return baseRpc(method, params)
    }

    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1', profile: 'default' })
    await act(async () => {
      await hook.result().setModel('claude-opus-4-6', 'anthropic')
      await hook.result().setYolo(true)
    })
    hook.rerender({ storedId: null, connected: true, url: 'h1', profile: 'work' })
    expect(hook.result().chat.model).toBeUndefined()
    expect(hook.result().chat.yolo).toBeUndefined()

    await act(async () => {
      await hook.result().setModel('gpt-5.4', 'openai')
    })
    resumes.a = { messages: history('one') }
    hook.rerender({ storedId: 'a', connected: true, url: 'h1', profile: 'work' })
    await settle()
    hook.rerender({ storedId: null, connected: true, url: 'h1', profile: 'work' })
    await act(async () => {
      await hook.result().send('fresh')
    })

    const createCall = sentRpc.find(c => c.method === 'session.create')
    expect(createCall?.params.model).toBeUndefined()
    expect(createCall?.params.provider).toBeUndefined()
    expect(createCall?.params.yolo).toBeUndefined()
  })

  it('does not treat a stored chat still resuming as a draft in setModel', async () => {
    holdResumes = true
    const hook = mount(chatInApp, { storedId: 'a', connected: true, url: 'h1' })
    expect(hook.result().loading).toBe(true)
    let outcome: unknown
    await act(async () => {
      outcome = await hook.result().setModel('claude-opus-4-6', 'anthropic')
    })
    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(hook.result().chat.model).toBeUndefined()
    expect(calls).toEqual(['session.resume'])
  })

  it('opens the model panel on /model in a draft without creating a session', async () => {
    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1' })
    let outcome: unknown
    await act(async () => {
      outcome = await hook.result().command('/model', [])
    })
    expect(outcome).toEqual({ kind: 'model', created: null })
    expect(calls).not.toContain('session.create')
  })

  it('reverts draft yolo and emits a notice if config.set fails, without aborting the first send', async () => {
    const sentRpc: string[] = []
    const conduit = (window as unknown as { conduit: { rpcOutcome: (m: string, p: Record<string, unknown>) => Promise<unknown> } }).conduit
    const baseRpc = conduit.rpcOutcome
    conduit.rpcOutcome = (method, params) => {
      sentRpc.push(method)
      if (method === 'config.set' && params.key === 'yolo') {
        return Promise.resolve({ ok: false, error: 'yolo refused', code: 4001 })
      }
      return baseRpc(method, params)
    }

    const hook = mount(chatInApp, { storedId: null, connected: true, url: 'h1', sessionAuthority: false })
    await act(async () => {
      await hook.result().setYolo(true)
      await hook.result().send('hello')
    })

    expect(sentRpc).toContain('session.create')
    expect(sentRpc).toContain('config.set')
    expect(sentRpc).toContain('prompt.submit')
    expect(hook.result().chat.yolo).toBeUndefined()
    expect(hook.result().transcript.items.some(i => i.kind === 'notice' && 'text' in i && i.text === 'yolo refused')).toBe(true)
  })
})

describe('whether a chat has rows before the ones it holds, while it opens (desktop#486)', () => {
  it('takes one past a page, or of unknown length, to have them, and a short one not to', async () => {
    holdResumes = true
    const hook = mount(chatInApp, { storedId: 'unknown', connected: true })
    await settle()
    expect(hook.result().loading).toBe(true)
    // It opens on its newest page too (resumeChat), so calls from before its rows wait as they will then.
    expect(hook.result().olderRows).toBe(true)
    noteChatLength('short', 12)
    hook.rerender({ storedId: 'short', connected: true })
    await settle()
    expect(hook.result().loading).toBe(true)
    expect(hook.result().olderRows).toBe(false)
    noteChatLength('long', 900)
    hook.rerender({ storedId: 'long', connected: true })
    await settle()
    expect(hook.result().olderRows).toBe(true)
    // A draft has no stored rows at all.
    hook.rerender({ storedId: null, connected: true })
    await settle()
    expect(hook.result().olderRows).toBe(false)
  })
})
