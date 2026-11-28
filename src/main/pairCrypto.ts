/**
 * Pairing a computer from the phone, and signing a phone in from here: the
 * keys, the link the QR code holds, the mailbox's owner signatures, and the
 * sealed boxes each side sends.
 *
 * Seal (the phone does it, the computer opens it; both sides must agree):
 *   shared = X25519(ephemeral private, computer's public)
 *   key    = HKDF-SHA256(ikm = shared, salt = "conduit-pair-v1",
 *                        info = "conduit-pair-v1 phone-to-computer" ‖ epk ‖ computer's public, 32 bytes)
 *   box    = AES-256-GCM(key, 12-byte random nonce, plaintext,
 *                        aad = "conduit-pair/1\n" ‖ inbox id)
 *            (AES-GCM, not ChaCha20-Poly1305: Electron's BoringSSL has no ChaCha in Node's cipher API.
 *            CryptoKit's AES.GCM.SealedBox is the phone's side.)
 *   envelope (JSON) = {"v": 1, "epk": b64url, "n": b64url nonce, "c": b64url ciphertext ‖ tag}
 * The other way (Conduit on iPhone, signed in from this computer: phoneSignIn.ts) seals the
 * same way to the phone's key, with info "conduit-pair-v1 computer-to-phone", so a box can't
 * be turned around.
 * Words: the first 44 bits of SHA-256("conduit-pair-words-v1\n" ‖ computer's public ‖ epk),
 * 11 bits a BIP39 word, so both screens show the same four only for this key and this phone's box.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { BIP39_WORDS } from './bip39'

export const PAIR_LINK_SCHEME = 'conduit://pair'
/** The code this computer shows to sign Conduit on an iPhone in. */
export const SIGNIN_LINK_SCHEME = 'conduit://signin'
const SALT = Buffer.from('conduit-pair-v1')
const TO_COMPUTER = Buffer.from('conduit-pair-v1 phone-to-computer')
const TO_PHONE = Buffer.from('conduit-pair-v1 computer-to-phone')
const AAD = 'conduit-pair/1\n'
const WORDS_LABEL = Buffer.from('conduit-pair-words-v1\n')

export const b64u = (data: Uint8Array) => Buffer.from(data).toString('base64url')
export const fromB64u = (text: string) => Buffer.from(text, 'base64url')
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest()

export interface PairKeys {
  signPrivate: KeyObject
  signPublic: Buffer
  sealPrivate: KeyObject
  sealPublic: Buffer
}

function raw(key: KeyObject): Buffer {
  return fromB64u(key.export({ format: 'jwk' }).x as string)
}

export function makePairKeys(): PairKeys {
  const sign = generateKeyPairSync('ed25519')
  const seal = generateKeyPairSync('x25519')
  return { signPrivate: sign.privateKey, signPublic: raw(sign.publicKey), sealPrivate: seal.privateKey, sealPublic: raw(seal.publicKey) }
}

/** The mailbox's name for an inbox: base64url SHA-256 of the owner's raw Ed25519 key. */
export const inboxId = (signPublic: Uint8Array) => b64u(sha256(signPublic))

/** The mailbox's owner signature (mailbox/README.md, Protocol v1). */
export function ownerAuthorization(key: KeyObject, method: string, host: string, pathAndQuery: string, body: Uint8Array, now = Date.now()): string {
  const ts = Math.floor(now / 1000)
  const nonce = b64u(randomBytes(18))
  const message = ['mailbox-v1', method.toUpperCase(), host, pathAndQuery, String(ts), nonce, b64u(sha256(body))].join('\n')
  const sig = b64u(sign(null, Buffer.from(message), key))
  return `Mailbox-Ed25519 ts=${ts},nonce=${nonce},sig=${sig}`
}

export interface PairLink {
  mailbox: string
  inbox: string
  token: string
  key: string
  expires: number
}

export function pairLink(link: PairLink, scheme = PAIR_LINK_SCHEME): string {
  const q = new URLSearchParams({ v: '1', m: link.mailbox, i: link.inbox, t: link.token, k: link.key, e: String(link.expires) })
  return `${scheme}?${q.toString()}`
}

export function parsePairLink(text: string, scheme = PAIR_LINK_SCHEME): PairLink | null {
  if (!text.startsWith(`${scheme}?`)) return null
  const q = new URLSearchParams(text.slice(scheme.length + 1))
  const expires = Number(q.get('e'))
  const link = { mailbox: q.get('m') ?? '', inbox: q.get('i') ?? '', token: q.get('t') ?? '', key: q.get('k') ?? '', expires }
  if (q.get('v') !== '1' || !/^https?:\/\//.test(link.mailbox) || !link.inbox || !link.token || fromB64u(link.key).length !== 32 || !Number.isFinite(expires)) return null
  return link
}

function boxKey(shared: Buffer, epk: Buffer, recipient: Buffer, info: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, SALT, Buffer.concat([info, epk, recipient]), 32))
}

/** The synchronous form (the typings list only the callback one). */
const agree = diffieHellman as unknown as (options: { privateKey: KeyObject; publicKey: KeyObject }) => Buffer

const x25519Public = (rawKey: Buffer) => createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(rawKey) }, format: 'jwk' })

function seal(plaintext: Uint8Array, recipientPublic: Buffer, inbox: string, info: Buffer): Buffer {
  const eph = generateKeyPairSync('x25519')
  const epk = raw(eph.publicKey)
  const shared = agree({ privateKey: eph.privateKey, publicKey: x25519Public(recipientPublic) })
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', boxKey(shared, epk, recipientPublic, info), nonce, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(AAD + inbox), { plaintextLength: plaintext.length })
  const c = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  return Buffer.from(JSON.stringify({ v: 1, epk: b64u(epk), n: b64u(nonce), c: b64u(c) }))
}

/** What the phone does (here for tests, and as the reference for the phone's code). */
export const sealForComputer = (plaintext: Uint8Array, recipientPublic: Buffer, inbox: string) => seal(plaintext, recipientPublic, inbox, TO_COMPUTER)

/** Seals sign-ins to a phone's key, for its inbox. */
export const sealForPhone = (plaintext: Uint8Array, phonePublic: Buffer, inbox: string) => seal(plaintext, phonePublic, inbox, TO_PHONE)

export interface OpenedBox {
  plaintext: Buffer
  ephemeralPublic: Buffer
}

function open(envelope: Uint8Array, keys: Pick<PairKeys, 'sealPrivate' | 'sealPublic'>, inbox: string, info: Buffer): OpenedBox {
  const parsed = JSON.parse(Buffer.from(envelope).toString('utf8')) as { v?: unknown; epk?: unknown; n?: unknown; c?: unknown }
  if (parsed.v !== 1 || typeof parsed.epk !== 'string' || typeof parsed.n !== 'string' || typeof parsed.c !== 'string') throw new Error('Not a pairing envelope.')
  const epk = fromB64u(parsed.epk)
  const nonce = fromB64u(parsed.n)
  const c = fromB64u(parsed.c)
  if (epk.length !== 32 || nonce.length !== 12 || c.length < 16) throw new Error('Not a pairing envelope.')
  const shared = agree({ privateKey: keys.sealPrivate, publicKey: x25519Public(epk) })
  const decipher = createDecipheriv('aes-256-gcm', boxKey(shared, epk, keys.sealPublic, info), nonce, { authTagLength: 16 })
  decipher.setAAD(Buffer.from(AAD + inbox), { plaintextLength: c.length - 16 })
  decipher.setAuthTag(c.subarray(c.length - 16))
  const plaintext = Buffer.concat([decipher.update(c.subarray(0, c.length - 16)), decipher.final()])
  return { plaintext, ephemeralPublic: epk }
}

/** Opens the phone's envelope, or throws when it isn't for this key and inbox. */
export const openFromPhone = (envelope: Uint8Array, keys: Pick<PairKeys, 'sealPrivate' | 'sealPublic'>, inbox: string) => open(envelope, keys, inbox, TO_COMPUTER)

/** What the phone does with sign-ins sealed to it (for tests, and the phone's reference). */
export const openFromComputer = (envelope: Uint8Array, keys: Pick<PairKeys, 'sealPrivate' | 'sealPublic'>, inbox: string) => open(envelope, keys, inbox, TO_PHONE)

/** The four words both screens show. */
export function pairWords(computerPublic: Uint8Array, ephemeralPublic: Uint8Array): string[] {
  const digest = sha256(Buffer.concat([WORDS_LABEL, computerPublic, ephemeralPublic]))
  const bits = digest.readUIntBE(0, 6) / 16 // the first 44 bits
  const n = Math.floor(bits)
  return [33, 22, 11, 0].map(shift => BIP39_WORDS[Math.floor(n / 2 ** shift) % 2048]!)
}

/** The private key back from its JWK, for keys kept between steps. */
export const keyFromJwk = (jwk: object) => createPrivateKey({ key: jwk as never, format: 'jwk' })
