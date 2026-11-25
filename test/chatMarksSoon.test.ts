// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushMarks, saveMarksSoon } from '../src/renderer/src/state/chatMarks'
import type { ChatMarks } from '../src/renderer/src/state/chatMarks'

const marks = (seen: number): ChatMarks => ({ stars: [], seen: { 'default\ta': seen }, baseline: 1000, unread: [] })
const stored = () => JSON.parse(localStorage.getItem('conduit.chatMarks.host') ?? 'null') as ChatMarks | null

describe('marks writes (issue 550)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    flushMarks()
    vi.useRealTimers()
  })

  it('debounces to one write a second after the last change, not one per second during it', () => {
    saveMarksSoon('host', marks(2000))
    vi.advanceTimersByTime(500)
    saveMarksSoon('host', marks(3000))
    vi.advanceTimersByTime(999)
    expect(stored()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(stored()?.seen).toEqual({ 'default\ta': 3000 })
    expect(localStorage.length).toBe(1)
  })
})
