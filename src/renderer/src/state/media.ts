/**
 * Hermes' `MEDIA:<path>` delivery tags in a reply, after the phone's
 * GatewayMediaTags: a tag alone on its line (any path), a Markdown image or
 * link around one, or a tag mid-sentence whose path ends in a known
 * extension. Each becomes a file card; the words around it stay Markdown.
 * Tags inside code or a blockquote are examples, not files.
 */

export type ReplyBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'media'; path: string; alt?: string }
  | { kind: 'preview'; path: string }
  /** A conduit_show board, where the reply's `::conduit-board{id="cb-…"}` line places it (boards.ts placeBoards). */
  | { kind: 'board'; id: string }

/** The plugin's board line, after the phone's TranscriptDirectives: at a word's start, its id `cb-` and 12 hex digits. */
const BOARD_LINE = /(?:^|(?<=\s))::conduit-board\{\s*id="(cb-[0-9a-f]{12})"\s*\}/g

/** The board lines in a line that name one of `ids`, each with where it stands; none inside a code span. */
function boardLines(line: string, ids: ReadonlySet<string>): { index: number; length: number; id: string }[] {
  const found: { index: number; length: number; id: string }[] = []
  for (const match of line.matchAll(BOARD_LINE)) {
    const index = match.index ?? 0
    const ticks = (line.slice(0, index).match(/`/g) ?? []).length
    if (ticks % 2 === 1 && line.indexOf('`', index) >= 0) continue
    if (ids.has(match[1]!)) found.push({ index, length: match[0].length, id: match[1]! })
  }
  return found
}

/**
 * Hermes Desktop's `::preview{file="…"}`, after the phone's TranscriptDirectives: the directive starts a
 * word (so `std::preview` isn't one), its file is `file="…"` or `file='…'`, and one without a file stays text.
 */
const PREVIEW = /(?:^|(?<=\s))::preview\{([^{}\n]{0,1024})\}/g
const FILE_ATTRIBUTE = /(?:^|\s)file=(?:"([^"]*)"|'([^']*)')/

/** The previews in a line, each with where it stands; none inside a code span. */
function previews(line: string): { index: number; length: number; path: string }[] {
  const found: { index: number; length: number; path: string }[] = []
  for (const match of line.matchAll(PREVIEW)) {
    const index = match.index ?? 0
    const ticks = (line.slice(0, index).match(/`/g) ?? []).length
    if (ticks % 2 === 1 && line.indexOf('`', index) >= 0) continue
    const attribute = FILE_ATTRIBUTE.exec(match[1] ?? '')
    const path = (attribute?.[1] ?? attribute?.[2] ?? '').trim()
    if (path) found.push({ index, length: match[0].length, path })
  }
  return found
}

/** Whether a preview's file draws in place; anything else gets a file card. */
export const isHtmlPage = (path: string) => /\.(?:html?|xhtml)$/i.test(path)

export const KNOWN_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'tif',
  'heic',
  'heif',
  'svg',
  'mp4',
  'mov',
  'm4v',
  'avi',
  'mkv',
  'webm',
  '3gp',
  'mp3',
  'm2a',
  'wav',
  'ogg',
  'oga',
  'opus',
  'm4a',
  'aac',
  'flac',
  'caf',
  'aiff',
  'aif',
  'pdf',
  'docx',
  'doc',
  'odt',
  'rtf',
  'txt',
  'md',
  'epub',
  'xlsx',
  'xls',
  'ods',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'kmz',
  'kml',
  'geojson',
  'gpx',
  'pptx',
  'ppt',
  'odp',
  'key',
  'pages',
  'numbers',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'apk',
  'ipa',
  'html',
  'htm'
]

const DIRECTIVES = ['[[audio_as_voice]]', '[[as_document]]']

const ROOT = String.raw`(?:~\/|\/|[A-Za-z]:[\\/])`
const EXT = [...KNOWN_EXTENSIONS].sort((a, b) => b.length - a.length).join('|')

const WHOLE_LINE = new RegExp(String.raw`^[\x60"'*_]{0,3}MEDIA:[^\S\n]*[\x60"']?(${ROOT}.*?)[\x60"']?[\x60"'*_]{0,3}\.?$`, 'i')
const MARKDOWN_LINK = new RegExp(String.raw`^!?\[([^\]]*)\]\([^\S\n]*MEDIA:[^\S\n]*[\x60"']?(${ROOT}[^)]*?)[\x60"']?[^\S\n]*\)$`, 'i')
const MID_LINE = new RegExp(
  String.raw`(?:!?\[([^\]]*)\]\()?[\x60"'*_]{0,3}MEDIA:[^\S\n]*[\x60"']?(${ROOT}\S+?\.(?:${EXT}))[\x60"']?(?=[\s\x60"'*_,;:)\]}]|$|\.(?:\s|$))[\x60"'*_]{0,3}\)?`,
  'gi'
)

export type MediaKind = 'image' | 'audio' | 'video' | 'file'

export function mediaKind(path: string): MediaKind {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'svg'].includes(ext)) return 'image'
  if (['mp3', 'm2a', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'caf', 'aiff', 'aif'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'].includes(ext)) return 'video'
  return 'file'
}

/**
 * Splits a reply into Markdown runs and the files it delivers. With `boards`, the ids of the boards the reply
 * places, it is also cut at the first line naming each (phone issue 3215): the words on that line stay before
 * the board, and a line in a fence, a quote or a table is never a cut.
 */
export function splitReply(text: string, boards?: ReadonlySet<string>): ReplyBlock[] {
  const left = boards?.size && text.includes('::conduit-board{') ? new Set(boards) : null
  if (!left && !/MEDIA:/i.test(text) && !text.includes('::preview') && !DIRECTIVES.some(d => text.includes(d))) return [{ kind: 'markdown', text }]
  const blocks: ReplyBlock[] = []
  let run: string[] = []
  const flush = () => {
    const joined = run.join('\n')
    if (joined.trim()) blocks.push({ kind: 'markdown', text: joined })
    run = []
  }
  let fence: string | null = null
  for (const rawLine of text.split('\n')) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(rawLine)
    if (fence) {
      run.push(rawLine)
      if (fenceMatch && fenceMatch[1]!.startsWith(fence)) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!
      run.push(rawLine)
      continue
    }
    let line = rawLine
    const hadDirective = DIRECTIVES.some(d => line.includes(d))
    for (const directive of DIRECTIVES) line = line.split(directive).join('')
    const trimmed = line.trim()
    if (hadDirective && !trimmed) continue
    const placed = left?.size && !trimmed.startsWith('>') && !trimmed.includes('|') ? boardLines(trimmed, left) : []
    if (placed.length) {
      // Each board once: a second line naming it stays text, which the Markdown hides.
      const first = placed.filter(board => left!.delete(board.id))
      let words = trimmed
      for (const board of [...first].reverse()) words = words.slice(0, board.index) + words.slice(board.index + board.length)
      flush()
      if (words.trim()) blocks.push(...splitReply(words.replace(/[^\S\n]{2,}/g, ' ').trim()))
      for (const board of first) blocks.push({ kind: 'board', id: board.id })
      continue
    }
    const drawn = trimmed.startsWith('>') ? [] : previews(trimmed)
    if (drawn.length) {
      let cursor = 0
      for (const page of drawn) {
        const before = trimmed.slice(cursor, page.index).trim()
        if (before) run.push(before)
        flush()
        blocks.push(isHtmlPage(page.path) ? { kind: 'preview', path: page.path } : { kind: 'media', path: page.path })
        cursor = page.index + page.length
      }
      const after = trimmed.slice(cursor).trim()
      if (after) run.push(after)
      continue
    }
    if (!/MEDIA:/i.test(trimmed) || trimmed.startsWith('>')) {
      run.push(hadDirective ? line : rawLine)
      continue
    }
    const link = MARKDOWN_LINK.exec(trimmed)
    if (link) {
      flush()
      blocks.push({ kind: 'media', path: link[2]!.trim(), alt: link[1]?.trim() || undefined })
      continue
    }
    const mid = [...trimmed.matchAll(MID_LINE)].filter(m => !insideCode(trimmed, m.index ?? 0))
    if (mid.length) {
      const files: ReplyBlock[] = []
      let rest = ''
      let cursor = 0
      for (const match of mid) {
        rest += trimmed.slice(cursor, match.index)
        cursor = (match.index ?? 0) + match[0].length
        files.push({ kind: 'media', path: match[2]!, alt: match[1]?.trim() || undefined })
      }
      rest += trimmed.slice(cursor)
      if (rest.trim()) run.push(rest.replace(/[^\S\n]{2,}/g, ' ').trimEnd())
      flush()
      blocks.push(...files)
      continue
    }
    const whole = WHOLE_LINE.exec(trimmed)
    if (whole) {
      flush()
      blocks.push({ kind: 'media', path: whole[1]!.trim() })
      continue
    }
    run.push(rawLine)
  }
  flush()
  return blocks
}

/** Whether the `MEDIA:` keyword of a match starting at `index` sits inside a `code span`. */
function insideCode(line: string, index: number): boolean {
  const keyword = line.toUpperCase().indexOf('MEDIA:', index)
  let ticks = 0
  for (let i = 0; i < keyword; i++) if (line[i] === '`') ticks++
  return ticks % 2 === 1 && line.indexOf('`', keyword) >= 0
}

/** A delivered file's name, never its path on the host. */
export const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/**
 * A reply as a voice model gets it, after the phone's GatewayMediaTags.namingFiles:
 * each delivered file or preview named, never given by its path (live models
 * are told of a file by name, #1449).
 */
export function namingFiles(text: string): string {
  const blocks = splitReply(text)
  if (blocks.length === 1 && blocks[0]!.kind === 'markdown') return blocks[0]!.text
  return blocks
    .map(block =>
      block.kind === 'markdown'
        ? block.text
        : block.kind === 'board'
          ? ''
          : `${block.kind === 'media' && block.alt ? `${block.alt} ` : ''}(a file in the chat: ${fileName(block.path)})`
    )
    .join('\n')
}
