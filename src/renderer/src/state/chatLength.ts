/**
 * How many rows each chat holds, as the chat list or its last whole open
 * said. A chat past one stored page opens on its newest page (longChat.ts),
 * which takes a read of that page before the resume; a chat known to be
 * shorter skips the read and resumes whole, as it always did. The list's
 * `message_count` leaves out rows a chat compacted away, which a resume
 * still carries (433 against 2,766 on one), so a count a whole open found
 * is never lowered by the list's: such a chat opens whole once, and on its
 * newest page from then on.
 */
const lengths = new Map<string, number>()
/** The chats whose count a whole resume found, which the list's count doesn't lower. */
const opened = new Set<string>()
/** The most chats a count is kept for; the ones noted longest ago go first. */
const KEPT = 5000

/** Notes a chat's row count: the list's `message_count`, or the rows a whole resume carried (`resumed`). */
export function noteChatLength(storedId: string, rows: number | undefined, resumed = false): void {
  if (typeof rows !== 'number' || !Number.isFinite(rows) || rows < 0) return
  const held = lengths.get(storedId)
  if (resumed) opened.add(storedId)
  else if (opened.has(storedId) && held !== undefined && held > rows) return
  lengths.delete(storedId)
  lengths.set(storedId, rows)
  if (lengths.size > KEPT) {
    const oldest = lengths.keys().next().value!
    lengths.delete(oldest)
    opened.delete(oldest)
  }
}

/** The chat's row count, where one was noted. */
export function knownChatLength(storedId: string): number | undefined {
  return lengths.get(storedId)
}

/** Forgets every count: a test's clean start. */
export function forgetChatLengths(): void {
  lengths.clear()
  opened.clear()
}
