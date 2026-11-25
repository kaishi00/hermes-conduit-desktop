/**
 * What Conduit's sign-in window (browserSignIn.ts) decides without a window:
 * where it keeps a dashboard's sign-in, which cookies go to the dashboard,
 * and when a page is worth asking about.
 */
import { createHash } from 'node:crypto'
import { isSignIn, type CookieJar } from './auth'

/**
 * The browser session a dashboard's sign-in window keeps, one per address
 * (scheme, host and port) and apart from the app's own and every other
 * dashboard's: the proxy and its identity provider remember the account
 * there, so signing in again after the proxy's session runs out is one step.
 */
export function signInPartition(url: string): string {
  return `persist:signin-${createHash('sha256').update(new URL(url).origin).digest('hex').slice(0, 24)}`
}

/**
 * The browser's own name without Electron's and the app's: an identity
 * provider that turns away browsers inside apps (Google does) reads this.
 */
export function plainUserAgent(userAgent: string, appName: string): string {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return userAgent
    .replace(/\sElectron\/\S+/g, '')
    .replace(new RegExp(`\\s${escaped}\\/\\S+`, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** The cookies the window holds for the dashboard, as requests send them. A name set twice keeps the one with the longer path, as a browser sends it first. */
export function cookieJarOf(cookies: readonly { name: string; value: string; path?: string }[]): CookieJar {
  const jar: CookieJar = {}
  const depth: Record<string, number> = {}
  for (const cookie of cookies) {
    if (!cookie.name) continue
    const length = cookie.path?.length ?? 0
    if (cookie.name in jar && (depth[cookie.name] ?? 0) >= length) continue
    jar[cookie.name] = cookie.value
    depth[cookie.name] = length
  }
  return jar
}

/** Whether the window's page is the dashboard itself, past every sign-in page: only then are its cookies tried. */
export function pastSignIn(pageUrl: string, dashboardUrl: string): boolean {
  let page: URL
  try {
    page = new URL(pageUrl)
  } catch {
    return false
  }
  if (page.protocol !== 'http:' && page.protocol !== 'https:') return false
  return !isSignIn(pageUrl, dashboardUrl)
}

/** A page the window may show: web pages only. */
export function isWebPage(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** How many failed checks in a row the sign-in window makes at its usual pace before it slows down. */
export const CHECK_FAILURES_AT_PACE = 3
/** The longest it waits between checks of a dashboard that keeps failing them. */
export const CHECK_WAIT_MAX_MS = 30_000

/**
 * How long the sign-in window waits before it asks a dashboard again after
 * `failures` checks in a row couldn't be made (a 502 behind the proxy, a
 * ticket route that answers without a ticket): nothing for the first few,
 * then twice as long each time, up to half a minute (desktop#511). A page
 * that loads is asked about at once whatever this says.
 */
export function checkWait(failures: number, paceMs: number): number {
  if (failures < CHECK_FAILURES_AT_PACE) return 0
  return Math.min(CHECK_WAIT_MAX_MS, paceMs * 2 ** (failures - CHECK_FAILURES_AT_PACE + 1))
}
