import { describe, expect, it } from 'vitest'
import { Pairing, readPayload } from '../src/main/pairing'
import { fromB64u, parsePairLink, sealForComputer } from '../src/main/pairCrypto'

/** A stand-in mailbox: records requests and hands out what the phone left. */
function fakeMailbox() {
  const calls: string[] = []
  const left: { seq: number; body: string }[] = []
  let seq = 1000
  const fetch = async (url: string, init: { method: string; signal?: AbortSignal }) => {
    const u = new URL(url)
    calls.push(`${init.method} ${u.pathname}`)
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
    return init.method === 'POST' ? new Response('{"inbox":"x"}', { status: 201 }) : new Response(null, { status: 204 })
  }
  return { calls, fetch, leave: (body: Buffer) => left.push({ seq: ++seq, body: body.toString('base64') }) }
}

describe('Pairing', () => {
  it('a new code waits for the last one’s take-back, so a late DELETE can’t remove its sender', async () => {
    const box = fakeMailbox()
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>(r => (release = r))
    const fetch = async (url: string, init: { method: string; signal?: AbortSignal }) => {
      const path = new URL(url).pathname
      if (init.method === 'DELETE' && path.endsWith('/senders/phone') && order.includes('PUT') && !order.includes('DELETE (held)')) {
        order.push('DELETE (held)')
        await held
      } else if (init.method !== 'GET') order.push(init.method)
      return box.fetch(url, init)
    }
    const pairing = new Pairing({ fetch: fetch as never, mailbox: 'https://mail.test', onEvent: () => {}, signIn: async () => ({ ok: true }), switchHost: () => true })
    expect((await pairing.start()).ok).toBe(true)
    const cancelling = pairing.cancel()
    const restarting = pairing.start()
    await new Promise(r => setTimeout(r, 30))
    expect(order.filter(m => m === 'PUT')).toHaveLength(1)
    release()
    await cancelling
    expect((await restarting).ok).toBe(true)
    expect(order.lastIndexOf('PUT')).toBeGreaterThan(order.indexOf('DELETE (held)'))
    await pairing.cancel()
  })

  it('keeps one inbox across new codes and takes the old code back', async () => {
    const box = fakeMailbox()
    const events: unknown[] = []
    const pairing = new Pairing({ fetch: box.fetch as never, mailbox: 'https://mail.test', onEvent: e => events.push(e), signIn: async () => ({ ok: true }), switchHost: () => true })
    const a = await pairing.start()
    const b = await pairing.start()
    if (!a.ok || !b.ok) throw new Error('start failed')
    const la = parsePairLink(a.link)!
    const lb = parsePairLink(b.link)!
    expect(lb.inbox).toBe(la.inbox)
    expect(lb.key).not.toBe(la.key)
    expect(lb.token).not.toBe(la.token)
    expect(box.calls.filter(c => c === `DELETE /v1/inboxes/${la.inbox}`)).toHaveLength(0)
    expect(box.calls.filter(c => c === `DELETE /v1/inboxes/${la.inbox}/senders/phone`).length).toBeGreaterThan(0)
    await pairing.cancel()
  })

  it('shows the words for a box sealed to the current code, then signs in and deletes the inbox', async () => {
    const box = fakeMailbox()
    const events: { phase: string; words?: string[] }[] = []
    const signedIn: string[] = []
    const named: [string, string][] = []
    const pairing = new Pairing({
      fetch: box.fetch as never,
      mailbox: 'https://mail.test',
      onEvent: e => events.push(e),
      signIn: async r => (signedIn.push(r.url), { ok: true }),
      switchHost: () => true,
      nameHost: (url, name) => named.push([url, name])
    })
    const started = await pairing.start()
    if (!started.ok) throw new Error(started.error)
    const link = parsePairLink(started.link)!
    box.leave(sealForComputer(Buffer.from(JSON.stringify({ v: 1, hosts: [{ url: 'https://hermes.test', method: 'open', name: 'Studio' }, { url: 'http://192.168.1.5:9119', method: 'open', name: '192.168.1.5' }] })), fromB64u(link.key), link.inbox))
    for (let i = 0; i < 100 && !events.some(e => e.phase === 'received'); i++) await new Promise(r => setTimeout(r, 10))
    expect(events.find(e => e.phase === 'received')?.words).toHaveLength(4)
    await pairing.confirm()
    expect(signedIn).toEqual(['https://hermes.test', 'http://192.168.1.5:9119'])
    // What the phone calls each, unless that's only its address.
    expect(named).toEqual([['https://hermes.test', 'Studio']])
    expect(events.at(-1)?.phase).toBe('done')
    expect(box.calls).toContain(`DELETE /v1/inboxes/${link.inbox}`)
  })

  it('reads only well-formed payloads', () => {
    expect(readPayload('{"v":1,"hosts":[{"url":"https://h","method":"password","username":"u"}]}')).toBeNull()
    expect(readPayload('{"v":1,"hosts":[{"url":"https://h","method":"token","token":"t","name":"Home"}]}')?.hosts[0]?.name).toBe('Home')
    // A proxy's headers come along; anything that isn't a string is dropped.
    expect(readPayload('{"v":1,"hosts":[{"url":"https://h","method":"token","token":"t","headers":{"CF-Access-Client-Id":"id","n":3}}]}')?.hosts[0]?.headers).toEqual({ 'CF-Access-Client-Id': 'id' })
    expect(readPayload('nope')).toBeNull()
  })
})
