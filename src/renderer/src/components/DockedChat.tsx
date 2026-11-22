import { useEffect, type MutableRefObject } from 'react'
import { dockedChatUrl } from '@shared/chatWindows'
import { IPC, type ChatWindowRequest } from '@shared/ipc'

/** Another combined dashboard's chat, opened in the main window's chat pane. */
export type DockedChat = ChatWindowRequest & { host: string }

/** What the main window uses of Electron's <webview>: telling its page something. */
export type DockedFrame = HTMLElement & { send(channel: string, ...args: unknown[]): void }

/** Tells the docked chat's page whether Chats is on screen, so it notifies while it isn't. */
export function tellDockedShown(frame: DockedFrame | null, shown: boolean): void {
  try {
    frame?.send(IPC.dockedShown, shown)
  } catch {
    // Not attached yet: dom-ready tells it.
  }
}

/**
 * Another combined dashboard's chat opened in place (the phone's no-switch
 * open, stage 2): a far Chats row, a far bot's Bot Chat or a far wait opens
 * here, in the chat pane, with no switch, so the dashboard on screen, its
 * lists and a call in progress stay as they are. The pane is the chat
 * window's page in a frame of its own, on that dashboard's kept connection
 * (the main process routes its calls, events and requests there), so it is
 * the whole chat a chat window is. Another chat of the same dashboard points
 * the frame at it with no reload; the parent keys the pane by dashboard.
 * The parent holds `frame` and tells it as Chats shows or goes (this pane
 * isn't rendered again while Chats is away); `shown` is read as the page loads
 * and whenever the page asks.
 */
export function DockedChatPane({
  chat,
  frame,
  shown,
  onMoved
}: {
  chat: DockedChat
  frame: MutableRefObject<DockedFrame | null>
  shown: MutableRefObject<boolean>
  /** The chat opened in a window of its own from the pane's header. */
  onMoved: () => void
}) {
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const tell = () => tellDockedShown(el, shown.current)
    const heard = (event: Event) => {
      const { channel, args } = event as Event & { channel?: string; args?: unknown[] }
      if (channel !== IPC.dockedToPane) return
      if (args?.[0] === 'moved') onMoved()
      else if (args?.[0] === 'ask') tell()
    }
    el.addEventListener('dom-ready', tell)
    el.addEventListener('ipc-message', heard)
    return () => {
      el.removeEventListener('dom-ready', tell)
      el.removeEventListener('ipc-message', heard)
    }
  }, [frame, shown, onMoved])
  return (
    <main className="docked-chat" aria-label={chat.title}>
      <webview ref={frame as React.Ref<HTMLElement>} className="docked-chat-frame" src={dockedChatUrl(window.location.href, chat)} />
    </main>
  )
}
