// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChat } from '../src/renderer/src/state/useChat'

type Listener = (event: { type: string; session_id?: string; payload?: unknown }) => void
let listeners: Listener[] = []
let calls: { method: string; params?: Record<string, unknown> }[] = []
let reads: string[] = []
/** What `session.resume` answers next (the last one again and again). */
let resumes: unknown[] = []
/** The chat's newest stored row, as its REST transcript names it. */
let newest: number | null = null

const emit = (event: { type: string; session_id?: string; payload?: unknown }) => act(() => listeners.forEach(l => l(event)))
const resumeCalls = () => calls.filter(c => c.method === 'session.resume').length

beforeEach(() => {
  listeners = []
  calls = []
  reads = []
  resumes = []
  newest = null
  ;(window as unknown as { conduit: unknown }).conduit = {
    platform: 'win32',
    rpcOutcome: async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })
      if (method === 'session.create') return { ok: true, result: { session_id: 'live-1', stored_session_id: 's1' } }
      if (method === 'session.resume') return { ok: true, result: resumes.length > 1 ? resumes.shift() : resumes[0] }
      if (method === 'prompt.submit') return { ok: true, result: { status: 'queued' } }
      return { ok: false, error: 'not here', code: 404 }
    },
    httpOutcome: async (_method: string, path: string) => {
      if (path.includes('/messages?') && path.includes('limit=1')) {
        reads.push(path)
        return { ok: true, result: { messages: newest === null ? [] : [{ role: 'assistant', id: newest }] } }
      }
      return { ok: false, error: 'not here', code: 404 }
    },
    onEvent: (listener: Listener) => {
      listeners.push(listener)
      return () => (listeners = listeners.filter(l => l !== listener))
    }
  }
})

type Props = { id: string | null; connected: boolean }
const open = (props: Props) => renderHook(({ id, connected }: Props) => useChat(id, undefined, false, connected, false, undefined, 'https://h'), props)

async function until(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  if (!done()) throw new Error(`never happened: ${what}`)
}

const texts = (hook: ReturnType<typeof open>) => hook.result().transcriptStore.get().items.map(i => ('text' in i ? i.text : i.kind))

describe('a chat after the connection drops and comes back (desktop#471)', () => {
  it('resumes a chat made here, so a turn that ran through the drop shows as running with its reply so far', async () => {
    const hook = open({ id: null, connected: true })
    await settle()
    let sent: unknown
    await act(async () => {
      sent = await hook.result().send('Write the report')
    })
    expect(sent).toBe('s1')
    // The list selects the chat it made: its first turn is on screen, so it isn't resumed over it.
    hook.rerender({ id: 's1', connected: true })
    await settle()
    expect(resumeCalls()).toBe(0)
    emit({ type: 'message.start', session_id: 'live-1' })
    expect(hook.result().transcriptStore.get().running).toBe(true)

    hook.rerender({ id: 's1', connected: false })
    await settle()
    // Its rows stay drawn through the drop.
    expect(texts(hook)).toEqual(['Write the report'])

    resumes = [
      {
        session_id: 'live-1',
        stored_session_id: 's1',
        running: true,
        inflight: { assistant: 'Here is the first part' },
        messages: [{ role: 'user', text: 'Write the report', row_id: 1 }]
      }
    ]
    hook.rerender({ id: 's1', connected: true })
    // Still drawn while it's read again, not blanked.
    expect(texts(hook)).toEqual(['Write the report'])
    await until(() => resumeCalls() === 1, 'the resume after the drop')
    await settle()
    expect(hook.result().transcriptStore.get().running).toBe(true)
    expect(texts(hook)).toEqual(['Write the report', 'Here is the first part'])

    // The new socket's events reach the chat again.
    emit({ type: 'message.complete', session_id: 'live-1', payload: { text: 'Here is the first part and the rest.' } })
    expect(hook.result().transcriptStore.get().running).toBe(false)
    hook.unmount()
  })

  it('asks again when Hermes says the live session is between two states', async () => {
    let refused = 0
    const conduit = (window as unknown as { conduit: { rpcOutcome: (method: string, params?: Record<string, unknown>) => Promise<unknown> } }).conduit
    const answer = conduit.rpcOutcome
    conduit.rpcOutcome = async (method, params) => {
      if (method === 'session.resume' && refused++ === 0) return { ok: false, error: 'session no longer live; retry resume', code: 4007 }
      return answer(method, params)
    }
    resumes = [{ session_id: 'live-2', stored_session_id: 's2', running: false, messages: [{ role: 'user', text: 'Hi', row_id: 1 }] }]
    const hook = open({ id: 's2', connected: true })
    await until(() => texts(hook).length === 1, 'the chat opening on the second ask')
    expect(hook.result().error).toBeNull()
    hook.unmount()
  })
})

describe('rows another process wrote into the open chat (desktop#432)', () => {
  const stored = (rows: { role: string; text: string; row_id: number }[]) => ({ session_id: 'live-3', stored_session_id: 's3', running: false, messages: rows })

  it('reads the chat again when the store moved and its newest row is one it never drew', async () => {
    resumes = [
      stored([{ role: 'user', text: 'Hi', row_id: 1 }, { role: 'assistant', text: 'Hello.', row_id: 2 }]),
      stored([{ role: 'user', text: 'Hi', row_id: 1 }, { role: 'assistant', text: 'Hello.', row_id: 2 }, { role: 'assistant', text: 'Your morning report.', row_id: 3 }])
    ]
    const hook = open({ id: 's3', connected: true })
    await until(() => texts(hook).length === 2, 'the chat opening')

    // The store moved for another chat: one small read, and nothing else.
    newest = 2
    emit({ type: 'sessions.changed' })
    await until(() => reads.length === 1, 'the newest row being asked for')
    await settle()
    expect(resumeCalls()).toBe(1)

    // A scheduled job's reply landed in this one.
    newest = 3
    emit({ type: 'sessions.changed' })
    await until(() => resumeCalls() === 2, 'the chat being read again')
    await settle()
    expect(texts(hook)).toEqual(['Hi', 'Hello.', 'Your morning report.'])
    hook.unmount()
  }, 15_000)

  it('does not read the chat again for the rows of a turn it followed live', async () => {
    resumes = [stored([{ role: 'user', text: 'Hi', row_id: 1 }, { role: 'assistant', text: 'Hello.', row_id: 2 }])]
    const hook = open({ id: 's3', connected: true })
    await until(() => texts(hook).length === 2, 'the chat opening')
    emit({ type: 'message.start', session_id: 'live-3' })
    emit({ type: 'message.complete', session_id: 'live-3', payload: { text: 'Done.' } })
    newest = 4
    emit({ type: 'sessions.changed' })
    await until(() => reads.length === 1, 'the newest row being asked for')
    await settle()
    expect(resumeCalls()).toBe(1)
    expect(texts(hook)).toEqual(['Hi', 'Hello.', 'Done.'])

    // A note written later, with no turn here, is read in.
    newest = 5
    emit({ type: 'sessions.changed' })
    await until(() => resumeCalls() === 2, 'the chat being read again')
    hook.unmount()
  }, 15_000)

  it('leaves a running turn alone', async () => {
    resumes = [stored([{ role: 'user', text: 'Hi', row_id: 1 }])]
    const hook = open({ id: 's3', connected: true })
    await until(() => texts(hook).length === 1, 'the chat opening')
    emit({ type: 'message.start', session_id: 'live-3' })
    newest = 9
    emit({ type: 'sessions.changed' })
    await act(async () => new Promise(resolve => setTimeout(resolve, 1_700)))
    expect(reads).toEqual([])
    expect(resumeCalls()).toBe(1)
    hook.unmount()
  }, 15_000)

  it('reads the chat again after a replay gap that landed mid-turn, once the turn ends', async () => {
    resumes = [
      stored([{ role: 'user', text: 'Hi', row_id: 1 }]),
      stored([{ role: 'user', text: 'Hi', row_id: 1 }, { role: 'assistant', text: 'The whole reply.', row_id: 2 }])
    ]
    const hook = open({ id: 's3', connected: true })
    await until(() => texts(hook).length === 1, 'the chat opening')
    emit({ type: 'message.start', session_id: 'live-3' })
    emit({ type: 'session.replay_gap', session_id: 'live-3' })
    await act(async () => new Promise(resolve => setTimeout(resolve, 1_700)))
    // Busy: nothing is read over the running turn.
    expect(resumeCalls()).toBe(1)
    emit({ type: 'message.complete', session_id: 'live-3', payload: { text: 'reply.' } })
    await until(() => resumeCalls() === 2, 'the chat being read again')
    await settle()
    expect(texts(hook)).toEqual(['Hi', 'The whole reply.'])
    hook.unmount()
  }, 15_000)
})
