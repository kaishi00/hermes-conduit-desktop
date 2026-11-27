/**
 * A room's private chat with one of your agents (the phone's
 * RoomChats.swift). "Ask … about this room" opens a chat with that agent, in
 * its own profile, and tells your Hermes which room it's about
 * (`PUT /rooms/chats`): each turn there is told the room, and the agent reads
 * it with its room tool. Nothing written there goes to the room. Wrap Up
 * opens the same chat and asks for notes; an agent that only listens leaves
 * its notes there on its own once the room goes quiet. One chat per room
 * and profile, the latest kept.
 */

import { t } from '../../../shared/i18n'
import type { RoomMember } from './groups'
import { ROOMS_PATH, type Http } from './roomLinks'

export const ROOM_CHATS_CAPABILITY = 'room-chats'
export const CHATS_PATH = `${ROOMS_PATH}/chats`
/** Tries for a free title before giving up. */
export const TITLE_TRIES = 5

export interface RoomChat {
  roomId: string
  chatId: string
  /** The last seq of the room its notes cover. */
  notesSeq: number
}

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

export function parseChat(value: unknown): RoomChat | null {
  const row = obj(value)
  const roomId = nonEmpty(row?.room_id)
  const chatId = nonEmpty(row?.chat_id)
  if (!roomId || !chatId) return null
  return { roomId, chatId, notesSeq: typeof row!.notes_seq === 'number' ? row!.notes_seq : 0 }
}

const scoped = (profile: string) => (profile && profile !== 'default' ? `${CHATS_PATH}?profile=${encodeURIComponent(profile)}` : CHATS_PATH)

/** The plugin's room chats routes, per profile. */
export function roomChatsClient(http: Http) {
  return {
    /** `profile`'s room chats. */
    chats: async (profile: string): Promise<RoomChat[]> => {
      const body = obj(await http('GET', scoped(profile)))
      if (body?.ok !== true || !Array.isArray(body.chats)) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
      return body.chats.map(parseChat).filter((c): c is RoomChat => c !== null)
    },
    /** `chatId` is `profile`'s chat about the room from now on. */
    open: async (roomId: string, chatId: string, profile: string): Promise<RoomChat> => {
      const body = obj(await http('PUT', scoped(profile), { room_id: roomId, chat_id: chatId }))
      const chat = body?.ok === true ? parseChat(body.chat) : null
      if (!chat) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
      return chat
    }
  }
}

export interface RoomChatAgent {
  profile: string
  name: string
}

/** Your agents still in a room with other people's agents; none in a room of your own agents only, which has nothing of other people's to ask about. */
export function roomChatAgents(members: readonly RoomMember[], titleOf: (profile: string) => string | undefined): RoomChatAgent[] {
  if (!members.some(m => m.peer)) return []
  const agents: RoomChatAgent[] = []
  for (const member of members) {
    const profile = member.profile?.trim()
    if (member.peer || member.out || !profile || agents.some(a => a.profile.toLowerCase() === profile.toLowerCase())) continue
    agents.push({ profile, name: member.displayName ?? titleOf(profile) ?? profile })
  }
  return agents
}

export type RoomChatOpening = 'opened' | 'gone' | 'failed'

/** Hermes keeps titles unique per profile: a write refused for one the profile has. */
export const titleTaken = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 4022 || /already in use/i.test(error instanceof Error ? error.message : String(error))

/**
 * Opens a room's chat: the one your Hermes keeps for the room and profile,
 * else a new one it's told about first, so the chat's first turn already
 * knows its room. A chat the plugin keeps that Hermes no longer has is
 * replaced; a new one is titled only once registered, and never opened
 * without the id Hermes keeps it by. Gives the chat's id and title.
 */
export async function openRoomChat(
  steps: {
    chats: (profile: string) => Promise<RoomChat[]>
    /** A new chat in the profile: the id it runs under, and the id Hermes keeps it by. */
    create: (profile: string) => Promise<{ runtimeId: string; storedId: string | null }>
    register: (roomId: string, chatId: string, profile: string) => Promise<RoomChat>
    /** Titles the chat by the id it runs under, which writes its row. */
    title: (runtimeId: string, profile: string, title: string) => Promise<void>
    /** Whether Hermes still has the chat. */
    exists: (chatId: string, profile: string) => Promise<boolean>
  },
  roomId: string,
  roomName: string,
  profile: string
): Promise<{ chatId: string; title: string }> {
  const title = chatTitle(roomName)
  const kept = (await steps.chats(profile)).find(c => c.roomId === roomId)
  if (kept && (await steps.exists(kept.chatId, profile))) return { chatId: kept.chatId, title }
  const created = await steps.create(profile)
  if (!created.storedId) throw new Error(t('The chat didn’t open. Try again.'))
  await steps.register(roomId, created.storedId, profile)
  for (let number = 1; number <= TITLE_TRIES; number++) {
    const candidate = number === 1 ? title : `${title} (${number})`
    try {
      await steps.title(created.runtimeId, profile, candidate)
      return { chatId: created.storedId, title: candidate }
    } catch (error) {
      if (number === TITLE_TRIES || !titleTaken(error)) throw error
    }
  }
  throw new Error(t('The chat didn’t open. Try again.'))
}

export const chatTitle = (roomName: string) => t('About {name}', { name: roomName.trim() || t('a room') })
export const askLine = (name: string) => t('Ask {name} about this room', { name })
export const wrapUpLine = (name: string) => t('Wrap Up with {name}', { name })
export const wrapUpPrompt = () =>
  t('Wrap up this room for me: what was decided, what I said I’d do, what I might have missed, and anything waiting on my answer.')

/** An ask that goes once its chat opens: a bot's introduce, a room chat's Wrap Up (#621). */
export interface PendingAsk {
  text: string
  /** The chat it goes to; null for a bot whose Bot Chat isn't made yet. */
  storedId: string | null
  profile: string
  resumed?: boolean
}

/** Whether `ask` is for this chat: the profile matched as rows name it, the default one left out or in another case. */
export function sameAsk(ask: PendingAsk, storedId: string | null | undefined, profile: string | undefined): boolean {
  const name = (value?: string) => (value || 'default').toLowerCase()
  return ask.storedId === storedId && name(ask.profile) === name(profile)
}
