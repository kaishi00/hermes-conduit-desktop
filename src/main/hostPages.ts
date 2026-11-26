/**
 * The workbench's Browser tabs (desktop issue 451; Eric, 2026-11-26: pages
 * render here, a host dev server is reached through the dashboard). Each
 * tab is a <webview> in a session of its own, with no preload and no way
 * into the app:
 *
 * - A host page (localhost:5173 on the Hermes host) is served from
 *   conduit-host-page://5173.<host>/ in a session kept in memory: each
 *   request goes to the plugin's /workspace/preview route, wrapped, on the
 *   dashboard on screen. Its cookies stay in this process.
 * - A web page loads from this computer, in a session of its own that keeps
 *   its sign-ins, as a browser's would.
 *
 * Neither asks for the camera, the microphone or any other permission. The
 * rules are in hostPageRules.ts.
 */
import { session, shell, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { t } from '../shared/i18n'
import { HOST_PAGE_SCHEME, HOST_PAGES_PARTITION, WEB_PAGES_PARTITION, hostPageParts } from '../shared/browserAddress'
import { PAGE_HEADERS, PAGE_STATUS, PageCookies, answerHeaders, bodiless, browserFrameStays, browserGoes, errorPage, hostPageRequest, namesThisComputer, pageHeaderPairs, pageStatus, type BrowserKind } from './hostPageRules'

const PREVIEW_PATH = '/api/plugins/conduit_push/workspace/preview'

export const HOST_PAGE_PRIVILEGES: Electron.CustomScheme = {
  scheme: HOST_PAGE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}

/** The key a host page's address names its dashboard by. */
export const hostPageKey = (dashboardUrl: string): string => createHash('sha256').update(dashboardUrl).digest('hex').slice(0, 12)

export interface ShownDashboard {
  url: string
  pageRequest(path: string, method: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer> | undefined, signal?: AbortSignal): Promise<Response>
}

const isMac = process.platform === 'darwin'
/** The dev servers' cookies, per dashboard and port, the newest 50 kept. */
const jars = new Map<string, PageCookies>()
const MAX_JARS = 50

function page(status: number, message: string): Response {
  return new Response(errorPage(message), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

async function refusal(answer: Response): Promise<string> {
  try {
    const detail = ((await answer.json()) as { detail?: unknown } | null)?.detail
    if (typeof detail === 'string' && detail) return detail
  } catch {
    // Not Hermes' JSON.
  }
  return answer.status === 404 ? t('Update the Conduit plugin on this host to see its pages.') : `${t('Hermes refused this page.')} (${answer.status})`
}

/** Once the app is ready: the host pages' scheme, and no permissions for either session. */
export function serveHostPages(shown: () => ShownDashboard | null): void {
  const hostPages = session.fromPartition(HOST_PAGES_PARTITION)
  for (const pages of [hostPages, session.fromPartition(WEB_PAGES_PARTITION)]) {
    pages.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    pages.setPermissionCheckHandler(() => false)
  }
  // A web page never reaches this computer by an address: no request of its, a fetch, an image or a socket, names one.
  session.fromPartition(WEB_PAGES_PARTITION).webRequest.onBeforeRequest((details, callback) => callback({ cancel: namesThisComputer(details.url) }))
  // A host page's request to localhost is the host's: it goes to that port's host page, never to this computer.
  hostPages.webRequest.onBeforeRequest((details, callback) => {
    let from: string | undefined
    try {
      from = details.frame?.url || details.webContents?.getURL()
    } catch {
      // The frame is gone.
    }
    callback(hostPageRequest(details.url, from) ?? {})
  })
  hostPages.protocol.handle(HOST_PAGE_SCHEME, async request => {
    const parts = hostPageParts(request.url)
    if (!parts) return page(404, t('This page address isn’t one Conduit knows.'))
    const dashboard = shown()
    if (!dashboard || hostPageKey(dashboard.url) !== parts.key) return page(421, t('This page is on another Hermes. Switch to it to see the page.'))
    const origin = `${HOST_PAGE_SCHEME}://${parts.port}.${parts.key}`
    const local = `http://localhost:${parts.port}`
    const jarKey = `${parts.key}:${parts.port}`
    const jar = jars.get(jarKey) ?? new PageCookies()
    jars.delete(jarKey)
    jars.set(jarKey, jar)
    while (jars.size > MAX_JARS) jars.delete(jars.keys().next().value!)
    const pairs = pageHeaderPairs(request.headers, origin, local, jar.header())
    const path = parts.path.replace(/#.*$/, '')
    let answer: Response
    try {
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer())
      answer = await dashboard.pageRequest(`${PREVIEW_PATH}/${parts.port}${path}`, request.method, { [PAGE_HEADERS]: JSON.stringify(pairs) }, body, request.signal)
    } catch (error) {
      return page(502, error instanceof Error ? error.message : String(error))
    }
    if (!answer.ok || !answer.headers.has(PAGE_STATUS)) return page(answer.ok ? 502 : answer.status === 403 ? 403 : 502, await refusal(answer))
    const status = pageStatus(answer.headers.get(PAGE_STATUS))
    const headers = answerHeaders(answer.headers.get(PAGE_HEADERS), origin, local, jar)
    if (bodiless(request.method, status)) {
      void answer.body?.cancel().catch(() => undefined)
      return new Response(null, { status, headers })
    }
    return new Response(answer.body, { status, headers })
  })
}

/** Which Browser tab a <webview> is, by its address and the session it asked for; null for any other frame. */
export function browserFrameKind(src: string | undefined, partition: string | undefined): BrowserKind | null {
  if (!src) return null
  if (src.startsWith(`${HOST_PAGE_SCHEME}:`)) return partition === HOST_PAGES_PARTITION ? 'host' : null
  if (/^https?:\/\//i.test(src) && partition === WEB_PAGES_PARTITION) return 'web'
  return null
}

/** The kind of Browser tab an attached page is, from its session. */
export function attachedBrowserKind(contents: WebContents): BrowserKind | null {
  if (contents.session === session.fromPartition(HOST_PAGES_PARTITION)) return 'host'
  if (contents.session === session.fromPartition(WEB_PAGES_PARTITION)) return 'web'
  return null
}

/** Where a Browser tab's page may go, and what it may open. */
export function confineBrowserPage(contents: WebContents, kind: BrowserKind): void {
  // A load another one cut short, or a page that couldn't be reached, shows in the tab, not as an unhandled rejection.
  const load = (url: string) => void contents.loadURL(url).catch(() => undefined)
  const go = (url: string, event?: { preventDefault(): void }): void => {
    const where = browserGoes(kind, url, contents.getURL(), isMac)
    if (where === 'stay') return
    event?.preventDefault()
    if (where === 'external') void shell.openExternal(url)
    else if (where !== 'refuse') load(where.load)
  }
  contents.setWindowOpenHandler(({ url }) => {
    // A new window opens in the tab itself: a Browser tab is one page.
    const where = browserGoes(kind, url, contents.getURL(), isMac)
    if (where === 'stay') load(url)
    else if (where === 'external') void shell.openExternal(url)
    else if (where !== 'refuse') load(where.load)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => go(url, event))
  contents.on('will-redirect', (event, url) => go(url, event))
  contents.on('will-frame-navigate', event => {
    if (event.isMainFrame || browserFrameStays(kind, event.url)) return
    event.preventDefault()
  })
}
