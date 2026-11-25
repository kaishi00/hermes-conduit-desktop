/**
 * Cards made for Hermes Desktop, after the phone's TranscriptDirectives and
 * DesktopCardBlock (#1522): a plugin with a client half has the agent write
 * a directive only Hermes Desktop draws, such as hermes-rich-ui's
 * `::richui{id="…"}`. Conduit doesn't rebuild those renderers: it shows a
 * card in the directive's place naming its plugin, and a click shows the
 * directive as written. The plugin's own `::conduit-board{…}` is hidden:
 * the board is drawn where the line is when the reply's turn showed it
 * (boards.ts placeBoards cuts the reply there), else from conduit_show's
 * tool row. A directive is one
 * at a word's start, `::name{…}` holding only `key="value"` attributes, at
 * least one; in a code span, a fence, a quote or a table cell it stays text,
 * and one still being written shows as text until its closing brace.
 */
import { gateway } from '../gateway'
import { t } from '../../../shared/i18n'

export interface Directive {
  name: string
  attributes: Record<string, string>
  /** As the agent wrote it. */
  source: string
}

const DIRECTIVE = /(^|\s)::([A-Za-z][\w-]*)\{((?:\s*[A-Za-z_][\w-]*="[^"\n]*")+\s*)\}/g
const ATTRIBUTE = /([A-Za-z_][\w-]*)="([^"\n]*)"/g
export const BOARD = 'conduit-board'

export function attributesOf(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of body.matchAll(ATTRIBUTE)) out[match[1]!] = match[2]!
  return out
}

/** Text and directives, in order; a directive's leading space stays with the text before it. */
export function segments(text: string): (string | Directive)[] {
  const out: (string | Directive)[] = []
  let at = 0
  for (const match of text.matchAll(DIRECTIVE)) {
    const start = match.index! + match[1]!.length
    if (start > at) out.push(text.slice(at, start))
    out.push({ name: match[2]!, attributes: attributesOf(match[3]!), source: text.slice(start, match.index! + match[0].length) })
    at = match.index! + match[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

/** The plugin a directive belongs to, as the card names it. */
export const pluginName = (name: string) => (name === 'richui' ? 'hermes-rich-ui' : name)

/** hermes-rich-ui's card id, only a well-formed one. */
export function richUiId(directive: Directive): string | null {
  const id = directive.attributes.id
  return directive.name === 'richui' && id && /^ru-[0-9a-f]{12}$/.test(id) ? id : null
}

export interface CardContent {
  title: string
  summary: string
}

/** hermes-rich-ui's card record: its author's plain-text fallback, `meta.title` (else the root's title) and `meta.summary`. */
export function richUiContent(json: unknown): CardContent | null {
  const body = (json ?? {}) as Record<string, unknown>
  if (body.ok !== true) return null
  const card = (body.card ?? {}) as Record<string, unknown>
  const surface = ((card.surface ?? {}) as Record<string, unknown>).createSurface as Record<string, unknown> | undefined
  if (!surface || typeof surface !== 'object') return null
  const meta = (((surface.dataModel ?? {}) as Record<string, unknown>).meta ?? {}) as Record<string, unknown>
  const components = Array.isArray(surface.components) ? (surface.components as Record<string, unknown>[]) : []
  const rootTitle = components.find(c => c?.id === 'root')?.title
  const clean = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().slice(0, limit) : '')
  const title = clean(meta.title, 200) || clean(rootTitle, 200)
  const summary = clean(meta.summary, 2000)
  return title || summary ? { title, summary } : null
}

const RETRY_MS = 5 * 60_000
const read = new Map<string, { at: number; content: Promise<CardContent | null> }>()

let host = ''

/** The dashboard signed in to: another one's cards are read again. */
export function setDesktopCardsHost(next: string): void {
  host = next
}

/** A card's contents, kept for the run; a failed read is asked again after five minutes. */
export function readRichUiCard(id: string): Promise<CardContent | null> {
  const key = `${host}\n${id}`
  const kept = read.get(key)
  if (kept && Date.now() - kept.at < RETRY_MS) return kept.content
  const content = gateway
    .http('GET', `/api/plugins/hermes-rich-ui/cards/${id}`, undefined, 15_000)
    .then(richUiContent)
    .catch(() => null)
    .then(answer => {
      // Only an answer stays for the run; nothing waits five minutes for it.
      if (answer) read.set(key, { at: Number.POSITIVE_INFINITY, content: Promise.resolve(answer) })
      return answer
    })
  read.set(key, { at: Date.now(), content })
  return content
}

/** What speech says for a directive, and what it leaves out: a card is said, the board line isn't. */
export function withSpokenCards(markdown: string): string {
  return replaceOutsideCode(markdown, d => (d.name === BOARD ? '' : t('(There’s a card here for Hermes Desktop.)')))
}

/** Every directive outside fences and code spans, replaced. */
function replaceOutsideCode(markdown: string, replace: (d: Directive) => string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : segments(part)
            .map(s => (typeof s === 'string' ? s : replace(s)))
            .join('')
    )
    .join('')
}

type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> }

/** Never cards: a quote is an example and a table cell is table text. */
const KEEPS_TEXT = new Set(['blockquote', 'tableCell', 'link', 'linkReference'])

/** The remark step: a directive in a text node becomes a `desktop-card` element, and the board line goes. */
export function remarkDesktopCards() {
  const walk = (node: Node) => {
    if (!node.children || KEEPS_TEXT.has(node.type)) return
    const next: Node[] = []
    for (const child of node.children) {
      if (child.type !== 'text' || !child.value?.includes('::')) {
        walk(child)
        next.push(child)
        continue
      }
      for (const part of segments(child.value)) {
        if (typeof part === 'string') next.push({ type: 'text', value: part })
        else if (part.name !== BOARD)
          next.push({
            type: 'desktopCard',
            data: { hName: 'desktop-card', hProperties: { dataName: part.name, dataSource: part.source, dataId: richUiId(part) ?? '' } }
          })
      }
    }
    node.children = next
  }
  return (tree: Node) => walk(tree)
}
