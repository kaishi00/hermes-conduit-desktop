/**
 * The small marks beside what a reply points at (issue 455): a site's own
 * icon beside a link to it, and a file's type beside its name.
 */

/** Hosts whose icon didn't load, for as long as the app runs: asked once, then left bare. */
const noIcon = new Set<string>()

/**
 * A site's own icon for a link to it: the `favicon.ico` at its root, asked
 * of the site itself (no icon service learns what was linked). Only for an
 * https link to a named host: a page on this network, an address or a host
 * with a login in the link gets none.
 */
export function faviconUrl(href: string | undefined): string | null {
  if (!href) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  // A name may end in a dot (`nas.local.`): the same host, so the same answer.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || /\.(local|lan|internal|home|test|localhost)$/.test(host)) return null
  if (noIcon.has(url.host)) return null
  return `https://${url.host}/favicon.ico`
}

/** A link whose icon failed: its host gets none from here on. */
export function faviconFailed(href: string | undefined): void {
  try {
    if (href) noIcon.add(new URL(href).host)
  } catch {
    // Not a link: nothing to forget.
  }
}

/** For tests: every host may be asked again. */
export function forgetFailedFavicons(): void {
  noIcon.clear()
}

const TYPE_NAMES: Record<string, string> = {
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  ts: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  py: 'Python',
  rb: 'Ruby',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  h: 'C header',
  cpp: 'C++',
  cs: 'C#',
  php: 'PHP',
  sh: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'Sass',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  md: 'Markdown',
  txt: 'Text',
  csv: 'CSV',
  pdf: 'PDF',
  png: 'PNG',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  gif: 'GIF',
  svg: 'SVG',
  webp: 'WebP',
  zip: 'ZIP',
  log: 'Log'
}

/**
 * A file's type from its name: the short label drawn beside it (its
 * extension, in capitals) and the type's name where it has a common one.
 * Null for a folder, a name without a type, a dotfile and a type that's a
 * number (a version).
 */
export function fileType(path: string): { label: string; name: string } | null {
  const text = path.trim()
  if (!text || /[\\/]$/.test(text)) return null
  const file = text.split(/[\\/]/).pop() ?? ''
  const dot = file.lastIndexOf('.')
  if (dot <= 0) return null
  const type = file.slice(dot + 1).toLowerCase()
  if (!/^[a-z0-9]{1,5}$/.test(type) || /^\d+$/.test(type)) return null
  return { label: type.toUpperCase(), name: TYPE_NAMES[type] ?? type.toUpperCase() }
}
