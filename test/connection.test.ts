import { describe, expect, it } from 'vitest'
import { Connection, type SavedConnection } from '../src/main/connection'
import type { Fetch } from '../src/main/auth'
import { createHostList } from '../src/main/hosts'
import type { ConnectionStatus, PendingRequest } from '../src/shared/ipc'
import type { WebSocketLike } from '../src/vendor/hermes-shared/json-rpc-gateway'

/** A socket that opens on the next tick and records what's sent. */
class FakeSocket extends EventTarget {
  readyState = 0
  sent: string[] = []
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
    opens = true
  ) {
    super()
    setTimeout(() => {
      if (!opens) {
        this.readyState = 3
        this.dispatchEvent(new Event('error'))
        this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }))
        return
      }
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
      this.serverSends({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { session_authority: true, replay_epoch: 'e1', change_events: true } } })
    }, 0)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }))
  }
  serverSends(frame: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) }))
  }
  serverDrops() {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }))
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const tick = () => new Promise(resolve => setTimeout(resolve, 5))
/** Waits for `done`, up to a second: a busy CI runner can take longer than one tick to open a socket. */
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await tick()
}

function harness(opts: { ticketsBeforeExpiry?: number; hosts?: boolean } = {}) {
  let session = 0
  let tickets = 0
  const log: string[] = []
  const sentHeaders: Headers[] = []
  const fetchImpl: Fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname
    log.push(path)
    sentHeaders.push(new Headers(init.headers))
    if (path === '/auth/password-login') {
      session++
      return json({ ok: true }, 200, { 'Set-Cookie': `hermes_session=s${session}; Path=/` })
    }
    if (path === '/api/auth/ws-ticket') {
      const cookie = new Headers(init.headers).get('Cookie') ?? ''
      tickets++
      if (opts.ticketsBeforeExpiry !== undefined && tickets > opts.ticketsBeforeExpiry && cookie === 'hermes_session=s1') {
        return json({ detail: 'Not authenticated' }, 401)
      }
      return json({ ticket: `T${tickets}` })
    }
    if (path === '/api/profiles/sessions') return json({ sessions: [] })
    return json({ detail: 'Not Found' }, 404)
  }
  const sockets: FakeSocket[] = []
  const statuses: ConnectionStatus[] = []
  let saved: SavedConnection | null = null
  const timers: (() => void)[] = []
  const requests: PendingRequest[][] = []
  const written: { hosts: string[]; active: string | null }[] = []
  const hostList = createHostList((hosts, active) => written.push({ hosts: hosts.map(h => h.url), active }), { hosts: [], active: null })
  const connection = new Connection({
    fetch: fetchImpl,
    store: opts.hosts ? hostList : { load: () => saved, save: s => (saved = { ...s }), clear: () => (saved = null) },
    createSocket: (url, headers) => {
      const socket = new FakeSocket(url, headers)
      sockets.push(socket)
      return socket as unknown as WebSocketLike
    },
    onStatus: s => statuses.push(s),
    onEvent: () => undefined,
    onRequests: list => requests.push(list),
    setTimeout: fn => timers.push(fn),
    clearTimeout: () => undefined
  })
  return { connection, sockets, statuses, log, sentHeaders, timers, requests, saved: () => saved, written, hostList }
}

/** The refresh handle a logout carried, as Hermes reads it: its session cookie. */
const revokedHandle = (init?: RequestInit) => (new Headers(init?.headers).get('cookie') ?? '').replace(/^hermes_session_rt=/, '')

describe('the connection', () => {
  it('restores an OIDC host, rotates an expired grant once, and uses the new bearer for tickets and requests', async () => {
    const url = 'https://hermes.example.com'
    const old = { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: 1, provider: 'self-hosted' }
    const next = { access_token: 'new-access', refresh_token: 'new-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, provider: 'self-hosted' }
    const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
    const requests: { path: string; authorization: string | null }[] = []
    let refreshes = 0
    let socketHeaders: Record<string, string> = {}
    const fetchImpl: Fetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname
      requests.push({ path, authorization: new Headers(init.headers).get('authorization') })
      if (path === '/auth/native/refresh') {
        refreshes++
        return json(next)
      }
      if (path === '/api/auth/ws-ticket') return json({ ticket: 'ticket' })
      return json({ ok: true })
    }
    const connection = new Connection({
      fetch: fetchImpl,
      store,
      createSocket: (socketUrl, headers) => {
        socketHeaders = headers
        return new FakeSocket(socketUrl, headers) as unknown as WebSocketLike
      },
      onStatus: () => {},
      onEvent: () => {}
    })
    await connection.restore()
    await Promise.all([connection.http('GET', '/api/a'), connection.http('GET', '/api/b')])
    expect(refreshes).toBe(1)
    expect(store.get?.(url)?.oidc).toEqual(next)
    expect(requests.filter(r => r.path.startsWith('/api/')).every(r => r.authorization === 'Bearer new-access')).toBe(true)
    expect(socketHeaders.Authorization).toBe('Bearer new-access')
  })
  it('shares a refresh between active and kept connections and persists the rotated grant', async () => {
    const url = 'https://hermes.example.com'
    const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: 1, provider: 'self-hosted' }
    const next = { ...old, access_token: 'new', refresh_token: 'new-refresh', expires_at: Date.now() / 1000 + 3600 }
    const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
    const pinned = { load: () => store.get?.(url) ?? null, save: (s: SavedConnection) => store.update?.(s), clear: () => {} }
    let refreshes = 0
    const response = Promise.withResolvers<Response>()
    const fetchImpl: Fetch = async input => {
      if (new URL(String(input)).pathname === '/auth/native/refresh') {
        refreshes++
        return response.promise
      }
      return json({ ticket: 'ticket' })
    }
    const deps = {
      fetch: fetchImpl,
      createSocket: (address: string, headers: Record<string, string>) => new FakeSocket(address, headers) as unknown as WebSocketLike,
      onStatus: () => {},
      onEvent: () => {}
    }
    const active = new Connection({ ...deps, store })
    const kept = new Connection({ ...deps, store: pinned, oidcStore: store })
    const both = Promise.all([active.restore(), kept.restore()])
    expect(refreshes).toBe(1)
    response.resolve(json(next))
    await both
    expect(store.get?.(url)?.oidc).toEqual(next)
  })

  it('revokes a rotated grant that arrives after sign-out', async () => {
    const url = 'https://hermes.example.com'
    const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: 1, provider: 'self-hosted' }
    const next = { ...old, access_token: 'new', refresh_token: 'new-refresh', expires_at: Date.now() / 1000 + 3600 }
    const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
    const response = Promise.withResolvers<Response>()
    const revoked: string[] = []
    const fetchImpl: Fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === '/auth/native/refresh') return response.promise
      if (path === '/auth/logout') revoked.push(revokedHandle(init))
      return json({})
    }
    const connection = new Connection({
      fetch: fetchImpl, store,
      createSocket: (address, headers) => new FakeSocket(address, headers) as unknown as WebSocketLike,
      onStatus: () => {}, onEvent: () => {}
    })
    const restoring = connection.restore()
    connection.signOut()
    response.resolve(json(next))
    await restoring
    await until(() => revoked.includes('new-refresh'))
    expect(revoked).toEqual(expect.arrayContaining(['old-refresh', 'new-refresh']))
    expect(store.get?.(url)).toBeNull()
  })
  it('uses the newly authenticated account rather than the saved account when signing in again', async () => {
    const url = 'https://hermes.example.com'
    const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: Date.now() / 1000 + 3600, provider: 'self-hosted' }
    const next = { ...old, access_token: 'new', refresh_token: 'new-refresh' }
    const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
    let ticketBearer: string | null = null
    const connection = new Connection({
      store,
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname
        if (path === '/auth/native/token') return json(next)
        if (path === '/api/auth/ws-ticket') ticketBearer = new Headers(init?.headers).get('authorization')
        return json({ ticket: 'ticket' })
      },
      openExternal: async address => {
        const authorize = new URL(address)
        const callback = new URL(authorize.searchParams.get('redirect_uri')!)
        callback.searchParams.set('state', authorize.searchParams.get('state')!)
        callback.searchParams.set('code', 'new-code')
        await fetch(callback)
      },
      createSocket: (address, headers) => new FakeSocket(address, headers) as unknown as WebSocketLike,
      onStatus: () => {}, onEvent: () => {}
    })
    expect(await connection.signIn({ url, method: 'oidc' })).toEqual({ ok: true })
    expect(ticketBearer).toBe('Bearer new')
    expect(store.get?.(url)?.oidc).toEqual(next)
  })
  it('cancels after token exchange while the initial ticket is pending and revokes the new grant', async () => {
    const url = 'https://hermes.example.com'
    const grant = { access_token: 'new', refresh_token: 'new-refresh', expires_at: Date.now() / 1000 + 3600, provider: 'self-hosted' }
    const store = createHostList(() => {}, { hosts: [], active: null })
    const ticket = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    const revoked: string[] = []
    const connection = new Connection({
      store,
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname
        if (path === '/auth/native/token') return json(grant)
        if (path === '/api/auth/ws-ticket') { started.resolve(); return ticket.promise }
        if (path === '/auth/logout') revoked.push(revokedHandle(init))
        return json({})
      },
      openExternal: async address => {
        const authorize = new URL(address)
        const callback = new URL(authorize.searchParams.get('redirect_uri')!)
        callback.searchParams.set('state', authorize.searchParams.get('state')!)
        callback.searchParams.set('code', 'code')
        await fetch(callback)
      },
      createSocket: (address, headers) => new FakeSocket(address, headers) as unknown as WebSocketLike,
      onStatus: () => {}, onEvent: () => {}
    })
    const signingIn = connection.signIn({ url, method: 'oidc' })
    await started.promise
    connection.cancelSignIn()
    ticket.resolve(json({ ticket: 'ticket' }))
    expect(await signingIn).toMatchObject({ ok: false })
    await until(() => revoked.includes('new-refresh'))
    expect(revoked).toContain('new-refresh')
    expect(store.get?.(url)).toBeNull()
  })

  describe('browser sign-in leftovers (#414, #417)', () => {
    const url = 'https://hermes.example.com'
    const fresh = () => Date.now() / 1000 + 3600
    /** The browser coming back with a code, as the system browser's redirect does. */
    const browserReturns = async (address: string) => {
      const authorize = new URL(address)
      const callback = new URL(authorize.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', authorize.searchParams.get('state')!)
      callback.searchParams.set('code', 'code')
      await fetch(callback)
    }
    const sockets = () => {
      const made: FakeSocket[] = []
      return { made, create: (address: string, headers: Record<string, string>) => (made.push(new FakeSocket(address, headers)), made.at(-1) as unknown as WebSocketLike) }
    }

    it('ends the sign-in it replaces on Hermes when the same host signs in again', async () => {
      const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const next = { ...old, access_token: 'new', refresh_token: 'new-refresh' }
      const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
      const revoked: string[] = []
      const connection = new Connection({
        store,
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname
          if (path === '/auth/native/token') return json(next)
          if (path === '/auth/logout') revoked.push(revokedHandle(init))
          return json({ ticket: 'ticket' })
        },
        openExternal: browserReturns,
        createSocket: sockets().create,
        onStatus: () => {}, onEvent: () => {}
      })
      expect(await connection.signIn({ url, method: 'oidc' })).toEqual({ ok: true })
      await until(() => revoked.length > 0)
      // The displaced grant only: the new one is the sign-in now.
      expect(revoked).toEqual(['old-refresh'])
      expect(store.get?.(url)?.oidc).toEqual(next)
    })

    it("ends the displaced sign-in on Edit Connection, and a removed host's too", async () => {
      const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const other = { access_token: 'o', refresh_token: 'other-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const next = { ...old, access_token: 'new', refresh_token: 'new-refresh' }
      const second = 'https://second.example.com'
      const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }, { url: second, method: 'oidc', oidc: other }], active: url })
      const revoked: string[] = []
      const connection = new Connection({
        store,
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname
          if (path === '/auth/native/token') return json(next)
          if (path === '/auth/logout') revoked.push(`${new URL(String(input)).host} ${revokedHandle(init)}`)
          return json({ ticket: 'ticket' })
        },
        openExternal: browserReturns,
        createSocket: sockets().create,
        onStatus: () => {}, onEvent: () => {}
      })
      await connection.restore()
      expect(await connection.editHost(url, { url, method: 'oidc' })).toEqual({ ok: true, url })
      await until(() => revoked.length > 0)
      expect(revoked).toEqual(['hermes.example.com old-refresh'])
      connection.removeHost(second)
      await until(() => revoked.length > 1)
      expect(revoked).toContain('second.example.com other-refresh')
      expect(store.get?.(second)).toBeNull()
    })

    it('opens the host that was open again when a browser sign-in to another is cancelled', async () => {
      const store = createHostList(() => {}, { hosts: [], active: null })
      const made = sockets()
      const opened = Promise.withResolvers<void>()
      const connection = new Connection({
        store,
        fetch: async () => json({ ticket: 'ticket' }),
        // The browser is out and never comes back.
        openExternal: async () => opened.resolve(),
        createSocket: made.create,
        onStatus: () => {}, onEvent: () => {}
      })
      await connection.signIn({ url: 'https://one.example.com', method: 'token', token: 'a' })
      await until(() => connection.current().phase === 'open')
      const signingIn = connection.signIn({ url, method: 'oidc' })
      await opened.promise
      connection.cancelSignIn()
      expect(await signingIn).toMatchObject({ ok: false })
      await until(() => made.made.length === 2 && made.made[1]!.readyState === 1)
      // A live socket again, not an "open" left over a closed one.
      expect(connection.current()).toMatchObject({ phase: 'open', url: 'https://one.example.com' })
      expect(made.made[0]!.readyState).toBe(3)
      expect(made.made[1]!.readyState).toBe(1)
    })

    it('says signed out when a first sign-in is cancelled after the browser returned', async () => {
      const grant = { access_token: 'new', refresh_token: 'new-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const store = createHostList(() => {}, { hosts: [], active: null })
      const ticket = Promise.withResolvers<Response>()
      const started = Promise.withResolvers<void>()
      const statuses: ConnectionStatus[] = []
      const connection = new Connection({
        store,
        fetch: async input => {
          const path = new URL(String(input)).pathname
          if (path === '/auth/native/token') return json(grant)
          if (path === '/api/auth/ws-ticket') { started.resolve(); return ticket.promise }
          return json({})
        },
        openExternal: browserReturns,
        createSocket: sockets().create,
        onStatus: status => statuses.push(status), onEvent: () => {}
      })
      const signingIn = connection.signIn({ url, method: 'oidc' })
      await started.promise
      expect(connection.current().phase).toBe('connecting')
      connection.cancelSignIn()
      expect(connection.current().phase).toBe('signed-out')
      ticket.resolve(json({ ticket: 'ticket' }))
      expect(await signingIn).toMatchObject({ ok: false })
      expect(connection.current()).toMatchObject({ phase: 'signed-out' })
      expect(connection.current().url).toBeUndefined()
    })

    it('leaves no socket behind when the sign-in is cancelled while its socket connects', async () => {
      const grant = { access_token: 'new', refresh_token: 'new-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const store = createHostList(() => {}, { hosts: [], active: null })
      /** A socket still connecting: it never opens by itself. */
      class HeldSocket extends EventTarget {
        readyState = 0
        send() {}
        close() {
          if (this.readyState === 3) return
          this.readyState = 3
          this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }))
        }
      }
      const made: HeldSocket[] = []
      const connection = new Connection({
        store,
        fetch: async input => (new URL(String(input)).pathname === '/auth/native/token' ? json(grant) : json({ ticket: 'ticket' })),
        openExternal: browserReturns,
        createSocket: () => (made.push(new HeldSocket()), made.at(-1) as unknown as WebSocketLike),
        onStatus: () => {}, onEvent: () => {}
      })
      const signingIn = connection.signIn({ url, method: 'oidc' })
      await until(() => made.length > 0)
      expect(made).toHaveLength(1)
      connection.cancelSignIn()
      expect(await signingIn).toMatchObject({ ok: false })
      await tick()
      expect(made.every(socket => socket.readyState === 3)).toBe(true)
      expect(connection.current().phase).toBe('signed-out')
      expect(store.get?.(url)).toBeNull()
    })

    it('asks to sign in again as soon as a refresh is refused while the host is open', async () => {
      const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
      const made = sockets()
      let refused = false
      const connection = new Connection({
        store,
        fetch: async input => {
          const path = new URL(String(input)).pathname
          if (path === '/auth/native/refresh') return json({ detail: 'revoked' }, 401)
          if (path === '/api/auth/ws-ticket') return json({ ticket: 'ticket' })
          // Hermes stops taking the access token.
          return refused ? json({ detail: 'expired' }, 401) : json({ ok: true })
        },
        createSocket: made.create,
        onStatus: () => {}, onEvent: () => {}
      })
      await connection.restore()
      await until(() => connection.current().phase === 'open')
      refused = true
      await expect(connection.http('GET', '/api/a')).rejects.toThrow('Sign in again')
      expect(connection.current()).toMatchObject({ phase: 'failed', url, error: 'Hermes signed this computer out. Sign in again.' })
      expect(made.made[0]!.readyState).toBe(3)
      expect(store.get?.(url)?.oidc).toBeUndefined()
    })

    it('refreshes once and sends a read again when Hermes refuses the access token', async () => {
      const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const next = { ...old, access_token: 'new', refresh_token: 'new-refresh' }
      const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
      const bearers: (string | null)[] = []
      let refreshes = 0
      const connection = new Connection({
        store,
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname
          if (path === '/auth/native/refresh') { refreshes++; return json(next) }
          if (path === '/api/auth/ws-ticket') return json({ ticket: 'ticket' })
          const bearer = new Headers(init?.headers).get('authorization')
          bearers.push(bearer)
          return bearer === 'Bearer new' ? json({ ok: true }) : json({ detail: 'expired' }, 401)
        },
        createSocket: sockets().create,
        onStatus: () => {}, onEvent: () => {}
      })
      await connection.restore()
      await until(() => connection.current().phase === 'open')
      expect(await connection.http('GET', '/api/a')).toEqual({ ok: true })
      expect(bearers).toEqual(['Bearer old', 'Bearer new'])
      expect(refreshes).toBe(1)
      expect(store.get?.(url)?.oidc).toEqual(next)
      expect(connection.current().phase).toBe('open')
    })

    it('mints the socket ticket again after a refresh when the first bearer is refused', async () => {
      const old = { access_token: 'old', refresh_token: 'old-refresh', expires_at: fresh(), provider: 'self-hosted' }
      const next = { ...old, access_token: 'new', refresh_token: 'new-refresh' }
      const store = createHostList(() => {}, { hosts: [{ url, method: 'oidc', oidc: old }], active: url })
      const tickets: (string | null)[] = []
      const connection = new Connection({
        store,
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname
          if (path === '/auth/native/refresh') return json(next)
          if (path === '/api/auth/ws-ticket') {
            const bearer = new Headers(init?.headers).get('authorization')
            tickets.push(bearer)
            return bearer === 'Bearer new' ? json({ ticket: 'ticket' }) : json({ detail: 'expired' }, 401)
          }
          return json({ ok: true })
        },
        createSocket: sockets().create,
        onStatus: () => {}, onEvent: () => {}
      })
      await connection.restore()
      await until(() => connection.current().phase === 'open')
      expect(tickets).toEqual(['Bearer old', 'Bearer new'])
      expect(connection.current().phase).toBe('open')
    })
  })

  it('signs in with a password and opens the socket with a ticket and the cookie', async () => {
    const h = harness()
    const result = await h.connection.signIn({ url: 'https://hermes.example.com/', method: 'password', username: 'eric', password: 'pw' })
    expect(result).toEqual({ ok: true })
    await tick()
    expect(h.sockets).toHaveLength(1)
    expect(h.sockets[0]!.url).toBe('wss://hermes.example.com/api/ws?ticket=T1')
    expect(h.sockets[0]!.headers).toEqual({ 'X-Conduit-Client': 'conduit', Cookie: 'hermes_session=s1' })
    expect(h.connection.current()).toMatchObject({ phase: 'open', hostLabel: 'hermes.example.com', username: 'eric', sessionAuthority: true })
    expect(h.saved()).toMatchObject({ url: 'https://hermes.example.com', method: 'password', password: 'pw', cookies: { hermes_session: 's1' } })
    // It says it answers server requests, as Hermes' own clients do.
    expect(h.sockets[0]!.sent.some(f => f.includes('client.capabilities'))).toBe(true)
  })

  it('sends a proxy’s headers on every request and the socket, over HTTPS only', async () => {
    const h = harness()
    const headers = { 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 'shh', 'X-Pangolin': 'p' }
    expect(await h.connection.signIn({ url: 'https://hermes.example.com', method: 'password', username: 'eric', password: 'pw', headers })).toEqual({ ok: true })
    await tick()
    for (const sent of h.sentHeaders) {
      expect(sent.get('CF-Access-Client-Id')).toBe('id.access')
      expect(sent.get('X-Pangolin')).toBe('p')
    }
    expect(h.sockets[0]!.headers).toMatchObject({ 'CF-Access-Client-Secret': 'shh', Cookie: 'hermes_session=s1' })
    expect(h.saved()?.headers).toEqual(headers)
    await h.connection.http('GET', '/api/profiles/sessions')
    expect(h.sentHeaders.at(-1)!.get('CF-Access-Client-Secret')).toBe('shh')

    // Plain http never carries them, so it says so rather than dropping them.
    const plain = harness()
    expect(await plain.connection.signIn({ url: 'http://192.168.1.20:9119', method: 'password', username: 'eric', password: 'pw', headers })).toEqual({
      ok: false,
      error: 'Extra headers are only sent over HTTPS. Enter an https:// server address first.'
    })
    expect(plain.log).toEqual([])
  })

  it('refuses headers Conduit sets itself, or half a Cloudflare token', async () => {
    const h = harness()
    expect(await h.connection.signIn({ url: 'https://h', method: 'token', token: 't', headers: { Cookie: 'x' } })).toMatchObject({ ok: false })
    expect(await h.connection.signIn({ url: 'https://h', method: 'token', token: 't', headers: { 'CF-Access-Client-Id': 'id' } })).toMatchObject({
      ok: false,
      error: 'A Cloudflare Access service token needs both its client ID and its secret.'
    })
    expect(await h.connection.signIn({ url: 'https://h', method: 'token', token: 't', headers: { 'Bad Name': 'v' } })).toMatchObject({ ok: false })
    expect(h.saved()).toBeNull()
  })

  it('redials after a drop, signing in again when the session ran out', async () => {
    const h = harness({ ticketsBeforeExpiry: 1 })
    await h.connection.signIn({ url: 'https://h', method: 'password', username: 'eric', password: 'pw' })
    await tick()
    h.sockets[0]!.serverDrops()
    expect(h.connection.current().phase).toBe('reconnecting')
    expect(h.timers).toHaveLength(1)
    h.timers[0]!()
    await tick()
    await tick()
    expect(h.log).toEqual(['/auth/password-login', '/api/auth/ws-ticket', '/api/auth/ws-ticket', '/auth/password-login', '/api/auth/ws-ticket'])
    expect(h.sockets).toHaveLength(2)
    expect(h.sockets[1]!.url).toBe('wss://h/api/ws?ticket=T3')
    expect(h.sockets[1]!.headers.Cookie).toBe('hermes_session=s2')
    expect(h.connection.current().phase).toBe('open')
    expect(h.saved()?.cookies).toEqual({ hermes_session: 's2' })
  })

  it('refuses a wrong password without saving anything', async () => {
    const h = harness()
    const result = await h.connection.signIn({ url: 'https://h', method: 'password', username: 'eric', password: '' })
    expect(result).toEqual({ ok: false, error: 'Enter your user name and password.' })
    expect(h.saved()).toBeNull()
  })

  it('signs out: closes the socket and forgets the sign-in', async () => {
    const h = harness()
    await h.connection.signIn({ url: 'https://h', method: 'token', token: 'tok' })
    await tick()
    expect(h.sockets[0]!.url).toBe('wss://h/api/ws?token=tok')
    h.connection.signOut()
    expect(h.sockets[0]!.readyState).toBe(3)
    expect(h.saved()).toBeNull()
    expect(h.connection.current()).toEqual({ phase: 'signed-out', hosts: [] })
    await expect(h.connection.rpc('session.list')).rejects.toThrow('Not connected')
  })

  it('makes REST calls with the sign-in, only under /api/', async () => {
    const h = harness()
    await h.connection.signIn({ url: 'https://h', method: 'password', username: 'eric', password: 'pw' })
    await expect(h.connection.http('GET', '/api/profiles/sessions?limit=1')).resolves.toEqual({ sessions: [] })
    await expect(h.connection.http('GET', '/auth/logout')).rejects.toThrow('Only dashboard API paths')
  })
})

describe('Needs you requests', () => {
  async function open() {
    const h = harness()
    await h.connection.signIn({ url: 'https://h', method: 'token', token: 'tok' })
    await tick()
    return h
  }
  const sentFrames = (socket: FakeSocket) => socket.sent.map(f => JSON.parse(f) as Record<string, unknown>)

  it('holds an approval until it is answered, then sends the choice back', async () => {
    const h = await open()
    const socket = h.sockets[0]!
    socket.serverSends({ jsonrpc: '2.0', id: 'srq-1', method: 'approval', params: { session_id: 'live-1', command: 'rm -rf build', description: 'Delete the build folder', choices: ['once', 'deny'] } })
    expect(h.connection.requests()).toEqual([
      expect.objectContaining({ id: 'srq-1', method: 'approval', sessionId: 'live-1', params: { command: 'rm -rf build', description: 'Delete the build folder', choices: ['once', 'deny'] } })
    ])
    expect(h.requests.at(-1)).toHaveLength(1)
    expect(h.connection.answerRequest('srq-1', { choice: 'once' })).toBe(true)
    expect(sentFrames(socket)).toContainEqual({ jsonrpc: '2.0', id: 'srq-1', result: { choice: 'once' } })
    expect(h.connection.requests()).toEqual([])
    expect(h.connection.answerRequest('srq-1', { choice: 'deny' })).toBe(false)
  })

  it('drops a request the gateway withdraws', async () => {
    const h = await open()
    const socket = h.sockets[0]!
    socket.serverSends({ jsonrpc: '2.0', id: 'srq-2', method: 'clarify', params: { session_id: 'live-1', questions: [{ qid: 'q1', question: 'Which?', choices: ['A'], multi_select: false }] } })
    expect(h.connection.requests()).toHaveLength(1)
    socket.serverSends({ jsonrpc: '2.0', method: 'event', params: { type: 'request.cancel', session_id: 'live-1', payload: { id: 'srq-2', method: 'clarify', reason: 'answered elsewhere' } } })
    expect(h.connection.requests()).toEqual([])
  })

  it('leaves other kinds of request to the clients that show them', async () => {
    const h = await open()
    h.sockets[0]!.serverSends({ jsonrpc: '2.0', id: 'srq-3', method: 'theme.pick', params: { session_id: 'live-1' } })
    expect(h.connection.requests()).toEqual([])
    // Not answered as unhandled, which would tell Hermes no client can answer it.
    expect(sentFrames(h.sockets[0]!).some(f => f.id === 'srq-3' && (f.error as { code?: number } | undefined)?.code === -32601)).toBe(false)
  })

  it('forgets requests when the socket goes', async () => {
    const h = await open()
    h.sockets[0]!.serverSends({ jsonrpc: '2.0', id: 'srq-4', method: 'approval', params: { session_id: 'live-1' } })
    h.connection.signOut()
    expect(h.connection.requests()).toEqual([])
    expect(h.requests.at(-1)).toEqual([])
  })
})

describe('more than one Hermes', () => {
  it('keeps each host signed in and switches between them', async () => {
    const h = harness({ hosts: true })
    await h.connection.signIn({ url: 'https://one', method: 'token', token: 'a' })
    await tick()
    await h.connection.signIn({ url: 'https://two', method: 'token', token: 'b' })
    await tick()
    expect(h.connection.current()).toMatchObject({ phase: 'open', url: 'https://two', hosts: [{ url: 'https://one' }, { url: 'https://two' }] })
    expect(h.connection.switchHost('https://one')).toBe(true)
    await until(() => h.connection.current().phase === 'open')
    expect(h.connection.current()).toMatchObject({ phase: 'open', url: 'https://one' })
    expect(h.sockets.at(-1)!.url).toBe('wss://one/api/ws?token=a')
    expect(h.written.at(-1)).toEqual({ hosts: ['https://one', 'https://two'], active: 'https://one' })
    expect(h.connection.switchHost('https://nowhere')).toBe(false)
  })

  it('signing out of one opens the next, and removing another keeps this one open', async () => {
    const h = harness({ hosts: true })
    await h.connection.signIn({ url: 'https://one', method: 'token', token: 'a' })
    await h.connection.signIn({ url: 'https://two', method: 'token', token: 'b' })
    await h.connection.signIn({ url: 'https://three', method: 'token', token: 'c' })
    await tick()
    h.connection.removeHost('https://one')
    expect(h.connection.current()).toMatchObject({ url: 'https://three', hosts: [{ url: 'https://two' }, { url: 'https://three' }] })
    h.connection.signOut()
    await tick()
    expect(h.connection.current()).toMatchObject({ phase: 'open', url: 'https://two', hosts: [{ url: 'https://two' }] })
    h.connection.signOut()
    expect(h.connection.current()).toEqual({ phase: 'signed-out', hosts: [] })
  })

  it('labels the open host by the name it was given', async () => {
    const h = harness({ hosts: true })
    await h.connection.signIn({ url: 'https://one', method: 'token', token: 'a' })
    await tick()
    expect(h.connection.current()).toMatchObject({ hostLabel: 'one' })
    h.hostList.rename!('https://one', 'Studio')
    h.connection.hostsChanged()
    expect(h.connection.current()).toMatchObject({ hostLabel: 'Studio' })
    // Named with its own address, it reads exactly as Settings does, port and all.
    h.hostList.rename!('https://one', 'one:9119')
    h.connection.hostsChanged()
    expect(h.connection.current()).toMatchObject({ hostLabel: 'one:9119' })
  })

  it('labels an unnamed host on an IP address with its port, as Settings does', async () => {
    const h = harness({ hosts: true })
    await h.connection.signIn({ url: 'http://192.168.1.5:9119', method: 'token', token: 'a' })
    await tick()
    expect(h.connection.current()).toMatchObject({ hostLabel: '192.168.1.5:9119' })
  })

  it('a failed sign-in to another host goes back to the open one', async () => {
    const h = harness({ hosts: true })
    await h.connection.signIn({ url: 'https://one', method: 'token', token: 'a' })
    await tick()
    const result = await h.connection.signIn({ url: 'https://two', method: 'password', username: 'eric', password: '' })
    expect(result.ok).toBe(false)
    await tick()
    expect(h.connection.current()).toMatchObject({ phase: 'open', url: 'https://one' })
    expect(h.hostList.list!()).toEqual([{ url: 'https://one', method: 'token', username: undefined, name: 'one' }])
  })

  it('stays shut while locked, then opens the last host once unlocked', async () => {
    const h = harness({ hosts: true })
    await h.connection.signIn({ url: 'https://one', method: 'token', token: 'a' })
    await h.connection.signIn({ url: 'https://two', method: 'token', token: 'b' })
    await tick()
    const fresh = harness({ hosts: true })
    for (const host of h.hostList.list!()) fresh.hostList.save({ url: host.url, method: host.method, token: host.url === 'https://one' ? 'a' : 'b' })
    fresh.connection.lock()
    expect(fresh.connection.current()).toEqual({ phase: 'locked', hosts: [{ url: 'https://one', method: 'token', username: undefined, name: 'one' }, { url: 'https://two', method: 'token', username: undefined, name: 'two' }] })
    await fresh.connection.restore()
    expect(fresh.connection.switchHost('https://one')).toBe(false)
    expect((await fresh.connection.signIn({ url: 'https://three', method: 'token', token: 'c' })).ok).toBe(false)
    fresh.connection.signOut()
    fresh.connection.removeHost('https://one')
    await tick()
    expect(fresh.sockets).toHaveLength(0)
    expect(fresh.connection.current().phase).toBe('locked')
    await fresh.connection.unlocked()
    await tick()
    expect(fresh.connection.current()).toMatchObject({ phase: 'open', url: 'https://two' })
    expect(fresh.connection.isLocked).toBe(false)
  })
  it('with Ask Which Dashboard at Launch, lists two or more hosts until one is picked', async () => {
    const one = harness({ hosts: true })
    one.hostList.save({ url: 'https://one', method: 'token', token: 'a' })
    await one.connection.restore({ askWhich: true })
    await tick()
    // One host: nothing to choose, so it opens.
    expect(one.connection.current()).toMatchObject({ phase: 'open', url: 'https://one' })

    const two = harness({ hosts: true })
    two.hostList.save({ url: 'https://one', method: 'token', token: 'a' })
    two.hostList.save({ url: 'https://two', method: 'token', token: 'b' })
    two.connection.lock()
    await two.connection.unlocked({ askWhich: true })
    await tick()
    expect(two.sockets).toHaveLength(0)
    expect(two.connection.current()).toMatchObject({ phase: 'signed-out', choosing: true, hosts: [{ url: 'https://one' }, { url: 'https://two' }] })
    // The pick opens that host, not the last one used, and ends the wait.
    expect(two.connection.switchHost('https://one')).toBe(true)
    await tick()
    expect(two.connection.current()).toMatchObject({ phase: 'open', url: 'https://one' })
    expect(two.connection.current().choosing).toBeUndefined()
  })
})
