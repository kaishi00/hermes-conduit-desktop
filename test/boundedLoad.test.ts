// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { renderHook, settle } from './hookHarness'
import { useChat } from '../src/renderer/src/state/useChat'
import { useTranscript } from '../src/renderer/src/state/transcriptStore'
import { forgetTranscripts } from '../src/renderer/src/state/transcriptCache'
import { newestPages, olderRows, storedRow } from '../src/renderer/src/state/longChat'
import { forgetChatLengths, noteChatLength } from '../src/renderer/src/state/chatLength'
import { prependOlder } from '../src/renderer/src/state/transcript'
import type { HistoryRow } from '../src/renderer/src/state/transcript'

type Event = { type: string; session_id?: string; payload?: unknown }

const row = (id: number, text: string): HistoryRow => ({ id, role: id % 2 ? 'assistant' : 'user', content: text } as HistoryRow)
/** A stored page of `count` rows whose words are the ids: the newest page is the highest ids. */
const page = (from: number, count: number): HistoryRow[] =>
  Array.from({ length: count }, (_, i) => row(from + i, `message ${from + i}`))

let paths: string[] = []
let calls: { method: string; params: Record<string, unknown> }[] = []
let pages: Record<number, HistoryRow[]> = {}
let resumeRows: HistoryRow[] = []
let resumeError: string | null = null
let morePages = false

beforeEach(() => {
  forgetTranscripts()
  forgetChatLengths()
  paths = []
  calls = []
  pages = {}
  resumeRows = []
  resumeError = null
  morePages = false
  ;(window as unknown as { conduit: unknown }).conduit = {
    rpcOutcome: (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      if (method !== 'session.resume') return Promise.resolve({ ok: true, result: {} })
      if (resumeError) return Promise.resolve({ ok: false, error: resumeError })
      if (params.omit_messages) return Promise.resolve({ ok: true, result: { session_id: 'live-big', stored_session_id: 'big', messages: [] } })
      return Promise.resolve({ ok: true, result: { session_id: 'live-big', stored_session_id: 'big', messages: resumeRows } })
    },
    httpOutcome: async (_method: string, path: string) => {
      paths.push(path)
      const offset = Number(/offset=(\d+)/.exec(path)?.[1] ?? 0)
      return { ok: true, result: { messages: pages[offset] ?? [], more: morePages && pages[offset + 500] !== undefined } }
    },
    onEvent: (_listener: (event: Event) => void) => () => undefined
  }
})

const words = (state: { items: { kind: string; text?: string }[] }) => state.items.map(i => i.text ?? i.kind)

function mount(storedId: string) {
  const hook = renderHook(({ id }: { id: string }) => {
    const chat = useChat(id, undefined, false, true)
    return { ...chat, transcript: useTranscript(chat.transcriptStore) }
  }, { id: storedId })
  return hook
}

describe('a chat opened on its newest stored page (desktop#291)', () => {
  it('resumes without its messages and draws the newest page, reading further back on request', async () => {
    pages[0] = page(501, 500)
    pages[500] = page(1, 500)
    const hook = mount('big')
    await settle()
    expect(calls.filter(c => c.method === 'session.resume').map(c => c.params.omit_messages === true)).toEqual([true])
    const items = hook.result().transcript.items
    expect(items.length).toBe(500)
    // The newest rows, oldest first, with no note: the chat isn't too long, it's just read in pages.
    expect(words(hook.result().transcript).slice(-2)).toEqual(['message 999', 'message 1000'])
    expect(words(hook.result().transcript).slice(0, 2)).toEqual(['message 501', 'message 502'])

    await act(async () => {
      await hook.result().loadOlder()
    })
    const all = words(hook.result().transcript)
    expect(all.length).toBe(1000)
    expect(all[0]).toBe('message 1')
    expect(new Set(hook.result().transcript.items.map(i => i.key)).size).toBe(1000)

    // The page before that one is empty: the chat has no more, and asking again reads nothing.
    await act(async () => {
      await hook.result().loadOlder()
    })
    expect(words(hook.result().transcript).length).toBe(1000)
    hook.unmount()
  })

  it('leaves a chat shorter than a page on the whole resume, with nothing to read back', async () => {
    pages[0] = page(1, 12)
    resumeRows = page(1, 12)
    const hook = mount('small')
    await settle()
    expect(calls.filter(c => c.method === 'session.resume').map(c => c.params.omit_messages === true)).toEqual([false])
    expect(hook.result().transcript.items.length).toBe(12)
    const reads = paths.length
    await act(async () => {
      await hook.result().loadOlder()
    })
    expect(paths.length).toBe(reads)
    hook.unmount()
  })

  it('resumes a chat the list says fits one page whole, with no page read first', async () => {
    noteChatLength('small', 12)
    resumeRows = page(1, 12)
    const hook = mount('small')
    await settle()
    expect(paths.filter(p => p.includes('include_compacted=true'))).toEqual([])
    expect(calls.filter(c => c.method === 'session.resume').map(c => c.params.omit_messages === true)).toEqual([false])
    expect(hook.result().transcript.items.length).toBe(12)
    hook.unmount()
  })

  it('reads the newest page for a chat the list says is past one, and for one a whole open found past one', async () => {
    noteChatLength('big', 1000)
    pages[0] = page(501, 500)
    const hook = mount('big')
    await settle()
    expect(calls.filter(c => c.method === 'session.resume').map(c => c.params.omit_messages === true)).toEqual([true])
    hook.unmount()
  })

  it("opens a chat on its newest page once a whole open found it long, whatever the list's count says", async () => {
    // The list leaves out rows the chat compacted away; the resume carries them.
    noteChatLength('big', 433)
    resumeRows = page(1, 700)
    pages[0] = page(201, 500)
    const hook = mount('big')
    await settle()
    expect(hook.result().transcript.items.length).toBe(700)
    noteChatLength('big', 433)
    hook.rerender({ id: 'other' })
    await settle()
    calls = []
    hook.rerender({ id: 'big' })
    await settle()
    expect(calls.filter(c => c.method === 'session.resume').map(c => c.params.omit_messages === true)).toEqual([true])
    expect(hook.result().transcript.items.length).toBe(500)
    hook.unmount()
  })

  it('reads on past a page that draws nothing new, so the top of the chat is never a dead end', async () => {
    pages[0] = page(1001, 500)
    // The page before holds only rows the chat already draws; the one before that has the words.
    pages[500] = page(1001, 500)
    pages[1000] = page(1, 300)
    const hook = mount('big')
    await settle()
    await act(async () => {
      await hook.result().loadOlder()
    })
    expect(paths.map(p => /offset=(\d+)/.exec(p)?.[1])).toEqual(['0', '500', '1000'])
    expect(hook.result().transcript.items.length).toBe(800)
    expect(words(hook.result().transcript)[0]).toBe('message 1')
    hook.unmount()
  })

  it("ends the earlier-messages line when another chat opens while a page is on its way", async () => {
    pages[0] = page(501, 500)
    let release!: () => void
    const conduit = (window as unknown as { conduit: { httpOutcome: (m: string, p: string) => Promise<unknown> } }).conduit
    const base = conduit.httpOutcome
    conduit.httpOutcome = (method, path) =>
      path.includes('offset=500') ? new Promise(resolve => (release = () => resolve({ ok: true, result: { messages: page(1, 500) } }))) : base(method, path)
    const hook = mount('big')
    await settle()
    act(() => void hook.result().loadOlder())
    await settle()
    expect(hook.result().loadingOlder).toBe(true)
    noteChatLength('small', 2)
    resumeRows = page(1, 2)
    hook.rerender({ id: 'small' })
    await settle()
    expect(hook.result().loadingOlder).toBe(false)
    // The page the last chat asked for lands late: it draws nothing here.
    await act(async () => {
      release()
    })
    await settle()
    expect(hook.result().loadingOlder).toBe(false)
    expect(hook.result().transcript.items.length).toBe(2)
    hook.unmount()
  })

  it('reads pages back until the row a jump is after is in the transcript, and no further', async () => {
    pages[0] = page(1501, 500)
    pages[500] = page(1001, 500)
    pages[1000] = page(501, 500)
    pages[1500] = page(1, 500)
    const hook = mount('big')
    await settle()
    const has = (key: string) => (items: readonly { key: string }[]) => items.some(i => i.key === key)
    act(() => hook.result().seekRow(has('row-700')))
    await settle()
    await settle()
    expect(paths.map(p => /offset=(\d+)/.exec(p)?.[1])).toEqual(['0', '500', '1000'])
    expect(hook.result().transcript.items.some(i => i.key === 'row-700')).toBe(true)
    expect(hook.result().loadingOlder).toBe(false)
    hook.unmount()
  })

  it('looks for a row asked for while the chat is still opening, and stops at the first page when the chat has none', async () => {
    pages[0] = page(501, 500)
    pages[500] = page(1, 500)
    const hook = mount('big')
    // Asked before the open settles: the pages are read once it has.
    act(() => hook.result().seekRow(items => items.some(i => i.key === 'row-9999')))
    await settle()
    await settle()
    await settle()
    expect(paths.map(p => /offset=(\d+)/.exec(p)?.[1])).toEqual(['0', '500', '1000'])
    expect(hook.result().transcript.items.length).toBe(1000)
    hook.unmount()
  })

  it('asks for nothing past a newest read that came back short', async () => {
    // 700 rows whose newest page is only tool steps: the page before is read for words, and comes back short.
    pages[0] = Array.from({ length: 500 }, (_, i) => ({ id: 201 + i, role: 'tool', content: 'ok', tool_call_id: `c${i}` }) as HistoryRow)
    pages[500] = page(1, 200)
    const hook = mount('big')
    await settle()
    expect(hook.result().olderRows).toBe(false)
    const reads = paths.length
    await act(async () => {
      await hook.result().loadOlder()
    })
    expect(paths.length).toBe(reads)
    hook.unmount()
  })

  it('tells a jump its row is nowhere once the chat has no page left, and reads nothing for a chat opened whole', async () => {
    noteChatLength('small', 12)
    resumeRows = page(1, 12)
    const hook = mount('small')
    await settle()
    let missed = 0
    act(() => void hook.result().seekRow(items => items.some(i => i.key === 'row-9999'), () => missed++))
    await settle()
    expect(missed).toBe(1)
    expect(paths.filter(p => p.includes('offset='))).toEqual([])
    hook.unmount()
  })

  it("answers a seek missed when the chat’s open has failed", async () => {
    resumeError = 'Hermes is offline'
    const hook = mount('broken')
    await settle()
    // The open itself reads its newest page; a seek after the failure must not read more.
    const readSoFar = paths.length
    let missed = 0
    act(() => void hook.result().seekRow(items => items.some(i => i.key === 'row-9999'), () => missed++))
    await settle()
    expect(missed).toBe(1)
    expect(paths.length).toBe(readSoFar)
    hook.unmount()
  })

  it('stops a dropped seek after one page even when the pages repeat rows already drawn', async () => {
    morePages = true
    const duplicate = page(2001, 500)
    pages[0] = duplicate
    // Pages that only repeat the rows already drawn add nothing, but report more.
    pages[500] = duplicate
    pages[1000] = duplicate
    pages[1500] = duplicate
    pages[2000] = duplicate
    const hook = mount('big')
    await settle()
    const before = paths.length
    let drop!: () => void
    act(() => void (drop = hook.result().seekRow(items => items.some(i => i.key === 'row-9999'))))
    act(() => drop())
    await settle()
    await settle()
    await settle()
    expect(paths.length).toBe(before + 1)
    hook.unmount()
  })

  it('stops reading pages for a jump that is dropped', async () => {
    pages[0] = page(1501, 500)
    pages[500] = page(1001, 500)
    pages[1000] = page(501, 500)
    pages[1500] = page(1, 500)
    const hook = mount('big')
    await settle()
    // The newest page is read while opening; dropping the seek stops after the page in flight.
    const before = paths.length
    let missed = 0
    let drop!: () => void
    act(() => void (drop = hook.result().seekRow(items => items.some(i => i.key === 'row-9999'), () => missed++)))
    // The first page before is on its way; the jump is dropped before it lands.
    act(() => drop())
    await settle()
    await settle()
    await settle()
    // The page already in flight lands; the dropped seek adds no further page.
    expect(paths.length).toBe(before + 1)
    expect(missed).toBe(0)
    hook.unmount()
  })

  it('keeps the earlier-messages line and its page when a reload lands while the page is on its way', async () => {
    pages[0] = page(501, 500)
    let release!: () => void
    const conduit = (window as unknown as { conduit: { httpOutcome: (m: string, p: string) => Promise<unknown> } }).conduit
    const base = conduit.httpOutcome
    conduit.httpOutcome = (method, path) =>
      path.includes('offset=500') ? new Promise(resolve => (release = () => resolve({ ok: true, result: { messages: page(1, 500) } }))) : base(method, path)
    const hook = mount('big')
    await settle()
    act(() => void hook.result().loadOlder())
    await settle()
    expect(hook.result().loadingOlder).toBe(true)
    // /compress reloads the chat's history under the page read.
    await act(async () => {
      await hook.result().command('/compress')
    })
    await settle()
    expect(calls.filter(c => c.method === 'session.resume').length).toBe(2)
    await act(async () => {
      release()
    })
    await settle()
    // The page belonged to the read before the reload: it draws nothing, and its line ends.
    expect(hook.result().loadingOlder).toBe(false)
    expect(hook.result().transcript.items.length).toBe(500)
    hook.unmount()
  })

  it('reads no further pages once the pane is gone', async () => {
    pages[0] = page(1001, 500)
    // The page before draws nothing new, so the read would go on to the one before it.
    let release!: () => void
    const conduit = (window as unknown as { conduit: { httpOutcome: (m: string, p: string) => Promise<unknown> } }).conduit
    const base = conduit.httpOutcome
    conduit.httpOutcome = (method, path) =>
      path.includes('offset=500') ? new Promise(resolve => (release = () => resolve({ ok: true, result: { messages: page(1001, 500) } }))) : base(method, path)
    pages[1000] = page(1, 300)
    const hook = mount('big')
    await settle()
    act(() => void hook.result().loadOlder())
    await settle()
    hook.unmount()
    release()
    await settle()
    expect(paths.filter(p => p.includes('offset=1000'))).toEqual([])
  })

  it('draws the page once when the scroll asks twice while it is on its way', async () => {
    pages[0] = page(201, 500)
    pages[500] = page(1, 200)
    const hook = mount('big')
    await settle()
    await act(async () => {
      await Promise.all([hook.result().loadOlder(), hook.result().loadOlder()])
    })
    expect(paths.filter(p => p.includes('offset=500')).length).toBe(1)
    expect(hook.result().transcript.items.length).toBe(700)
    hook.unmount()
  })
})

describe('the stored page before the drawn rows (desktop#291)', () => {
  const http = async (_method: 'GET', path: string) => ({ messages: pages[Number(/offset=(\d+)/.exec(path)?.[1] ?? 0)] ?? [] })

  it('says whether the newest read reached the first row', async () => {
    pages[0] = page(201, 500)
    expect((await newestPages(http, 'big')).more).toBe(true)
    pages[0] = page(1, 40)
    expect(await newestPages(http, 'big')).toMatchObject({ more: false })
  })

  it('reads one page by offset, and says whether the chat has more before it', async () => {
    pages[500] = page(1, 500)
    expect(await olderRows(http, 'big', undefined, 500)).toMatchObject({ more: true })
    pages[500] = page(1, 40)
    const short = await olderRows(http, 'big', undefined, 500)
    expect(short.rows.length).toBe(40)
    expect(short.more).toBe(false)
  })

  it('names a REST row as a resume does, so a row read twice draws once', () => {
    expect(storedRow({ id: 7, role: 'tool', tool_name: 'terminal', content: 'ok' } as HistoryRow)).toMatchObject({
      row_id: 7,
      name: 'terminal'
    })
  })

  it('draws the page above the chat, under the notes, and no row twice', () => {
    const state = {
      running: false,
      items: [
        { kind: 'notice', key: 'long-chat', text: 'note', tone: 'info' },
        { kind: 'user', key: 'row-501', text: 'message 501' },
        { kind: 'assistant', key: 'row-502', text: 'message 502' }
      ]
    } as unknown as Parameters<typeof prependOlder>[0]
    const next = prependOlder(state, [
      { kind: 'user', key: 'row-1', text: 'message 1' },
      { kind: 'user', key: 'row-501', text: 'message 501' }
    ] as Parameters<typeof prependOlder>[1])
    expect(next.items.map(i => i.key)).toEqual(['long-chat', 'row-1', 'row-501', 'row-502'])
    // Nothing new: the transcript is left as it is.
    expect(prependOlder(next, [{ kind: 'user', key: 'row-1', text: 'message 1' }] as Parameters<typeof prependOlder>[1])).toBe(next)
  })

})
