import { t } from '../../../shared/i18n'
import { gateway } from '../gateway'
import { authorityMutation, sessionPath } from './chatActions'
import { openRoomChat, roomChatsClient } from './roomChats'

/**
 * A room's private chat with one of your agents, through this page's
 * connection: the one kept for the room, or a new one made, told its room and
 * titled after it. The main window opens it in its chat pane; a docked room
 * (another combined dashboard's) asks the main window to dock it.
 */
export async function openRoomChatHere(roomId: string, roomName: string, profile: string, sessionAuthority: boolean): Promise<{ chatId: string; title: string }> {
  const chats = roomChatsClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))
  const scoped = (profile: string) => (profile && profile !== 'default' ? { profile } : {})
  return openRoomChat(
    {
      chats: profile => chats.chats(profile),
      create: async profile => {
        const made = await gateway.rpc<{ session_id?: string; stored_session_id?: string | null }>('session.create', { cols: 96, source: 'desktop', ...scoped(profile) })
        if (!made?.session_id) throw new Error(t('The chat didn’t open. Try again.'))
        return { runtimeId: made.session_id, storedId: made.stored_session_id ?? null }
      },
      register: (roomId, chatId, profile) => chats.open(roomId, chatId, profile),
      // By the id it runs under, as a Bot Chat's title goes; the authority's is a rename.
      title: async (runtimeId, profile, title) => {
        if (sessionAuthority) await authorityMutation(gateway.rpc, gateway.http, runtimeId, profile, 'rename', { title })
        else await gateway.rpc('session.title', { session_id: runtimeId, title, ...scoped(profile) })
      },
      exists: async (chatId, profile) => {
        try {
          await gateway.http('GET', sessionPath(chatId, profile))
          return true
        } catch (e) {
          if ((e as { code?: unknown })?.code === 404) return false
          throw e
        }
      }
    },
    roomId,
    roomName,
    profile
  )
}
