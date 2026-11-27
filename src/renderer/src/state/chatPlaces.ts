/**
 * Where a reader left a chat that holds a tab (issue 423), so going back to
 * its tab opens it where they were rather than at its newest rows. Any other
 * chat still opens on its newest rows (desktop#467). A chat left at its end
 * keeps no place: it opens at the end and follows the reply, as before.
 *
 * A place is the window the transcript drew (its first row, by index and by
 * key) and the scroll from that row's top. The window draws from that row to
 * the newest, so rows that arrive while the tab is away land below the place
 * and leave it where it was.
 */
export interface ChatPlace {
  start: number
  anchor?: string
  top: number
  /** The text size `top` was read at: coming back at another, it scales with the rows (#641). */
  scale?: number
}

/** Places kept at once; the oldest goes first. */
export const CHAT_PLACES_KEPT = 24

export class ChatPlaces {
  private kept = new Map<string, ChatPlace>()

  /** `chat` was left at `place`, or at its end (null). */
  keep(chat: string, place: ChatPlace | null): void {
    this.kept.delete(chat)
    if (!place) return
    this.kept.set(chat, place)
    while (this.kept.size > CHAT_PLACES_KEPT) {
      const oldest = this.kept.keys().next().value
      if (oldest === undefined) break
      this.kept.delete(oldest)
    }
  }

  /** The place `chat` was left at, given once: a reader who leaves again keeps a new one. */
  take(chat: string): ChatPlace | undefined {
    const place = this.kept.get(chat)
    this.kept.delete(chat)
    return place
  }
}

export const chatPlaces = new ChatPlaces()
