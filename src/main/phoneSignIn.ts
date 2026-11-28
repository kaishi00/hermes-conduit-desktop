/**
 * Signing Conduit on an iPhone in from here (Settings › Conduit on iPhone),
 * the way back of pairing.ts. This computer makes a one-time inbox on the
 * rooms mailbox and shows a code. The phone scans it, makes an inbox of its
 * own, and leaves a request sealed to this computer's key: its inbox, a send
 * token for it and its key. Both screens show the same four words, and once
 * the person says they match and picks the hosts, this computer seals those
 * sign-ins to the phone's key and leaves them in the phone's inbox. The
 * mailbox only ever holds sealed boxes, and both inboxes are deleted after.
 *
 * The request (sealed with sealForComputer): {"v":1,"want":"signins","reply":{"inbox","token","key"}}
 * The answer (sealed with sealForPhone, aad inbox = the phone's):
 *   {"v":1,"hosts":[{"url","method":"password"|"token"|"open","username","password","token","name","headers"}]}
 * A host signed in through a browser or single sign-on can't be sent: the phone signs in to it itself.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { PhoneSignInEvent, PhoneSignInHost } from '../shared/ipc'
import type { Fetch } from './auth'
import type { SavedConnection } from './connection'
import { b64u, fromB64u, inboxId, makePairKeys, openFromPhone, pairLink, pairWords, sealForPhone, SIGNIN_LINK_SCHEME, type PairKeys } from './pairCrypto'
import { DEFAULT_MAILBOX, mailboxAnswer, mailboxOwner, PAIR_TTL_MS, POLL_WAIT_S } from './pairing'
import { hostDisplayName } from '../shared/hostNames'
import { t } from '../shared/i18n'

const SENDER = 'phone'

export interface PhoneSignInDeps {
  fetch: Fetch
  mailbox?: string
  onEvent: (event: PhoneSignInEvent) => void
  /** The signed-in hosts, with their secrets. */
  hosts: () => SavedConnection[]
  now?: () => number
}

export interface PhoneRequest {
  inbox: string
  token: string
  key: Buffer
}

/** The phone's sealed request, or null when it isn't one. */
export function readRequest(text: string): PhoneRequest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const row = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const reply = row?.reply && typeof row.reply === 'object' ? (row.reply as Record<string, unknown>) : null
  if (!row || row.v !== 1 || row.want !== 'signins' || !reply) return null
  const { inbox, token, key } = reply
  if (typeof inbox !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(inbox)) return null
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,}$/.test(token)) return null
  if (typeof key !== 'string' || fromB64u(key).length !== 32) return null
  return { inbox, token, key: fromB64u(key) }
}

/** What the phone is sent for a host, or null for one it signs in to itself. */
export function sendableHost(host: SavedConnection): Record<string, unknown> | null {
  const base: Record<string, unknown> = { url: host.url, method: host.method, name: hostDisplayName(host) }
  if (host.headers && Object.keys(host.headers).length) base.headers = host.headers
  if (host.method === 'password' && host.username && host.password) return { ...base, username: host.username, password: host.password }
  if (host.method === 'token' && host.token) return { ...base, token: host.token }
  if (host.method === 'open') return base
  return null
}

export class PhoneSignIn {
  private keys: PairKeys | null = null
  private inbox: string | null = null
  /** Kept for the app's run, as in pairing.ts: the mailbox makes only a few inboxes an hour. */
  private signing: Pick<PairKeys, 'signPrivate' | 'signPublic'> | null = null
  private request: PhoneRequest | null = null
  private words: string[] = []
  private run = 0
  private expiry: ReturnType<typeof setTimeout> | null = null
  private readonly mailbox: string

  constructor(private readonly deps: PhoneSignInDeps) {
    this.mailbox = (deps.mailbox ?? DEFAULT_MAILBOX).replace(/\/+$/, '')
  }

  private get now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** Makes the inbox and answers the link the code shows. */
  async start(): Promise<{ ok: true; link: string; expires: number } | { ok: false; error: string }> {
    await this.cancel()
    const mine = ++this.run
    const fresh = makePairKeys()
    this.signing ??= { signPrivate: fresh.signPrivate, signPublic: fresh.signPublic }
    const keys: PairKeys = { ...fresh, ...this.signing }
    const inbox = inboxId(keys.signPublic)
    const token = b64u(randomBytes(32))
    try {
      await this.owner('POST', '/v1/inboxes', { key: b64u(keys.signPublic) }, keys)
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
    return { ok: true, link: pairLink({ mailbox: this.mailbox, inbox, token, key: b64u(keys.sealPublic), expires: Math.floor(expires / 1000) }, SIGNIN_LINK_SCHEME), expires }
  }

  /** The words matched: seal the picked hosts' sign-ins to the phone. */
  async send(urls: string[]): Promise<void> {
    const request = this.request
    if (!request) return
    const picked = new Set(urls)
    const still = this.deps.hosts().filter(h => picked.has(h.url))
    const hosts = still.map(sendableHost).filter((h): h is Record<string, unknown> => h !== null)
    if (!hosts.length || still.length < picked.size) {
      // A picked host was signed out meanwhile: list them again rather than send fewer than were checked.
      this.deps.onEvent({ phase: 'received', words: this.words, hosts: this.listed() })
      return
    }
    this.request = null
    this.deps.onEvent({ phase: 'sending' })
    try {
      // Inside the try: a key that can't be agreed with ends as a failure, not a stuck "sending".
      const envelope = sealForPhone(Buffer.from(JSON.stringify({ v: 1, hosts })), request.key, request.inbox)
      const response = await this.deps.fetch(`${this.mailbox}/v1/inboxes/${request.inbox}/envelopes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${request.token}`, 'Content-Type': 'application/json' },
        body: envelope.toString('utf8'),
        signal: AbortSignal.timeout(20_000)
      })
      await mailboxAnswer(response)
    } catch (error) {
      // The card shows the failure at once; taking the code back can wait on the mailbox.
      const cleanup = this.cancel()
      this.deps.onEvent({ phase: 'failed', error: t('Couldn’t send to your iPhone: {reason}', { reason: (error as Error).message }) })
      await cleanup
      return
    }
    const cleanup = this.cancel({ deleteInbox: true })
    this.deps.onEvent({ phase: 'done' })
    await cleanup
  }

  /** Stops waiting and takes the code back (the inbox too, once done). */
  async cancel(options: { deleteInbox?: boolean } = {}): Promise<void> {
    this.run++
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = null
    const keys = this.keys
    const inbox = this.inbox
    this.keys = null
    this.inbox = null
    this.request = null
    if (!keys || !inbox) return
    if (options.deleteInbox) {
      this.signing = null
      await this.owner('DELETE', `/v1/inboxes/${inbox}`, undefined, keys).catch(() => undefined)
    } else {
      await this.owner('DELETE', `/v1/inboxes/${inbox}/senders/${SENDER}`, undefined, keys).catch(() => undefined)
    }
  }

  /** The hosts listed for the person to pick, those that can't be sent included. */
  private listed(): PhoneSignInHost[] {
    return this.deps.hosts().map(h => ({ url: h.url, name: hostDisplayName(h), sendable: sendableHost(h) !== null }))
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
            const request = readRequest(opened.plaintext.toString('utf8'))
            if (!request) continue
            this.request = request
            this.words = pairWords(keys.sealPublic, opened.ephemeralPublic)
            this.deps.onEvent({ phase: 'received', words: this.words, hosts: this.listed() })
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
