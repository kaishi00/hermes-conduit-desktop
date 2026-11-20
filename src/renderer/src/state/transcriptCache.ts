/**
 * The last few chats' transcripts in this window (desktop#201), so going
 * back to a chat draws it at once while its resume runs, as the phone's
 * transcript cache does. The resume always runs and its answer replaces
 * what's drawn, so a chat changed elsewhere (the phone, another window)
 * shows its new rows once it answers. Only a settled transcript is kept:
 * not one with a turn running, a message still sending, or held messages,
 * whose live parts only the resume can give back.
 */
import type { TranscriptState } from './transcript'

export const TRANSCRIPT_CACHE_SIZE = 6

const kept = new Map<string, TranscriptState>()

const keyOf = (storedId: string, profile: string | undefined) => `${profile || 'default'}\n${storedId}`

export function settled(state: TranscriptState): boolean {
  return !state.running && !state.held?.length && state.items.length > 0 && !state.items.some(i => i.kind === 'user' && i.pending)
}

/** Keeps a chat's transcript as it was left, the newest first out of TRANSCRIPT_CACHE_SIZE. */
export function keepTranscript(storedId: string | null, profile: string | undefined, state: TranscriptState): void {
  if (!storedId) return
  const key = keyOf(storedId, profile)
  kept.delete(key)
  if (!settled(state)) return
  kept.set(key, state)
  while (kept.size > TRANSCRIPT_CACHE_SIZE) kept.delete(kept.keys().next().value!)
}

/** The transcript kept for a chat, to draw while it resumes; null when none. */
export function keptTranscript(storedId: string, profile: string | undefined): TranscriptState | null {
  const key = keyOf(storedId, profile)
  const state = kept.get(key)
  if (!state) return null
  kept.delete(key)
  kept.set(key, state)
  return state
}

/** Another dashboard, or the connection dropped: what was kept may not be this host's or current. */
export function forgetTranscripts(): void {
  kept.clear()
}
