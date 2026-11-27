/**
 * A chat read ahead before it's opened (desktop#612): pointing at a
 * workstream's card reads its chat's newest stored page and keeps it as the
 * chat's stand-in (transcriptCache.ts, apart from the chats left, so it never
 * pushes one out), so a click draws it at once while
 * its resume runs, as going back to a chat does. A page that came back short
 * is the whole chat, so its length is noted too, and the open resumes whole
 * without reading that page first (chatLength.ts). A bot's workstreams are
 * hidden from the chat list, which is where every other chat's length comes
 * from. A chat already kept isn't read, nor one read in the last half
 * minute, so moving over a card again reads nothing.
 */
import { gateway } from '../gateway'
import { noteChatLength } from './chatLength'
import { LONG_CHAT_PAGE, newestPages, rowsStandIn } from './longChat'
import { hasKeptTranscript, keepReadAhead, keyOf } from './transcriptCache'

/** How long a read ahead stands before pointing at the card again reads the chat again. */
export const READ_AHEAD_AGAIN_MS = 30_000

const started = new Map<string, number>()

/** Reads the chat's newest page ahead of its open, on the dashboard on screen. */
export function readChatAhead(storedId: string, profile: string | undefined, host = ''): void {
  if (!storedId || hasKeptTranscript(storedId, profile, host)) return
  const key = keyOf(storedId, profile, host)
  const now = Date.now()
  const at = started.get(key)
  if (at !== undefined && now - at < READ_AHEAD_AGAIN_MS) return
  // Reads that no longer hold anything back go, so the list stays as short as the last half minute's.
  for (const [k, when] of started) if (now - when >= READ_AHEAD_AGAIN_MS) started.delete(k)
  started.set(key, now)
  void newestPages((method, path) => gateway.http(method, path), storedId, profile)
    .then(({ rows }) => {
      // Opened and left meanwhile: the copy it kept is newer.
      if (!rows.length || hasKeptTranscript(storedId, profile, host)) return
      if (rows.length < LONG_CHAT_PAGE) noteChatLength(storedId, rows.length)
      keepReadAhead(storedId, profile, rowsStandIn(rows), host)
    })
    .catch(() => started.delete(key))
}

/** Forgets what was read ahead: a test's clean start. */
export function forgetReadsAhead(): void {
  started.clear()
}
