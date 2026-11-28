/**
 * Pairing this computer from the phone (Settings > Connection > Pair a
 * Computer there). The computer makes a one-time inbox on the rooms mailbox
 * and shows a QR code with the inbox, a send token for it and its public key.
 * The phone seals its Hermes sign-ins to that key and leaves them in the
 * inbox. The computer opens them, both screens show the same four words, and
 * once the person says they match the computer signs in to each host. The
 * mailbox only ever holds the sealed box, and the inbox is deleted after.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { PairEvent, PairHost, SignInRequest } from '../shared/ipc'
import type { Fetch } from './auth'
import { b64u, inboxId, makePairKeys, openFromPhone, ownerAuthorization, pairLink, pairWords, type PairKeys } from './pairCrypto'
import { t } from '../shared/i18n'

export const DEFAULT_MAILBOX = 'https://rooms.milim.dev'
export const PAIR_TTL_MS = 10 * 60_000
const SENDER = 'phone'
export const POLL_WAIT_S = 25

export interface PairingDeps {
  fetch: Fetch
  mailbox?: string
  onEvent: (event: PairEvent) => void
  signIn: (request: SignInRequest) => Promise<{ ok: true } | { ok: false; error: string }>
  switchHost: (url: string) => boolean
  /** Names a host just signed in to as the phone calls it, unless it was named here. */
  nameHost?: (url: string, name: string) => void
  now?: () => number
}

interface Received {
  hosts: (PairHost & { password?: string; token?: string; headers?: Record<string, string> })[]
}

/** The phone's sealed payload, or null when it isn't one. */
export function readPayload(text: string): Received | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const row = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  if (!row || row.v !== 1 || !Array.isArray(row.hosts)) return null
  const hosts: Received['hosts'] = []
  for (const raw of row.hosts) {
    const h = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const url = typeof h?.url === 'string' ? h.url : ''
    const method = h?.method
    if (!h || !/^https?:\/\//.test(url) || (method !== 'password' && method !== 'token' && method !== 'open')) continue
    const host: Received['hosts'][number] = { url, method }
    if (typeof h.username === 'string') host.username = h.username
    if (typeof h.password === 'string') host.password = h.password
    if (typeof h.token === 'string') host.token = h.token
    if (typeof h.name === 'string') host.name = h.name
    // A proxy's headers (Cloudflare Access, Pangolin…); the sign-in checks each one.
    if (h.headers && typeof h.headers === 'object' && !Array.isArray(h.headers)) {
      const headers = Object.entries(h.headers as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string')
      if (headers.length) host.headers = Object.fromEntries(headers)
    }
    if (method === 'password' && (!host.username || !host.password)) continue
    if (method === 'token' && !host.token) continue
    hosts.push(host)
  }
  return hosts.length ? { hosts } : null
}

export class Pairing {
  private keys: PairKeys | null = null
  private inbox: string | null = null
  /**
   * The inbox's signing key, kept for the app's run: the mailbox lets one
   * client make only a few inboxes an hour, so a new code is a new seal key
   * and send token on the same inbox, not a new inbox.
   */
  private signing: Pick<PairKeys, 'signPrivate' | 'signPublic'> | null = null
  private received: Received | null = null
  private run = 0
  private expiry: ReturnType<typeof setTimeout> | null = null
  private readonly mailbox: string

  constructor(private readonly deps: PairingDeps) {
    this.mailbox = (deps.mailbox ?? DEFAULT_MAILBOX).replace(/\/+$/, '')
  }

  private get now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** Makes the inbox and answers the link the QR code shows. */
  async start(): Promise<{ ok: true; link: string; expires: number } | { ok: false; error: string }> {
    await this.cancel()
    const mine = ++this.run
    const fresh = makePairKeys()
    this.signing ??= { signPrivate: fresh.signPrivate, signPublic: fresh.signPublic }
    const keys: PairKeys = { ...fresh, ...this.signing }
    const inbox = inboxId(keys.signPublic)
    const token = b64u(randomBytes(32))
    try {
      // Registering an inbox the mailbox already has only confirms it.
      await this.owner('POST', '/v1/inboxes', { key: b64u(keys.signPublic) }, keys)
      // A sender removed takes what it left with it, so an old code's box can't linger.
      await this.owner('DELETE', `/v1/inboxes/${inbox}/senders/${SENDER}`, undefined, keys).catch(() => undefined)
      await this.owner('PUT', `/v1/inboxes/${inbox}/senders/${SENDER}`, { token_sha256: b64u(createHash('sha256').update(token).digest()) }, keys)
    } catch (error) {
      return { ok: false, error: t('Couldn’t reach the pairing mailbox: {reason}', { reason: (error as Error).message }) }
    }
    if (mine !== this.run) return { ok: false, error: t('Cancelled.') }
    this.keys = keys
    this.inbox = inbox
    const expires = this.now + PAIR_TTL_MS
    this.expiry = setTimeout(() => {
      if (mine !== this.run) return
      this.deps.onEvent({ phase: 'expired' })
      void this.cancel()
    }, PAIR_TTL_MS)
    void this.poll(mine)
    return { ok: true, link: pairLink({ mailbox: this.mailbox, inbox, token, key: b64u(keys.sealPublic), expires: Math.floor(expires / 1000) }), expires }
  }

  /** The person said the words match: sign in to each host the phone sent. */
  async confirm(): Promise<void> {
    const received = this.received
    if (!received) return
    this.received = null
    this.deps.onEvent({ phase: 'signing-in' })
    const failed: string[] = []
    let first: string | null = null
    for (const host of received.hosts) {
      const result = await this.deps.signIn({ url: host.url, method: host.method, username: host.username, password: host.password, token: host.token, headers: host.headers })
      if (result.ok) {
        first ??= host.url
        // What the phone calls it, unless that's only its address.
        if (host.name && !/^(localhost|[\d.:\[\]]+)$/i.test(host.name.trim())) this.deps.nameHost?.(host.url, host.name)
      }
      else failed.push(`${host.name ?? host.url}: ${result.error}`)
    }
    // The phone's own host first, as it listed them.
    if (first) this.deps.switchHost(first)
    await this.cancel({ deleteInbox: true })
    this.deps.onEvent(first ? { phase: 'done', error: failed.length ? failed.join('\n') : undefined } : { phase: 'failed', error: failed.join('\n') || t('Nothing to sign in to.') })
  }

  /** Stops waiting and takes the code back (the inbox too, once paired). */
  async cancel(options: { deleteInbox?: boolean } = {}): Promise<void> {
    this.run++
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = null
    const keys = this.keys
    const inbox = this.inbox
    this.keys = null
    this.inbox = null
    this.received = null
    if (!keys || !inbox) return
    if (options.deleteInbox) {
      this.signing = null
      await this.owner('DELETE', `/v1/inboxes/${inbox}`, undefined, keys).catch(() => undefined)
    } else {
      await this.owner('DELETE', `/v1/inboxes/${inbox}/senders/${SENDER}`, undefined, keys).catch(() => undefined)
    }
  }

  private async poll(mine: number): Promise<void> {
    let after = 0
    let failures = 0
    while (mine === this.run && this.keys && this.inbox) {
      const keys = this.keys
      const inbox = this.inbox
      try {
        const page = (await this.owner('GET', `/v1/inboxes/${inbox}/envelopes?after=${after}&wait=${POLL_WAIT_S}`, undefined, keys)) as {
          envelopes?: { seq: number; body: string }[]
          next?: number
        }
        failures = 0
        if (mine !== this.run) return
        for (const envelope of page.envelopes ?? []) {
          after = Math.max(after, envelope.seq)
          try {
            const opened = openFromPhone(Buffer.from(envelope.body, 'base64'), keys, inbox)
            const payload = readPayload(opened.plaintext.toString('utf8'))
            if (!payload) continue
            this.received = payload
            this.deps.onEvent({
              phase: 'received',
              words: pairWords(keys.sealPublic, opened.ephemeralPublic),
              hosts: payload.hosts.map(h => ({ url: h.url, method: h.method, username: h.username, name: h.name }))
            })
            return
          } catch {
            // Not for this key: leave it.
          }
        }
        if (typeof page.next === 'number') after = Math.max(after, page.next)
      } catch (error) {
        if (mine !== this.run) return
        if (++failures >= 5) {
          this.deps.onEvent({ phase: 'failed', error: t('Lost the pairing mailbox: {reason}', { reason: (error as Error).message }) })
          await this.cancel()
          return
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * failures))
      }
    }
  }

  private owner(method: string, pathAndQuery: string, body: unknown, keys: PairKeys): Promise<unknown> {
    return mailboxOwner(this.deps.fetch, this.mailbox, method, pathAndQuery, body, keys, this.now)
  }
}

/** One request to the mailbox as an inbox's owner; throws its error code. */
export async function mailboxOwner(fetch: Fetch, mailbox: string, method: string, pathAndQuery: string, body: unknown, keys: Pick<PairKeys, 'signPrivate'>, now: number): Promise<unknown> {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
  const url = new URL(pathAndQuery, `${mailbox}/`)
  const headers: Record<string, string> = { Authorization: ownerAuthorization(keys.signPrivate, method, url.host, pathAndQuery, bytes, now) }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : bytes,
    signal: AbortSignal.timeout((POLL_WAIT_S + 10) * 1000)
  })
  return mailboxAnswer(response)
}

/** A mailbox answer's JSON, or its error code thrown. */
export async function mailboxAnswer(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!response.ok) {
    let code = `HTTP ${response.status}`
    try {
      code = (JSON.parse(text) as { error?: string }).error ?? code
    } catch {
      // Not JSON.
    }
    throw new Error(code)
  }
  return text ? JSON.parse(text) : null
}
