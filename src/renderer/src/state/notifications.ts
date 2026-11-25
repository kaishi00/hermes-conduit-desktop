/**
 * System notifications: a turn that finished, and something that needs the
 * user, in a chat they aren't looking at (or with the window away). A click
 * brings the window back on that chat.
 */
import type { PendingRequest } from '../../../shared/ipc'
import { inputPromptView } from './inputPrompts'
import { approvalView, clarifyQuestions } from './needsYou'
import { silenceShown } from './silence'
import { plainLine } from './text'
import { t } from '../../../shared/i18n'

export { plainLine }

export interface ChatRef {
  storedId: string | null
  profile?: string
  title?: string
  /** The chat's bot as the window names it: a reply in an untitled chat is titled by it. */
  bot?: string
}

export interface NotificationSpec {
  title: string
  body: string
  /** One notification per chat and kind: a newer one replaces it. */
  tag: string
}

const SETTING_KEY = 'conduit.notifications'

export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off')
  } catch {
    // Private storage: the default (on) stands.
  }
}

/**
 * A chat's title for its notifications: the list's "Untitled chat" label and a
 * window's "Chat" are no title, so the bot's name stands in. Only notifications
 * read it this way; reopening a chat keeps the label it had.
 */
export function untitledAsNone(title: string | undefined): string | undefined {
  return title && title !== t('Untitled chat') && title !== t('Chat') ? title : undefined
}

/**
 * A finished turn's notification, or none: a stop needs no telling, and nor
 * does a reply that is only one of Hermes' silence markers ([SILENT],
 * NO_REPLY, ...), as the plugin's push sends none (events.is_silent_response).
 * A Bot Chat's turn ends with no text when Hermes streamed its reply, so the
 * reply streamed last (`streamed`, from TurnReplies) stands in. It's titled by
 * the chat, else by the bot that answered, as the phone's reply push is, never
 * a line that says only that a reply came.
 */
export function turnNotification(sessionId: string, payload: unknown, chat: ChatRef | undefined, streamed = ''): NotificationSpec | null {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  if (p.status === 'interrupted') return null
  const title = untitledAsNone(chat?.title) || chat?.bot || 'Hermes'
  const tag = `turn-${sessionId}`
  if (p.status === 'error') {
    const reason = typeof p.error === 'string' ? p.error : t('The turn failed.')
    return { title, body: plainLine(reason), tag }
  }
  const final = typeof p.text === 'string' ? p.text : typeof p.rendered === 'string' ? p.rendered : ''
  const reply = final.trim() ? final : streamed
  const shown = silenceShown(reply)
  if (reply.trim() && !shown.trim()) return null
  return { title, body: plainLine(shown) || t('Replied.'), tag }
}

/** What a finished turn's notification reads besides its event: the reply it streamed last, and when it started. */
export interface TurnEnd {
  streamed: string
  /** On this computer's clock; null when this window didn't see it start. */
  startedAt: number | null
}

/**
 * The reply each chat's turn streamed last, for a turn that ends with no text
 * of its own, and when the turn started. A tool, or a delta of `null`, closes
 * a reply: the next text is a new one, as the chat shows it.
 */
export class TurnReplies {
  private replies = new Map<string, { text: string; open: boolean; startedAt: number | null }>()

  /** Takes one gateway event; on `message.complete` it hands back that turn's end and forgets it, else null. */
  note(event: { type: string; session_id?: string; payload?: unknown }, now = Date.now()): TurnEnd | null {
    const sid = event.session_id
    if (!sid) return null
    const p = event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
    if (event.type === 'message.complete') {
      const reply = this.replies.get(sid)
      this.replies.delete(sid)
      return { streamed: reply?.text ?? '', startedAt: reply?.startedAt ?? null }
    }
    const reply = this.replies.get(sid)
    if (event.type === 'message.start') {
      this.replies.set(sid, { text: '', open: false, startedAt: now })
    } else if (event.type === 'message.delta') {
      const current = reply ?? { text: '', open: false, startedAt: null }
      if (typeof p.text === 'string' && p.text) this.replies.set(sid, { ...current, text: current.open ? current.text + p.text : p.text, open: true })
      else if (p.text === null) this.replies.set(sid, { ...current, open: false })
    } else if (event.type.startsWith('tool.') && reply) {
      this.replies.set(sid, { ...reply, open: false })
    }
    return null
  }
}

export function requestNotification(request: PendingRequest, chat: ChatRef | undefined): NotificationSpec {
  const named = untitledAsNone(chat?.title)
  const where = named ? ` · ${named}` : ''
  if (request.method === 'approval') {
    const view = approvalView(request.params)
    return {
      title: `${t('Needs your OK')}${where}`,
      body: plainLine(view.command ? `${view.description}: ${view.command}` : view.description),
      tag: `ask-${request.id}`
    }
  }
  // A password, login or code: its title only, never what's typed.
  const input = inputPromptView(request)
  if (input) return { title: `${t('Input needed')}${where}`, body: plainLine(input.title), tag: `ask-${request.id}` }
  const questions = clarifyQuestions(request.params)
  const first = questions[0]?.question ?? t('Hermes has a question.')
  return {
    title: `${questions.length > 1 ? t('{count} questions', { count: questions.length }) : t('A question')}${where}`,
    body: plainLine(first),
    tag: `ask-${request.id}`
  }
}

/** Whether the user is looking at this chat right now, so a notification would only repeat the screen. */
export function isWatching(sessionId: string, openLiveId: string | null, onChats: boolean): boolean {
  return onChats && sessionId === openLiveId && !document.hidden && document.hasFocus()
}

/** What a new room invite says, as the plugin's room.invite push does (room_invites.notify_invite). */
export function inviteNotification(invite: { id: string; from: string; name: string }): NotificationSpec {
  return {
    title: invite.from ? t('{name} invited you to {room}', { name: invite.from, room: invite.name }) : t('Someone invited you to {room}', { room: invite.name }),
    body: t('Choose which of your agents join, or decline.'),
    tag: `room-invite-${invite.id}`
  }
}

/** What a new ask Hermes waits on says: who asks, and what. */
export function askNotification(ask: { id: string; title: string }, asker: string): NotificationSpec {
  return { title: asker, body: ask.title, tag: `ask-${ask.id}` }
}

/**
 * The ids not told about yet, kept per host across launches so a relaunch
 * doesn't tell again; the first read of a host only marks what's there.
 */
export function newlyArrived(key: string, ids: readonly string[], storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): string[] {
  let seen: string[] | null = null
  try {
    const raw = storage.getItem(key)
    seen = raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    seen = null
  }
  const fresh = seen ? ids.filter(id => !seen!.includes(id)) : []
  try {
    // Only what's still listed is kept, so the list never grows past it.
    storage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // Kept for this run only.
  }
  return fresh
}
