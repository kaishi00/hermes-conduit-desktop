/**
 * Copy and Quote on a message, after the phone's ChatQuote. A message's own
 * words quote into the draft as a Markdown blockquote; a whole reply
 * attaches as a "Replying to" chip and travels ahead of the next message
 * behind a marker line, which every Conduit reads back as a compact card:
 *
 *     [Replying to your earlier message]
 *     > the earlier reply,
 *     > line by line
 *
 *     the user's message
 *
 * In a room the marker names whose message it was ("[Replying to Atlas]"),
 * and the quote and the name are defanged so only the user's own words
 * mention anyone.
 */
import { splitReply, withoutBoardLines } from './media'

/** Protocol text, not translated: Hermes and its model read it, and every Conduit parses it. */
export const REPLY_MARKER = '[Replying to your earlier message]'
const ROOM_PREFIX = '[Replying to '

/** `text` as a Markdown blockquote: `> ` on each line, a bare `>` on blank ones; "" when there's nothing to quote. */
export function blockquote(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(line => line.replace(/\s+$/, ''))
  const first = lines.findIndex(line => line !== '')
  if (first < 0) return ''
  let last = lines.length - 1
  while (lines[last] === '') last--
  return lines
    .slice(first, last + 1)
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')
}

/** The draft with `quote` after what's typed, then an empty line for the reply. */
export function insertQuote(quote: string, draft: string): string {
  if (!quote) return draft
  const kept = draft.replace(/\s+$/, '')
  return kept ? `${kept}\n\n${quote}\n\n` : `${quote}\n\n`
}

/** A one-line plain preview of a Markdown reply, for the chip and the card. */
export function excerpt(markdown: string, limit = 200): string {
  const words: string[] = []
  let length = 0
  for (const raw of markdown.split('\n')) {
    if (length > limit) break
    let line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) continue
    line = line.replace(/^(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, '')
    line = line.replace(/\*\*|__|`/g, '')
    if (line) {
      words.push(line)
      length += line.length + 1
    }
  }
  const joined = words.join(' ').replace(/\s+/g, ' ')
  return joined.length > limit ? `${joined.slice(0, limit).trim()}…` : joined
}

/** False only for what runs as a slash command (a `/name`, no files): the reply waits for the next message. */
export function carriesReply(draft: string, hasAttachments: boolean): boolean {
  if (hasAttachments) return true
  const trimmed = draft.trimStart()
  if (!trimmed.startsWith('/')) return true
  return trimmed.replace(/^\/+/, '').trim() === ''
}

export function replyEnvelope(reply: string, message: string): string {
  const quote = blockquote(reply)
  return quote ? `${REPLY_MARKER}\n${quote}\n\n${message}` : message
}

/** A sent message's quoted reply and the user's own words, or null when it isn't one. */
export function parseReplyEnvelope(content: string): { quote: string; message: string } | null {
  if (!content.startsWith(`${REPLY_MARKER}\n`)) return null
  const lines = content.slice(REPLY_MARKER.length + 1).split('\n')
  const quoted: string[] = []
  let i = 0
  while (i < lines.length && lines[i]!.startsWith('>')) {
    const unquoted = lines[i]!.slice(1)
    quoted.push(unquoted.startsWith(' ') ? unquoted.slice(1) : unquoted)
    i++
  }
  if (!quoted.length) return null
  if (i < lines.length) {
    if (lines[i] !== '') return null
    i++
  }
  return { quote: quoted.join('\n'), message: lines.slice(i).join('\n') }
}

/** `@name` with a word joiner after the `@`, so a quote mentions nobody. */
export function defanged(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9])/g, '@⁠')
}

export function refanged(text: string): string {
  return text.replace(/@⁠/g, '@')
}

export function roomReplyText(quoting: string, author: string, message: string): string {
  const quote = blockquote(defanged(quoting))
  if (!quote) return message
  const name = defanged(author.replace(/]/g, ')').replace(/\n/g, ' '))
  return `${ROOM_PREFIX}${name}]\n${quote}\n\n${message}`
}

/** A room message's quoted author, quote and own words, or null when it isn't a reply. */
export function parseRoomReply(content: string): { author: string; quote: string; message: string } | null {
  if (!content.startsWith(ROOM_PREFIX)) return null
  const end = content.indexOf('\n')
  if (end < 0) return null
  const header = content.slice(0, end)
  if (!header.endsWith(']')) return null
  const author = header.slice(ROOM_PREFIX.length, -1)
  if (!author) return null
  const body = parseReplyEnvelope(REPLY_MARKER + content.slice(end))
  if (!body) return null
  return { author: refanged(author), quote: refanged(body.quote), message: body.message }
}

/** A reply as Copy puts it on the clipboard: its words, and each file it delivered by its path. */
export function copyableReply(text: string): string {
  return splitReply(withoutBoardLines(text))
    // `splitReply` is called without board ids here, so no board block can appear;
    // the branch only keeps the union exhaustive.
    .map(block => (block.kind === 'markdown' ? block.text.trim() : block.kind === 'board' ? '' : block.kind === 'page' ? block.html : block.path))
    .filter(Boolean)
    .join('\n\n')
}

/** The same text as a quote holds it, for finding the reply a card quoted. */
export function sameQuotedText(a: string, b: string): boolean {
  const quoted = blockquote(a)
  return quoted !== '' && quoted === blockquote(b)
}

/** A whole message attached to the next one as its "Replying to" chip. */
export interface ReplyReference {
  author: string
  text: string
}

/**
 * Words on their way to the composer; each has its own id, so quoting twice
 * lands twice. `text` is a quote added to the draft, `reply` a whole message
 * as the "Replying to" chip, `draft` words that replace the draft (what
 * /undo takes back).
 */
export type QuoteRequest =
  | { id: number; text: string }
  | { id: number; reply: ReplyReference }
  | { id: number; draft: string; reply?: ReplyReference }
  /** Words put in at the caret, as typed: a file's path. */
  | { id: number; insert: string }
