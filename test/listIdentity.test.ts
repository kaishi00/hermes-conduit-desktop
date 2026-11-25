import { afterEach, describe, expect, it, vi } from 'vitest'
import { withProfileMarks } from '../src/renderer/src/state/chatDone'
import { withProfileMutes } from '../src/renderer/src/state/chatMute'
import { sameVoice, type VoiceList } from '../src/renderer/src/state/voiceList'
import { flushMarks, loadMarks, MARKS_SAVE_WAIT_MS, saveMarksSoon, type ChatMarks } from '../src/renderer/src/state/chatMarks'

// desktop#543: a read that says the same keeps the object the chat list works from.
describe('side reads that say the same', () => {
  it('keep the done marks', () => {
    const marks = { work: [{ ids: ['a'], at: 1, byAgent: false }] }
    expect(withProfileMarks(marks, 'work', [{ ids: ['a'], at: 1, byAgent: false }])).toBe(marks)
    expect(withProfileMarks(marks, 'work', [{ ids: ['a'], at: 2, byAgent: false }])).not.toBe(marks)
    expect(withProfileMarks(null, 'work', [])).toEqual({ work: [] })
  })

  it('keep the mutes, a timed end read again a moment later included', () => {
    const mutes = { default: [{ ids: ['a'], until: 10_000 }, { ids: ['b'], until: null }] }
    expect(withProfileMutes(mutes, 'default', [{ ids: ['a'], until: 10_900 }, { ids: ['b'], until: null }])).toBe(mutes)
    expect(withProfileMutes(mutes, 'default', [{ ids: ['a'], until: 60_000 }, { ids: ['b'], until: null }])).not.toBe(mutes)
    expect(withProfileMutes(mutes, 'default', [{ ids: ['a'], until: 10_000 }, { ids: ['c'], until: null }])).not.toBe(mutes)
    expect(withProfileMutes(mutes, 'default', [{ ids: ['a'], until: 10_000 }])).not.toBe(mutes)
  })

  it('keep voice’s tags', () => {
    const read = (engine: string | null): VoiceList => ({
      tags: new Map([['default', new Map([['c1', { kind: 'call' as const, engine, parentId: null, parentTitle: null }]])]]),
      callChats: new Map([['default', new Set(['kept'])]])
    })
    expect(sameVoice(read('gpt-live'), read('gpt-live'))).toBe(true)
    expect(sameVoice(read('gpt-live'), read('gemini-live'))).toBe(false)
    expect(sameVoice(read(null), { ...read(null), callChats: new Map([['default', new Set(['other'])]]) })).toBe(false)
  })
})

describe('saving marks', () => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage
  afterEach(() => vi.useRealTimers())

  it('writes the latest of a burst once, a moment later, and at once when the host’s marks are loaded', () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(localStorage, 'setItem')
    const marks = (at: number): ChatMarks => ({ stars: [], seen: { 'default\tc': at }, baseline: 0, unread: [] })
    for (let at = 1; at <= 20; at++) saveMarksSoon('h', marks(at))
    expect(setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(MARKS_SAVE_WAIT_MS)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(loadMarks('h').seen['default\tc']).toBe(20)
    saveMarksSoon('h', marks(21))
    expect(loadMarks('h').seen['default\tc']).toBe(21)
    expect(setItem).toHaveBeenCalledTimes(2)
    flushMarks()
    setItem.mockRestore()
  })
})
