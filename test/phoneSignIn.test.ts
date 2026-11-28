import { describe, expect, it } from 'vitest'
import { PhoneSignIn, readRequest, sendableHost } from '../src/main/phoneSignIn'
import type { SavedConnection } from '../src/main/connection'
import { b64u, fromB64u, inboxId, makePairKeys, openFromComputer, openFromPhone, pairWords, parsePairLink, sealForComputer, sealForPhone, SIGNIN_LINK_SCHEME } from '../src/main/pairCrypto'

/** A stand-in mailbox: records requests and bodies, and hands out what the phone left. */
function fakeMailbox() {
  const calls: { method: string; path: string; auth?: string; body?: string }[] = []
  const left: { seq: number; body: string }[] = []
  let seq = 1000
  const fetch = async (url: string, init: { method: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal }) => {
    const u = new URL(url)
    calls.push({ method: init.method, path: u.pathname, auth: init.headers?.Authorization, body: typeof init.body === 'string' ? init.body : undefined })
    if (init.method === 'GET') {
      const after = Number(u.searchParams.get('after'))
      for (let i = 0; i < 50; i++) {
        const page = left.filter(e => e.seq > after)
        if (page.length) return new Response(JSON.stringify({ envelopes: page, next: page.at(-1)!.seq }))
        if (init.signal?.aborted) break
        await new Promise(r => setTimeout(r, 10))
      }
      return new Response(JSON.stringify({ envelopes: [], next: after }))
    }
    return init.method === 'POST' ? new Response('{"seq":1}', { status: 201 }) : new Response(null, { status: 204 })
  }
  return { calls, fetch, leave: (body: Buffer) => left.push({ seq: ++seq, body: body.toString('base64') }) }
}

const HOSTS: SavedConnection[] = [
  { url: 'https://hermes.example', method: 'password', username: 'eric', password: 'pw', name: 'Home', headers: { 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' } },
  { url: 'https://sso.example', method: 'browser', cookies: {} as never },
  { url: 'http://100.64.0.2:9119', method: 'open' }
]

describe('PhoneSignIn', () => {
  it('shows the words for the phone’s request, then seals the picked sign-ins to the phone’s inbox', async () => {
    const box = fakeMailbox()
    const events: { phase: string; words?: string[]; hosts?: { url: string; sendable: boolean }[] }[] = []
    const signIn = new PhoneSignIn({ fetch: box.fetch as never, mailbox: 'https://mail.test', onEvent: e => events.push(e), hosts: () => HOSTS })
    const started = await signIn.start()
    if (!started.ok) throw new Error(started.error)
    expect(started.link.startsWith(`${SIGNIN_LINK_SCHEME}?`)).toBe(true)
    const link = parsePairLink(started.link, SIGNIN_LINK_SCHEME)!
    expect(parsePairLink(started.link)).toBeNull()

    // The phone: its own inbox and reply key, then the request sealed to this computer.
    const phone = makePairKeys()
    const phoneInbox = inboxId(phone.signPublic)
    const request = { v: 1, want: 'signins', reply: { inbox: phoneInbox, token: b64u(Buffer.alloc(32, 7)), key: b64u(phone.sealPublic) } }
    const sealed = sealForComputer(Buffer.from(JSON.stringify(request)), fromB64u(link.key), link.inbox)
    box.leave(sealed)
    for (let i = 0; i < 100 && !events.length; i++) await new Promise(r => setTimeout(r, 10))
    const received = events[0]!
    expect(received.phase).toBe('received')
    const epk = fromB64u(JSON.parse(sealed.toString()).epk)
    expect(received.words).toEqual(pairWords(fromB64u(link.key), epk))
    expect(received.hosts!.map(h => [h.url, h.sendable])).toEqual([
      ['https://hermes.example', true],
      ['https://sso.example', false],
      ['http://100.64.0.2:9119', true]
    ])

    await signIn.send(['https://hermes.example', 'https://sso.example'])
    const post = box.calls.find(c => c.method === 'POST' && c.path === `/v1/inboxes/${phoneInbox}/envelopes`)!
    expect(post.auth).toBe(`Bearer ${request.reply.token}`)
    const opened = openFromComputer(Buffer.from(post.body!), phone, phoneInbox)
    expect(JSON.parse(opened.plaintext.toString())).toEqual({
      v: 1,
      hosts: [{ url: 'https://hermes.example', method: 'password', name: 'Home', username: 'eric', password: 'pw', headers: { 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' } }]
    })
    // A box for the phone can't be read as one for a computer.
    expect(() => openFromPhone(Buffer.from(post.body!), phone, phoneInbox)).toThrow()
    expect(events.at(-1)!.phase).toBe('done')
    expect(box.calls.some(c => c.method === 'DELETE' && c.path === `/v1/inboxes/${link.inbox}`)).toBe(true)
  })

  /** A sign-in showing the phone's words, with the phone's own keys. */
  async function received(hosts: () => SavedConnection[], phoneKey?: Buffer) {
    const box = fakeMailbox()
    const events: { phase: string; words?: string[]; hosts?: { url: string; sendable: boolean }[] }[] = []
    const signIn = new PhoneSignIn({ fetch: box.fetch as never, mailbox: 'https://mail.test', onEvent: e => events.push(e), hosts })
    const started = await signIn.start()
    if (!started.ok) throw new Error(started.error)
    const link = parsePairLink(started.link, SIGNIN_LINK_SCHEME)!
    const phone = makePairKeys()
    const phoneInbox = inboxId(phone.signPublic)
    const request = { v: 1, want: 'signins', reply: { inbox: phoneInbox, token: b64u(Buffer.alloc(32, 7)), key: b64u(phoneKey ?? phone.sealPublic) } }
    box.leave(sealForComputer(Buffer.from(JSON.stringify(request)), fromB64u(link.key), link.inbox))
    for (let i = 0; i < 100 && !events.length; i++) await new Promise(r => setTimeout(r, 10))
    return { box, events, signIn, phoneInbox }
  }

  it('lists the hosts again when a picked one was signed out, and sends nothing', async () => {
    let hosts = HOSTS
    const { box, events, signIn, phoneInbox } = await received(() => hosts)
    hosts = HOSTS.filter(h => h.url !== 'http://100.64.0.2:9119')
    await signIn.send(['https://hermes.example', 'http://100.64.0.2:9119'])
    expect(events.map(e => e.phase)).toEqual(['received', 'received'])
    expect(events[1]!.words).toEqual(events[0]!.words)
    expect(events[1]!.hosts!.map(h => h.url)).toEqual(['https://hermes.example', 'https://sso.example'])
    expect(box.calls.some(c => c.method === 'POST' && c.path === `/v1/inboxes/${phoneInbox}/envelopes`)).toBe(false)
    await signIn.cancel()
  })

  it('ends as a failure when the phone’s key can’t be sealed to', async () => {
    // An all-zero X25519 key is a low-order point: the agreement refuses it.
    const { box, events, signIn, phoneInbox } = await received(() => HOSTS, Buffer.alloc(32))
    await signIn.send(['https://hermes.example'])
    expect(events.at(-1)!.phase).toBe('failed')
    expect(box.calls.some(c => c.method === 'POST' && c.path === `/v1/inboxes/${phoneInbox}/envelopes`)).toBe(false)
  })

  it('reads only a well-formed request', () => {
    const key = b64u(Buffer.alloc(32, 1))
    const inbox = 'a'.repeat(43)
    const token = b64u(Buffer.alloc(32, 2))
    expect(readRequest(JSON.stringify({ v: 1, want: 'signins', reply: { inbox, token, key } }))).not.toBeNull()
    expect(readRequest(JSON.stringify({ v: 1, hosts: [] }))).toBeNull()
    expect(readRequest(JSON.stringify({ v: 1, want: 'signins', reply: { inbox: 'short', token, key } }))).toBeNull()
    expect(readRequest(JSON.stringify({ v: 1, want: 'signins', reply: { inbox, token, key: b64u(Buffer.alloc(8)) } }))).toBeNull()
    expect(readRequest('not json')).toBeNull()
  })

  it('sends passwords, tokens and open hosts, never a browser or single sign-on one', () => {
    expect(sendableHost({ url: 'https://a', method: 'token', token: 'tk' })).toMatchObject({ method: 'token', token: 'tk' })
    expect(sendableHost({ url: 'https://a', method: 'password', username: 'u' })).toBeNull()
    expect(sendableHost({ url: 'https://a', method: 'oidc' })).toBeNull()
  })

  it('seals each way under its own key', () => {
    const phone = makePairKeys()
    const box = sealForPhone(Buffer.from('hi'), phone.sealPublic, 'inbox')
    expect(openFromComputer(box, phone, 'inbox').plaintext.toString()).toBe('hi')
    expect(() => openFromComputer(box, phone, 'other')).toThrow()
  })
})
