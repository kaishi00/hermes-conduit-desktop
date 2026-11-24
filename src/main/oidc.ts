/// <reference lib="es2024.promise" />
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { t } from '../shared/i18n'

export interface OidcGrant {
  access_token: string
  /** Refresh handle; '' on access-token-only sessions (the dashboard issued none). */
  refresh_token: string
  /** Unix seconds, as returned by the dashboard. */
  expires_at: number
  provider: string
  user_id?: string
}

/** HTTP status is retained so a rejected refresh is distinct from an outage. */
export class OidcError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'OidcError'
  }

  get isRejected(): boolean {
    return this.status === 400 || this.status === 401
  }
}

const LOGIN_TIMEOUT_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const REVOKE_TIMEOUT_MS = 3_000
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_CALLBACK_HEADERS_BYTES = 16 * 1024
const CALLBACK_SOCKET_TIMEOUT_MS = 10_000

/** Keep a reverse-proxy path prefix, but never send a grant to URL userinfo or a redirect. */
function nativeEndpoint(baseUrl: string, path: string): URL {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new OidcError(t('Invalid dashboard address.'))
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new OidcError(t('Invalid dashboard address.'))
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new OidcError(t('Browser sign-in requires HTTPS, except on this computer.'))
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  url.search = ''
  url.hash = ''
  return url
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseGrant(value: unknown): OidcGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OidcError(t('The dashboard returned invalid authentication tokens.'))
  }
  const row = value as Record<string, unknown>
  if (
    !nonEmptyString(row.access_token) || !/^[\x21-\x7e]+$/.test(row.access_token) ||
    typeof row.refresh_token !== 'string' || !nonEmptyString(row.provider) ||
    typeof row.expires_at !== 'number' || !Number.isFinite(row.expires_at) ||
    (row.user_id !== undefined && typeof row.user_id !== 'string') ||
    (row.token_type !== undefined && (typeof row.token_type !== 'string' || row.token_type.toLowerCase() !== 'bearer'))
  ) {
    throw new OidcError(t('The dashboard returned invalid authentication tokens.'))
  }
  const grant: OidcGrant = {
    access_token: row.access_token,
    // A handle that trims to nothing is no handle: an IdP that withheld one (or wrote blanks)
    // leaves an access-token-only session, and the next refresh says "sign in again" instead of
    // taking a round-trip the dashboard can only refuse (issue 436).
    refresh_token: row.refresh_token.trim() ? row.refresh_token : '',
    expires_at: row.expires_at,
    provider: row.provider
  }
  if (typeof row.user_id === 'string') grant.user_id = row.user_id
  return grant
}

/** A stored grant as it was saved, or nothing when it no longer reads as one (a damaged file): the host asks to sign in again. */
export function storedGrant(value: unknown): OidcGrant | undefined {
  try {
    return parseGrant(value)
  } catch {
    return undefined
  }
}

function discardResponse(response: Response): void {
  if (response.body) void response.body.cancel().catch(() => undefined)
}

async function readGrant(response: Response, signal: AbortSignal): Promise<OidcGrant> {
  const declared = response.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    discardResponse(response)
    throw new OidcError(t('The dashboard authentication response was too large.'))
  }
  if (!response.body) throw new OidcError(t('The dashboard returned invalid authentication tokens.'))

  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        cancel()
        throw new OidcError(t('The dashboard authentication response was too large.'))
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  try {
    return parseGrant(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown)
  } catch (error) {
    if (error instanceof OidcError) throw error
    throw new OidcError(t('The dashboard returned invalid authentication tokens.'))
  }
}

/** Only the explicit JSON body goes to the dashboard. Never follow a 3xx with credentials. */
async function postNative(
  baseUrl: string,
  path: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  returnsGrant: boolean
): Promise<OidcGrant | undefined> {
  const url = nativeEndpoint(baseUrl, path)
  const controller = new AbortController()
  const { promise: deadline, reject: rejectDeadline } = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    rejectDeadline(new OidcError(t('The dashboard authentication request timed out.')))
    controller.abort()
  }, timeoutMs)
  const request = async (): Promise<OidcGrant | undefined> => {
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    })
    if (controller.signal.aborted) {
      discardResponse(response)
      throw new OidcError(t('The dashboard authentication request timed out.'))
    }
    if (!response.ok) {
      discardResponse(response)
      throw new OidcError(t('Dashboard authentication failed (HTTP {status}).', { status: response.status }), response.status)
    }
    if (returnsGrant) return readGrant(response, controller.signal)
    discardResponse(response)
    return undefined
  }
  try {
    return await Promise.race([request(), deadline])
  } catch (error) {
    if (error instanceof OidcError) throw error
    // Transport errors can contain request URLs or bodies. Never expose those to callers.
    throw new OidcError(t('Could not complete the dashboard authentication request.'))
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

type Callback = { code: string } | { rejected: true } | null

/** Accept only the exact callback target and one instance of each supported OAuth parameter. */
function callbackTarget(target: string, expectedState: string): Callback {
  const question = target.indexOf('?')
  if (question < 0 || target.slice(0, question) !== '/callback' || /[#\\\x00-\x20\x7f]/.test(target)) return null
  const query = target.slice(question + 1)
  const params = new Map<string, string>()
  for (const part of query.split('&')) {
    const equals = part.indexOf('=')
    if (equals < 1) return null
    let name: string
    let value: string
    try {
      name = decodeURIComponent(part.slice(0, equals).replace(/\+/g, ' '))
      value = decodeURIComponent(part.slice(equals + 1).replace(/\+/g, ' '))
    } catch {
      return null
    }
    if (!['state', 'code', 'error', 'error_description', 'error_uri'].includes(name) || params.has(name)) return null
    if (/[\x00-\x1f\x7f]/.test(value)) return null
    params.set(name, value)
  }
  const receivedState = Buffer.from(params.get('state') ?? '', 'utf8')
  const state = Buffer.from(expectedState, 'utf8')
  if (receivedState.length !== state.length || !timingSafeEqual(receivedState, state)) return null
  const code = params.get('code')
  const error = params.get('error')
  if (error && !params.has('code')) return { rejected: true }
  if (!code || error !== undefined || params.has('error_description') || params.has('error_uri')) return null
  return { code }
}

function reply(response: ServerResponse, status: number, message: string): void {
  const safeMessage = message.replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  )
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close'
  })
  response.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conduit</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #151418; color: #f5f3ef; }
  body { min-height: 100vh; min-height: 100dvh; margin: 0; display: grid; place-items: center; }
  main { box-sizing: border-box; width: min(90vw, 440px); padding: 40px; border: 1px solid #484038;
    border-radius: 24px; background: #211e20; box-shadow: 0 20px 70px #0005; }
  .mark { width: 40px; height: 4px; border-radius: 4px; background: #d9a944; }
  h1 { margin: 24px 0 12px; font-size: 1.5rem; letter-spacing: -.02em; }
  p { margin: 0; color: #c8c2ba; line-height: 1.6; }
</style></head><body><main><div class="mark" aria-hidden="true"></div><h1>Conduit</h1><p>${safeMessage}</p></main></body></html>`)
}

/** The listener owns its deadline, browser failure, and every accepted socket. */
function receiveCode(
  authorizeUrl: URL,
  state: string,
  openExternal: (url: string) => Promise<void>,
  signal?: AbortSignal
): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const sockets = new Set<Socket>()
  let finished = false
  let port = 0
  const server = createServer({ maxHeaderSize: MAX_CALLBACK_HEADERS_BYTES }, (request, response) => {
    if (finished) {
      response.destroy()
      return
    }
    const hostCount = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'host').length
    if (
      request.method !== 'GET' || request.headers.host !== `127.0.0.1:${port}` || hostCount !== 1 ||
      request.headers['transfer-encoding'] !== undefined ||
      (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')
    ) {
      reply(response, 400, t('Invalid sign-in response.'))
      return
    }
    const callback = callbackTarget(request.url ?? '', state)
    if (!callback) {
      // Other local processes and browser probes cannot cancel the real login.
      reply(response, 400, t('Invalid sign-in response.'))
    } else if ('rejected' in callback) {
      reply(response, 400, t('Sign-in was not completed. You can return to Conduit.'))
      finish(new OidcError(t('The identity provider did not complete sign-in.')), undefined, request.socket)
    } else {
      reply(response, 200, t('Sign-in response received. Return to Conduit to finish.'))
      finish(undefined, callback.code, request.socket)
    }
  })
  server.maxConnections = 16
  server.maxRequestsPerSocket = 1
  server.on('connection', socket => {
    sockets.add(socket)
    socket.setTimeout(CALLBACK_SOCKET_TIMEOUT_MS, () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  server.on('error', () => finish(new OidcError(t('Could not start the sign-in callback.'))))
  const timer = setTimeout(() => finish(new OidcError(t('Sign-in timed out. Please try again.'))), LOGIN_TIMEOUT_MS)
  const cancel = () => finish(new OidcError(t('Sign-in was cancelled.')))

  function finish(error?: OidcError, code?: string, respondingSocket?: Socket): void {
    if (finished) return
    finished = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    server.close()
    for (const socket of sockets) {
      if (socket !== respondingSocket) socket.destroy()
    }
    if (error) reject(error)
    else if (code !== undefined) resolve(code)
    else reject(new OidcError(t('Could not receive the sign-in response.')))
  }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) {
    cancel()
    return promise
  }


  try {
    server.listen(0, '127.0.0.1', () => {
      if (finished) {
        server.close()
        return
      }
      const address = server.address()
      if (!address || typeof address === 'string') {
        finish(new OidcError(t('Could not start the sign-in callback.')))
        return
      }
      port = address.port
      authorizeUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${port}/callback`)
      // The browser opener itself may reject or never return; neither bypasses the deadline.
      void Promise.resolve().then(() => openExternal(authorizeUrl.toString())).catch(() => {
        finish(new OidcError(t('Could not open the sign-in page.')))
      })
    })
  } catch {
    finish(new OidcError(t('Could not start the sign-in callback.')))
  }
  return promise
}

export async function oidcLogin(
  baseUrl: string,
  fetchImpl: typeof fetch,
  openExternal: (url: string) => Promise<void>,
  signal?: AbortSignal
): Promise<OidcGrant> {
  const authorizeUrl = nativeEndpoint(baseUrl, '/auth/native/authorize')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  const state = randomBytes(32).toString('base64url')
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('state', state)
  const code = await receiveCode(authorizeUrl, state, openExternal, signal)
  return (await postNative(baseUrl, '/auth/native/token', { code, code_verifier: verifier }, fetchImpl, REQUEST_TIMEOUT_MS, true))!
}

export async function refreshOidc(baseUrl: string, grant: OidcGrant, fetchImpl: typeof fetch): Promise<OidcGrant> {
  if (!grant.refresh_token) {
    // Access-token-only session (the dashboard issued no refresh token — an IdP like
    // Authentik 2024.2+ withholds one without offline_access): the dashboard's refresh
    // endpoint requires a refresh token, so mirror its rejection and let the caller
    // clear the grant for re-login instead of a doomed round-trip.
    throw new OidcError(t('Your browser sign-in has expired. Sign in again.'), 400)
  }
  return (await postNative(baseUrl, '/auth/native/refresh', {
    refresh_token: grant.refresh_token,
    provider: grant.provider
  }, fetchImpl, REQUEST_TIMEOUT_MS, true))!
}

/** Hermes' session refresh cookie, which `/auth/logout` reads (the bare name, or its `__Host-` and `__Secure-` forms). */
const REFRESH_COOKIE = 'hermes_session_rt'
const LOGOUT_PATH = '/auth/logout'

/** Whether the handle can travel as a cookie value unchanged: visible ASCII without `"`, `,`, `;` or `\`. */
function cookieSafe(token: string): boolean {
  return /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(token)
}

/**
 * Whether `/auth/logout`'s answer means Hermes took it. Hermes answers with a
 * redirect to its own sign-in page; a redirect anywhere else is something in
 * front of it that never passed the request on. A server without the route
 * (404, 405) has nothing to revoke with, so there is nothing more to do.
 */
function logoutTaken(status: number, location: string | null, url: URL): boolean {
  if ((status >= 200 && status < 300) || status === 404 || status === 405) return true
  if (status < 300 || status >= 400 || !location) return false
  let target: URL
  try {
    target = new URL(location, url)
  } catch {
    return false
  }
  return target.origin === url.origin && target.pathname === `${url.pathname.slice(0, -LOGOUT_PATH.length)}/login`
}

/**
 * Ends the sign-in on Hermes too, so the refresh handle stops working at the
 * identity provider and not only on this computer. Hermes has no revoke
 * route for a native sign-in: its public `POST /auth/logout` revokes the
 * refresh token it reads from the session cookie, with every provider, so
 * the handle goes as that cookie, as the phone sends it (hermes-conduit#889).
 * Nothing else is sent, and a redirect is never followed. The caller clears
 * local credentials even if this best-effort request fails.
 */
export async function revokeOidc(baseUrl: string, grant: OidcGrant, fetchImpl: typeof fetch): Promise<void> {
  if (!grant.refresh_token || !cookieSafe(grant.refresh_token)) return
  const url = nativeEndpoint(baseUrl, LOGOUT_PATH)
  const controller = new AbortController()
  const { promise: deadline, reject: rejectDeadline } = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    rejectDeadline(new OidcError(t('The dashboard authentication request timed out.')))
    controller.abort()
  }, REVOKE_TIMEOUT_MS)
  const request = async (): Promise<void> => {
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${grant.refresh_token}`, Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    })
    discardResponse(response)
    if (controller.signal.aborted) throw new OidcError(t('The dashboard authentication request timed out.'))
    if (!logoutTaken(response.status, response.headers.get('location'), url)) {
      throw new OidcError(t('Dashboard authentication failed (HTTP {status}).', { status: response.status }), response.status)
    }
  }
  try {
    await Promise.race([request(), deadline])
  } catch (error) {
    if (error instanceof OidcError) throw error
    // Transport errors can contain request URLs or headers. Never expose those to callers.
    throw new OidcError(t('Could not complete the dashboard authentication request.'))
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
