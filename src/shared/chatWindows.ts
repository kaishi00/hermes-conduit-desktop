import type { ChatWindowRequest } from './ipc'

/**
 * Chat windows of their own open at once. The phone allows three; a
 * computer's screen holds more, and each window is a whole chat for its own
 * bot (Eric, 2026-11-21).
 */
export const CHAT_WINDOW_LIMIT = 6

/** A chat window's title: the chat, then its bot when that isn't already the chat's name. */
export function chatWindowTitle(chat: string, bot?: string): string {
  const name = chat.trim()
  const by = bot?.trim()
  if (!name) return by || 'Conduit'
  return by && by !== name ? `${name} — ${by}` : name
}

/** The chat a window of its own was opened on, from its page's hash; null for any other page. */
export function chatWindowRequest(hash: string): ChatWindowRequest | null {
  const match = /^#chat=(.+)$/.exec(hash)
  if (!match) return null
  try {
    const raw = JSON.parse(decodeURIComponent(match[1]!)) as Partial<ChatWindowRequest> | null
    if (!raw || typeof raw.id !== 'string' || !raw.id) return null
    return {
      id: raw.id,
      profile: typeof raw.profile === 'string' ? raw.profile : undefined,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      author: typeof raw.author === 'string' ? raw.author : undefined,
      ...(raw.botChat === true ? { botChat: true } : {}),
      ...(typeof raw.host === 'string' && raw.host ? { host: raw.host } : {})
    }
  } catch {
    return null
  }
}
