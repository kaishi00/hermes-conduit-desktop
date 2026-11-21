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
  /** Each open window's chat, with the dashboard it's on. */
  private readonly chats = new Map<string, ChatWindowRequest>()

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
      this.chats.delete(chat.id)
      this.changed(this.ids())
    })
    this.open.set(chat.id, window)
    this.chats.set(chat.id, chat)
    this.changed(this.ids())
    return true
  }

  /** Closes these chats' windows, or every one (a sign-out). */
  close(ids?: readonly string[]): void {
    this.closeWhere(chat => !ids || ids.includes(chat.id))
  }

  /** Closes the windows whose chat this picks: those of a dashboard no longer connected. */
  closeWhere(picks: (chat: ChatWindowRequest) => boolean): void {
    let closed = false
    for (const [id, window] of [...this.open]) {
      const chat = this.chats.get(id)
      if (!chat || !picks(chat)) continue
      this.open.delete(id)
      this.chats.delete(id)
      closed = true
      window.close()
    }
    if (closed) this.changed(this.ids())
  }
}

/**
 * The chat window that has a session's chat, for a notification: a chat
 * window that opened the session wins (`opened`: it notifies itself); else
 * one found by its chat's stored id, a window still opening its session
 * (the main window passes the ids it knows the chat by, and an event may
 * name the chat by its stored id). That one can't tell the session is its
 * own yet, so the main window still notifies, and a click brings the chat's
 * window to the front. Undefined when no chat window has it.
 */
export function chatWindowFor<W extends { contentsId: number }>(
  sessionId: string,
  storedIds: readonly string[],
  openers: readonly number[],
  windows: readonly W[],
  byStored: (storedId: string) => W | undefined
): { window: W; opened: boolean } | undefined {
  const opened = windows.find(window => openers.includes(window.contentsId))
  if (opened) return { window: opened, opened: true }
  for (const id of [...storedIds, sessionId]) {
    const window = id ? byStored(id) : undefined
    if (window) return { window, opened: false }
  }
  return undefined
}
