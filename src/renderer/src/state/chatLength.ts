/**
 * How many rows each chat holds, as the chat list or its last whole open
 * said. A chat past one stored page opens on its newest page (longChat.ts),
 * which takes a read of that page before the resume; a chat known to be
 * shorter skips the read and resumes whole, as it always did.
 */
const lengths = new Map<string, number>()
/** The most chats a count is kept for; the ones noted longest ago go first. */
const KEPT = 5000

/** Notes a chat's row count: the list's `message_count`, or the rows a whole resume carried. */
export function noteChatLength(storedId: string, rows: number | undefined): void {
  if (typeof rows !== 'number' || !Number.isFinite(rows) || rows < 0) return
  lengths.delete(storedId)
  lengths.set(storedId, rows)
  if (lengths.size > KEPT) lengths.delete(lengths.keys().next().value!)
}

/** The chat's row count, where one was noted. */
export function knownChatLength(storedId: string): number | undefined {
  return lengths.get(storedId)
}

/** Forgets every count: a test's clean start. */
export function forgetChatLengths(): void {
  lengths.clear()
}
