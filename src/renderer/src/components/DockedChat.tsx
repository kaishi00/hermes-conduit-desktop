import { dockedChatUrl } from '@shared/chatWindows'
import type { ChatWindowRequest } from '@shared/ipc'

/** Another combined dashboard's chat, opened in the main window's chat pane. */
export type DockedChat = ChatWindowRequest & { host: string }

/**
 * Another combined dashboard's chat opened in place (the phone's no-switch
 * open, stage 2): a far Chats row, a far bot's Bot Chat or a far wait opens
 * here, in the chat pane, with no switch, so the dashboard on screen, its
 * lists and a call in progress stay as they are. The pane is the chat
 * window's page in a frame of its own, on that dashboard's kept connection
 * (the main process routes its calls, events and requests there), so it is
 * the whole chat a chat window is. Another chat of the same dashboard points
 * the frame at it with no reload; the parent keys the pane by dashboard.
 */
export function DockedChatPane({ chat }: { chat: DockedChat }) {
  return (
    <main className="docked-chat" aria-label={chat.title}>
      <webview className="docked-chat-frame" src={dockedChatUrl(window.location.href, chat)} />
    </main>
  )
}
