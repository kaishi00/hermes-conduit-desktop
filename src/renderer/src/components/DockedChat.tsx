import { useEffect, useRef } from 'react'
import { dockedChatUrl } from '@shared/chatWindows'
import { IPC, type ChatWindowRequest } from '@shared/ipc'

/** Another combined dashboard's chat, opened in the main window's chat pane. */
export type DockedChat = ChatWindowRequest & { host: string }

/** What the main window uses of Electron's <webview>: telling its page something. */
type Frame = HTMLElement & { send(channel: string, ...args: unknown[]): void }

/**
 * Another combined dashboard's chat opened in place (the phone's no-switch
 * open, stage 2): a far Chats row, a far bot's Bot Chat or a far wait opens
 * here, in the chat pane, with no switch, so the dashboard on screen, its
 * lists and a call in progress stay as they are. The pane is the chat
 * window's page in a frame of its own, on that dashboard's kept connection
 * (the main process routes its calls, events and requests there), so it is
 * the whole chat a chat window is. Another chat of the same dashboard points
 * the frame at it with no reload; the parent keys the pane by dashboard.
 * `shown` (Chats on screen) tells the page, so it notifies while hidden.
 */
export function DockedChatPane({ chat, shown }: { chat: DockedChat; shown: boolean }) {
  const frame = useRef<Frame>(null)
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const tell = () => {
      try {
        el.send(IPC.dockedShown, shownRef.current)
      } catch {
        // Not attached yet: dom-ready tells it.
      }
    }
    el.addEventListener('dom-ready', tell)
    return () => el.removeEventListener('dom-ready', tell)
  }, [])
  useEffect(() => {
    try {
      frame.current?.send(IPC.dockedShown, shown)
    } catch {
      // Not attached yet: dom-ready tells it.
    }
  }, [shown])
  return (
    <main className="docked-chat" aria-label={chat.title}>
      <webview ref={frame as React.Ref<HTMLElement>} className="docked-chat-frame" src={dockedChatUrl(window.location.href, chat)} />
    </main>
  )
}
