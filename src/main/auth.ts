/**
 * Signing in to a Hermes dashboard, the way the phone app does it.
 *
 * - `open`: a dashboard without its sign-in gate (on the same machine or a
 *   trusted network) prints its session token into `/`; the socket takes it as
 *   `?token=`.
 * - `password`: `POST /auth/password-login` sets session cookies, which mint a
 *   single-use ticket (`POST /api/auth/ws-ticket`) for each socket.
 * - `token`: a gated dashboard that takes Hermes' session token as a sign-in
 *   (`HERMES_DASHBOARD_SESSION_TOKEN`); the socket takes it as `?token=`.
 * - `oidc`: a native PKCE flow opens the system browser and exchanges its
 *   one-time code for a dashboard grant.
 * - `browser`: a login proxy in front of the dashboard (oauth2-proxy, Google
 *   IAP, Authelia, Cloudflare Access without a service token), or a Hermes
 *   whose only sign-in is its own page, is signed in to in Conduit's sign-in
 *   window (browserSignIn.ts), as the phone does in its browser view. The
 *   window's cookies go with every request and socket, and say what is behind
 *   them at each dial: an ungated Hermes' session token, or a ticket.
 *
 * Everything here takes its `fetch` as an argument so the tests can stand in
 * for a dashboard.
 */
import type { HostProbe, SignInMethod } from '../shared/ipc'
import { t } from '../shared/i18n'
import { httpsIssue, proxyFetch, type ProxyHeaders } from './proxyHeaders'
import { accessDeniedMessage, connectionFailureKind, connectionFailureMessage, troubleshootingTopic } from './connectionFailure'

export type Fetch = typeof fetch

/** The header that tells the Conduit plugin a socket is Conduit's, not Hermes Desktop's (notifier #454). */
export const CONDUIT_CLIENT_HEADER = 'X-Conduit-Client'

/** How REST calls carry Hermes' session token. */
export const SESSION_TOKEN_HEADER = 'X-Hermes-Session-Token'

const SESSION_TOKEN_PROVIDER = 'session-token'
const PASSWORD_PROVIDER = 'basic'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AuthError'
  }

  /** The dashboard says we're signed out: the cookies or token stopped working. */
  get signedOut(): boolean {
    return this.status === 401 || this.status === 403
  }
}

/**
 * Turns what someone typed into a dashboard base address: a scheme (http for
 * this machine and private addresses, https otherwise), no trailing slash,
 * query or fragment. A path prefix (a reverse proxy's `/hermes`) is kept.
 */
export function normalizeBaseUrl(input: string): string {
  let text = input.trim()
  if (!text) throw new AuthError(t('Enter your dashboard address.'))
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const host = text.split(/[/:]/)[0]?.toLowerCase() ?? ''
    text = `${isLocalHost(host) ? 'http' : 'https'}://${text}`
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new AuthError(t('That doesn’t look like a web address.'))
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AuthError(t('Use an http or https address.'))
  }
  url.hash = ''
  url.search = ''
  url.username = ''
  url.password = ''
  return url.toString().replace(/\/+$/, '')
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) // Tailscale
  )
}

export function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

export function webSocketUrl(baseUrl: string, query: Record<string, string>, path = '/api/ws'): string {
  const url = new URL(endpoint(baseUrl, path))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  return url.toString()
}

async function timedFetch(fetchImpl: Fetch, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    // A network or TLS failure in the phone's words, named by the check that failed.
    const kind = connectionFailureKind(error)
    if (kind) throw Object.assign(new AuthError(connectionFailureMessage(kind)), { kind })
    const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : ''
    throw new AuthError(reason ? t('Couldn’t reach {host} ({reason}).', { host: new URL(url).host, reason }) : t('Couldn’t reach {host}.', { host: new URL(url).host }))
  }
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; error?: unknown; message?: unknown }
    const detail = body.detail ?? body.error ?? body.message
    if (typeof detail === 'string' && detail) return detail
  } catch {
    // Not JSON.
  }
  return `HTTP ${response.status}`
}

/** Fetch discovery without following a redirect off the dashboard with proxy headers. */
async function discoveryFetch(fetchImpl: Fetch, url: string): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await timedFetch(fetchImpl, current, { headers: { Accept: 'application/json' }, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      if (hop > 0) redirectedAnswers.add(response)
      return response
    }
    const next = new URL(location, current)
    if (next.origin !== new URL(url).origin) return response
    current = next.toString()
  }
  throw new AuthError(t('The dashboard redirected too many times.'))
}

/** Discovery answers that came through a redirect on the dashboard's own origin. */
const redirectedAnswers = new WeakSet<Response>()

/**
 * A sign-in page's path on the dashboard's own origin, as the phone decides
 * it (DashboardSignInRedirect.isSignInPath): a sign-in segment (Hermes'
 * `/login`, `/signin`, `/sign_in`, `/sign-in`, under any base path) or an auth
 * proxy's start (`/oauth2/start`). Whole segments only.
 */
export function isSignInPath(path: string): boolean {
  const segments = path.toLowerCase().split('/').filter(Boolean)
  if (segments.some(segment => ['login', 'signin', 'sign_in', 'sign-in'].includes(segment))) return true
  return segments.some((segment, index) => segment === 'oauth2' && segments[index + 1] === 'start')
}

/** Whether `target`, a page or a redirect's target for the dashboard at `baseUrl`, is a sign-in: any web address on another origin, or a sign-in page on its own. */
export function isSignIn(target: string, baseUrl: string): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.origin !== new URL(baseUrl).origin || isSignInPath(url.pathname)
}

/**
 * An unauthenticated read answered by a sign-in in the dashboard's place: a
 * redirect to one, a 401, or a refusal that is a web page. Something in front
 * of the dashboard wants a person to sign in on its page first.
 */
function signInAnswered(response: Response, requested: string, baseUrl: string): boolean {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) return false
    try {
      return isSignIn(new URL(location, response.url || requested).toString(), baseUrl)
    } catch {
      return false
    }
  }
  if (response.status === 401) return true
  return response.status === 403 && /^text\/html\b/i.test(response.headers.get('content-type') ?? '')
}

function signInPageAnswer(url: string): HostProbe {
  return { ok: false, error: t('This dashboard is behind a sign-in page. Sign in on that page to continue.'), browser: url }
}

function malformedAuthFlows(body: Record<string, unknown>): boolean {
  return Object.hasOwn(body, 'auth_flows') &&
    (!Array.isArray(body.auth_flows) || body.auth_flows.some(flow => typeof flow !== 'string'))
}

/** Reads public provider discovery and status to find the dashboard's sign-in methods. */
/** `headers`, for a proxy in front of the dashboard, go only to its own address over HTTPS. */
export async function probeHost(input: string, fetchImpl: Fetch, headers?: ProxyHeaders): Promise<HostProbe> {
  let url: string
  try {
    url = normalizeBaseUrl(input)
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
  const insecure = httpsIssue(url, headers)
  if (insecure) return { ok: false, error: insecure }
  try {
    const scopedFetch = proxyFetch(fetchImpl, url, headers)
    const discovery = await discoveryFetch(scopedFetch, endpoint(url, '/api/auth/providers'))
    if (behindCloudflareAccess(discovery)) {
      return {
        ok: false,
        help: 'cloudflare',
        error: headers
          ? t('Cloudflare Access turned this computer away. Check the service token under Proxy sign-in.')
          : t('This dashboard is behind Cloudflare Access. Add its service token under Proxy sign-in, or sign in on its page.'),
        ...(headers ? {} : { browser: url })
      }
    }
    const discovered = discovery.ok ? await discovery.json().catch(() => null) : null
    const metadata = discovered && typeof discovered === 'object' && !Array.isArray(discovered)
      ? discovered as Record<string, unknown>
      : null
    if (metadata && malformedAuthFlows(metadata)) {
      return { ok: false, error: t('This isn’t answering like a Hermes dashboard.') }
    }
    const native = Array.isArray(metadata?.auth_flows) && metadata.auth_flows.includes('native_pkce')
    const result = (status: Record<string, unknown>): HostProbe => {
      const methods = signInMethods(status, metadata)
      return methods.length
        ? { ok: true, url, methods, version: typeof status.version === 'string' ? status.version : undefined }
        : { ok: false, error: t('This dashboard has no sign-in method supported by Conduit.') }
    }

    // Status also lists session-token, which is not in the provider list. A
    // native-enabled edge can expose discovery while denying anonymous status.
    let response: Response
    try {
      response = await discoveryFetch(scopedFetch, endpoint(url, '/api/status'))
    } catch (error) {
      if (native) return result({ auth_required: true })
      throw error
    }
    if (behindCloudflareAccess(response)) {
      return {
        ok: false,
        help: 'cloudflare',
        error: headers
          ? t('Cloudflare Access turned this computer away. Check the service token under Proxy sign-in.')
          : t('This dashboard is behind Cloudflare Access. Add its service token under Proxy sign-in, or sign in on its page.'),
        ...(headers ? {} : { browser: url })
      }
    }
    if (!response.ok && native) return result({ auth_required: true })
    const statusUrl = endpoint(url, '/api/status')
    // A redirect to a sign-in page: a login proxy in front of the dashboard owns the first step, as on the phone.
    if (response.status >= 300 && response.status < 400 && signInAnswered(response, statusUrl, url)) return signInPageAnswer(url)
    // No credentials went with this read, so a 401 or 403 is something in front of the dashboard turning this computer away.
    // One that has a page to sign in on (a 401, or a refusal that is a page) can be passed in the sign-in window.
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: accessDeniedMessage(), help: 'network', ...(signInAnswered(response, statusUrl, url) ? { browser: url } : {}) }
    }
    // A web page where Hermes' status should be may be a sign-in page answered in its place, so the sign-in window is offered with the error.
    if (!response.ok) {
      const page = /^text\/html\b/i.test(response.headers.get('content-type') ?? '')
      return { ok: false, error: t('This isn’t answering like a Hermes dashboard ({detail}).', { detail: await errorDetail(response) }), ...(page ? { browser: url } : {}) }
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      if (native) return result({ auth_required: true })
      // A page reached through a redirect on the dashboard's own origin is a sign-in portal there (a forward-auth gate).
      if (redirectedAnswers.has(response)) return signInPageAnswer(url)
      const page = /^text\/html\b/i.test(response.headers.get('content-type') ?? '')
      return { ok: false, error: t('This isn’t answering like a Hermes dashboard.'), ...(page ? { browser: url } : {}) }
    }
    if ((!metadata || !Object.hasOwn(metadata, 'auth_flows')) && malformedAuthFlows(body)) {
      return { ok: false, error: t('This isn’t answering like a Hermes dashboard.') }
    }
    return result(body)
  } catch (error) {
    // A certificate this computer doesn't trust: offer to read and save its root.
    const kind = (error as { kind?: unknown }).kind
    const untrusted = kind === 'tlsUntrusted' && url.startsWith('https:')
    const help = troubleshootingTopic(kind)
    return { ok: false, error: (error as Error).message, ...(untrusted ? { untrusted: url } : {}), ...(help ? { help } : {}) }
  }
}

/** Cloudflare Access answered instead of Hermes: its login page, or its refusal. */
export function behindCloudflareAccess(response: Response): boolean {
  try {
    if (new URL(response.url).hostname.endsWith('.cloudflareaccess.com')) return true
  } catch {
    // No final address (a test's fake response): judge by the headers.
  }
  const location = response.headers.get('location') ?? ''
  return /\.cloudflareaccess\.com\//.test(location) || (response.status === 403 && response.headers.has('cf-access-domain'))
}

export function signInMethods(status: Record<string, unknown>, metadata?: Record<string, unknown> | null): SignInMethod[] {
  // Provider discovery's flows are authoritative when present; stock Hermes
  // advertises them on status instead.
  const flows = Array.isArray(metadata?.auth_flows) ? metadata.auth_flows : status.auth_flows
  const native = Array.isArray(flows) && flows.includes('native_pkce')
  const discoveredProviders = Array.isArray(metadata?.providers) ? metadata.providers : null
  if (status.auth_required === false || (status.auth_required !== true && !native && !discoveredProviders?.length)) return ['open']
  const providers = Array.isArray(status.auth_providers)
    ? status.auth_providers.filter((p): p is string => typeof p === 'string')
    : []
  const passwordDeclared = discoveredProviders?.some(p => p && typeof p === 'object' && typeof p.supports_password === 'boolean')
  const password = discoveredProviders?.some(p => p && typeof p === 'object' && p.supports_password === true) ||
    (!passwordDeclared && providers.includes(PASSWORD_PROVIDER))
  const methods: SignInMethod[] = []
  if (native) methods.push('oidc')
  if (password) methods.push('password')
  // A provider that signs in on the dashboard's own page, on a Hermes without native sign-in (older than `native_pkce`):
  // Conduit's sign-in window, as the phone's browser view.
  const pageProvider = discoveredProviders?.some(p =>
    p && typeof p === 'object' && typeof p.name === 'string' && p.name !== SESSION_TOKEN_PROVIDER && p.supports_session !== false &&
    (p.supports_password === false || (p.supports_password === undefined && p.name !== PASSWORD_PROVIDER))
  )
  if (!native && pageProvider) methods.push('browser')
  if (providers.includes(SESSION_TOKEN_PROVIDER) || discoveredProviders?.some(p => p && typeof p === 'object' && p.name === SESSION_TOKEN_PROVIDER)) methods.push('token')
  // Only old servers with no provider metadata get the historical password fallback.
  if (methods.length === 0 && !discoveredProviders) methods.push('password')
  return methods
}

/** The session token an ungated dashboard prints into its page. */
export async function readOpenSessionToken(baseUrl: string, fetchImpl: Fetch): Promise<string> {
  const response = await timedFetch(fetchImpl, endpoint(baseUrl, '/'), { headers: { Accept: 'text/html' } })
  if (!response.ok) throw new AuthError(t('The dashboard page didn’t load ({detail}).', { detail: await errorDetail(response) }), response.status)
  const html = await response.text()
  const match = /__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)["']/.exec(html)
  if (!match?.[1]) {
    throw new AuthError(t('This dashboard asks for a sign-in. Try again with your user name and password.'))
  }
  return match[1]
}

/** Cookies as `name → value`, from one host. */
export type CookieJar = Record<string, string>

export function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

/** Takes in a response's `Set-Cookie` headers; an expired or emptied cookie leaves the jar. */
export function absorbCookies(jar: CookieJar, response: Response): CookieJar {
  const next = { ...jar }
  const lines = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const line of lines) {
    const [pair, ...attributes] = line.split(';')
    const eq = pair?.indexOf('=') ?? -1
    if (!pair || eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attributes.some(attr => {
      const [key, raw] = attr.split('=').map(s => s.trim())
      if (key?.toLowerCase() === 'max-age') return Number(raw) <= 0
      if (key?.toLowerCase() === 'expires') return Date.parse(raw ?? '') <= Date.now()
      return false
    })
    if (expired || value === '') delete next[name]
    else next[name] = value
  }
  return next
}

/**
 * Follows redirects ourselves, within the dashboard's own origin, so a
 * cookie set on a redirect isn't lost.
 */
/**
 * `send` makes each request (within the sign-in's own time limit by default).
 * With `stopAtSignIn`, a redirect to a sign-in page on the dashboard's own
 * origin comes back as the answer too, as one to another origin always does.
 */
export async function fetchKeepingCookies(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  jar: CookieJar,
  options: { stopAtSignIn?: boolean; send?: (fetchImpl: Fetch, url: string, init: RequestInit) => Promise<Response> } = {}
): Promise<{ response: Response; jar: CookieJar }> {
  const send = options.send ?? timedFetch
  let current = url
  let cookies = jar
  let request = init
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers = new Headers(request.headers)
    const header = cookieHeader(cookies)
    if (header) headers.set('Cookie', header)
    const response = await send(fetchImpl, current, { ...request, headers, redirect: 'manual' })
    cookies = absorbCookies(cookies, response)
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return { response, jar: cookies }
    const next = new URL(location, current)
    if (next.origin !== new URL(url).origin) return { response, jar: cookies }
    if (options.stopAtSignIn && isSignInPath(next.pathname)) return { response, jar: cookies }
    current = next.toString()
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && request.method === 'POST')) {
      request = { method: 'GET', headers: request.headers, signal: request.signal }
    }
  }
  throw new AuthError(t('The dashboard redirected too many times.'))
}

/** Whether an answer to a request that carried a sign-in window's cookies says they no longer pass: a redirect somewhere (to sign in again) or a 401. */
export function browserSignedOut(response: Response): boolean {
  return (response.status >= 300 && response.status < 400 && response.headers.has('location')) || response.status === 401
}

/**
 * What a sign-in window's cookies open, asked at each dial: the socket's
 * credential (an ungated Hermes' session token read from its page, or a
 * ticket from a gated one) and the cookies as they stand after it. Cookies
 * that no longer pass, at the proxy or at Hermes, throw a signed-out error.
 */
export async function browserSession(
  baseUrl: string,
  jar: CookieJar,
  fetchImpl: Fetch
): Promise<{ query: Record<string, string>; jar: CookieJar; token?: string }> {
  const signedOut = () => new AuthError(t('Your sign-in to this dashboard ran out. Sign in again.'), 401)
  const read = async (path: string, init: RequestInit, cookies: CookieJar) => {
    const answer = await fetchKeepingCookies(fetchImpl, endpoint(baseUrl, path), init, cookies, { stopAtSignIn: true })
    if (browserSignedOut(answer.response)) throw signedOut()
    return answer
  }
  const status = await read('/api/status', { headers: { Accept: 'application/json' } }, jar)
  if (!status.response.ok) {
    throw new AuthError(t('This isn’t answering like a Hermes dashboard ({detail}).', { detail: await errorDetail(status.response) }), status.response.status)
  }
  const body = (await status.response.json().catch(() => null)) as Record<string, unknown> | null
  // A page where the status should be: the proxy's own sign-in, answered in place.
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw signedOut()
  if (body.auth_required === true) {
    const minted = await read('/api/auth/ws-ticket', { method: 'POST', headers: { Accept: 'application/json' } }, status.jar)
    if (!minted.response.ok) {
      throw new AuthError(t('Couldn’t open a connection ({detail}).', { detail: await errorDetail(minted.response) }), minted.response.status)
    }
    const ticket = ((await minted.response.json().catch(() => null)) as { ticket?: unknown } | null)?.ticket
    if (typeof ticket !== 'string' || !ticket.trim()) throw new AuthError(t('The dashboard sent no connection ticket.'))
    return { query: { ticket }, jar: minted.jar }
  }
  const page = await read('/', { headers: { Accept: 'text/html' } }, status.jar)
  if (!page.response.ok) throw new AuthError(t('The dashboard page didn’t load ({detail}).', { detail: await errorDetail(page.response) }), page.response.status)
  const token = /__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)["']/.exec(await page.response.text())?.[1]
  if (!token) throw signedOut()
  return { query: { token }, jar: page.jar, token }
}

export async function passwordLogin(
  baseUrl: string,
  username: string,
  password: string,
  fetchImpl: Fetch
): Promise<CookieJar> {
  const { response, jar } = await fetchKeepingCookies(
    fetchImpl,
    endpoint(baseUrl, '/auth/password-login'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ provider: PASSWORD_PROVIDER, username, password })
    },
    {}
  )
  if (!response.ok) {
    const detail = await errorDetail(response)
    throw new AuthError(
      response.status === 401 ? t('That user name and password didn’t work.') : t('Sign-in failed ({detail}).', { detail }),
      response.status
    )
  }
  if (Object.keys(jar).length === 0) {
    throw new AuthError(t('Signed in, but the dashboard sent no session cookie. Check its address and any proxy in front of it.'))
  }
  return jar
}

/** A single-use socket ticket for the signed-in session, and the cookies as they stand after it. */
export async function mintTicket(
  baseUrl: string,
  jar: CookieJar,
  fetchImpl: Fetch
): Promise<{ ticket: string; jar: CookieJar }> {
  const { response, jar: next } = await fetchKeepingCookies(
    fetchImpl,
    endpoint(baseUrl, '/api/auth/ws-ticket'),
    { method: 'POST', headers: { Accept: 'application/json' } },
    jar
  )
  if (!response.ok) {
    throw new AuthError(t('Couldn’t open a connection ({detail}).', { detail: await errorDetail(response) }), response.status)
  }
  const body = (await response.json().catch(() => null)) as { ticket?: unknown } | null
  if (typeof body?.ticket !== 'string' || !body.ticket.trim()) {
    throw new AuthError(t('The dashboard sent no connection ticket.'))
  }
  return { ticket: body.ticket, jar: next }
}
