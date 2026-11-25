/**
 * Pages Hermes drew (`::preview{file="…"}`, HTML artifacts), after the
 * phone's HTMLPreviewBlock: served from a scheme of their own so they run
 * their own scripts (charts need them) under a policy of their own, while
 * the window's stays strict. A page keeps nothing (an opaque origin in a
 * sandboxed frame), can't reach the app beyond its height, can't fetch, and
 * a link it opens goes to the browser.
 */
import { protocol } from 'electron'
import { randomUUID } from 'node:crypto'

export const PAGE_SCHEME = 'conduit-page'
const MAX_PAGES = 40
const MAX_BYTES = 8 * 1024 * 1024

export const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  'img-src data: blob: https:',
  'font-src data: https:',
  'media-src data: blob: https:'
].join('; ')

/** Reports the page's height to the chat that shows it, and nothing else. */
const HEIGHT_SCRIPT =
  '<script>(()=>{const send=()=>parent.postMessage({conduitPageHeight:Math.ceil(document.documentElement.scrollHeight)},"*");' +
  'addEventListener("load",send);new ResizeObserver(send).observe(document.documentElement)})()</script>'

const pages = new Map<string, string>()

/** Before the app is ready, with the other schemes Conduit serves: Electron keeps only the last call's list. */
export function registerPageScheme(...others: Electron.CustomScheme[]): void {
  protocol.registerSchemesAsPrivileged([{ scheme: PAGE_SCHEME, privileges: { standard: true, secure: true } }, ...others])
}

/** Once the app is ready. */
export function servePages(): void {
  protocol.handle(PAGE_SCHEME, request => {
    const html = pages.get(new URL(request.url).hostname)
    return new Response(html ?? 'Not found', {
      status: html === undefined ? 404 : 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_POLICY, 'Cache-Control': 'no-store' }
    })
  })
}

/** The page's address, with its height reporter added; the oldest is forgotten past 40. */
export function pageUrl(html: unknown): string | null {
  if (typeof html !== 'string' || html.length > MAX_BYTES) return null
  const id = randomUUID()
  pages.set(id, html + HEIGHT_SCRIPT)
  while (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value!)
  return `${PAGE_SCHEME}://${id}/`
}

export const isPageUrl = (url: string) => url.startsWith(`${PAGE_SCHEME}://`)
