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
  const read = (name: string) => {
    for (const [key, value] of params) if (key.toLowerCase() === name) return value
    return undefined
  }
  const cleaned = (value: string | undefined) => {
    const one = value?.replace(/\s+/g, ' ').trim()
    return one ? one : undefined
  }
  const rawText = read('text') ?? ''
  const profile = cleaned(read('profile'))
  if (profile && !PLAIN_TOKEN.test(profile)) return null
  const title = cleaned(read('title'))
  const link: NewChatLink = {
    text: rawText.trim() ? rawText.slice(0, NEW_CHAT_TEXT_MAX) : '',
    sends: ['1', 'true', 'yes'].includes((read('send') ?? '').trim().toLowerCase())
  }
  if (profile) link.profile = profile
  if (title) link.title = title.slice(0, NEW_CHAT_TITLE_MAX)
  return link
}

/** The longest text the Send dialog shows; the rest is cut with an ellipsis. */
export const NEW_CHAT_PREVIEW_MAX = 600

/** A link's text as its Send dialog shows it. */
export function newChatLinkPreview(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > NEW_CHAT_PREVIEW_MAX ? `${trimmed.slice(0, NEW_CHAT_PREVIEW_MAX)}…` : trimmed
}
