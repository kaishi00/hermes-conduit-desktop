// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from './hookHarness'
import { REVEAL_WAIT_MS, useRevealRow } from '../src/renderer/src/state/revealRow'
import { TranscriptStore } from '../src/renderer/src/state/transcriptStore'
import { emptyTranscript, type TranscriptItem, type TranscriptState } from '../src/renderer/src/state/transcript'

const rows = (...ns: number[]): TranscriptState => ({
  ...emptyTranscript,
  items: ns.map(n => ({ key: `row-${n}`, kind: 'user', text: `m${n}` }) as unknown as TranscriptItem)
})

type Props = { selected: string; stored: string }

function setup(initial: TranscriptState, props: Props) {
  const store = new TranscriptStore(initial)
  const reveal = vi.fn()
  const hook = renderHook((p: Props) => useRevealRow(store, p.selected, p.stored, reveal), props)
  return { store, reveal, hook }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useRevealRow', () => {
  it('reveals the row once its chat has it', () => {
    const { store, reveal, hook } = setup(emptyTranscript, { selected: 'a', stored: 'a' })
    act(() => hook.result()('a', 5))
    expect(reveal).not.toHaveBeenCalled()
    act(() => store.set(rows(3, 5, 7)))
    expect(reveal).toHaveBeenCalledWith('row-5')
    act(() => store.set(rows(3, 5, 7, 9)))
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('waits for the open chat to be the one asked for, not the previous chat\'s rows', () => {
    const { store, reveal, hook } = setup(rows(1, 2, 3), { selected: 'a', stored: 'a' })
    // Show in Chat for b: the selection moves first, the store still holds a's rows.
    act(() => {
      hook.result()('b', 2)
      hook.rerender({ selected: 'b', stored: 'a' })
    })
    expect(reveal).not.toHaveBeenCalled()
    act(() => {
      store.set(rows(1, 2))
      hook.rerender({ selected: 'b', stored: 'b' })
    })
    expect(reveal).toHaveBeenCalledWith('row-2')
  })

  it('ends the wait on time when the row never comes', () => {
    const { store, reveal, hook } = setup(emptyTranscript, { selected: 'a', stored: 'a' })
    act(() => hook.result()('a', 5))
    act(() => vi.advanceTimersByTime(REVEAL_WAIT_MS + 1))
    act(() => store.set(rows(5)))
    expect(reveal).not.toHaveBeenCalled()
  })

  it('ends the wait when another chat opens, even if the first comes back in time', () => {
    const { store, reveal, hook } = setup(emptyTranscript, { selected: 'a', stored: 'a' })
    act(() => hook.result()('a', 5))
    hook.rerender({ selected: 'z', stored: 'z' })
    hook.rerender({ selected: 'a', stored: 'a' })
    act(() => store.set(rows(5)))
    expect(reveal).not.toHaveBeenCalled()
  })

  it('asks for the pages before when the open chat holds no row that far back, and not for another chat', () => {
    // A chat opened on its newest stored page: rows 500 and up.
    const store = new TranscriptStore(rows(500, 501))
    const reveal = vi.fn()
    const seek = vi.fn()
    const hook = renderHook((p: Props) => useRevealRow(store, p.selected, p.stored, reveal, seek), { selected: 'a', stored: 'a' })
    act(() => hook.result()('b', 40))
    expect(seek).not.toHaveBeenCalled()
    act(() => hook.result()('a', 40))
    expect(seek).toHaveBeenCalledTimes(1)
    const found = seek.mock.calls[0]![0] as (items: readonly TranscriptItem[]) => boolean
    expect(found(rows(500, 501).items)).toBe(false)
    expect(found(rows(38, 40, 500).items)).toBe(true)
    // The page arrives: the row is revealed.
    act(() => store.set(rows(38, 40, 500, 501)))
    expect(reveal).toHaveBeenCalledWith('row-40')
  })
})
