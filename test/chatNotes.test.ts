// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChat } from '../src/renderer/src/state/useChat'
import { forgetTranscripts } from '../src/renderer/src/state/transcriptCache'
import { forgetChatLengths } from '../src/renderer/src/state/chatLength'
import { useTranscript } from '../src/renderer/src/state/transcriptStore'
import { addChatNote, chatNotes, forgetChatNotes, MAX_CHAT_NOTES, rememberChatNotes, withChatNotes, type ChatNote } from '../src/renderer/src/state/chatNotes'
import type { TranscriptItem, TranscriptState } from '../src/renderer/src/state/transcript'

type Event = { type: string; session_id?: string; payload?: unknown }
let listeners: ((event: Event) => void)[] = []
let resumes: Record<string, unknown[]> = {}
let heldBtw: (() => void) | null = null

beforeEach(() => {
  forgetTranscripts()
  forgetChatLengths()
  forgetChatNotes()
  listeners = []
  resumes = {}
  heldBtw = null
  ;(window as unknown as { conduit: unknown }).conduit = {
    rpcOutcome: (method: string, params: Record<string, unknown>) => {
      if (method === 'session.resume') {
        const id = String(params.session_id)
        return Promise.resolve({ ok: true, result: { session_id: `live-${id}`, stored_session_id: id, messages: resumes[id] ?? [] } })
      }
      if (method === 'prompt.btw') return new Promise(resolve => (heldBtw = () => resolve({ ok: true, result: {} })))
      return Promise.resolve({ ok: true, result: {} })
    },
    httpOutcome: async () => ({ ok: false, error: 'none', code: 404 }),
    onEvent: (listener: (event: Event) => void) => {
      listeners.push(listener)
      return () => (listeners = listeners.filter(l => l !== listener))
    }
  }
})

let mounted: { unmount: () => void }[] = []
afterEach(() => {
  mounted.forEach(hook => hook.unmount())
  mounted = []
})

/** Stored rows as Hermes sends them, each with its row id. */
const rows = (from: number, ...texts: string[]) =>
  texts.flatMap((text, i) => [
    { role: 'user', content: text, row_id: from + 2 * i },
    { role: 'assistant', content: `re: ${text}`, row_id: from + 2 * i + 1 }
  ])
const words = (state: { items: { kind: string; text?: string }[] }) => state.items.map(i => i.text ?? i.kind)
type Props = { storedId: string | null }
const chatInApp = ({ storedId }: Props) => {
  const chat = useChat(storedId, undefined, false, true, false, undefined, 'h1')
  return { ...chat, transcript: useTranscript(chat.transcriptStore) }
}
const mount = (props: Props) => {
  const rendered = renderHook(chatInApp, props)
  mounted.push(rendered)
  return rendered
}
const emit = (event: Event) => act(() => listeners.forEach(l => l(event)))

describe("a chat's own notes (issue 3394)", () => {
  it('come back when the chat is opened again, after the row they followed', async () => {
    resumes.a = rows(1, 'one')
    const hook = mount({ storedId: 'a' })
    await settle()
    await act(async () => {
      await hook.result().command('/help', [])
    })
    emit({ type: 'background.complete', session_id: 'live-a', payload: { task_id: 'bg_1', text: 'Logs are clean.' } })
    expect(words(hook.result().transcript).length).toBe(4)
    // Hermes' rows have moved on meanwhile: a new turn after the notes.
    resumes.a = [...rows(1, 'one'), ...rows(3, 'two')]
    hook.rerender({ storedId: 'b' })
    await settle()
    expect(hook.result().transcript.items.some(item => item.kind === 'output')).toBe(false)
    hook.rerender({ storedId: 'a' })
    await settle()
    const kinds = hook.result().transcript.items.map(item => item.kind)
    expect(kinds).toEqual(['user', 'assistant', 'output', 'output', 'user', 'assistant'])
    expect(words(hook.result().transcript)[3]).toBe('[bg bg_1]\nLogs are clean.')
  })

  it('stay through a re-read of the open chat', async () => {
    resumes.a = rows(1, 'one')
    const hook = mount({ storedId: 'a' })
    await settle()
    await act(async () => {
      await hook.result().command('/help', [])
    })
    await act(async () => {
      await hook.result().command('/compress', [])
    })
    expect(hook.result().transcript.items.filter(item => item.kind === 'output')).toHaveLength(1)
  })

  it("from a command that ends after its chat was left go to that chat, not the one shown", async () => {
    resumes.a = rows(1, 'one')
    resumes.b = rows(1, 'other')
    const hook = mount({ storedId: 'a' })
    await settle()
    let running: Promise<unknown> = Promise.resolve()
    act(() => {
      running = hook.result().command('/btw what did we decide?', [])
    })
    await settle()
    hook.rerender({ storedId: 'b' })
    await settle()
    await act(async () => {
      heldBtw?.()
      await running
    })
    expect(hook.result().transcript.items.some(item => item.kind === 'output')).toBe(false)
    hook.rerender({ storedId: 'a' })
    await settle()
    expect(hook.result().transcript.items.map(item => item.kind)).toEqual(['user', 'assistant', 'output'])
  })
})

describe('withChatNotes', () => {
  const row = (key: string): TranscriptItem => ({ kind: 'user', key, text: key }) as TranscriptItem
  const state = (...items: TranscriptItem[]): TranscriptState => ({ items, running: false })
  const note = (key: string, after: string | null | undefined): ChatNote => ({ key, ...(after === undefined ? {} : { after }), text: key, format: 'plain' })

  it('puts each note after its row, at the end when the row is gone, never above an earlier note', () => {
    const placed = withChatNotes(state(row('row-1'), row('row-2'), row('row-3')), [note('n1', 'row-2'), note('n2', 'row-9'), note('n3', 'row-1'), note('n0', null)])
    expect(placed.items.map(i => i.key)).toEqual(['row-1', 'row-2', 'n1', 'row-3', 'n2', 'n3', 'n0'])
    expect(withChatNotes(state(row('row-1')), [note('n0', null)]).items.map(i => i.key)).toEqual(['n0', 'row-1'])
    expect(withChatNotes(state(row('row-1')), [note('late', undefined)]).items.map(i => i.key)).toEqual(['row-1', 'late'])
  })

  it("doesn't draw a note twice", () => {
    const drawn = withChatNotes(state(row('row-1')), [note('n1', 'row-1')])
    expect(withChatNotes(drawn, [note('n1', 'row-1')])).toBe(drawn)
  })

  it('keeps the newest notes past the limit', () => {
    for (let i = 0; i < MAX_CHAT_NOTES + 3; i++) addChatNote('c', { text: `n${i}`, format: 'plain' })
    const kept = chatNotes('c')
    expect(kept).toHaveLength(MAX_CHAT_NOTES)
    expect(kept.at(-1)?.text).toBe(`n${MAX_CHAT_NOTES + 2}`)
    rememberChatNotes('d', state(row('row-1'), { kind: 'output', key: 'note-x', text: 'x', format: 'plain' }))
    expect(chatNotes('d')).toEqual([{ key: 'note-x', after: 'row-1', text: 'x', format: 'plain' }])
    expect(chatNotes('c')).toHaveLength(MAX_CHAT_NOTES - 1)
  })
})
