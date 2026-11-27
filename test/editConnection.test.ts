import { describe, expect, it, vi } from 'vitest'
import { Connection } from '../src/main/connection'
import type { Fetch } from '../src/main/auth'
import { createHostList } from '../src/main/hosts'
import type { WebSocketLike } from '../src/vendor/hermes-shared/json-rpc-gateway'
import { copyHostData, finishHostMove, undoHostCopy } from '../src/renderer/src/state/hostData'
import { DraftStore, draftStoreKey } from '../src/renderer/src/state/composerDrafts'

class FakeSocket extends EventTarget {
  readyState = 0
  constructor(readonly url: string) {
    super()
    setTimeout(() => {
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
      this.dispatchEvent(
        Object.assign(new Event('message'), { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }) })
      )
    }, 0)
  }
  send() {}
  close() {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }))
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
/** The connection's state, once it has settled: a fixed wait is a race under load. */
const opened = (connection: { current(): { phase?: string; url?: string } | null }, url: string) =>
  vi.waitFor(() => expect(connection.current()).toMatchObject({ phase: 'open', url }), { timeout: 5_000, interval: 20 })

function harness() {
  const logins: string[] = []
  const sentHeaders: Headers[] = []
  const fetchImpl: Fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    sentHeaders.push(new Headers(init.headers))
    if (url.pathname === '/auth/password-login') {
      const body = JSON.parse(String(init.body)) as { password: string }
      logins.push(`${url.origin} ${body.password}`)
      if (body.password === 'wrong') return json({ detail: 'Invalid credentials' }, 401)
      return json({ ok: true }, 200, { 'Set-Cookie': 'hermes_session=s; Path=/' })
    }
    if (url.pathname === '/api/auth/ws-ticket') return json({ ticket: 'T' })
    return json({ detail: 'Not Found' }, 404)
  }
  const sockets: FakeSocket[] = []
  const hostList = createHostList(() => undefined, { hosts: [], active: null })
  const connection = new Connection({
    fetch: fetchImpl,
    store: hostList,
    createSocket: url => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocketLike
    },
    onStatus: () => undefined,
    onEvent: () => undefined,
    onRequests: () => undefined,
    setTimeout: () => undefined,
    clearTimeout: () => undefined
  })
  return { connection, hostList, logins, sockets, sentHeaders }
}

describe('Edit Connection', () => {
  it('moves the open host to its new address in its place, keeping its group', async () => {
    const h = harness()
    await h.connection.signIn({ url: 'https://a.example', method: 'password', username: 'eric', password: 'pw' })
    await h.connection.signIn({ url: 'https://b.example', method: 'password', username: 'eric', password: 'pw' })
    h.hostList.setCombined!('https://b.example', true)
    const result = await h.connection.editHost('https://b.example', { url: 'https://c.example/', method: 'password', username: 'eric', password: 'pw2' })
    expect(result).toEqual({ ok: true, url: 'https://c.example' })
    expect(h.hostList.list!().map(host => host.url)).toEqual(['https://a.example', 'https://c.example'])
    expect(h.hostList.list!()[1]).toMatchObject({ combined: true })
    expect(h.hostList.load()).toMatchObject({ url: 'https://c.example', password: 'pw2' })
    await opened(h.connection, 'https://c.example')
    expect(h.connection.current()).toMatchObject({ phase: 'open', url: 'https://c.example' })
  })

  it('refuses an address saved as another host, before anything is sent, and never merges the two', async () => {
    const h = harness()
    await h.connection.signIn({ url: 'https://a.example', method: 'password', username: 'eric', password: 'pw-a' })
    await h.connection.signIn({ url: 'https://b.example', method: 'password', username: 'eric', password: 'pw-b' })
    const logins = h.logins.length
    const result = await h.connection.editHost('https://b.example', { url: 'a.example', method: 'password', username: 'eric', password: 'pw-b' })
    // Repair offers to switch to the dashboard the address belongs to.
    expect(result).toMatchObject({ ok: false, savedAs: 'https://a.example' })
    expect(h.logins).toHaveLength(logins)
    expect(h.hostList.get!('https://a.example')).toMatchObject({ password: 'pw-a' })
    expect(h.hostList.list!().map(host => host.url)).toEqual(['https://a.example', 'https://b.example'])
    expect(h.connection.current()).toMatchObject({ url: 'https://b.example' })
  })

  it('leaves the host as it was when the new sign-in fails, and opens it again', async () => {
    const h = harness()
    await h.connection.signIn({ url: 'https://a.example', method: 'password', username: 'eric', password: 'pw' })
    await opened(h.connection, 'https://a.example')
    const result = await h.connection.editHost('https://a.example', { url: 'https://a.example', method: 'password', username: 'eric', password: 'wrong' })
    expect(result).toMatchObject({ ok: false })
    expect(h.hostList.load()).toMatchObject({ url: 'https://a.example', password: 'pw' })
    await opened(h.connection, 'https://a.example')
    expect(h.connection.current()).toMatchObject({ phase: 'open', url: 'https://a.example' })
  })

  it('keeps the proxy’s headers when none are given at the same origin', async () => {
    const h = harness()
    const headers = { 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'shh' }
    await h.connection.signIn({ url: 'https://a.example', method: 'password', username: 'eric', password: 'pw', headers })
    expect(await h.connection.editHost('https://a.example', { url: 'https://a.example', method: 'password', username: 'other', password: 'pw' })).toMatchObject({ ok: true })
    expect(h.hostList.load()).toMatchObject({ username: 'other', headers })
  })
})

class MemoryStorage {
  map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

describe('what this computer keeps for a moved host', () => {
  const from = 'https://a.example'
  const to = 'https://c.example'

  it('copies its own keys before the sign-in, and takes them back if it fails', () => {
    const s = new MemoryStorage()
    s.setItem(`conduit.pinnedReplies.${from}`, '[1]')
    s.setItem(`conduit.pinnedReplies.${from}:8443`, '[2]')
    s.setItem('conduit.lastHost', from)
    const written = copyHostData(from, to, s)
    expect(written).toEqual([`conduit.pinnedReplies.${to}`])
    expect(s.getItem(`conduit.pinnedReplies.${to}`)).toBe('[1]')
    undoHostCopy(written, s)
    expect(s.getItem(`conduit.pinnedReplies.${to}`)).toBeNull()
    expect(s.getItem(`conduit.pinnedReplies.${from}`)).toBe('[1]')
  })

  it('drops the old keys after, and renames whole addresses in values that hold several hosts', () => {
    const s = new MemoryStorage()
    s.setItem(`conduit.chatMarks.${from}`, '{}')
    s.setItem('conduit.lastHost', from)
    s.setItem('conduit.ledger', JSON.stringify([{ host: from }, { host: `${from}:8443` }, { key: `${from}\u0000chat` }]))
    copyHostData(from, to, s)
    finishHostMove(from, to, s)
    expect(s.getItem(`conduit.chatMarks.${from}`)).toBeNull()
    expect(s.getItem(`conduit.chatMarks.${to}`)).toBe('{}')
    expect(s.getItem('conduit.lastHost')).toBe(to)
    expect(JSON.parse(s.getItem('conduit.ledger')!)).toEqual([{ host: to }, { host: `${from}:8443` }, { key: `${to}\u0000chat` }])
  })

  it('moves the host’s unsent drafts', () => {
    const drafts = new DraftStore()
    drafts.save(draftStoreKey(from, 'chat1'), { text: 'hi', attachments: [], replyTo: null })
    drafts.moveHost(from, to)
    expect(drafts.peek(draftStoreKey(to, 'chat1'))).toMatchObject({ text: 'hi' })
    expect(drafts.peek(draftStoreKey(from, 'chat1'))).toBeNull()
  })
})
