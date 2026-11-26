/**
 * Conduit's sign-in window: a dashboard whose first answer is a sign-in page
 * (a login proxy in front of it, such as oauth2-proxy, Google IAP, Authelia
 * or Cloudflare Access without a service token), or a Hermes that only signs
 * in on its own page, is signed in to here, as the phone does in its browser
 * view. The window is an ordinary sandboxed browser page in a session of its
 * own per dashboard address (browserSignInRules.ts): nothing of Conduit's
 * runs in it and it reaches nothing of the app's. Its title names the site
 * on screen, since it has no address bar.
 *
 * Each time a page on the dashboard itself loads, the window's cookies for
 * the dashboard are tried against it (the caller's `signedIn`). Once they
 * pass, the window closes and they are the sign-in.
 */
import { app, BrowserWindow, nativeTheme, session } from 'electron'
import { AuthError, cookieHeader, type CookieJar } from './auth'
import { checkWait, cookieJarOf, isWebPage, lookRequest, pastSignIn, plainUserAgent, signInPartition } from './browserSignInRules'
import { carriesHeaders, type ProxyHeaders } from './proxyHeaders'
import { t } from '../shared/i18n'

/** How often a page that changes without loading another (a sign-in form that posts in place) is looked at again. */
const POLL_MS = 1_500
/** Chromium's code for a load another navigation replaced: not a failure. */
const ERR_ABORTED = -3

export interface SignInWindowOptions {
  url: string
  headers?: ProxyHeaders
  signal: AbortSignal
  /** The cookies to keep when they open the dashboard, null when they don't yet; throws when the dashboard couldn't be asked. */
  signedIn: (jar: CookieJar) => Promise<CookieJar | null>
  parent?: BrowserWindow | null
}

export function openSignInWindow(options: SignInWindowOptions): Promise<CookieJar> {
  const { url, headers, signal, signedIn } = options
  const { promise, resolve, reject } = Promise.withResolvers<CookieJar>()
  const cancelled = () => new AuthError(t('Sign-in was cancelled.'))
  if (signal.aborted) {
    reject(cancelled())
    return promise
  }
  const store = session.fromPartition(signInPartition(url))
  store.setUserAgent(plainUserAgent(store.getUserAgent(), app.getName()))
  // A sign-in page gets no camera, microphone, location or notifications.
  store.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  // The proxy's headers, when it checks some before its page, go to the dashboard's own address only, over HTTPS.
  store.webRequest.onBeforeSendHeaders(headers ? (details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    if (carriesHeaders(details.url, url)) {
      const taken = new Set(Object.keys(requestHeaders).map(name => name.toLowerCase()))
      for (const [name, value] of Object.entries(headers)) if (!taken.has(name.toLowerCase())) requestHeaders[name] = value
    }
    callback({ requestHeaders })
  } : null)

  const window = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 380,
    minHeight: 480,
    show: false,
    title: t('Sign In'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#ffffff',
    autoHideMenuBar: true,
    ...(options.parent && !options.parent.isDestroyed() ? { parent: options.parent } : {}),
    webPreferences: { session: store, contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  const contents = window.webContents
  let finished = false
  let checking = false
  /** The cookies the last look tried, so a page that hasn't changed them isn't asked about again. */
  let tried: string | null = null
  /** Checks in a row that couldn't be made, and until when the timer's looks wait because of them. */
  let failures = 0
  let waitUntil = 0
  /** A page load seen while a check was in flight, to run when it ends. */
  let pendingLook = false
  /** Navigations so far, and how many there were when the check in flight started: a load is new only past it. */
  let loads = 0
  let checkLoads = 0
  const timer = setInterval(() => void look(), POLL_MS)

  const finish = (jar: CookieJar | null, error?: Error): void => {
    if (finished) return
    finished = true
    clearInterval(timer)
    signal.removeEventListener('abort', abort)
    if (!window.isDestroyed()) window.destroy()
    if (jar) resolve(jar)
    else reject(error ?? cancelled())
  }
  const abort = (): void => finish(null)
  signal.addEventListener('abort', abort, { once: true })

  async function look(navigated = false, loadFinished = false): Promise<void> {
    if (finished) return
    // The end of a load a check already started on asks only if its cookies changed, as a timer look does.
    if (loadFinished && !checking && loads === checkLoads) navigated = false
    const request = lookRequest(checking, navigated, pendingLook, loads === checkLoads)
    if (request.pending) pendingLook = true
    // A load during an in-flight check is kept for the look that follows it;
    // a timer look during back-off stays skipped.
    if (checking || request.pending || !request.run && Date.now() < waitUntil) return
    if (request.run && pendingLook) pendingLook = false
    if (window.isDestroyed() || !pastSignIn(contents.getURL(), url)) return
    checking = true
    checkLoads = loads
    try {
      const jar = cookieJarOf(await store.cookies.get({ url: `${url}/` }))
      const header = cookieHeader(jar)
      // A page that loaded is always asked about; between loads, only when its cookies changed.
      if (!request.run && header === tried) return
      tried = header
      const kept = await signedIn(jar)
      failures = 0
      waitUntil = 0
      if (kept) finish(kept)
    } catch {
      // The cookies couldn't be read, or the dashboard couldn't be asked: a later look tries them again.
      tried = null
      failures++
      waitUntil = Date.now() + checkWait(failures, POLL_MS)
    } finally {
      checking = false
      // A load that came while this check ran is looked at now, not at the next tick.
      if (pendingLook) void look()
    }
  }

  // The window has no address bar, so its title is the site on screen, never what the page calls itself.
  const nameSite = (): void => {
    if (window.isDestroyed()) return
    let host = ''
    try {
      host = new URL(contents.getURL()).host
    } catch {
      // No page yet.
    }
    window.setTitle(host ? t('Sign In: {host}', { host }) : t('Sign In'))
  }
  window.on('page-title-updated', event => {
    event.preventDefault()
    nameSite()
  })
  // A provider's pop-up (its account chooser) opens here, in the same session, never as a window of its own.
  contents.setWindowOpenHandler(({ url: target }) => {
    if (isWebPage(target)) void contents.loadURL(target).catch(() => {})
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, target) => {
    if (!isWebPage(target)) event.preventDefault()
  })
  contents.on('did-navigate', () => {
    loads++
    nameSite()
    void look(true)
  })
  contents.on('did-navigate-in-page', () => {
    loads++
    void look(true)
  })
  contents.on('did-finish-load', () => void look(true, true))
  contents.on('did-fail-load', (_event, code, description, _target, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED) return
    finish(null, new AuthError(t('The sign-in page didn’t load ({reason}).', { reason: description || String(code) })))
  })
  window.on('ready-to-show', () => window.show())
  window.on('closed', () => finish(null))
  void contents.loadURL(`${url}/`).catch(() => {
    // did-fail-load reports it.
  })
  return promise
}

/** Clears what the sign-in window kept for a dashboard's address: its cookies and the pages' own storage. */
export function forgetSignInSession(url: string): void {
  void session.fromPartition(signInPartition(url)).clearStorageData().catch(() => {})
}
