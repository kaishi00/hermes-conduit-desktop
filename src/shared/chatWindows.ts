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
      ...(typeof raw.host === 'string' && raw.host ? { host: raw.host } : {}),
      ...(raw.docked === true ? { docked: true } : {})
    }
  } catch {
    return null
  }
}

/** A page's address without its hash: what a docked chat's page is loaded from, the main window's own. */
export const pageBase = (url: string): string => url.split('#')[0] ?? url

/**
 * Another combined dashboard's chat shown in the main window's chat pane (the
 * phone's no-switch open, stage 2): the chat window's page in a frame of its
 * own, on its own dashboard's connection, at the main window's address.
 */
export function dockedChatUrl(base: string, chat: ChatWindowRequest & { host: string }): string {
  return `${pageBase(base)}#chat=${encodeURIComponent(JSON.stringify({ ...chat, docked: true }))}`
}

/** The docked chat a frame asks for: only the main window's own page, docked, naming its dashboard; null for anything else. */
export function dockedChatRequest(src: string, base: string): (ChatWindowRequest & { host: string }) | null {
  const page = pageBase(base)
  if (!page || pageBase(src) !== page) return null
  const chat = chatWindowRequest(src.slice(page.length))
  return chat?.docked && chat.host ? { ...chat, host: chat.host } : null
}
