/**
 * The rules for a host file a chat's file card opens in Conduit's viewer
 * (desktop#554): which files are copied down to be shown, the type each is
 * served as, and the byte range a player asks for. Kept free of Electron so
 * they're tested on their own and the renderer asks them too; main's
 * viewFiles.ts applies them.
 */

export const FILE_SCHEME = 'conduit-file'

/** Chromium's PDF viewer, which a PDF's frame opens inside itself. */
const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'

/**
 * The files the viewer shows from a copy, by extension, with the type each is
 * served as: pictures, sound, video and PDFs. Pages and text are read as text
 * instead, so no copy of them is made. An SVG is served as a picture and only
 * ever drawn in an <img>, where its scripts don't run.
 */
const VIEWED_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  m2a: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf'
}

/** A path's extension, lowercased, without its dot; '' when it has none. */
export function extensionOf(path: string): string {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The type a copy of `path` is served as, or null when the viewer doesn't show it from a copy. */
export function viewedType(path: string): string | null {
  return VIEWED_TYPES[extensionOf(path)] ?? null
}

/** A page the browser can open from a copy: an .html or .htm file. */
export const isPagePath = (path: string) => ['html', 'htm'].includes(extensionOf(path))

/** A copy's address on the file scheme. */
export function viewedFileUrl(id: string, path: string): string {
  const ext = extensionOf(path)
  return `${FILE_SCHEME}://${id}/file${ext ? `.${ext}` : ''}`
}

export const isViewedFileUrl = (url: string) => url.startsWith(`${FILE_SCHEME}://`)

/** A frame the viewer opens: a copy's address, or the PDF viewer a PDF's frame opens inside itself. */
export const viewerFrame = (url: string) => isViewedFileUrl(url) || url.startsWith(PDF_VIEWER)

/**
 * The bytes a `Range` header asks for, of a file `size` bytes long: null for
 * the whole file (no header, or one this doesn't read), 'unsatisfiable' when
 * it starts past the end. One range only, as players ask; `bytes=-500` is the
 * last 500 bytes.
 */
export function byteRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  if (match[1] === '') {
    const last = Number(match[2])
    if (last === 0) return 'unsatisfiable'
    return size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - last), end: size - 1 }
  }
  const start = Number(match[1])
  if (start >= size) return 'unsatisfiable'
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  return end < start ? 'unsatisfiable' : { start, end }
}

/** The copies kept at once: opening another removes the oldest. */
export const KEPT_VIEWS = 6
