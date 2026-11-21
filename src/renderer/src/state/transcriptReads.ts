/** Values the window reads from the open chat's transcript (transcriptStore.ts). */
import type { TranscriptItem } from './transcript'

/** The reply to the last message you sent, once it has words; null after a newer message of yours. */
export function lastReplyOf(items: readonly TranscriptItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'user') return null
    if (item.kind === 'assistant' && item.text.trim()) return item.text
  }
  return null
}

/**
 * An artifact's Show in Chat: the item of the message it came from (row
 * `messageId`), else the last one before it, since a tool call keeps no row
 * of its own. Null until the transcript has one.
 */
export function revealedKey(items: readonly TranscriptItem[], messageId: number): string | null {
  let best: { key: string; row: number } | null = null
  for (const item of items) {
    const row = /^row-(\d+)$/.exec(item.key)?.[1]
    if (row === undefined) continue
    const n = Number(row)
    if (n <= messageId && (!best || n >= best.row)) best = { key: item.key, row: n }
  }
  return best?.key ?? null
}
