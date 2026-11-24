/**
 * An artifact's Show in Chat: the message it came from, revealed once its
 * chat's transcript has it (after the phone's ArtifactReveal). The wait lasts
 * 20 seconds, and ends early when another chat opens.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranscriptValue, type TranscriptStore } from './transcriptStore'
import { revealedKey } from './transcriptReads'
import type { TranscriptItem } from './transcript'

export const REVEAL_WAIT_MS = 20_000

export interface RevealRow {
  sessionId: string
  messageId: number
  until: number
}

/**
 * Waits for the row to reveal and hands its key to `reveal`. `selectedId` is
 * the chat on screen; `storedId` is the open chat's id in useChat, which
 * changes in the same effect as the store's reset, so the render between a
 * switch and that reset never matches the row against the previous chat's
 * transcript. A chat opened on its newest stored page may not hold the row
 * yet: `seek` reads the pages before until it does (useChat's seekRow).
 * Answers the call that starts a wait.
 */
export function useRevealRow(
  store: TranscriptStore,
  selectedId: string | null | undefined,
  storedId: string | null | undefined,
  reveal: (key: string) => void,
  seek?: (found: (items: readonly TranscriptItem[]) => boolean) => void
): (sessionId: string, messageId: number) => void {
  const [row, setRow] = useState<RevealRow | null>(null)
  const revealRef = useRef(reveal)
  revealRef.current = reveal
  const seekRef = useRef(seek)
  seekRef.current = seek
  const revealing = row && selectedId === row.sessionId && storedId === row.sessionId ? row.messageId : null
  const key = useTranscriptValue(store, state => (revealing === null ? null : revealedKey(state.items, revealing)))
  useEffect(() => {
    if (!row) return
    // Another chat opened mid-wait: the reveal is over, not saved for later.
    if (selectedId !== row.sessionId) return setRow(null)
    const left = row.until - Date.now()
    if (left <= 0) return setRow(null)
    if (key) {
      setRow(null)
      revealRef.current(key)
      return
    }
    // Not among the rows read so far: the pages before are read for it.
    if (revealing !== null) seekRef.current?.(items => revealedKey(items, revealing) !== null)
    // The row may never come: the wait ends on time, not on the next change to the transcript.
    const timer = window.setTimeout(() => setRow(current => (current === row ? null : current)), left)
    return () => window.clearTimeout(timer)
  }, [row, selectedId, key, revealing])
  const [start] = useState(() => (sessionId: string, messageId: number) => setRow({ sessionId, messageId, until: Date.now() + REVEAL_WAIT_MS }))
  return start
}
