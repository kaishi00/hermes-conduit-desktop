/**
 * The last few chats' transcripts in this window (desktop#201), so going
 * back to a chat draws it at once while its resume runs, as the phone's
 * transcript cache does. The resume always runs and its answer replaces
 * what's drawn, so a chat changed elsewhere (the phone, another window)
 * shows its new rows once it answers. A chat left mid-turn (a bot's
 * workstream still working) is kept as its stand-in: its rows as they were,
 * without the turn's live parts (the running turn, a message still sending,
 * held messages), which only the resume can give back (desktop#612).
 */
import type { TranscriptState } from './transcript'

export const TRANSCRIPT_CACHE_SIZE = 6

/** Where the pages read back up to: the chat's next older page, and whether there is one (longChat.ts). */
export type OlderAt = { offset: number; more: boolean }

const kept = new Map<string, TranscriptState>()
/**
 * Chats read ahead before they were opened (readAhead.ts), apart from the
 * chats left, so pointing at cards never pushes out a chat just left. Each
 * dashboard keeps its own six; opening or leaving one moves it to `kept`.
 */
const ahead = new Map<string, TranscriptState>()
// The older pages a kept transcript holds were read up to here, so coming back keeps them (desktop#540).
const keptOlder = new Map<string, OlderAt>()

/** Each dashboard's own, so switching between combined dashboards draws the chat it opens at once. */
export const keyOf = (storedId: string, profile: string | undefined, host = '') => `${host}\n${profile || 'default'}\n${storedId}`

export function settled(state: TranscriptState): boolean {
  return !state.running && !state.held?.length && state.items.length > 0 && !state.items.some(i => i.kind === 'user' && i.pending)
}

/**
 * What a chat draws while its resume runs: a settled transcript as it is,
 * and one left mid-turn as its rows so far, with nothing still running in
 * it (no turn, no message sending or held, no reply or thinking still
 * streaming), so nothing acts on a turn the resume hasn't given back. Its
 * rows are replaced as the resume answers. Null when there's nothing to draw.
 */
export function standIn(state: TranscriptState): TranscriptState | null {
  if (settled(state)) return state
  const items = state.items
    .filter(item => !(item.kind === 'user' && item.pending))
    .map(item => ((item.kind === 'assistant' || item.kind === 'thinking') && item.streaming ? { ...item, streaming: false } : item))
  if (!items.length) return null
  return { items, running: false, plan: state.plan }
}

/** Keeps a chat's transcript as it was left, the newest first out of TRANSCRIPT_CACHE_SIZE. */
export function keepTranscript(storedId: string | null, profile: string | undefined, state: TranscriptState, host = '', older?: OlderAt | null): void {
  if (!storedId) return
  const key = keyOf(storedId, profile, host)
  kept.delete(key)
  keptOlder.delete(key)
  ahead.delete(key)
  const copy = standIn(state)
  if (!copy) return
  kept.set(key, copy)
  // The pages read back are kept only with a settled chat: one left mid-turn reads them again.
  if (older && copy === state) keptOlder.set(key, older)
  // Each dashboard keeps its own six, so opening chats on one doesn't push out another's.
  const prefix = `${host}\n`
  const mine = [...kept.keys()].filter(k => k.startsWith(prefix))
  for (const old of mine.slice(0, Math.max(0, mine.length - TRANSCRIPT_CACHE_SIZE))) {
    kept.delete(old)
    keptOlder.delete(old)
  }
}

/** Keeps a chat read ahead of its open, the newest first out of TRANSCRIPT_CACHE_SIZE, apart from the chats left. */
export function keepReadAhead(storedId: string, profile: string | undefined, state: TranscriptState, host = ''): void {
  const key = keyOf(storedId, profile, host)
  if (kept.has(key) || !state.items.length) return
  ahead.delete(key)
  ahead.set(key, state)
  const prefix = `${host}\n`
  const mine = [...ahead.keys()].filter(k => k.startsWith(prefix))
  for (const old of mine.slice(0, Math.max(0, mine.length - TRANSCRIPT_CACHE_SIZE))) ahead.delete(old)
}

/** Where a kept transcript's pages read back up to, when it holds pages read by scrolling up; null otherwise. */
export function keptOlderAt(storedId: string, profile: string | undefined, host = ''): OlderAt | null {
  const key = keyOf(storedId, profile, host)
  return kept.has(key) ? (keptOlder.get(key) ?? null) : null
}

/** Whether a chat has a transcript kept, without counting as an open. */
export function hasKeptTranscript(storedId: string, profile: string | undefined, host = ''): boolean {
  const key = keyOf(storedId, profile, host)
  return kept.has(key) || ahead.has(key)
}

/** The transcript kept for a chat, to draw while it resumes; null when none. */
export function keptTranscript(storedId: string, profile: string | undefined, host = ''): TranscriptState | null {
  const key = keyOf(storedId, profile, host)
  const state = kept.get(key)
  if (!state) {
    const early = ahead.get(key)
    if (!early) return null
    // Opening it moves it to `kept`, so it gives back its read-ahead slot (#634).
    keepTranscript(storedId, profile, early, host)
    return kept.get(key) ?? null
  }
  kept.delete(key)
  kept.set(key, state)
  return state
}

/** The chats kept for dashboards no longer saved go. */
export function forgetTranscriptHosts(hosts: readonly string[]): void {
  for (const key of [...kept.keys()]) if (!hosts.includes(key.slice(0, key.indexOf('\n')))) kept.delete(key)
  for (const key of [...ahead.keys()]) if (!hosts.includes(key.slice(0, key.indexOf('\n')))) ahead.delete(key)
  for (const key of [...keptOlder.keys()]) if (!kept.has(key)) keptOlder.delete(key)
}

/** A dashboard's connection dropped: what was kept for it may not be current. The others' stay. */
export function forgetTranscripts(host = ''): void {
  const prefix = `${host}\n`
  for (const key of [...kept.keys()]) if (key.startsWith(prefix)) kept.delete(key)
  for (const key of [...ahead.keys()]) if (key.startsWith(prefix)) ahead.delete(key)
  for (const key of [...keptOlder.keys()]) if (key.startsWith(prefix)) keptOlder.delete(key)
}
