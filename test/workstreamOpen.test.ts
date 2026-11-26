// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChat } from '../src/renderer/src/state/useChat'
import { useTranscript } from '../src/renderer/src/state/transcriptStore'
import { forgetTranscripts, hasKeptTranscript, keepReadAhead, keepTranscript, keptTranscript, standIn, TRANSCRIPT_CACHE_SIZE } from '../src/renderer/src/state/transcriptCache'
import { forgetChatLengths, knownChatLength } from '../src/renderer/src/state/chatLength'
import { forgetReadsAhead, readChatAhead } from '../src/renderer/src/state/readAhead'
import type { HistoryRow, TranscriptState } from '../src/renderer/src/state/transcript'

// desktop#612: a bot's workstream chats (hidden from the chat list, so no length is known, and usually still working)
// opened blank until a page read and then a whole resume had both come back.

const row = (id: number, text: string): HistoryRow => ({ id, role: id % 2 ? 'assistant' : 'user', content: text }) as HistoryRow
const page = (from: number, count: number): HistoryRow[] => Array.from({ length: count }, (_, i) => row(from + i, `message ${from + i}`))

let paths: string[] = []
let resumes: Record<string, unknown>[] = []
let pageRows: HistoryRow[] = []
let resumeRows: HistoryRow[] = []
let releaseResume: (() => void) | null = null

beforeEach(() => {
  forgetTranscripts()
  forgetChatLengths()
  forgetReadsAhead()
  paths = []
  resumes = []
  pageRows = []
  resumeRows = []
  releaseResume = null
  ;(window as unknown as { conduit: unknown }).conduit = {
    rpcOutcome: (method: string, params: Record<string, unknown>) => {
      if (method !== 'session.resume') return Promise.resolve({ ok: true, result: {} })
      resumes.push(params)
      const answer = { ok: true, result: { session_id: 'live-w1', stored_session_id: 'w1', messages: resumeRows } }
      // The resume is held until the test lets it go, to see what the chat draws meanwhile.
      return new Promise(resolve => {
        releaseResume = () => resolve(answer)
      })
    },
    httpOutcome: async (_method: string, path: string) => {
      paths.push(path)
      return { ok: true, result: { messages: pageRows } }
    },
    onEvent: () => () => undefined
  }
})

const words = (state: { items: { kind: string; text?: string }[] }) => state.items.map(i => i.text ?? i.kind)

function mount(storedId: string) {
  return renderHook(({ id }: { id: string }) => {
    const chat = useChat(id, undefined, false, true)
    return { ...chat, transcript: useTranscript(chat.transcriptStore) }
  }, { id: storedId })
}

describe('a workstream chat opened for the first time', () => {
  it('draws the page its open read while the whole resume runs, then the resume', async () => {
    pageRows = page(1, 6)
    resumeRows = page(1, 7)
    const hook = mount('w1')
    await settle()
    expect(resumes.map(r => r.omit_messages === true)).toEqual([false])
    expect(words(hook.result().transcript)).toEqual(page(1, 6).map(r => r.content))
    releaseResume!()
    await settle()
    expect(words(hook.result().transcript)).toEqual(page(1, 7).map(r => r.content))
    hook.unmount()
  })
})

describe('a chat left mid-turn', () => {
  const running: TranscriptState = {
    running: true,
    turnFrom: 1,
    status: 'Reading files',
    items: [
      { kind: 'user', key: 'u1', text: 'build it' },
      { kind: 'assistant', key: 'a1', text: 'On it', streaming: true },
      { kind: 'user', key: 'u2', text: 'also tests', pending: true }
    ] as TranscriptState['items']
  }

  it('is kept as its rows so far, with nothing still running in it', () => {
    keepTranscript('w1', undefined, running, '', { offset: 500, more: true })
    const kept = keptTranscript('w1', undefined)!
    expect(kept.running).toBe(false)
    expect(kept.turnFrom).toBeUndefined()
    expect(kept.status).toBeUndefined()
    expect(words(kept)).toEqual(['build it', 'On it'])
    expect(kept.items.some(i => i.kind === 'assistant' && i.streaming)).toBe(false)
  })

  it('keeps a settled chat as it is, and nothing for one with no rows to draw', () => {
    const done: TranscriptState = { running: false, items: [{ kind: 'assistant', key: 'a', text: 'done', streaming: false }] as TranscriptState['items'] }
    expect(standIn(done)).toBe(done)
    expect(standIn({ running: true, items: [{ kind: 'user', key: 'u', text: 'hi', pending: true }] as TranscriptState['items'] })).toBeNull()
  })

  it('draws at once when opened again, before its resume answers', async () => {
    keepTranscript('w1', undefined, running)
    pageRows = page(1, 6)
    const hook = mount('w1')
    expect(words(hook.result().transcript)).toEqual(['build it', 'On it'])
    expect(hook.result().transcript.running).toBe(false)
    hook.unmount()
  })
})

describe('a workstream card read ahead', () => {
  it('keeps its chat’s page and length, so the open draws it at once and resumes whole without reading it again', async () => {
    pageRows = page(1, 6)
    readChatAhead('w1', undefined)
    await settle()
    expect(paths.length).toBe(1)
    expect(knownChatLength('w1')).toBe(6)
    expect(hasKeptTranscript('w1', undefined)).toBe(true)

    resumeRows = page(1, 7)
    const hook = mount('w1')
    expect(words(hook.result().transcript)).toEqual(page(1, 6).map(r => r.content))
    await settle()
    expect(paths.length).toBe(1)
    expect(resumes.map(r => r.omit_messages === true)).toEqual([false])
    releaseResume!()
    await settle()
    expect(words(hook.result().transcript)).toEqual(page(1, 7).map(r => r.content))
    hook.unmount()
  })

  it('reads nothing for a chat already kept, nor again for one read moments ago', async () => {
    pageRows = page(1, 6)
    keepTranscript('kept', undefined, { running: false, items: [{ kind: 'assistant', key: 'a', text: 'hi', streaming: false }] as TranscriptState['items'] })
    readChatAhead('kept', undefined)
    readChatAhead('w1', undefined)
    readChatAhead('w1', undefined)
    await settle()
    expect(paths.length).toBe(1)
  })

  it('leaves a copy kept meanwhile alone, and keeps no length for a chat past one page', async () => {
    pageRows = page(1, 500)
    readChatAhead('big', undefined)
    await settle()
    expect(knownChatLength('big')).toBeUndefined()
    expect(hasKeptTranscript('big', undefined)).toBe(true)
  })

  it('never pushes out a chat just left, however many cards are pointed at', () => {
    const left: TranscriptState = { running: false, items: [{ kind: 'assistant', key: 'a', text: 'left', streaming: false }] as TranscriptState['items'] }
    keepTranscript('left', undefined, left)
    for (let i = 0; i < TRANSCRIPT_CACHE_SIZE + 2; i++) keepReadAhead(`w${i}`, undefined, left)
    expect(keptTranscript('left', undefined)).toBe(left)
    // Its own six: the oldest read ahead go first.
    expect(hasKeptTranscript('w0', undefined)).toBe(false)
    expect(hasKeptTranscript(`w${TRANSCRIPT_CACHE_SIZE + 1}`, undefined)).toBe(true)
  })

  it('gives way to the chat once it is left, and goes with a dropped connection', () => {
    const read: TranscriptState = { running: false, items: [{ kind: 'assistant', key: 'r', text: 'read', streaming: false }] as TranscriptState['items'] }
    const left: TranscriptState = { running: false, items: [{ kind: 'assistant', key: 'l', text: 'left', streaming: false }] as TranscriptState['items'] }
    keepReadAhead('w1', undefined, read)
    expect(keptTranscript('w1', undefined)).toBe(read)
    keepTranscript('w1', undefined, left)
    expect(keptTranscript('w1', undefined)).toBe(left)
    keepReadAhead('w2', undefined, read)
    forgetTranscripts()
    expect(hasKeptTranscript('w2', undefined)).toBe(false)
  })
})
