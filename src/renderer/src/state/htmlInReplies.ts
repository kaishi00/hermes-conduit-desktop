/**
 * HTML in a reply, after the phone's ReplyHTML (Eric 2026-11-26): one rule for
 * Hermes, "HTML in your reply draws".
 *
 * - A page: a line that starts with a page's tag (`<div`, `<table`, `<svg`,
 *   `<style`, `<!doctype html`…) outside a code fence starts one, and it runs
 *   to where its elements close, taking in the page tags that follow it (a
 *   `<style>`, then a `<div>`, then a `<script>`). It draws in the page card
 *   `::preview` uses, sandboxed.
 * - A few tags that read as text draw as text: bold, italics, underline,
 *   strikethrough, `<mark>`, `<kbd>`, `<sub>`, `<sup>`, a colored `<span>` or
 *   `<font>`, `<br>`, and `<details>` with its `<summary>` as a fold. Any other tag, or one that isn't closed, stays text as it always did.
 *
 * A fenced ```html block is code and stays code.
 */

/** Tags that start a page when a line starts with one. */
const PAGE_TAGS = new Set(
  (
    'html head body style script div table svg canvas section article figure header footer main nav aside form ' +
    'img picture video audio iframe center h1 h2 h3 h4 h5 h6 p ul ol dl blockquote pre button input select textarea ' +
    'link meta template'
  ).split(' ')
)

/** Elements with no closing tag. */
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '))

/** Elements whose content is text up to their own closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const PAGE_START = /^ {0,3}(?:<!doctype\s+html\b|<([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>]|$))/i

/** Whether a line starts a page. */
export function startsPage(line: string): boolean {
  const match = PAGE_START.exec(line)
  return !!match && (match[1] === undefined || PAGE_TAGS.has(match[1].toLowerCase()))
}

// A tag, a comment or a declaration; a tag's attributes may hold `>` inside quotes.
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g

/**
 * Where the elements opened in `text` from `from` close: the index just past the tag that leaves none open, or -1
 * while one is still open (or a tag, comment or script is still being written). A closing tag closes its element
 * and any left open inside it, as a browser does; one with nothing to close is passed over.
 */
function closesAt(text: string, from: number): number {
  const open: string[] = []
  let lower = ''
  let at = from
  // Where the last element closed: tags after it on its line are read too, so one opened there keeps the page going.
  let emptied = -1
  for (;;) {
    TOKEN.lastIndex = at
    const match = TOKEN.exec(text)
    if (emptied >= 0) {
      const lineEnd = text.indexOf('\n', emptied)
      if (!match || (lineEnd >= 0 && match.index > lineEnd)) return emptied
    }
    // A `<` still being written (a tag cut mid-way) leaves the page open.
    if (!match) return -1
    const token = match[0]
    at = TOKEN.lastIndex
    if (token.startsWith('<!--')) {
      if (!token.endsWith('-->')) return -1
    } else if (match[1]) {
      const name = match[1].toLowerCase()
      const index = open.lastIndexOf(name)
      if (index >= 0) open.length = index
    } else if (match[2]) {
      const name = match[2].toLowerCase()
      if (!VOID.has(name) && !match[4]) {
        if (RAW_TEXT.has(name)) {
          // Its text runs to its own closing tag: a script's `<` or `"</div>"` is not a tag.
          lower ||= text.toLowerCase()
          const end = lower.indexOf(`</${name}`, at)
          const close = end < 0 ? -1 : text.indexOf('>', end)
          if (close < 0) return -1
          at = close + 1
        } else open.push(name)
      }
    }
    if (token.startsWith('<!')) continue
    emptied = open.length ? -1 : at
  }
}

const TABLE_SEPARATOR = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/

/** Whether line `i` starts a page: a table row or header that starts with a tag is the table's. */
export function startsPageAt(lines: readonly string[], i: number): boolean {
  const line = lines[i]!
  if (!startsPage(line)) return false
  if (!line.includes('|')) return true
  if (i > 0 && lines[i - 1]!.includes('|')) return false
  return !(i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]!))
}

export type PageSpan = {
  /** The page's first line and the line after its last. */
  start: number
  end: number
  /** Its elements all closed, and something other than a page comes after it: nothing more will join it. */
  complete: boolean
}

/** The page starting at line `start` (which `startsPage`). */
export function pageAt(lines: readonly string[], start: number): PageSpan {
  // Joined once; `from` is where the part being read starts in it.
  const text = lines.slice(start).join('\n')
  let line = start
  let from = 0
  for (;;) {
    const at = closesAt(text, from)
    if (at < 0) return { start, end: lines.length, complete: false }
    // The line holding the closing tag ends the part.
    const end = line + text.slice(from, at).split('\n').length
    // Another page tag after blank lines continues the same page.
    let next = end
    while (next < lines.length && !lines[next]!.trim()) next++
    if (next < lines.length && startsPageAt(lines, next)) {
      for (; line < next; line++) from += lines[line]!.length + 1
      continue
    }
    if (next >= lines.length) return { start, end: trimBlankEnd(lines, start, end), complete: false }
    // The reply's last line may be a page tag still being written.
    if (next === lines.length - 1 && /^ {0,3}<[!a-zA-Z]*$/.test(lines[next]!)) return { start, end, complete: false }
    return { start, end, complete: true }
  }
}

function trimBlankEnd(lines: readonly string[], start: number, end: number): number {
  while (end > start + 1 && !lines[end - 1]!.trim()) end--
  return end
}

export type HtmlPart = { kind: 'text'; text: string } | { kind: 'page'; html: string; complete: boolean }

/** A reply's text in its runs of Markdown and its pages; a page inside a code fence is code. */
export function splitPages(text: string): HtmlPart[] {
  if (!text.includes('<')) return [{ kind: 'text', text }]
  const lines = text.split('\n')
  const parts: HtmlPart[] = []
  let run: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (run.join('\n').trim()) parts.push({ kind: 'text', text: run.join('\n') })
    run = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fenceMatch = FENCE.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) fence = null
      run.push(line)
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!
      run.push(line)
      continue
    }
    if (startsPageAt(lines, i)) {
      const page = pageAt(lines, i)
      flush()
      parts.push({ kind: 'page', html: lines.slice(page.start, page.end).join('\n').trim(), complete: page.complete })
      i = page.end - 1
      continue
    }
    run.push(line)
  }
  flush()
  return parts
}

/** A reply with each page as `said` (speech, a notification, the chat list); the rest as written. */
export function withPagesSaid(text: string, said: string): string {
  const parts = splitPages(text)
  if (parts.length === 1 && parts[0]!.kind === 'text') return text
  return parts.map(part => (part.kind === 'text' ? part.text : said)).join('\n\n')
}

const NAMED_COLORS = new Set('red green blue orange yellow purple pink gray grey black white teal brown cyan magenta indigo'.split(' '))

/** A CSS color a reply may use, or null: a name, a hex color, or rgb()/rgba() with plain numbers (the phone's ReplyHTML.safeColor). */
export function safeColor(value: string | undefined): string | null {
  const color = value?.trim().toLowerCase()
  if (!color) return null
  if (NAMED_COLORS.has(color)) return color
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(color)) return color
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)$/.test(color)) return color
  return null
}

/** A tag's attributes, by lowercase name. */
function attributes(text: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const match of text.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    found[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return found
}

/** The colors a span's style or a font's color attribute gives, as the style the text takes; empty when none. */
export function textColors(tag: string, attrs: Record<string, string>): { color?: string; background?: string } {
  const colors: { color?: string; background?: string } = {}
  if (tag === 'font') {
    const color = safeColor(attrs.color)
    if (color) colors.color = color
  }
  for (const rule of (attrs.style ?? '').split(';')) {
    const [name, ...rest] = rule.split(':')
    const property = name?.trim().toLowerCase()
    const value = safeColor(rest.join(':'))
    if (!value) continue
    if (property === 'color') colors.color = value
    if (property === 'background-color' || property === 'background') colors.background = value
  }
  return colors
}

/** The tags that draw as text, and the element each draws as. */
export const TEXT_TAGS: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'u',
  ins: 'u',
  s: 's',
  del: 's',
  strike: 's',
  mark: 'mark',
  kbd: 'kbd',
  sub: 'sub',
  sup: 'sup',
  span: 'span',
  font: 'span'
}

/** A class for the tags the app's own styles would otherwise reach. */
const CLASSES: Record<string, string> = { kbd: 'reply-key', mark: 'reply-highlight' }

export type Tag = { name: string; closing: boolean; selfClosing: boolean; attrs: Record<string, string> }

/** The single tag `text` is, or null. */
export function tagOf(text: string): Tag | null {
  const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>$/.exec(text.trim())
  if (!match) return null
  return { name: match[2]!.toLowerCase(), closing: !!match[1], selfClosing: !!match[4], attrs: attributes(match[3] ?? '') }
}

type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> }

const DETAILS_OPEN = /^<details(\s+open(?:=(?:"[^"]*"|'[^']*'|\S+))?)?\s*>\s*(?:<summary>([\s\S]*?)<\/summary>)?\s*$/i
const SUMMARY = /^<summary>([\s\S]*?)<\/summary>$/i
const DETAILS_CLOSE = /^<\/details\s*>$/i

/** Words without tags, for a summary. */
const untagged = (text: string) => text.replace(/<[^>]*>/g, '').trim()

/**
 * The remark plugin that draws the text tags: each paired tag wraps what's between, `<br>` is a line break, and a
 * `<details>` folds the blocks up to its `</details>` (or the reply's end, while it's being written). Anything
 * else stays as react-markdown leaves raw HTML: text.
 */
export function remarkHtmlTags() {
  return (tree: Node) => {
    visit(tree)
  }
}

function visit(parent: Node): void {
  const children = parent.children
  if (!children) return
  for (let i = 0; i < children.length; i++) {
    const node = children[i]!
    if (node.type !== 'html') {
      visit(node)
      continue
    }
    const value = node.value ?? ''
    const details = DETAILS_OPEN.exec(value.trim())
    if (details) {
      const end = matching(children, i, isDetailsOpen, isDetailsClose)
      const inside = children.slice(i + 1, end < 0 ? children.length : end)
      let summary = details[2] !== undefined ? untagged(details[2]) : ''
      // A summary of its own, as the fold's first block.
      const first = inside[0]
      if (details[2] === undefined && first) {
        const own = summaryOf(first)
        if (own !== null) {
          summary = own
          inside.shift()
        }
      }
      const fold: Node = {
        type: 'htmlDetails',
        data: { hName: 'details', hProperties: details[1] ? { className: ['reply-fold'], open: true } : { className: ['reply-fold'] } },
        children: [
          { type: 'htmlSummary', data: { hName: 'summary' }, children: [{ type: 'text', value: summary || 'Details' }] },
          ...inside
        ]
      }
      for (const child of inside) visit({ type: 'root', children: [child] })
      children.splice(i, (end < 0 ? children.length : end + 1) - i, fold)
      continue
    }
    const tag = tagOf(value)
    if (!tag || tag.closing) continue
    if (tag.name === 'br') {
      children[i] = { type: 'break' }
      continue
    }
    const element = TEXT_TAGS[tag.name]
    if (!element || tag.selfClosing) continue
    const end = matching(
      children,
      i,
      n => tagOf(n.value ?? '')?.name === tag.name && !tagOf(n.value ?? '')?.closing,
      n => tagOf(n.value ?? '')?.name === tag.name && !!tagOf(n.value ?? '')?.closing
    )
    if (end < 0) continue
    const colors = element === 'span' ? textColors(tag.name, tag.attrs) : {}
    const style = [colors.color ? `color: ${colors.color}` : '', colors.background ? `background-color: ${colors.background}` : '']
      .filter(Boolean)
      .join('; ')
    const className = CLASSES[element]
    const wrapped: Node = {
      type: 'htmlTag',
      data: { hName: element, hProperties: { ...(style ? { style } : {}), ...(className ? { className: [className] } : {}) } },
      children: children.slice(i + 1, end)
    }
    visit(wrapped)
    children.splice(i, end - i + 1, wrapped)
  }
}

const isDetailsOpen = (n: Node) => n.type === 'html' && DETAILS_OPEN.test((n.value ?? '').trim())
const isDetailsClose = (n: Node) => n.type === 'html' && DETAILS_CLOSE.test((n.value ?? '').trim())

/** The sibling that closes the one at `start`, counting those nested inside; -1 when none does. */
function matching(children: readonly Node[], start: number, opens: (n: Node) => boolean, closes: (n: Node) => boolean): number {
  let depth = 0
  for (let j = start + 1; j < children.length; j++) {
    const node = children[j]!
    if (node.type !== 'html') continue
    if (opens(node)) depth++
    else if (closes(node)) {
      if (!depth) return j
      depth--
    }
  }
  return -1
}

/** A block that is only `<summary>…</summary>`: its words. */
function summaryOf(node: Node): string | null {
  if (node.type === 'html') {
    const match = SUMMARY.exec((node.value ?? '').trim())
    return match ? untagged(match[1]!) : null
  }
  if (node.type !== 'paragraph' || !node.children?.length) return null
  const kids = node.children
  const first = kids[0]!
  const last = kids[kids.length - 1]!
  if (first.type !== 'html' || !/^<summary>$/i.test(first.value?.trim() ?? '')) return null
  if (last.type !== 'html' || !/^<\/summary>$/i.test(last.value?.trim() ?? '')) return null
  return kids
    .slice(1, -1)
    .map(text)
    .join('')
    .trim()
}

function text(node: Node): string {
  return node.value !== undefined && node.type !== 'html' ? node.value : (node.children ?? []).map(text).join('')
}

// The tags the chat draws; any other stays text there, so it stays in a plain line too.
const DRAWN_TAG = /<\/?(?:b|strong|i|em|u|ins|s|del|strike|mark|kbd|sub|sup|span|font|details|summary)(?:\s+[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+)|\s+open)*\s*\/?>/gi

/** The tags the chat draws taken out, for a line of plain text (a notification, the chat list); `<br>` a space. */
export function withoutTags(text: string): string {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(DRAWN_TAG, '')
}
