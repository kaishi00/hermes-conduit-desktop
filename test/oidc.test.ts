import { createHash } from 'node:crypto'
import { createServer, request, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OidcError, oidcLogin, refreshOidc, revokeOidc, type OidcGrant } from '../src/main/oidc'

const grant: OidcGrant = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: 1_900_000_000,
  provider: 'self-hosted',
  user_id: 'user-123'
}

interface CallbackResponse {
  status: number
  cacheControl: string | undefined
  text: string
}

function callback(redirect: URL, path: string, method = 'GET', host = redirect.host): Promise<CallbackResponse> {
  const { promise, resolve, reject } = Promise.withResolvers<CallbackResponse>()
  const call = request({
    host: '127.0.0.1', port: redirect.port, path, method, headers: { Host: host }, agent: false
  }, response => {
    const chunks: Buffer[] = []
    response.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
    response.on('end', () => resolve({
      status: response.statusCode ?? 0,
      cacheControl: response.headers['cache-control'],
      text: Buffer.concat(chunks).toString('utf8')
    }))
    response.on('error', reject)
  })
  call.on('error', reject)
  call.end()
  return promise
}

function listen(server: Server): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') reject(new Error('Server did not bind to TCP'))
    else resolve(`http://127.0.0.1:${address.port}`)
  })
  return promise
}

function close(server: Server): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.closeAllConnections()
  server.close(error => error ? reject(error) : resolve())
  return promise
}

afterEach(() => vi.useRealTimers())

describe('native OAuth login', () => {
  it('refuses remote plaintext dashboards before opening the browser or sending credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const open = vi.fn(async () => {})
    await expect(oidcLogin('http://192.168.1.20:9119', fetchImpl, open)).rejects.toThrow('requires HTTPS')
    expect(open).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('cancels a pending browser sign-in and closes its callback listener', async () => {
    const controller = new AbortController()
    let callbackUrl = ''
    const open = async (url: string) => {
      callbackUrl = new URL(url).searchParams.get('redirect_uri')!
      controller.abort()
    }
    await expect(oidcLogin('https://hermes.example', vi.fn<typeof fetch>(), open, controller.signal)).rejects.toThrow('cancelled')
    await expect(fetch(callbackUrl)).rejects.toThrow()
  })

  it('uses a loopback callback and S256 PKCE, rejects probes, and exchanges only the valid code', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init })
      return Response.json(grant)
    }
    const browser: { authorize?: URL; redirect?: URL; work?: Promise<void> } = {}
    const replies: CallbackResponse[] = []
    const result = await oidcLogin('https://dashboard.example/hermes/', fetchImpl, async url => {
      const authorize = new URL(url)
      const redirect = new URL(authorize.searchParams.get('redirect_uri')!)
      browser.authorize = authorize
      browser.redirect = redirect
      const state = authorize.searchParams.get('state')!
      const valid = `/callback?code=one-time-code&state=${encodeURIComponent(state)}`
      browser.work = (async () => {
        replies.push(await callback(redirect!, `/other?code=attacker&state=${state}`))
        replies.push(await callback(redirect!, `/callback/../callback?code=attacker&state=${state}`))
        replies.push(await callback(redirect!, '/callback?code=attacker&state=wrong'))
        replies.push(await callback(redirect!, `${valid}&state=${state}`))
        replies.push(await callback(redirect!, `${valid}&%73tate=${state}`))
        replies.push(await callback(redirect!, `${valid}&code=second`))
        replies.push(await callback(redirect!, `${valid}&unexpected=value`))
        replies.push(await callback(redirect!, `${valid}&error=access_denied`))
        replies.push(await callback(redirect!, `${valid}&`))
        replies.push(await callback(redirect!, `/callback?code=%ZZ&state=${state}`))
        replies.push(await callback(redirect!, valid, 'POST'))
        replies.push(await callback(redirect!, valid, 'GET', 'attacker.example'))
        replies.push(await callback(redirect!, valid))
      })()
      await browser.work
    })
    await browser.work
    const authorize = browser.authorize
    const redirect = browser.redirect

    expect(result).toEqual(grant)
    expect(authorize?.origin).toBe('https://dashboard.example')
    expect(authorize?.pathname).toBe('/hermes/auth/native/authorize')
    expect(authorize?.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize?.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(redirect?.protocol).toBe('http:')
    expect(redirect?.hostname).toBe('127.0.0.1')
    expect(Number(redirect?.port)).toBeGreaterThan(0)
    expect(redirect?.pathname).toBe('/callback')
    expect(replies.map(reply => reply.status)).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 200])
    expect(replies.at(-1)?.cacheControl).toBe('no-store')
    expect(replies.at(-1)?.text).not.toContain('one-time-code')
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://dashboard.example/hermes/auth/native/token')
    expect(requests[0].init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store' })
    const sentHeaders = new Headers(requests[0].init.headers)
    expect(sentHeaders.get('content-type')).toBe('application/json')
    expect(sentHeaders.has('cookie')).toBe(false)
    expect(sentHeaders.has('authorization')).toBe(false)
    const body = JSON.parse(String(requests[0].init.body)) as { code: string; code_verifier: string }
    expect(body.code).toBe('one-time-code')
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorize?.searchParams.get('code_challenge')).toBe(createHash('sha256').update(body.code_verifier).digest('base64url'))
    expect(authorize?.toString()).not.toContain(body.code_verifier)
    expect(authorize?.toString()).not.toContain(grant.refresh_token)
    await expect(callback(redirect!, `/callback?code=another&state=${authorize?.searchParams.get('state')}`)).rejects.toThrow()
  })

  it('ends a login on an OAuth error only when its state matches', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const browser: { work?: Promise<CallbackResponse> } = {}
    const login = oidcLogin('https://dashboard.example', fetchImpl, async url => {
      const authorize = new URL(url)
      const redirect = new URL(authorize.searchParams.get('redirect_uri')!)
      const state = authorize.searchParams.get('state')!
      expect((await callback(redirect, '/callback?error=access_denied&state=wrong')).status).toBe(400)
      browser.work = callback(redirect, `/callback?error=access_denied&state=${state}`)
      await browser.work
    })
    await expect(login).rejects.toThrow('identity provider did not complete sign-in')
    expect((await browser.work)?.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('closes the listener when opening the system browser fails', async () => {
    const browser: { redirect?: URL } = {}
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(oidcLogin('https://dashboard.example', fetchImpl, async url => {
      browser.redirect = new URL(new URL(url).searchParams.get('redirect_uri')!)
      throw new Error('browser launch failed with sensitive detail')
    })).rejects.toThrow('Could not open the sign-in page')
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(callback(browser.redirect!, '/callback?code=x&state=y')).rejects.toThrow()
  })

  it('times out and closes the listener even when the browser opener never returns', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const opened = Promise.withResolvers<URL>()
    const pending = oidcLogin('https://dashboard.example', vi.fn<typeof fetch>(), url => {
      opened.resolve(new URL(new URL(url).searchParams.get('redirect_uri')!))
      return Promise.withResolvers<void>().promise
    })
    const rejected = expect(pending).rejects.toThrow('Sign-in timed out')
    const redirect = await opened.promise
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await rejected
    await expect(callback(redirect, '/callback?code=x&state=y')).rejects.toThrow()
  })
})

describe('native OAuth grant requests', () => {
  it('refreshes with the old handle and preserves the rotated grant and Unix-seconds expiry', async () => {
    const rotated = { ...grant, access_token: 'next-access', refresh_token: 'next-refresh', expires_at: 1_900_000_123.5 }
    const requests: { url: string; init: RequestInit; initiallyAborted: boolean | undefined }[] = []
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init, initiallyAborted: init.signal?.aborted })
      return Response.json({ ...rotated, token_type: 'Bearer' })
    }
    await expect(refreshOidc('https://dashboard.example/proxy', grant, fetchImpl)).resolves.toEqual(rotated)
    const captured = requests[0]
    expect(captured?.url).toBe('https://dashboard.example/proxy/auth/native/refresh')
    expect(JSON.parse(String(captured?.init.body))).toEqual({ refresh_token: 'refresh-token', provider: 'self-hosted' })
    expect(captured?.init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(captured?.initiallyAborted).toBe(false)
    const headers = new Headers(captured?.init.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
  })

  it('accepts an already-expired expiry so the caller can refresh it', async () => {
    const expired = { ...grant, expires_at: 0 }
    await expect(refreshOidc('https://dashboard.example', grant, async () => Response.json(expired))).resolves.toEqual(expired)
  })

  it('revokes using only the refresh handle', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    await revokeOidc('https://dashboard.example/proxy/', grant, async (input, init = {}) => {
      requests.push({ url: String(input), init })
      return new Response(null, { status: 204 })
    })
    const sent = requests[0]
    expect(sent?.url).toBe('https://dashboard.example/proxy/auth/native/revoke')
    expect(JSON.parse(String(sent?.init.body))).toEqual({ refresh_token: grant.refresh_token })
    expect(sent?.init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit' })
  })

  it.each([400, 401, 403, 429, 500, 503, 302])('preserves HTTP %i without exposing response details', async status => {
    let caught: unknown
    try {
      await refreshOidc('https://dashboard.example', grant, async () => new Response('secret server detail', { status }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(OidcError)
    expect(caught).toMatchObject({ status, isRejected: status === 400 || status === 401 })
    expect((caught as Error).message).not.toContain('secret server detail')
    expect((caught as Error).message).not.toContain(grant.refresh_token)
  })

  it('does not expose transport error contents', async () => {
    const failure = refreshOidc('https://dashboard.example', grant, async () => {
      throw new Error(`unsafe transport detail: ${grant.refresh_token}`)
    })
    await expect(failure).rejects.toMatchObject({ name: 'OidcError', status: undefined, isRejected: false })
    await expect(failure).rejects.not.toThrow(grant.refresh_token)
  })

  it.each([
    ['missing access token', { ...grant, access_token: '' }],
    ['unsafe access token', { ...grant, access_token: 'bad\r\nheader' }],
    ['missing refresh token', { ...grant, refresh_token: '' }],
    ['missing provider', { ...grant, provider: ' ' }],
    ['string expiry', { ...grant, expires_at: '1900000000' }],
    ['null user ID', { ...grant, user_id: null }],
    ['wrong token type', { ...grant, token_type: 'MAC' }],
    ['array', []]
  ])('rejects a malformed grant: %s', async (_label, response) => {
    await expect(refreshOidc('https://dashboard.example', grant, async () => Response.json(response)))
      .rejects.toThrow('invalid authentication tokens')
  })

  it('rejects a non-finite numeric expiry and malformed JSON', async () => {
    for (const body of [
      '{"access_token":"a","refresh_token":"b","provider":"c","expires_at":1e999}',
      '{not-json'
    ]) {
      await expect(refreshOidc('https://dashboard.example', grant, async () => new Response(body)))
        .rejects.toThrow('invalid authentication tokens')
    }
  })

  it('accepts a grant without an optional user ID', async () => {
    const withoutUser = {
      access_token: grant.access_token, refresh_token: grant.refresh_token,
      expires_at: grant.expires_at, provider: grant.provider
    }
    await expect(refreshOidc('https://dashboard.example', grant, async () => Response.json(withoutUser)))
      .resolves.toEqual(withoutUser)
  })

  it('limits streamed and declared response sizes', async () => {
    let cancelled = false
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)) },
      cancel() { cancelled = true }
    })
    await expect(refreshOidc('https://dashboard.example', grant, async () => new Response(oversized)))
      .rejects.toThrow('too large')
    expect(cancelled).toBe(true)
    await expect(refreshOidc('https://dashboard.example', grant, async () => new Response('small', {
      headers: { 'content-length': String(64 * 1024 + 1) }
    }))).rejects.toThrow('too large')
  })

  it('bounds the full response read and cancels an incomplete stream', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let cancelled = false
    const captured: { signal?: AbortSignal | null } = {}
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const pending = refreshOidc('https://dashboard.example', grant, async (_input, init) => {
      captured.signal = init?.signal
      return new Response(stream)
    })
    const rejected = expect(pending).rejects.toThrow('request timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(captured.signal?.aborted).toBe(true)
    expect(cancelled).toBe(true)
  })

  it('bounds revoke separately even if the transport ignores its abort signal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const captured: { signal?: AbortSignal | null } = {}
    const pending = revokeOidc('https://dashboard.example', grant, (_input, init) => {
      captured.signal = init?.signal
      return Promise.withResolvers<Response>().promise
    })
    const rejected = expect(pending).rejects.toThrow('request timed out')
    await vi.advanceTimersByTimeAsync(3_000)
    await rejected
    expect(captured.signal?.aborted).toBe(true)
  })

  it.each([
    'https://name:password@dashboard.example',
    'https://dashboard.example/?other=secret',
    'https://dashboard.example/#fragment',
    'file:///tmp/dashboard'
  ])('does not send credentials to an invalid base URL: %s', async baseUrl => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(refreshOidc(baseUrl, grant, fetchImpl)).rejects.toThrow('Invalid dashboard address')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never forwards a refresh token through an HTTP redirect', async () => {
    let redirectedRequests = 0
    const destination = createServer((_request, response) => {
      redirectedRequests++
      response.end('unexpected')
    })
    const destinationUrl = await listen(destination)
    const dashboard = createServer((incoming, response) => {
      incoming.resume()
      response.writeHead(307, { Location: `${destinationUrl}/collect` })
      response.end()
    })
    const dashboardUrl = await listen(dashboard)
    try {
      await expect(refreshOidc(dashboardUrl, grant, fetch)).rejects.toMatchObject({ status: 307, isRejected: false })
      expect(redirectedRequests).toBe(0)
    } finally {
      await Promise.all([close(dashboard), close(destination)])
    }
  })
})
