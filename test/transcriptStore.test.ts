import { describe, expect, it, vi } from 'vitest'
import { TranscriptStore } from '../src/renderer/src/state/transcriptStore'
import { lastReplyOf, revealedKey } from '../src/renderer/src/state/transcriptReads'
import { emptyTranscript, type TranscriptItem } from '../src/renderer/src/state/transcript'

describe('the open chat’s transcript store (desktop#212)', () => {
  it('tells its readers of a new state, not of the same one again', () => {
    const store = new TranscriptStore(emptyTranscript)
    const heard = vi.fn()
    const off = store.subscribe(heard)
    store.set(emptyTranscript)
    expect(heard).not.toHaveBeenCalled()
    const next = { ...emptyTranscript, running: true }
    store.set(next)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(store.get()).toBe(next)
    off()
    store.set(emptyTranscript)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('what the window reads from the transcript', () => {
  const items = (...rows: [string, string, string?][]) => rows.map(([kind, text, key]) => ({ kind, text, key: key ?? `${kind}-${text}` }) as TranscriptItem)

  it('the reply to your last message, once it has words', () => {
    expect(lastReplyOf(items(['user', 'hi'], ['assistant', 'Hello']))).toBe('Hello')
    expect(lastReplyOf(items(['user', 'hi'], ['assistant', 'Hello'], ['user', 'more']))).toBeNull()
    expect(lastReplyOf(items(['user', 'hi'], ['assistant', 'Hello'], ['assistant', '  ']))).toBe('Hello')
  })

  it('the item of the message Show in Chat names, else the last one before it', () => {
    const rows = items(['user', 'a', 'row-3'], ['assistant', 'b', 'row-7'], ['assistant', 'c', 'live-1'])
    expect(revealedKey(rows, 7)).toBe('row-7')
    expect(revealedKey(rows, 5)).toBe('row-3')
    expect(revealedKey(rows, 2)).toBeNull()
  })
})
