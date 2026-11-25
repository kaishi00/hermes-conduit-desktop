import { describe, expect, it } from 'vitest'
import { callLength, callTranscript, chatCalls, firstTime, speaker, withCalls } from '../src/renderer/src/state/voiceCalls'
import type { TranscriptItem } from '../src/renderer/src/state/transcript'

describe("a chat's saved voice calls", () => {
  it("reads the chat's calls from the tags answer, oldest first", () => {
    const answer = {
      ok: true,
      tags: {},
      chat_calls: [
        { call_id: 'b', chat_id: 'chat1', engine: 'grok-live', started_at: 200, ended_at: 260 },
        { call_id: 'a', chat_id: 'chat1', started_at: 100 },
        { call_id: 'c', chat_id: 'other', started_at: 50, ended_at: 60 },
        { call_id: 'd', chat_id: 'chat1' },
        'junk'
      ]
    }
    expect(chatCalls(answer, 'chat1')).toEqual([
      { callId: 'a', chatId: 'chat1', engine: null, startedAt: 100_000, endedAt: 100_000 },
      { callId: 'b', chatId: 'chat1', engine: 'grok-live', startedAt: 200_000, endedAt: 260_000 }
    ])
    expect(chatCalls({ ok: true, tags: {} }, 'chat1')).toEqual([])
    expect(chatCalls(null, 'chat1')).toEqual([])
  })

  it('places each card before the first item after the call started', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', key: 'u1', text: 'hi', at: 1000 },
      { kind: 'notice', key: 'n', text: 'no time', tone: 'info' },
      { kind: 'assistant', key: 'a1', text: 'hello', at: 5000 }
    ] as TranscriptItem[]
    const calls = [
      { callId: 'x', chatId: 'c', engine: null, startedAt: 2000, endedAt: 3000 },
      { callId: 'y', chatId: 'c', engine: null, startedAt: 9000, endedAt: 9500 }
    ]
    expect(withCalls(items, calls).map(i => i.key)).toEqual(['u1', 'n', 'call-x', 'a1', 'call-y'])
    expect(withCalls(items, [])).toBe(items)
  })

  it('leaves out the calls from before the rows a chat on its newest pages holds', () => {
    const items: TranscriptItem[] = [
      { kind: 'notice', key: 'n', text: 'no time', tone: 'info' },
      { kind: 'user', key: 'u1', text: 'hi', at: 4000 },
      { kind: 'assistant', key: 'a1', text: 'hello', at: 5000 }
    ] as TranscriptItem[]
    const calls = [
      { callId: 'old', chatId: 'c', engine: null, startedAt: 1000, endedAt: 2000 },
      { callId: 'x', chatId: 'c', engine: null, startedAt: 4500, endedAt: 4600 },
      { callId: 'y', chatId: 'c', engine: null, startedAt: 9000, endedAt: 9500 }
    ]
    // Held whole, the old call leads the chat; with pages still to read, it waits for its own.
    expect(withCalls(items, calls).map(i => i.key)).toEqual(['n', 'call-old', 'u1', 'call-x', 'a1', 'call-y'])
    expect(withCalls(items, calls, firstTime(items)).map(i => i.key)).toEqual(['n', 'u1', 'call-x', 'a1', 'call-y'])
    // The first stored row is hidden by a display setting: a call after it, before the first row drawn, keeps its card.
    expect(withCalls(items.slice(2), calls, firstTime(items)).map(i => i.key)).toEqual(['call-x', 'a1', 'call-y'])
  })

  it("gives the call's length in its two largest units", () => {
    expect(callLength(5_000)).toBe('5s')
    expect(callLength(65_000)).toBe('1m 5s')
    expect(callLength(120_000)).toBe('2m')
    expect(callLength(3_725_000)).toBe('1h 2m')
    expect(callLength(-1)).toBe('0s')
  })

  it("reads one call's turns and names who spoke", () => {
    const answer = {
      ok: true,
      chat_id: 'c',
      calls: [
        {
          call_id: 'x',
          engine: 'gemini-live',
          turns: [
            { role: 'user', text: ' check my mail ' },
            { role: 'assistant', text: 'Asking Hermes.' },
            { role: 'tool', text: 'nope' },
            { role: 'assistant', text: '  ' }
          ]
        }
      ]
    }
    expect(callTranscript(answer, 'x')).toEqual({
      engine: 'gemini-live',
      turns: [
        { role: 'user', text: 'check my mail' },
        { role: 'assistant', text: 'Asking Hermes.' }
      ],
      // Every turn the host holds: a resumed call's turns are numbered after them.
      count: 4
    })
    expect(callTranscript(answer, 'gone')).toBeNull()
    expect(callTranscript({ ok: true, calls: [{ call_id: 'x', turns: [] }] }, 'x')).toBeNull()
    expect(speaker('assistant', 'grok-live')).toBe('Grok')
    expect(speaker('assistant', 'gpt-live')).toBe('GPT-Live')
    expect(speaker('assistant', null)).toBeNull()
    expect(speaker('user', null)).toBe('You')
  })
})
