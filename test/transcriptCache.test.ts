import { beforeEach, describe, expect, it } from 'vitest'
import { forgetTranscriptHosts, forgetTranscripts, keepTranscript, keptOlderAt, keptTranscript, TRANSCRIPT_CACHE_SIZE } from '../src/renderer/src/state/transcriptCache'
import type { TranscriptState } from '../src/renderer/src/state/transcript'

const state = (text: string, extra: Partial<TranscriptState> = {}): TranscriptState => ({
  items: [{ kind: 'assistant', key: text, text, at: 1 } as TranscriptState['items'][number]],
  running: false,
  ...extra
})

const A = 'https://a.example'
const B = 'https://b.example'
beforeEach(() => [undefined, A, B].forEach(host => forgetTranscripts(host)))

describe('the transcripts kept for coming back', () => {
  it('keeps each dashboard’s chats apart, so switching back draws its chat at once', () => {
    const here = state('here')
    const there = state('there')
    keepTranscript('s1', 'zhongli', here, 'https://a.example')
    keepTranscript('s1', 'zhongli', there, 'https://b.example')
    expect(keptTranscript('s1', 'zhongli', 'https://a.example')).toBe(here)
    expect(keptTranscript('s1', 'zhongli', 'https://b.example')).toBe(there)
    expect(keptTranscript('s1', 'zhongli')).toBeNull()
  })

  it('forgets only the dropped dashboard’s chats, and keeps six for each', () => {
    const there = state('there')
    keepTranscript('s1', undefined, state('here'), A)
    keepTranscript('s1', undefined, there, B)
    forgetTranscripts(A)
    expect(keptTranscript('s1', undefined, A)).toBeNull()
    expect(keptTranscript('s1', undefined, B)).toBe(there)
    for (let i = 0; i < TRANSCRIPT_CACHE_SIZE + 2; i++) keepTranscript(`a${i}`, undefined, state(String(i)), A)
    expect(keptTranscript('s1', undefined, B)).toBe(there)
    expect(keptTranscript('a0', undefined, A)).toBeNull()
    expect(keptTranscript('a2', undefined, A)).not.toBeNull()
  })

  it('lets a dashboard no longer saved take its chats with it', () => {
    const kept = state('kept')
    keepTranscript('s1', undefined, kept, A)
    keepTranscript('s1', undefined, state('gone'), B)
    forgetTranscriptHosts([A])
    expect(keptTranscript('s1', undefined, A)).toBe(kept)
    expect(keptTranscript('s1', undefined, B)).toBeNull()
  })

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

describe('pages read back before a chat was left (desktop#540)', () => {
  it('keeps where they reached with the transcript, and lets it go with it', () => {
    keepTranscript('long', undefined, state('paged'), A, { offset: 1500, more: true })
    expect(keptOlderAt('long', undefined, A)).toEqual({ offset: 1500, more: true })
    expect(keptOlderAt('long', undefined, B)).toBeNull()
    keepTranscript('long', undefined, state('read again'), A)
    expect(keptOlderAt('long', undefined, A)).toBeNull()
    keepTranscript('long', undefined, state('paged'), A, { offset: 1500, more: false })
    keepTranscript('long', undefined, state('running', { running: true }), A, { offset: 2000, more: true })
    expect(keptOlderAt('long', undefined, A)).toBeNull()
    keepTranscript('long', undefined, state('paged'), A, { offset: 1500, more: false })
    forgetTranscripts(A)
    expect(keptOlderAt('long', undefined, A)).toBeNull()
  })
})
