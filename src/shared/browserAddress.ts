/**
 * What a workbench Browser tab's address means (desktop issue 451): a port or
 * a localhost address is a dev server on the Hermes host, reached through the
 * plugin's /workspace/preview route and served here on a scheme of its own;
 * anything else is a web page, which loads from this computer as a browser's
 * would. Kept free of Electron so it's tested on its own.
 */

export const HOST_PAGE_SCHEME = 'conduit-host-page'
/** The Browser tabs' sessions: host pages' kept in memory, web pages' kept on disk with their sign-ins. */
export const HOST_PAGES_PARTITION = 'conduit-host-pages'
export const WEB_PAGES_PARTITION = 'persist:conduit-web-pages'

export type BrowserAddress = { kind: 'host'; port: number; path: string } | { kind: 'web'; url: string }

const HOST_NAME = /^(\d{1,5})\.([a-z0-9]{4,32})$/

function hostAt(port: number, path: string | undefined): BrowserAddress | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const rest = path ?? '/'
  return { kind: 'host', port, path: rest.startsWith('/') ? rest : `/${rest}` }
}

/** A host page's address: its port, the host it's on (a key, from hostPageKey) and its path. */
export function hostPageUrl(key: string, port: number, path = '/'): string {
  return `${HOST_PAGE_SCHEME}://${port}.${key}${path.startsWith('/') ? path : `/${path}`}`
}

/** A host page address's parts, or null for any other address. */
export function hostPageParts(url: string): { port: number; key: string; path: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${HOST_PAGE_SCHEME}:`) return null
  const name = HOST_NAME.exec(parsed.hostname)
  if (!name) return null
  const port = Number(name[1])
  if (port < 1 || port > 65535) return null
  return { port, key: name[2]!, path: `${parsed.pathname || '/'}${parsed.search}${parsed.hash}` }
}

/**
 * Whether a host name (as URL gives it) is this machine's own: 127.0.0.0/8,
 * ::1 and its IPv4-mapped forms, 0.0.0.0 and ::, localhost and *.localhost,
 * a trailing dot included. On the desktop it names the computer; typed into
 * a Browser tab or linked from the chat, it names the Hermes host. One check
 * for both, so the two never disagree on a spelling.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
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

/** An address on this machine's loopback, by any spelling URL reads (2130706433 and [::7f00:1] too): its port and path. */
function loopbackAt(text: string): BrowserAddress | null {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') return null
  let parsed: URL
  try {
    parsed = new URL(scheme ? text : `http://${text}`)
  } catch {
    return null
  }
  if (!isLoopbackHost(parsed.hostname) || parsed.username || parsed.password) return null
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  return hostAt(port, `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`)
}

/** What an address typed into a Browser tab opens, or null when it isn't one. */
export function readAddress(input: string): BrowserAddress | null {
  const text = input.trim()
  if (!text) return null
  const bare = /^:?(\d{1,5})([/?#]\S*)?$/.exec(text)
  if (bare) return hostAt(Number(bare[1]), bare[2])
  if (/\s/.test(text)) return null
  const local = loopbackAt(text)
  if (local) return local
  const page = hostPageParts(text)
  if (page) return hostAt(page.port, page.path)
  if (/^https?:\/\/\S+$/i.test(text)) return web(text)
  // An address on a network (192.168.1.5:8080, [fe80::1], nas:5000): over http, as a device there usually serves.
  if (/^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])(:\d{1,5})?([/?#]\S*)?$/i.test(text) || /^[a-z0-9-]+:\d{1,5}([/?#]\S*)?$/i.test(text)) return web(`http://${text}`)
  if (/^[^\s/:?#]+\.[a-z]{2,}(?::\d{1,5})?([/?#]\S*)?$/i.test(text)) return web(`https://${text}`)
  return null
}

function web(text: string): BrowserAddress | null {
  try {
    return { kind: 'web', url: new URL(text).href }
  } catch {
    return null
  }
}

/** A link's address when it names this host's localhost (http://localhost:5173 in a reply): a dev server on the Hermes host. */
export function localLink(href: string): { port: number; path: string } | null {
  if (!/^https?:\/\//i.test(href)) return null
  const address = readAddress(href)
  return address?.kind === 'host' ? { port: address.port, path: address.path } : null
}

/** The address a tab shows: localhost:5173/path for a host page, the web address as it is. */
export function shownAddress(url: string): string {
  const page = hostPageParts(url)
  if (!page) return url
  return `localhost:${page.port}${page.path === '/' ? '' : page.path}`
}
