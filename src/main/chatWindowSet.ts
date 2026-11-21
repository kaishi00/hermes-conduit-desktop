/**
 * The chat windows, after the phone's AppState+ChatWindows: a chat moves to a
 * window of its own, up to CHAT_WINDOW_LIMIT at once, one per chat, and
 * asking again for one already open brings it to the front. Kept free of
 * Electron so the rules are tested on their own.
 */
import type { ChatWindowRequest } from '../shared/ipc'
import { CHAT_WINDOW_LIMIT } from '../shared/chatWindows'

export { CHAT_WINDOW_LIMIT }

/** What a window needs of Electron: focus it, close it. */
export interface ChatWindowHandle {
  focus(): void
  close(): void
}

export class ChatWindowSet<W extends ChatWindowHandle = ChatWindowHandle> {
  private readonly open = new Map<string, W>()

  constructor(
    private readonly create: (chat: ChatWindowRequest, onClosed: () => void) => W,
    private readonly changed: (ids: string[]) => void
  ) {}

  ids(): string[] {
    return [...this.open.keys()]
  }

  /** A window for the chat: its own if it has one (brought to the front), a new one while there's room; false when the limit is open. */
  show(chat: ChatWindowRequest): boolean {
    const had = this.open.get(chat.id)
    if (had) {
      had.focus()
      return true
    }
    if (this.open.size >= CHAT_WINDOW_LIMIT) return false
    const window = this.create(chat, () => {
      if (this.open.get(chat.id) !== window) return
      this.open.delete(chat.id)
      this.changed(this.ids())
    })
    this.open.set(chat.id, window)
    this.changed(this.ids())
    return true
  }

  /** Closes these chats' windows, or every one (a dashboard or profile switch). */
  close(ids?: readonly string[]): void {
    let closed = false
    for (const [id, window] of [...this.open]) {
      if (ids && !ids.includes(id)) continue
      this.open.delete(id)
      closed = true
      window.close()
    }
    if (closed) this.changed(this.ids())
  }
}
