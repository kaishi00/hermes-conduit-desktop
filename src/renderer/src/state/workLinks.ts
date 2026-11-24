/**
 * A Bot Chat reply's links to its work, after the phone's BotWorkLinks and
 * HermesSessionReference (app #1637, #1710, #1947): the plugin hands the bot
 * "[Open W3](conduit://session/<id>?profile=<p>)" with Hermes Desktop's
 * "@session:<p>/<id>" reference right after it. The link leaves the reply's
 * words and becomes a work card under it, the reference to the same session
 * goes with it, and any other reference becomes a link to that chat.
 */

export interface WorkLink {
  /** "W3". */
  ref: string
  sessionId: string
  profile?: string
}

export const SESSION_LINK = 'conduit://session/'

/** The stored id and profile a `conduit://session/<id>?profile=<p>` link names. */
export function sessionInLink(href: string): { sessionId: string; profile?: string } | null {
  if (!href.startsWith(SESSION_LINK)) return null
  const rest = href.slice(SESSION_LINK.length)
  // A sentence's full stop after it isn't part of the id.
  const raw = (rest.split(/[?#)\]> \n]/)[0] ?? '').replace(/[.:-]+$/, '')
  const sessionId = decode(raw)
  if (!sessionId) return null
  const query = rest.includes('?') ? rest.slice(rest.indexOf('?') + 1) : ''
  const profile = new URLSearchParams(query).get('profile') || undefined
  return { sessionId, profile }
}

export function sessionLink(sessionId: string, profile?: string): string {
  return `${SESSION_LINK}${encodeURIComponent(sessionId)}${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`
}

const decode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** The link's words: "Open W3", or the ref with the bot's title after it ("W7: Provision the LXC"). */
const LABEL = String.raw`(?:Open )?(W\d+)(?:(?::|\s+[—–-])[^\]\n]*)?`
const WORK_LINK = new RegExp(String.raw`\[${LABEL}\]\((conduit://session/[^)\s]+)\)`, 'g')
/** A work link with Hermes Desktop's reference to its own session after it: group 1 the link, group 2 its id. */
const DESKTOP_REF = new RegExp(
  String.raw`(\[(?:Open )?W\d+(?:(?::|\s+[—–-])[^\]\n]*)?\]\(conduit://session/([^)?\s]+)[^)\s]*\))[ \t]*` +
    String.raw`(?<![\w/\`@])@session:(?:[A-Za-z0-9][A-Za-z0-9_-]{0,63}/)?\2(?![A-Za-z0-9_]|[.:-][A-Za-z0-9_])`,
  'g'
)

/** An inline code span, closed by a run of as many backticks as opened it (so ``a ` b`` is one span) within its paragraph. */
const INLINE_CODE = /(?<!`)(`+)(?!`)(?:(?!\r?\n[ \t]*\r?\n)[\s\S])*?(?<!`)\1(?!`)/g

/** A line that opens a fence: three or more backticks or tildes (the phone's MarkdownFence). */
function fenceOpening(trimmed: string): { mark: string; length: number } | null {
  const mark = trimmed[0]
  if (mark !== '`' && mark !== '~') return null
  let length = 0
  while (trimmed[length] === mark) length += 1
  return length >= 3 ? { mark, length } : null
}

/**
 * Where `text` has code, as sorted [start, end) offsets: its fenced blocks, read
 * as the phone's MarkdownText reads them (only a bare line of the same mark, at
 * least as long, closes one; a fence in a quote counts; one left open runs to
 * the end), and its inline spans outside them.
 */
function codeRanges(text: string): [number, number][] {
  if (!text.includes('`') && !text.includes('~~~')) return []
  const blocks: [number, number][] = []
  let fence: { mark: string; length: number } | null = null
  let fenceStart = 0
  let offset = 0
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/^\s*(?:>\s?)*/, '').trim()
    if (fence) {
      if (trimmed.length >= fence.length && [...trimmed].every(c => c === fence!.mark)) {
        blocks.push([fenceStart, offset + line.length])
        fence = null
      }
    } else {
      const open = fenceOpening(trimmed)
      if (open) {
        fence = open
        fenceStart = offset
      }
    }
    offset += line.length + 1
  }
  if (fence) blocks.push([fenceStart, text.length])
  // Inline spans in the rest: each block is blanked to line breaks, a paragraph's end, so no span pairs across it.
  let prose = text
  for (const [a, b] of blocks) prose = prose.slice(0, a) + '\n'.repeat(b - a) + prose.slice(b)
  const spans = [...prose.matchAll(INLINE_CODE)].map(m => [m.index!, m.index! + m[0].length] as [number, number])
  return [...blocks, ...spans].sort((x, y) => x[0] - y[0])
}

/** Whether a link starts in code: one quoted there stays as written, while a code span in its own title leaves it a card. */
const inCode = (ranges: [number, number][], start: number) => ranges.some(([a, b]) => start >= a && start < b)

/** The reply's words without its work links (and Desktop's references to them), and the links in order, each workstream once; null when it has none. */
export function splitWorkLinks(original: string): { text: string; links: WorkLink[] } | null {
  if (!original.includes(SESSION_LINK)) return null
  // A link quoted in code stays there as written.
  const originalCode = codeRanges(original)
  const text = original.includes('@session:')
    ? original.replace(DESKTOP_REF, (whole: string, link: string, _id: string, offset: number) =>
        // Kept when the link starts in code or the reference after it is quoted (a code span in the title doesn't count).
        inCode(originalCode, offset) || originalCode.some(([a, b]) => a < offset + whole.length && b > offset + link.length) ? whole : link
      )
    : original
  const code = codeRanges(text)
  const links: WorkLink[] = []
  let kept = ''
  let cursor = 0
  for (const match of text.matchAll(WORK_LINK)) {
    const session = sessionInLink(match[2]!)
    if (!session || inCode(code, match.index!)) continue
    const ref = match[1]!
    if (!links.some(link => link.ref === ref)) links.push({ ref, ...session })
    let start = match.index!
    let end = start + match[0].length
    // The spaces before it go too, and the "(…)" around it once it's empty.
    while (start > cursor && text[start - 1] === ' ') start--
    if (start > cursor && text[start - 1] === '(' && text[end] === ')') {
      start--
      end++
      while (start > cursor && text[start - 1] === ' ') start--
    }
    kept += text.slice(cursor, start)
    cursor = end
  }
  if (!links.length) return null
  return { text: (kept + text.slice(cursor)).trim(), links }
}

const REF = String.raw`@session:(?:([A-Za-z0-9][A-Za-z0-9_-]{0,63})/)?([A-Za-z0-9_](?:[A-Za-z0-9_.:-]{0,126}[A-Za-z0-9_])?)`
const BARE_REF = new RegExp(String.raw`(?<![\w/\`@])${REF}`, 'g')
const TARGET_REF = new RegExp(String.raw`\]\(\s*@session:(?:([A-Za-z0-9][A-Za-z0-9_-]{0,63})/)?([A-Za-z0-9_](?:[A-Za-z0-9_.:-]{0,126}[A-Za-z0-9_])?)[.:-]*\s*\)`, 'g')
/** What's already a link: a Markdown link (its words and its address), an autolink and a bare URL. */
const LINK_SPANS = /!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\s]+>|\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s)]+/g

/** Runs `transform` on the parts of `text` outside inline code. */
function outsideCode(text: string, transform: (prose: string) => string): string {
  let out = ''
  let cursor = 0
  for (const [start, end] of codeRanges(text)) {
    out += transform(text.slice(cursor, start)) + text.slice(start, end)
    cursor = end
  }
  return out + transform(text.slice(cursor))
}

/** Runs `transform` on the parts of `text` outside links. */
function outsideLinks(text: string, transform: (prose: string) => string): string {
  let out = ''
  let cursor = 0
  for (const match of text.matchAll(LINK_SPANS)) {
    out += transform(text.slice(cursor, match.index)) + match[0]
    cursor = match.index! + match[0].length
  }
  return out + transform(text.slice(cursor))
}

const oneLine = (title: string) => title.split(/\s+/).filter(Boolean).join(' ').replace(/([\\[\]])/g, '\\$1')

/**
 * Hermes' references to its chats ("@session:<profile>/<id>", or one as a
 * link's address) as links to the chat, titled with its name where the list
 * has it, else `fallback` ("Open chat"). Code is left as written.
 */
export function linkSessionRefs(text: string, titleOf: (sessionId: string) => string | undefined, fallback: string): string {
  if (!text.includes('@session:')) return text
  return outsideCode(text, segment => {
    if (!segment.includes('@session:')) return segment
    const targets = segment.replace(TARGET_REF, (_all, profile: string | undefined, id: string) => `](${sessionLink(id, profile)})`)
    // A reference inside a link's words stays as written: a link can't hold another.
    return outsideLinks(targets, prose =>
      prose.replace(BARE_REF, (_all, profile: string | undefined, id: string) => `[${oneLine(titleOf(id) ?? fallback)}](${sessionLink(id, profile)})`)
    )
  })
}

/** A ref the reply names in its words ("W50 found …"), not a link's words, a path's or a longer word's part. */
const NAMED_REF = /(?<![\w/[])(W\d+)\b(?!\]\(|\.\w)/g

/**
 * A Bot Chat reply with each workstream it names, as the bot's work lists it,
 * made a link to that workstream's chat (Eric 2026-11-03, app #1701). Code and
 * links are left as written; a ref the list doesn't have stays plain.
 */
export function linkNamedRefs(text: string, chatOf: (ref: string) => { sessionId: string; profile?: string } | undefined): string {
  if (!/W\d/.test(text)) return text
  return outsideCode(text, segment =>
    outsideLinks(segment, prose =>
      prose.replace(NAMED_REF, (whole, ref: string) => {
        const chat = chatOf(ref)
        return chat ? `[${ref}](${sessionLink(chat.sessionId, chat.profile)})` : whole
      })
    )
  )
}

/**
 * Whether a chat another window asks the main window to open belongs beside
 * the bots: the window said it's a workstream (it read the bot's own work),
 * or the main window's cross-bot read lists it. The read alone trails a
 * workstream just started, which then landed in the sessions list.
 */
export function landsWithBots(request: { storedId: string; workstream?: boolean }, workSessions: ReadonlySet<string>): boolean {
  return request.workstream === true || workSessions.has(request.storedId)
}
