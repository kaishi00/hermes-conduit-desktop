/**
 * Conduit links opened from another app, as the phone takes them: a Link
 * invite (`conduit://link/…`) from Messages, a chat or the Camera, and a new
 * chat with text ready (`conduit://new?text=…&profile=…&title=…&send=1`,
 * hermes-conduit issue 3389). The OS hands one to Conduit on the command
 * line (Windows, and a second launch anywhere) or as an open-url event (the
 * Mac).
 */

export const LINK_SCHEME = 'conduit'

/** The first Conduit link among a launch's arguments, if any. */
export function linkUrlFromArgs(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const url = linkUrl(arg)
    if (url) return url
  }
  return null
}

/** The text when it's a Link invite or a new chat link, trimmed; null otherwise. */
export function linkUrl(text: string): string | null {
  const trimmed = text.trim()
  if (/^conduit:\/\/link\/\S+$/i.test(trimmed)) return trimmed
  return newChatLink(trimmed) ? trimmed : null
}

/** Whether the text is shaped as a new chat link, read or refused: never a Link invite. */
export const isNewChatUrl = (text: string) => /^conduit:\/\/new(?:[/?]|$)/i.test(text.trim())

/** `text` cut to `max` UTF-16 units, never leaving half an emoji at the end. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const kept = text.slice(0, max)
  const last = kept.charCodeAt(kept.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept
}

/** What a `conduit://new` link asks for. */
export interface NewChatLink {
  /** The composer's text; empty for none. */
  text: string
  /** The profile to start in; the one on screen when left out. */
  profile?: string
  /** The new chat's title. */
  title?: string
  /** Sends the text once the person says so (`send=1`): never unseen (Eric, 2026-11-27). */
  sends: boolean
}

/** The longest title kept, as the phone keeps. */
export const NEW_CHAT_TITLE_MAX = 80
/** The longest text kept, as a phone's shared draft carries at most. */
export const NEW_CHAT_TEXT_MAX = 100_000
/** A profile name from outside is a plain token, as the phone takes one. */
const PLAIN_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/

/** A `conduit://new` link's parts; null for any other text, or one naming an odd profile. */
export function newChatLink(text: string): NewChatLink | null {
  const trimmed = text.trim()
  if (!/^conduit:\/\/new\/?(\?\S*)?$/i.test(trimmed)) return null
  let params: URLSearchParams
  try {
    params = new URLSearchParams(trimmed.replace(/^conduit:\/\/new\/?\??/i, ''))
  } catch {
    return null
  }
  // Names exactly as written, as the phone reads them.
  const read = (name: string) => params.get(name) ?? undefined
  const cleaned = (value: string | undefined) => {
    const one = value?.replace(/\s+/g, ' ').trim()
    return one ? one : undefined
  }
  const rawText = read('text') ?? ''
  const profile = cleaned(read('profile'))
  if (profile && !PLAIN_TOKEN.test(profile)) return null
  const title = cleaned(read('title'))
  const link: NewChatLink = {
    text: rawText.trim() ? cut(rawText, NEW_CHAT_TEXT_MAX) : '',
    sends: (read('send') ?? '').trim() === '1'
  }
  if (profile) link.profile = profile
  if (title) link.title = cut(title, NEW_CHAT_TITLE_MAX)
  return link
}

/** The longest text a link may send: its Send dialog shows it whole. Longer text waits in the composer instead. */
export const NEW_CHAT_PREVIEW_MAX = 2000
