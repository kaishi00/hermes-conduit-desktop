import { beforeEach, describe, expect, it } from 'vitest'
import { forgetTranscripts, keepTranscript, keptTranscript, TRANSCRIPT_CACHE_SIZE } from '../src/renderer/src/state/transcriptCache'
import type { TranscriptState } from '../src/renderer/src/state/transcript'

const state = (text: string, extra: Partial<TranscriptState> = {}): TranscriptState => ({
  items: [{ kind: 'assistant', key: text, text, at: 1 } as TranscriptState['items'][number]],
  running: false,
  ...extra
})

beforeEach(() => forgetTranscripts())

describe('the transcripts kept for coming back', () => {
  it('gives back a chat as it was left, per profile', () => {
    const a = state('a')
    keepTranscript('s1', undefined, a)
    expect(keptTranscript('s1', 'default')).toBe(a)
    expect(keptTranscript('s1', 'work')).toBeNull()
  })

  it('keeps only settled transcripts, and a later unsettled one drops the old', () => {
    keepTranscript('s1', undefined, state('a', { running: true }))
    expect(keptTranscript('s1', undefined)).toBeNull()
    keepTranscript('s2', undefined, state('b'))
    keepTranscript('s2', undefined, state('b', { running: true }))
    expect(keptTranscript('s2', undefined)).toBeNull()
    keepTranscript('s3', undefined, { items: [{ kind: 'user', key: 'u', text: 'hi', pending: true } as TranscriptState['items'][number]], running: false })
    expect(keptTranscript('s3', undefined)).toBeNull()
    keepTranscript('s4', undefined, { items: [], running: false })
    expect(keptTranscript('s4', undefined)).toBeNull()
  })

  it('lets the least recently opened go past its size', () => {
    for (let i = 0; i <= TRANSCRIPT_CACHE_SIZE; i++) keepTranscript(`s${i}`, undefined, state(String(i)))
    expect(keptTranscript('s0', undefined)).toBeNull()
    expect(keptTranscript('s1', undefined)).not.toBeNull()
    keepTranscript('new', undefined, state('n'))
    expect(keptTranscript('s1', undefined)).not.toBeNull()
    expect(keptTranscript('s2', undefined)).toBeNull()
  })
})
