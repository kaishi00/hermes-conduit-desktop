/**
 * What Hermes stores around a person's words, taken off before the window
 * shows them, the way the phone does (HermesClient's `removingContextFooter`,
 * `splitLeadingFileReferences`, and the voice background-job brief).
 */
import { inbound } from './teammateMessages'
import { t } from '../../../shared/i18n'
import { withPagesSaid, withoutTags } from './htmlInReplies'

/** The brief a Conduit voice conversation puts before a background job's instructions. */
// A list preview can end inside it, before its closing bracket.
const VOICE_JOB_PREFIX = /^\s*\[Background job started from a Conduit voice conversation\.(?:[^\]]*\]\s*|[^\]]*$)/

/** Where a voice conversation's delegation appends the recent conversation, for context (GPTLive's `delegationContextMarker`). */
const VOICE_CONTEXT = /\s*\[Recent voice conversation, for context only\b[\s\S]*$/

/** An `@kind:value` context reference, as Hermes expands them. */
const CONTEXT_REFERENCE = /(?<![\w/])@(?:diff\b|staged\b|[A-Za-z][A-Za-z0-9_-]*:\S)/

/** Where Hermes appends the expanded references to the message it stores. */
const CONTEXT_FOOTER = /(?:^|\n)--- (?:Context Warnings|Attached Context) ---[ \t]*(?:\r?\n|$)/

/** A leading attachment line: `@file:path`, with the path bare, backticked or quoted. */
const LEADING_REFERENCE = /^@(file|url|folder|image):(?:`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s`"']\S*))$/

export interface Attachment {
  kind: 'file' | 'url' | 'folder' | 'image'
  value: string
  /** A picture's bytes already here, as a data URL (one being sent from this window). */
  preview?: string
}

export function removeVoiceJobPrefix(text: string): string {
  return text.replace(VOICE_JOB_PREFIX, '').replace(VOICE_CONTEXT, '')
}

/** A reference inside the words: the quoted value, or one cut off at the end of a preview. */
const INLINE_REFERENCE = /(?<![\w/])@(file|url|folder|image):(?:`([^`\n]*)(?:`|$)|"([^"\n]*)(?:"|$)|'([^'\n]*)(?:'|$)|([^\s`"']+))/g

/** `@url:\`https://x\`` in a sentence reads as `https://x` (or, `short`, as `x` and a file's name). */
export function plainReferences(text: string, short = false): string {
  return text.replace(INLINE_REFERENCE, (_all, kind: string, a?: string, b?: string, c?: string, d?: string) => {
    const value = (a ?? b ?? c ?? d ?? '').trim()
    if (!short) return value
    return kind === 'url' ? value.replace(/^https?:\/\/(www\.)?/, '') : baseName(value)
  })
}

/** Cuts the expanded context Hermes stores after a message that named `@file:` and the like. */
export function removeContextFooter(text: string): string {
  if (!CONTEXT_REFERENCE.test(text)) return text
  const match = CONTEXT_FOOTER.exec(text)
  return match ? text.slice(0, match.index).trimEnd() : text
}

/** The attachment lines a message starts with, and the words after them. */
export function splitLeadingReferences(text: string): { attachments: Attachment[]; text: string } {
  const lines = text.split(/\r?\n/)
  const attachments: Attachment[] = []
  let index = 0
  for (; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (!line) {
      if (attachments.length) continue
      break
    }
    const match = LEADING_REFERENCE.exec(line)
    if (!match) break
    const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    attachments.push({ kind: match[1] as Attachment['kind'], value })
  }
  if (!attachments.length) return { attachments, text }
  return { attachments, text: lines.slice(index).join('\n').trim() }
}

/**
 * Where a message's pictures stand in its stored text: Hermes Desktop's and
 * Conduit's `@image:` token, the gateway's note for a picture from a chat
 * platform, and what Hermes saved for one before v0.21 (the phone's
 * HermesClient.splitUserImageReferences). The last group is the path.
 */
const IMAGE_REFERENCES = [
  /(?<![\w/])@image:(?:`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+))/g,
  /\[Image attached at: ([^\n\]]+)\]/g,
  /\[The user attached an image:\r?\n[\s\S]*?\]\r?\n\[You can examine it with vision_analyze using image_url: ([^\]\r\n]+)\]/g,
  /\[The user attached an image but analysis failed\.\]\r?\n\[You can examine it with vision_analyze using image_url: ([^\]\r\n]+)\]/g,
  /\[The user sent an image~ Here's what I can see:\r?\n[\s\S]*?\]\r?\n\[If you need a closer look, use vision_analyze with image_url: (\S+) ~\]/g,
  /\[The user sent an image but [^[\]]*? with vision_analyze using image_url: ([^\]\r\n]+)\]/g
]

/** A message's pictures, taken out of its words wherever they stand. */
export function splitImageReferences(text: string): { images: Attachment[]; text: string } {
  const images: Attachment[] = []
  let rest = text
  for (const pattern of IMAGE_REFERENCES) {
    rest = rest.replace(pattern, (...match: unknown[]) => {
      const groups = match.slice(1, -2).filter((g): g is string => typeof g === 'string')
      const path = groups[groups.length - 1]?.trim()
      if (path) images.push({ kind: 'image', value: path })
      return ''
    })
  }
  if (!images.length) return { images, text }
  return {
    images,
    text: rest
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}

/** A person's message as the transcript shows it: their words, with its attachments apart. */
export function cleanUserText(raw: string): { text: string; attachments: Attachment[] } {
  const { attachments, text } = stripStored(raw)
  const pictures = splitImageReferences(text)
  return { text: plainReferences(pictures.text).trim(), attachments: [...attachments, ...pictures.images, ...footerPictures(raw)] }
}

/**
 * The pictures Hermes noted below its expanded context: 0.23 stores a sent
 * picture as `[Image attached at: …]` after the `--- Attached Context ---`
 * footer the words are cut at. Only Hermes' own notes count there, never an
 * `@image:` inside an attached file's text.
 */
function footerPictures(raw: string): Attachment[] {
  const text = removeVoiceJobPrefix(raw)
  if (!CONTEXT_REFERENCE.test(text)) return []
  const match = CONTEXT_FOOTER.exec(text)
  if (!match) return []
  const footer = text.slice(match.index)
  const images: Attachment[] = []
  for (const pattern of IMAGE_REFERENCES.slice(1)) {
    for (const found of footer.matchAll(pattern)) {
      const path = found
        .slice(1)
        .filter((g): g is string => typeof g === 'string')
        .pop()
        ?.trim()
      if (path) images.push({ kind: 'image', value: path })
    }
  }
  return images
}

/** What Hermes stored around the words, taken off; references inside the words are left as written. */
function stripStored(raw: string): { text: string; attachments: Attachment[] } {
  const withoutFooter = removeContextFooter(removeVoiceJobPrefix(raw))
  const { attachments, text } = splitLeadingReferences(withoutFooter.trim())
  return { text: text.trim(), attachments }
}

/** The last path component, for a chip or card. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}

/** The same references at the start of a preview the dashboard already folded onto one line. */
const FOLDED_REFERENCE = /^@(file|url|folder|image):(?:`([^`\r\n]*)(?:`|$)|"([^"\r\n]*)(?:"|$)|'([^'\r\n]*)(?:'|$)|([^\s`"']+))(?:\s+|$)/

/** One line for the chat list: the words, else the first attachment's name. */
export function previewText(raw: string): string {
  const cleaned = stripStored(raw)
  const pictures = splitImageReferences(cleaned.text)
  const attachments = [...cleaned.attachments, ...pictures.images]
  let text = pictures.text
  for (let match = FOLDED_REFERENCE.exec(text); match; match = FOLDED_REFERENCE.exec(text)) {
    attachments.push({ kind: match[1] as Attachment['kind'], value: match[2] ?? match[3] ?? match[4] ?? match[5] ?? '' })
    text = text.slice(match[0].length)
  }
  // A folded preview has the stored context on the same line as the words.
  // It can be cut off anywhere, even inside the marker.
  if (attachments.length || CONTEXT_REFERENCE.test(raw)) text = text.replace(/\s*---(?:\s[\s\S]*)?$/, '')
  const said = withoutTags(withPagesSaid(plainReferences(text, true), `🗂 ${t('Page')}`)).replace(/\s+/g, ' ').trim()
  // A teammate's delivery previews as "Atlas: what it said".
  const teammate = inbound(said)
  const words = teammate ? `${teammate.sender}: ${teammate.body}` : said
  const first = attachments[0]
  // A preview cut off just past a long link can leave a letter or two of the words.
  if (words.replace(/[….\s]+$/, '').length >= 3 || (words && !first)) return words
  return first ? (first.kind === 'url' ? first.value.replace(/^https?:\/\/(www\.)?/, '') : baseName(first.value)) : ''
}

/** A title Hermes made from a voice delegation's first message, without the conversation it carried (cut off anywhere). */
export function cleanTitle(title: string): string {
  const stripped = title
    .replace(/\s*\[Recent voice\b[^\]]*$/i, '')
    .replace(VOICE_CONTEXT, '')
    .replace(VOICE_JOB_PREFIX, '')
  return plainReferences(stripped, true).trim()
}

/** Markdown down to a line a notification can show. */
export function plainLine(text: string, max = 180): string {
  const plain = withoutTags(withPagesSaid(text, `🗂 ${t('Page')}`))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(?:MEDIA:|\[\[(?:audio_as_voice|as_document)\]\]).*$/gim, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, ' ')
    .replace(/[*`]+/g, '')
    // Emphasis underscores, not the ones inside a word (iq3_xs, snake_case).
    .replace(/(^|[\s(])_+(?=\S)/g, '$1')
    .replace(/(\S)_+(?=[\s.,!?;:)]|$)/g, '$1')
    .replace(/^\s*[>#]+/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}
