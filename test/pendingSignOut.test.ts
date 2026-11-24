import { describe, expect, it } from 'vitest'
import { Connection, PENDING_SIGN_OUT_MS, type PendingSignOut, type SavedConnection } from '../src/main/connection'
import type { Fetch } from '../src/main/auth'
import type { ConnectionStatus } from '../src/shared/ipc'
import type { WebSocketLike } from '../src/vendor/hermes-shared/json-rpc-gateway'

const url = 'https://hermes.example.com'
const grant = { access_token: 'a', refresh_token: 'rt', expires_at: 1_900_000_000, provider: 'self-hosted' }
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await tick()
}

class Socket extends EventTarget {
  readyState = 1
  send(): void {}
  close(): void {
    this.readyState = 3
  }
  constructor() {
    super()
    setTimeout(() => this.dispatchEvent(Object.assign(new Event('message'), {
      data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { session_authority: true } } })
    })), 0)
  }
}

function fakeStore() {
  let saved: SavedConnection | null = { url, method: 'oidc', oidc: grant }
  let pending: PendingSignOut[] = []
  return {
    load: () => saved,
    save: (next: SavedConnection) => { saved = { ...next } },
    clear: () => { saved = null },
    pendingSignOuts: () => pending,
    savePendingSignOut: (entry: PendingSignOut) => {
      pending = [...pending.filter(p => !(p.url === entry.url && p.refreshToken === entry.refreshToken)), entry]
    },
    clearPendingSignOut: (host: string, token: string) => {
      pending = pending.filter(p => !(p.url === host && p.refreshToken === token))
    },
    pending: () => pending,
    setPending: (list: PendingSignOut[]) => { pending = list }
  }
}

function connection(store: ReturnType<typeof fakeStore>, logout: (init?: RequestInit) => Response) {
  const statuses: ConnectionStatus[] = []
  const fetchImpl: Fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname
    if (path === '/auth/logout') return logout(init)
    if (path === '/api/auth/ws-ticket') return json({ ticket: 'T' })
    if (path === '/api/profiles/sessions') return json({ sessions: [] })
    return json({ ok: true })
  }
  return new Connection({
    fetch: fetchImpl,
    store,
    createSocket: () => new Socket() as unknown as WebSocketLike,
    onStatus: status => statuses.push(status),
    onEvent: () => undefined
  })
}

describe('a sign-out Hermes did not hear (issue 463)', () => {
  it('keeps the handle encrypted and retries it on the next launch until Hermes takes it', async () => {
    const store = fakeStore()
    const revoked: string[] = []
    const first = connection(store, init => {
      const cookie = new Headers(init?.headers).get('cookie') ?? ''
      revoked.push(cookie.replace(/^hermes_session_rt=/, ''))
      return new Response('busy', { status: 500 })
    })
    void first.restore().catch(() => {})
    first.signOut()
    await until(() => store.pending().length === 1)
    expect(store.pending()[0]).toMatchObject({ url, refreshToken: 'rt' })
    expect(store.pending()[0]!.expiresAt).toBeGreaterThan(Date.now() + PENDING_SIGN_OUT_MS - 5_000)

    const second = connection(store, () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    void second.restore().catch(() => {})
    await until(() => store.pending().length === 0)
    expect(store.pending()).toEqual([])
    expect(revoked).toContain('rt')
  })

  it('drops a pending sign-out whose handle has run out', async () => {
    const store = fakeStore()
    store.setPending([{ url, refreshToken: 'old', expiresAt: Date.now() - 1 }])
    const c = connection(store, () => new Response('{}', { status: 200 }))
    void c.restore().catch(() => {})
    await until(() => store.pending().length === 0)
    expect(store.pending()).toEqual([])
  })
})
