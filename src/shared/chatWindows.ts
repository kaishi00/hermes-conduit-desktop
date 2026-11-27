import type { ChatWindowRequest } from './ipc'

/**
 * Chat windows of their own open at once. The phone allows three; a
 * computer's screen holds more, and each window is a whole chat for its own
 * bot (Eric, 2026-11-21).
 */
export const CHAT_WINDOW_LIMIT = 6

/** The Live call shortcut's window: one at a time, a new chat until its call's first request makes one. */
export const LIVE_CALL_WINDOW_ID = 'live-call'

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
      ...(raw.docked === true ? { docked: true } : {}),
      ...(typeof raw.draft === 'string' && raw.draft ? { draft: raw.draft } : {}),
      ...(raw.fresh === true ? { fresh: true } : {}),
      ...(raw.call === true ? { call: true } : {})
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

/**
 * Another combined dashboard's Pulse feed, shown in the main window's Pulse
 * page when its chip is picked (Pulse keeps a feed per dashboard): the feed's
 * page in a frame of its own, on that dashboard's kept connection, as a docked
 * chat is.
 */
export function dockedPulseUrl(base: string, host: string): string {
  return `${pageBase(base)}#pulse=${encodeURIComponent(JSON.stringify({ host, docked: true }))}`
}

/** The docked Pulse feed a page's hash asks for; null for any other page. */
export function pulseFrameRequest(hash: string): { host: string } | null {
  const match = /^#pulse=(.+)$/.exec(hash)
  if (!match) return null
  try {
    const raw = JSON.parse(decodeURIComponent(match[1]!)) as { host?: unknown; docked?: unknown } | null
    return raw && raw.docked === true && typeof raw.host === 'string' && raw.host ? { host: raw.host } : null
  } catch {
    return null
  }
}

/** Another combined dashboard's group chat docked in the main window: a room it hosts, or its copy of one hosted elsewhere. */
export interface DockedRoomRequest {
  host: string
  kind: 'room' | 'copy'
  /** The room's id, or the copy's. */
  id: string
  title?: string
}

/**
 * Another combined dashboard's group chat, opened in the main window's room
 * pane with no switch: the room's page in a frame of its own, on that
 * dashboard's kept connection, as a docked chat is.
 */
export function dockedRoomUrl(base: string, room: DockedRoomRequest): string {
  return `${pageBase(base)}#room=${encodeURIComponent(JSON.stringify({ ...room, docked: true }))}`
}

/** The docked group chat a page's hash asks for; null for any other page. */
export function roomFrameRequest(hash: string): DockedRoomRequest | null {
  const match = /^#room=(.+)$/.exec(hash)
  if (!match) return null
  try {
    const raw = JSON.parse(decodeURIComponent(match[1]!)) as Record<string, unknown> | null
    if (!raw || raw.docked !== true || typeof raw.host !== 'string' || !raw.host || typeof raw.id !== 'string' || !raw.id) return null
    if (raw.kind !== 'room' && raw.kind !== 'copy') return null
    return { host: raw.host, kind: raw.kind, id: raw.id, ...(typeof raw.title === 'string' ? { title: raw.title } : {}) }
  } catch {
    return null
  }
}

/** The dashboard a main window's frame is on, a docked chat, Pulse feed or group chat at the main window's own page; null for anything else. */
export function dockedFrameHost(src: string, base: string): string | null {
  const chat = dockedChatRequest(src, base)
  if (chat) return chat.host
  const page = pageBase(base)
  if (!page || pageBase(src) !== page) return null
  const hash = src.slice(page.length)
  return pulseFrameRequest(hash)?.host ?? roomFrameRequest(hash)?.host ?? null
}
