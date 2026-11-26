/**
 * The rules behind the workbench's Browser tabs (hostPages.ts applies them):
 * how a host page's request is wrapped for the plugin, how its answer is
 * unwrapped, the cookies a dev server set, and where a Browser tab may go.
 * Kept free of Electron so they're tested on their own.
 */
import { HOST_PAGE_SCHEME, hostPageParts, hostPageUrl, localLink } from '../shared/browserAddress'
import { opensExternally } from './linkPolicy'

export const PAGE_HEADERS = 'X-Conduit-Page-Headers'
export const PAGE_STATUS = 'X-Conduit-Page-Status'

/** Headers about this hop, or the browser's own to set. */
const DROPPED = new Set(['host', 'cookie', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'te', 'trailer'])

/** An address on the page's own origin, as the dev server knows it (http://localhost:5173). */
function asLocal(value: string, origin: string, local: string): string {
  return value === origin || value.startsWith(`${origin}/`) ? local + value.slice(origin.length) : value
}

/** The page's headers, for X-Conduit-Page-Headers: its origin and referrer as the dev server's own, and its cookies from the jar. */
export function pageHeaderPairs(headers: Headers, origin: string, local: string, cookie: string | null): [string, string][] {
  const pairs: [string, string][] = []
  headers.forEach((value, name) => {
    const lower = name.toLowerCase()
    if (DROPPED.has(lower)) return
    pairs.push([name, lower === 'origin' || lower === 'referer' ? asLocal(value, origin, local) : value])
  })
  if (cookie) pairs.push(['Cookie', cookie])
  return pairs
}

/** The dev server's status, as the page gets it. */
export function pageStatus(raw: string | null): number {
  const status = Number(raw)
  return Number.isInteger(status) && status >= 200 && status <= 599 ? status : 502
}

/** An answer with no body: a HEAD, or a status that never has one. */
export function bodiless(method: string, status: number): boolean {
  return method === 'HEAD' || status === 204 || status === 205 || status === 304
}

/**
 * The cookies one dev server set, kept in this process (a custom scheme's
 * page gets none of Chromium's): sent back to it, never to the dashboard.
 * Paths and domains are one origin's here, so only names, values and
 * expiry are kept.
 */
export class PageCookies {
  private readonly cookies = new Map<string, { value: string; expires: number | null }>()

  constructor(private readonly now: () => number = Date.now) {}

  take(setCookie: string): void {
    const [pair, ...attributes] = setCookie.split(';')
    const at = pair?.indexOf('=') ?? -1
    if (!pair || at <= 0) return
    const name = pair.slice(0, at).trim()
    const value = pair.slice(at + 1).trim()
    let expires: number | null = null
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.split('=')
      const field = key?.trim().toLowerCase()
      const raw = rest.join('=').trim()
      if (field === 'max-age') {
        const seconds = Number(raw)
        if (Number.isFinite(seconds)) expires = this.now() + seconds * 1000
      } else if (field === 'expires' && expires === null) {
        const when = Date.parse(raw)
        if (Number.isFinite(when)) expires = when
      }
    }
    if (expires !== null && expires <= this.now()) this.cookies.delete(name)
    else this.cookies.set(name, { value, expires })
  }

  header(): string | null {
    const now = this.now()
    const live: string[] = []
    for (const [name, cookie] of this.cookies) {
      if (cookie.expires !== null && cookie.expires <= now) this.cookies.delete(name)
      else live.push(`${name}=${cookie.value}`)
    }
    return live.length ? live.join('; ') : null
  }
}

/** The dev server's headers, for the page: its cookies to the jar, a redirect to its own origin kept on the page's. */
export function answerHeaders(raw: string | null, origin: string, local: string, jar: PageCookies): Headers {
  const headers = new Headers()
  let pairs: unknown
  try {
    pairs = JSON.parse(raw ?? '[]')
  } catch {
    pairs = []
  }
  if (!Array.isArray(pairs)) return headers
  const locals = [local, local.replace('localhost', '127.0.0.1')]
  for (const pair of pairs) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') continue
    const [name, value] = pair as [string, string]
    const lower = name.toLowerCase()
    if (lower === 'set-cookie') {
      jar.take(value)
      continue
    }
    if (DROPPED.has(lower)) continue
    if (lower === 'location' || lower === 'content-location') {
      const at = locals.find(l => value === l || value.startsWith(`${l}/`) || value.startsWith(`${l}?`))
      headers.append(name, at ? origin + value.slice(at.length) : value)
      continue
    }
    try {
      headers.append(name, value)
    } catch {
      // A header Chromium won't take: left out.
    }
  }
  return headers
}

/**
 * Whether a URL names this computer by an address literal or a loopback name:
 * 127.0.0.0/8, ::1 and its IPv4-mapped forms, 0.0.0.0, localhost and
 * *.localhost, a trailing dot included. A web page never reaches these.
 */
export function namesThisComputer(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  host = host.replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (/^127(\.\d{1,3}){3}$/.test(host) || host === '0.0.0.0') return true
  if (host === '::1' || host === '::' || /^0*:(0*:)*0*:?1$/.test(host)) return true
  // IPv4-mapped (::ffff:127.0.0.1, which URL writes as ::ffff:7f00:1) and IPv4-compatible forms.
  const mapped = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (mapped) {
    const high = parseInt(mapped[1]!, 16)
    return high >> 8 === 127 || (high === 0 && parseInt(mapped[2]!, 16) === 0)
  }
  return /^::(?:ffff:)?127(\.\d{1,3}){3}$/.test(host)
}

export type BrowserKind = 'host' | 'web'

/**
 * A host page's own request that names this computer (a fetch to
 * http://localhost:8000/api, an image from 127.0.0.1): it means the Hermes
 * host's, so an http one goes to that port's host page, through the
 * dashboard, and any other (a socket) is cancelled. Never this computer's.
 * Null for a request that names somewhere else.
 */
export function hostPageRequest(url: string, from: string | undefined): { redirectURL: string } | { cancel: true } | null {
  if (!namesThisComputer(url)) return null
  const here = from ? hostPageParts(from) : null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { cancel: true }
  }
  if (!here || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return { cancel: true }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  return { redirectURL: hostPageUrl(here.key, port, `${parsed.pathname}${parsed.search}`) }
}

/**
 * Where a Browser tab's page may go: `stay` lets it, `load` takes it to a
 * host page in place (a localhost link on a host page is the host's),
 * `external` opens it in the browser, `refuse` goes nowhere. A host page
 * keeps to the host; a web page never reaches a host page or this computer's
 * own localhost.
 */
export function browserGoes(kind: BrowserKind, url: string, from: string, mac: boolean): 'stay' | 'refuse' | 'external' | { load: string } {
  const page = hostPageParts(url)
  if (url.startsWith(`${HOST_PAGE_SCHEME}:`)) {
    const here = hostPageParts(from)
    return kind === 'host' && page && here && page.key === here.key ? 'stay' : 'refuse'
  }
  const local = localLink(url)
  if (kind === 'web' && namesThisComputer(url)) return 'refuse'
  if (local) {
    const here = hostPageParts(from)
    return kind === 'host' && here ? { load: hostPageUrl(here.key, local.port, local.path) } : 'refuse'
  }
  if (/^https?:\/\//i.test(url)) return kind === 'web' ? 'stay' : 'external'
  return opensExternally(url, mac) ? 'external' : 'refuse'
}

/** A frame inside a Browser tab's page (an embed, an ad, a sign-in): web pages and the page's own scheme, never a host page from a web page. */
export function browserFrameStays(kind: BrowserKind, url: string): boolean {
  if (/^(about:|data:|blob:)/i.test(url)) return true
  if (url.startsWith(`${HOST_PAGE_SCHEME}:`)) return kind === 'host'
  if (localLink(url) || namesThisComputer(url)) return false
  return /^https?:\/\//i.test(url)
}

/** The page a refused request shows: what went wrong, in plain words. */
export function errorPage(message: string): string {
  const text = message.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><title>${text}</title><style>body{font:14px system-ui,sans-serif;color:#555;display:grid;place-items:center;height:90vh;margin:0}@media (prefers-color-scheme:dark){body{color:#bbb;background:#1e1e1e}}</style><p>${text}</p>`
}
