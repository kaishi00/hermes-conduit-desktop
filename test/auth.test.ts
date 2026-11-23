import { describe, expect, it } from 'vitest'
import {
  AuthError,
  absorbCookies,
  cookieHeader,
  mintTicket,
  normalizeBaseUrl,
  passwordLogin,
  probeHost,
  readOpenSessionToken,
  signInMethods,
  webSocketUrl,
  type Fetch
} from '../src/main/auth'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

/** A stand-in dashboard: each path answers with its handler; every request is recorded. */
function dashboard(routes: Record<string, Handler>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl: Fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const path = new URL(url).pathname
    const handler = routes[path]
    if (!handler) return new Response('{"detail":"Not Found"}', { status: 404 })
    return handler(url, init)
  }
  return { fetchImpl, calls }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

describe('dashboard addresses', () => {
  it('adds a scheme, keeps a proxy prefix and drops the rest', () => {
    expect(normalizeBaseUrl('hermes.example.com')).toBe('https://hermes.example.com')
    expect(normalizeBaseUrl('192.168.1.20:9119/')).toBe('http://192.168.1.20:9119')
    expect(normalizeBaseUrl('localhost:9119')).toBe('http://localhost:9119')
    expect(normalizeBaseUrl('100.101.5.6:9119')).toBe('http://100.101.5.6:9119')
    expect(normalizeBaseUrl('https://me:pw@example.com/hermes/?x=1#y')).toBe('https://example.com/hermes')
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(AuthError)
    expect(() => normalizeBaseUrl('  ')).toThrow('Enter your dashboard address.')
  })

  it('builds the socket address under the same prefix', () => {
    expect(webSocketUrl('https://example.com/hermes', { ticket: 'a b' })).toBe('wss://example.com/hermes/api/ws?ticket=a+b')
    expect(webSocketUrl('http://127.0.0.1:9119', { token: 't' })).toBe('ws://127.0.0.1:9119/api/ws?token=t')
  })
})

describe('sign-in methods', () => {
  it('reads them from the status', () => {
    expect(signInMethods({ auth_required: false })).toEqual(['open'])
    expect(signInMethods({ auth_required: true, auth_providers: ['basic', 'session-token'] })).toEqual(['password', 'token'])
    expect(signInMethods({ auth_required: true, auth_providers: ['session-token'] })).toEqual(['token'])
    expect(signInMethods({ auth_required: true, auth_providers: ['github'] })).toEqual(['password'])
  })

  it('falls back to /api/status on an older dashboard without provider discovery', async () => {
    const { fetchImpl, calls } = dashboard({ '/api/status': () => json({ version: '0.22.5', auth_required: true, auth_providers: ['basic'] }) })
    expect(await probeHost('example.com', fetchImpl)).toEqual({ ok: true, url: 'https://example.com', methods: ['password'], version: '0.22.5' })
    expect(calls.map(call => call.url)).toEqual(['https://example.com/api/auth/providers', 'https://example.com/api/status'])
  })

  it('accepts an explicit legacy basic provider when older metadata has no password flag', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({ providers: [{ name: 'basic' }] }),
      '/api/status': () => json({ auth_required: true, auth_providers: ['basic'] })
    })
    expect(await probeHost('example.com', fetchImpl)).toMatchObject({ ok: true, methods: ['password'] })
  })

  it('discovers native PKCE before an edge that denies anonymous status', async () => {
    const { fetchImpl, calls } = dashboard({
      '/api/auth/providers': () => json({ providers: [{ name: 'self-hosted', supports_password: false }], auth_flows: ['cookie', 'native_pkce'] }),
      '/api/status': () => json({ error: 'authentication_required' }, { status: 401 })
    })
    expect(await probeHost('example.com', fetchImpl)).toEqual({ ok: true, url: 'https://example.com', methods: ['oidc'], version: undefined })
    expect(calls.map(call => new URL(call.url).pathname)).toEqual(['/api/auth/providers', '/api/status'])
  })

  it('keeps explicitly advertised mixed methods when status is private', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({
        providers: [
          { name: 'self-hosted', supports_password: false },
          { name: 'basic', supports_password: true },
          { name: 'session-token', supports_password: false }
        ],
        auth_flows: ['native_pkce']
      }),
      '/api/status': () => new Response(null, { status: 401 })
    })
    expect(await probeHost('example.com', fetchImpl)).toMatchObject({ ok: true, methods: ['oidc', 'password', 'token'] })
  })

  it('uses provider flows without requiring status to list auth_providers', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({ providers: [{ name: 'self-hosted', supports_password: false }], auth_flows: ['native_pkce'] }),
      '/api/status': () => json({ version: '1.0', auth_required: true })
    })
    expect(await probeHost('example.com', fetchImpl)).toEqual({ ok: true, url: 'https://example.com', methods: ['oidc'], version: '1.0' })
  })

  it('falls back to status flows when provider discovery omits them', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({ providers: [{ name: 'self-hosted', supports_password: false }] }),
      '/api/status': () => json({ status: 'ok', auth_flows: ['cookie', 'native_pkce'] })
    })
    expect(await probeHost('example.com', fetchImpl)).toMatchObject({ ok: true, methods: ['oidc'] })
  })

  it('offers all supported methods on a mixed dashboard', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({
        providers: [{ name: 'basic', supports_password: true }, { name: 'self-hosted', supports_password: false }],
        auth_flows: ['cookie', 'native_pkce']
      }),
      '/api/status': () => json({ auth_required: true, auth_providers: ['basic', 'session-token'] })
    })
    expect(await probeHost('example.com', fetchImpl)).toMatchObject({ ok: true, methods: ['oidc', 'password', 'token'] })
  })

  it('does not offer password when provider metadata says it is unavailable', async () => {
    const providers = { providers: [{ name: 'self-hosted', supports_password: false }] }
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json(providers),
      '/api/status': () => json({ auth_required: true, auth_providers: ['basic'] })
    })
    expect(await probeHost('example.com', fetchImpl)).toEqual({ ok: false, error: 'This dashboard has no sign-in method supported by Conduit.' })
    expect(signInMethods({ auth_required: true, auth_providers: ['session-token'] }, providers)).toEqual(['token'])
  })

  it('treats provider flows as authoritative over stale status flows', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({ providers: [{ name: 'basic', supports_password: true }], auth_flows: ['cookie'] }),
      '/api/status': () => json({ auth_required: true, auth_flows: ['native_pkce'] })
    })
    expect(await probeHost('example.com', fetchImpl)).toMatchObject({ ok: true, methods: ['password'] })
  })

  it('rejects malformed capability metadata instead of silently downgrading', async () => {
    for (const auth_flows of ['native_pkce', ['cookie', 1]]) {
      const { fetchImpl, calls } = dashboard({
        '/api/auth/providers': () => json({ providers: [], auth_flows }),
        '/api/status': () => json({ auth_required: true, auth_providers: ['basic'] })
      })
      expect(await probeHost('example.com', fetchImpl)).toEqual({ ok: false, error: 'This isn’t answering like a Hermes dashboard.' })
      expect(calls).toHaveLength(1)
    }
  })

  it('keeps a discovered native flow when status cannot be reached', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({ providers: [{ name: 'self-hosted', supports_password: false }], auth_flows: ['native_pkce'] }),
      '/api/status': () => { throw new TypeError('fetch failed') }
    })
    expect(await probeHost('example.com', fetchImpl)).toMatchObject({ ok: true, methods: ['oidc'] })
  })

  it('does not follow discovery redirects to a different origin with proxy headers', async () => {
    const { fetchImpl, calls } = dashboard({
      '/hermes/api/auth/providers': () => json({ providers: [{ name: 'self-hosted', supports_password: false }], auth_flows: ['native_pkce'] }),
      '/hermes/api/status': () => new Response(null, { status: 302, headers: { Location: 'https://login.example.org/' } })
    })
    expect(await probeHost('https://example.com/hermes', fetchImpl, { 'X-Proxy-Token': 'secret' })).toMatchObject({ ok: true, methods: ['oidc'] })
    expect(calls.map(call => call.url)).toEqual(['https://example.com/hermes/api/auth/providers', 'https://example.com/hermes/api/status'])
    for (const call of calls) {
      expect(new Headers(call.init.headers).get('X-Proxy-Token')).toBe('secret')
      expect(call.init.redirect).toBe('manual')
    }
  })

  it('keeps an ungated dashboard open even if a native flow is advertised', async () => {
    const { fetchImpl } = dashboard({
      '/api/auth/providers': () => json({ providers: [{ name: 'self-hosted', supports_password: false }], auth_flows: ['native_pkce'] }),
      '/api/status': () => json({ auth_required: false })
    })
    expect(await probeHost('example.com', fetchImpl)).toMatchObject({ ok: true, methods: ['open'] })
  })

  it('says when something else answers', async () => {
    const { fetchImpl } = dashboard({})
    const probe = await probeHost('example.com', fetchImpl)
    expect(probe.ok).toBe(false)
  })

  it('says when nothing answers', async () => {
    const probe = await probeHost('example.com', async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })
    })
    expect(probe).toEqual({ ok: false, error: 'Couldn’t reach example.com (ECONNREFUSED).' })
  })

  it('names the check a network or TLS failure failed, in the phone’s words', async () => {
    const reason = async (fetchImpl: () => Promise<Response>) => {
      const probe = await probeHost('example.com', fetchImpl)
      return probe.ok ? '' : probe.error
    }
    const failing = (code: string) => async (): Promise<Response> => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
    }
    expect(await reason(failing('ECONNREFUSED'))).toMatch(/could not connect to the dashboard at this address/)
    expect(await reason(failing('ENOTFOUND'))).toMatch(/could not find that host/)
    expect(await reason(failing('SELF_SIGNED_CERT_IN_CHAIN'))).toMatch(/doesn’t trust its TLS certificate/)
    expect(await reason(failing('CERT_HAS_EXPIRED'))).toMatch(/expired or not yet valid/)
    expect(await reason(failing('ERR_TLS_CERT_ALTNAME_INVALID'))).toMatch(/isn’t issued for this address/)
  })

  it('points a certificate failure to HTTPS & certificates, and a network failure to Network & reachability', async () => {
    const failing = (code: string) => async (): Promise<Response> => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
    }
    const help = async (code: string) => {
      const probe = await probeHost('https://example.com', failing(code))
      return probe.ok ? 'ok' : probe.help
    }
    expect(await help('SELF_SIGNED_CERT_IN_CHAIN')).toBe('tls')
    expect(await help('CERT_HAS_EXPIRED')).toBe('tls')
    expect(await help('ERR_TLS_CERT_ALTNAME_INVALID')).toBe('tls')
    expect(await help('ENOTFOUND')).toBe('network')
    expect(await help('ECONNREFUSED')).toBe('network')
    expect(await help('ETIMEDOUT')).toBe('network')
    expect(await help('SOMETHING_ELSE')).toBeUndefined()
  })

  it('says a 401 or 403 on the status read is something in front of the dashboard refusing this computer', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = dashboard({ '/api/status': () => new Response('nope', { status }) })
      const probe = await probeHost('example.com', fetchImpl)
      expect(probe.ok ? '' : probe.error).toMatch(/refused this device/)
      expect(probe.ok ? undefined : probe.help).toBe('network')
    }
  })
})

describe('open dashboards', () => {
  it('read the session token from the page', async () => {
    const { fetchImpl } = dashboard({
      '/': () => new Response('<head><script>window.__HERMES_SESSION_TOKEN__="abc_123";window.x=1</script></head>')
    })
    expect(await readOpenSessionToken('http://h', fetchImpl)).toBe('abc_123')
  })

  it('send a gated one to the sign-in', async () => {
    const { fetchImpl } = dashboard({ '/': () => new Response('<head><script>window.__HERMES_AUTH_REQUIRED__=true</script></head>') })
    await expect(readOpenSessionToken('http://h', fetchImpl)).rejects.toThrow('asks for a sign-in')
  })
})

describe('password sign-in', () => {
  it('keeps cookies set along a redirect and mints a ticket with them', async () => {
    const { fetchImpl, calls } = dashboard({
      '/auth/password-login': () =>
        new Response(null, { status: 303, headers: [['Location', '/auth/landing'], ['Set-Cookie', 'hermes_session=s1; Path=/; HttpOnly']] }),
      '/auth/landing': () => json({ ok: true }, { headers: { 'Set-Cookie': 'hermes_csrf=c1; Path=/' } }),
      '/api/auth/ws-ticket': (_url, init) => {
        const cookie = new Headers(init.headers).get('Cookie')
        return cookie === 'hermes_session=s1; hermes_csrf=c1' ? json({ ticket: 'T1', ttl_seconds: 30 }) : json({ detail: 'no' }, { status: 401 })
      }
    })
    const jar = await passwordLogin('https://h', 'eric', 'pw', fetchImpl)
    expect(jar).toEqual({ hermes_session: 's1', hermes_csrf: 'c1' })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ provider: 'basic', username: 'eric', password: 'pw' })
    expect(calls[1]?.init.method).toBe('GET')
    expect(await mintTicket('https://h', jar, fetchImpl)).toEqual({ ticket: 'T1', jar })
  })

  it('says when the password is wrong', async () => {
    const { fetchImpl } = dashboard({ '/auth/password-login': () => json({ detail: 'Invalid credentials' }, { status: 401 }) })
    await expect(passwordLogin('https://h', 'eric', 'bad', fetchImpl)).rejects.toThrow('That user name and password didn’t work.')
  })

  it('says when no cookie came back', async () => {
    const { fetchImpl } = dashboard({ '/auth/password-login': () => json({ ok: true }) })
    await expect(passwordLogin('https://h', 'eric', 'pw', fetchImpl)).rejects.toThrow('no session cookie')
  })

  it('marks a refused ticket as signed out', async () => {
    const { fetchImpl } = dashboard({ '/api/auth/ws-ticket': () => json({ detail: 'Not authenticated' }, { status: 401 }) })
    const error = await mintTicket('https://h', { s: '1' }, fetchImpl).catch(e => e)
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).signedOut).toBe(true)
  })
})

describe('cookies', () => {
  it('drop expired and emptied ones', () => {
    const response = new Response(null, {
      headers: [
        ['Set-Cookie', 'a=; Max-Age=0'],
        ['Set-Cookie', 'b=2; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],
        ['Set-Cookie', 'c=3; Path=/']
      ]
    })
    expect(cookieHeader(absorbCookies({ a: '1', b: '1' }, response))).toBe('c=3')
  })
})

describe('a dashboard behind Cloudflare Access', () => {
  it('says so, and sends the service token only to the dashboard', async () => {
    const access = (url: string) => Object.defineProperty(new Response('<html>login</html>', { status: 200 }), 'url', { value: url })
    const turnedAway = await probeHost('https://hermes.example.com', async () => access('https://team.cloudflareaccess.com/cdn-cgi/access/login'))
    expect(turnedAway).toEqual({ ok: false, help: 'cloudflare', error: 'This dashboard is behind Cloudflare Access. Add its service token under Proxy sign-in.' })

    const seen: [string, string | null][] = []
    const passes = await probeHost(
      'https://hermes.example.com',
      async (input, init) => {
        seen.push([String(input), new Headers(init?.headers).get('CF-Access-Client-Id')])
        return new Response(JSON.stringify({ version: '0.22.5', auth: { providers: ['password'] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
      { 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 'shh' }
    )
    expect(passes).toMatchObject({ ok: true, url: 'https://hermes.example.com' })
    expect(seen).toEqual([
      ['https://hermes.example.com/api/auth/providers', 'id.access'],
      ['https://hermes.example.com/api/status', 'id.access']
    ])
  })
})
