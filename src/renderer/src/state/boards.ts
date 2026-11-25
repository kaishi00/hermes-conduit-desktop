/**
 * Boards: the cards one `conduit_show` call showed in a chat, after the
 * phone's RichBoard. The plugin's answer keeps the normalized cards (so the
 * chat's history draws them again), their Markdown, the layout and the
 * follow-ups. This app draws the plainer kinds itself; a board with any
 * other kind shows its Markdown whole, never part of it. A board is drawn
 * at its call's row, or where the reply writes the board's line
 * (`placeBoards`).
 */

import { splitReply } from './media'

export const SHOW_TOOL = 'conduit_show'

export type Card = Record<string, unknown> & { type: string; title?: string }

export interface Board {
  cards: Card[]
  /** One card at a time, each card's title its tab. */
  tabs: boolean
  /** Asked as the user's next message when tapped. */
  next: string[]
  /** The cards' Markdown, shown in the board's place when they can't all be drawn. */
  markdown?: string
  /** The id its answer's `::conduit-board{id="cb-…"}` line names: a reply that writes the line draws the board there. */
  line?: string
}

/** A board a reply draws where its line is, and the `conduit_show` row it came from. */
export interface PlacedBoard {
  id: string
  board: Board
  /** The row's key: its follow-ups show while it is the last turn's last board. */
  key: string
}

/** Where a chat's boards go: the rows that draw nothing, and each reply's boards by the reply's key. */
export interface BoardPlacement {
  hidden: ReadonlySet<string>
  placed: ReadonlyMap<string, PlacedBoard[]>
}

const NOWHERE: BoardPlacement = { hidden: new Set(), placed: new Map() }

/**
 * Where a chat's boards go, after the phone's LineBoards.placement (phone issue 3215): a reply that writes a
 * board's line takes the board from the `conduit_show` row above it in its own turn, the first reply to name it,
 * and that row draws nothing. A reply without the line leaves the board at its row, and so does a later turn's.
 */
export function placeBoards(items: readonly { kind: string; key: string; text?: string; board?: Board; steer?: boolean }[]): BoardPlacement {
  let hidden: Set<string> | undefined
  let placed: Map<string, PlacedBoard[]> | undefined
  const turn = new Map<string, PlacedBoard>()
  for (const item of items) {
    if (item.kind === 'user') {
      // A steer is part of the turn it steers.
      if (!item.steer) turn.clear()
    }
    else if (item.kind === 'tool' && item.board?.line) turn.set(item.board.line, { id: item.board.line, board: item.board, key: item.key })
    else if (item.kind === 'assistant' && turn.size && item.text?.includes('::conduit-board{')) {
      const taken = splitReply(item.text, new Set(turn.keys())).flatMap(block => (block.kind === 'board' ? [turn.get(block.id)!] : []))
      if (!taken.length) continue
      for (const board of taken) {
        turn.delete(board.id)
        ;(hidden ??= new Set()).add(board.key)
      }
      ;(placed ??= new Map()).set(item.key, taken)
    }
  }
  return hidden && placed ? { hidden, placed } : NOWHERE
}

/** Whether two replies' placed boards draw the same. */
export const sameBoards = (a: readonly PlacedBoard[] | undefined, b: readonly PlacedBoard[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.board === b[i]!.board && x.key === b[i]!.key))

/** The kinds drawn here. */
export const DRAWN = new Set(['stats', 'table', 'checklist', 'list', 'progress', 'callout', 'status', 'steps', 'timeline', 'contact'])

const object = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return null
}

/** A ::conduit-board line or a stray directive left in the Markdown. */
const cleanMarkdown = (text: string) => text.replace(/^::conduit-board\{[^}]*\}\s*$/gm, '').trim()

/**
 * The board a finished `conduit_show` call showed, or null when it showed
 * none: a Markdown-only show, or an answer whose Markdown Hermes was told to
 * put in its reply, which would show twice.
 */
export function boardFrom(name: string, result: unknown, args: unknown): Board | null {
  if (name.toLowerCase() !== SHOW_TOOL) return null
  const answer = object(result)
  if (!answer) return null
  const given = Array.isArray(answer.cards) ? answer.cards : answer.ok === true ? object(args)?.cards : undefined
  const raw = Array.isArray(given) ? given : []
  if (!raw.length) return null
  const cards = raw.filter((card): card is Card => !!card && typeof card === 'object' && typeof (card as { type?: unknown }).type === 'string')
  const markdown = typeof answer.markdown === 'string' && answer.markdown.trim() ? cleanMarkdown(answer.markdown) : undefined
  const next = (Array.isArray(answer.next) ? answer.next : [])
    .map(item => (typeof item === 'string' ? item : typeof (item as { text?: unknown })?.text === 'string' ? (item as { text: string }).text : ''))
    .filter(Boolean)
    .slice(0, 4)
  const drawable = cards.length === raw.length && cards.every(card => DRAWN.has(card.type))
  if (!drawable && !markdown) return null
  const line = typeof answer.directive === 'string' ? /^::conduit-board\{\s*id="(cb-[0-9a-f]{12})"\s*\}$/.exec(answer.directive.trim())?.[1] : undefined
  return { cards: drawable ? cards : [], tabs: answer.layout === 'tabs' && cards.length > 1, next, markdown, ...(line ? { line } : {}) }
}

// Readers for a card's parts: the plugin normalized them, so these only keep the shape safe.

export const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
export const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : []
export const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(text) : [])
export const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** A progress row's share, 0 to 1. */
export function share(value: unknown, goal: unknown): number {
  const v = number(value) ?? 0
  const g = number(goal)
  if (!g || g <= 0) return Math.max(0, Math.min(1, v > 1 ? v / 100 : v))
  return Math.max(0, Math.min(1, v / g))
}

/** A contact card's person, after the phone's RichPerson. */
export interface Person {
  name: string
  detail?: string
  phone?: string
  email?: string
  url?: string
  address?: string
  note?: string
  /** A text Hermes wrote for the user to send them. */
  message?: string
  photo?: string
}

const trimmed = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

export function people(card: Card): Person[] {
  return list(card.people).flatMap(row => {
    const name = trimmed(row.name)
    if (!name) return []
    const photo = row.photo && typeof row.photo === 'object' ? trimmed((row.photo as Record<string, unknown>).url) : trimmed(row.photo)
    const web = (value: string | undefined) => (value && /^https?:\/\//i.test(value) ? value : undefined)
    return [
      {
        name,
        detail: trimmed(row.detail),
        phone: trimmed(row.phone),
        email: trimmed(row.email),
        url: web(trimmed(row.url)),
        address: trimmed(row.address),
        note: trimmed(row.note),
        message: trimmed(row.message),
        photo: web(photo)
      }
    ]
  })
}

/** The number to dial: its digits, with + when the number starts international. */
export function dialable(phone: string | undefined): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/[^0-9]/g, '')
  if (!digits) return undefined
  const lead = phone.slice(0, phone.search(/[0-9]/))
  return lead.includes('+') ? `+${digits}` : digits
}

/** Where Send text sends: their number, or without one their email (iMessage). */
export const textRecipient = (person: Person) => dialable(person.phone) ?? person.email

/** Messages opened to a number or an email; nothing in the address can add a body. */
export const smsLink = (recipient: string) => `sms:${recipient.replace(/[^A-Za-z0-9@._+-]/g, c => encodeURIComponent(c))}`

/** The Email action's link, built so nothing in the address adds a header or a recipient. */
export const mailtoLink = (email: string) => `mailto:${email.replace(/[^A-Za-z0-9@._+-]/g, c => encodeURIComponent(c))}`
