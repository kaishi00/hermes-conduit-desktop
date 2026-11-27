/**
 * Pictures and files sent with a message, as the phone sends them: each
 * staged in the composer, then sent up when the message is. A picture goes
 * with `image.attach_bytes` (as a file when Hermes won't take it as an image);
 * any other file goes with `file.attach`, and the prompt names it with the
 * `@file:` reference Hermes hands back. A paste over 3,000 characters goes as
 * a text file named the way Hermes Desktop names a paste.
 */
import { t } from '../../../shared/i18n'

/**
 * The largest file the composer stages, after the phone's Settings › Chat ›
 * Attachments: 16 MB by default, up to the 256 MB the Hermes host accepts.
 * Kept on this computer, as the phone keeps it on the phone. Every file is
 * held in memory and base64-encoded before it's sent, so Settings warns
 * above the default. A group room's own limits still apply under it.
 */
export const ATTACHMENT_LIMIT_KEY = 'conduit.attachmentSizeLimitMB'
export const DEFAULT_ATTACHMENT_LIMIT_MB = 16
/** What the Hermes host accepts per upload. */
export const HOST_MAX_ATTACHMENT_MB = 256
export const ATTACHMENT_LIMIT_CHOICES = [8, 16, 32, 64, 128, 256] as const

type LimitStorage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

function defaultStorage(): LimitStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** One of the choices: anything else (a hand-edited value) is the default, so Settings can always show it. */
export function clampAttachmentLimit(value: number): number {
  return (ATTACHMENT_LIMIT_CHOICES as readonly number[]).includes(value) ? value : DEFAULT_ATTACHMENT_LIMIT_MB
}

/** The pick made while storage couldn't keep it, for the rest of this window. */
let unsaved: number | null = null

/** The limit set on this computer, in MB. */
export function attachmentLimitMB(storage: LimitStorage | null = defaultStorage()): number {
  if (unsaved !== null) return unsaved
  let saved: string | null = null
  try {
    saved = storage?.getItem(ATTACHMENT_LIMIT_KEY) ?? null
  } catch {
    // Private storage: the default stands.
  }
  return saved === null ? DEFAULT_ATTACHMENT_LIMIT_MB : clampAttachmentLimit(Number(saved))
}

export function setAttachmentLimitMB(megabytes: number, storage: LimitStorage | null = defaultStorage()): number {
  const next = clampAttachmentLimit(megabytes)
  try {
    if (!storage) throw new Error('no storage')
    storage.setItem(ATTACHMENT_LIMIT_KEY, String(next))
    unsaved = null
  } catch {
    // Private storage: it lasts until the window closes.
    unsaved = next
  }
  return next
}

export const attachmentLimitBytes = (megabytes = attachmentLimitMB()) => clampAttachmentLimit(megabytes) * 1024 * 1024

/** Above the default, Settings warns about memory. */
export const isRiskyAttachmentLimit = (megabytes: number) => clampAttachmentLimit(megabytes) > DEFAULT_ATTACHMENT_LIMIT_MB
/** Hermes Desktop's threshold for a paste that goes as a file. */
export const LONG_PASTE_CHARACTERS = 3000
/** The pictures every model provider reads; others go as files. */
export const PROVIDER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export interface StagedAttachment {
  id: string
  name: string
  /** A picture goes as an image; anything else as a file. */
  kind: 'image' | 'file'
  mime: string
  size: number
  /** The file's bytes, base64, without a data: prefix. */
  base64: string
  /** A long paste's words, for its chip and the chat's title. */
  pastedText?: string
}

export function isPicture(mime: string): boolean {
  return PROVIDER_IMAGE_TYPES.includes(mime.toLowerCase())
}

/** Desktop's name for a saved paste, `pasted_content_<stamp>_<hex>.txt`. */
export function pastedTextName(now = new Date(), random = Math.floor(Math.random() * 0x1000000)): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  const stamp =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}_` +
    `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}-${pad(now.getUTCMilliseconds(), 3)}`
  return `pasted_content_${stamp}_${random.toString(16).padStart(6, '0')}.txt`
}

export function isPastedTextName(name: string): boolean {
  const last = name.split(/[\\/]/).pop() ?? name
  return /^.*pasted_content_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}_[0-9a-f]{6}(?:-\d+)?\.txt$/.test(last)
}

/** What a staged file is called on its chip and in the sent message. */
export function displayName(name: string): string {
  return isPastedTextName(name) ? t('Pasted text') : name
}

/** UTF-8 text as base64, for a paste staged as a file. */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function stagePaste(text: string, id: string, now = new Date()): StagedAttachment {
  const base64 = textToBase64(text)
  return { id, name: pastedTextName(now), kind: 'file', mime: 'text/plain', size: Math.floor((base64.length * 3) / 4), base64, pastedText: text }
}

/** The message's first 1,000 characters of its paste, so a chat that opens with one gets a title from its words. */
export function titlePreview(attachments: StagedAttachment[], limit = 1000): string | undefined {
  const preview = attachments.find(a => a.pastedText !== undefined)?.pastedText?.slice(0, limit).trim()
  return preview || undefined
}

/** Where the limit can be raised, while it can be. */
function raiseHint(megabytes: number): string {
  return clampAttachmentLimit(megabytes) < HOST_MAX_ATTACHMENT_MB ? ` ${t('You can raise the limit in Settings › Attachments.')}` : ''
}

/** The refusal for files over the limit, naming them. */
export function tooLargeMessage(names: string[], megabytes = attachmentLimitMB()): string {
  const limit = clampAttachmentLimit(megabytes)
  const refusal =
    names.length === 1
      ? t('{name} is larger than the {limit} MB attachment limit.', { name: names[0], limit })
      : t('These files are larger than the {limit} MB attachment limit: {names}.', { limit, names: names.join(', ') })
  return refusal + raiseHint(limit)
}

/** The refusal for a recorded voice message over the limit. */
export function voiceTooLargeMessage(megabytes = attachmentLimitMB()): string {
  const limit = clampAttachmentLimit(megabytes)
  return t('This voice message is larger than the {limit} MB attachment limit.', { limit }) + raiseHint(limit)
}

/** Quotes a reference value holding whitespace, brackets or quotes, as Hermes' `format_reference_value` does. */
export function formatReferenceValue(value: string): string {
  if (!/[\s()[\]{}<>"'`]/.test(value)) return value
  for (const quote of ['`', '"', "'"]) if (!value.includes(quote)) return `${quote}${value}${quote}`
  return value
}

/** The `@file:` reference from a `file.attach` reply: its `ref_text`, else one built from the stored path. */
export function fileReference(result: unknown): string | null {
  const object = (result ?? {}) as Record<string, unknown>
  const ref = typeof object.ref_text === 'string' ? object.ref_text.trim() : ''
  if (ref.startsWith('@file:') && ref.length > '@file:'.length) return ref
  for (const key of ['ref_path', 'path']) {
    const path = typeof object[key] === 'string' ? (object[key] as string).trim() : ''
    if (path) return `@file:${formatReferenceValue(path)}`
  }
  return null
}

/** The words Hermes gets: the files' references, then what was typed. */
export function promptText(text: string, references: string[]): string {
  const refs = references.join('\n')
  if (!refs) return text
  if (!text.trim()) return refs
  return `${refs}\n\n${text}`
}

/** Hermes refused an upload as an image (a type it doesn't list, or past its image cap), not failed to store it. */
export function isImageAttachRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 4016 || code === 4018
}

export type Rpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>

export interface UploadOutcome {
  /** `@file:` lines for the prompt. */
  references: string[]
  /** Pictures the session authority staged, which the prompt names in `attachments`. */
  images: { path: string; mime: string }[]
  /** Pictures the dashboard holds for the next message, to take back if the send fails. */
  heldImagePaths: string[]
}

/**
 * Sends a message's files up, one after another. If one fails, the pictures
 * already held for the chat are taken back so none rides on a later message,
 * and the error is thrown.
 */
export async function uploadAttachments(
  rpc: Rpc,
  sessionId: string,
  profile: string | undefined,
  authority: boolean,
  attachments: StagedAttachment[]
): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { references: [], images: [], heldImagePaths: [] }
  const base = (): Record<string, unknown> => (profile ? { session_id: sessionId, profile } : { session_id: sessionId })
  const asFile = async (a: StagedAttachment) => {
    const result = await rpc<unknown>('file.attach', { ...base(), data_url: `data:${a.mime || 'application/octet-stream'};base64,${a.base64}`, name: a.name, path: '' })
    const ref = fileReference(result)
    if (ref) outcome.references.push(ref)
  }
  try {
    for (const a of attachments) {
      if (a.kind !== 'image') {
        await asFile(a)
        continue
      }
      try {
        const result = await rpc<{ path?: string | null; mime?: string | null }>('image.attach_bytes', { ...base(), content_base64: a.base64, filename: a.name })
        const path = result?.path ?? ''
        if (!path) continue
        if (authority) outcome.images.push({ path, mime: result.mime || a.mime })
        else outcome.heldImagePaths.push(path)
      } catch (error) {
        if (!isImageAttachRefusal(error)) throw error
        await asFile(a)
      }
    }
    return outcome
  } catch (error) {
    await releaseHeldImages(rpc, sessionId, profile, outcome.heldImagePaths)
    throw error
  }
}

/** Takes back pictures the dashboard holds for the chat's next message. */
export async function releaseHeldImages(rpc: Rpc, sessionId: string, profile: string | undefined, paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await rpc('image.detach', profile ? { session_id: sessionId, profile, path } : { session_id: sessionId, path })
    } catch {
      // Best effort: the send already failed.
    }
  }
}


// Group rooms ----------------------------------------------------------

/** Hermes' limits for a room message's files (gateway/hosted_room_attachments.py). */
export const ROOM_MAX_FILES = 8
export const ROOM_MAX_FILE_BYTES = 15_000_000
export const ROOM_MAX_MESSAGE_BYTES = 25_000_000

function firstBytes(base64: string, count: number): Uint8Array {
  const chars = Math.ceil(count / 3) * 4
  const binary = atob(base64.slice(0, chars))
  return Uint8Array.from(binary.slice(0, count), c => c.charCodeAt(0))
}

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0) => prefix.every((b, i) => bytes[at + i] === b)
const ascii = (text: string) => Array.from(text, c => c.charCodeAt(0))

/** The picture type Hermes recognizes these bytes as, or null. */
export function pictureType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

const PICTURE_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp']
}
const OTHER_PICTURE_EXTENSIONS = ['heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'svg', 'jxl']

/** The extension a picture of this type is named with: "jpg" for a JPEG, as the phone names it, never "jpeg" (#3366). */
export function pictureExtension(mime: string): string {
  const known = PICTURE_EXTENSIONS[mime]?.[0]
  if (known) return known
  const subtype = (mime.split('/')[1] ?? '').split('+')[0]
  return subtype || 'png'
}

/**
 * `name` with the picture extension `ext`: a picture extension it already has
 * is replaced, any other ending ("Event 8.30", a domain) stays part of the
 * name, and trailing dots go, as on the phone (issue 3331).
 */
export function withPictureExtension(name: string, ext: string): string {
  const trimmed = name.replace(/\.+$/, '')
  const dot = trimmed.lastIndexOf('.')
  const current = dot > 0 ? trimmed.slice(dot + 1).toLowerCase() : ''
  const pictureEnding = Object.values(PICTURE_EXTENSIONS).flat().includes(current) || OTHER_PICTURE_EXTENSIONS.includes(current)
  const stem = pictureEnding ? trimmed.slice(0, dot) : trimmed
  return `${stem || 'image'}.${ext}`
}

/**
 * A picture's type from its bytes, and its name with that type's extension,
 * or null when Hermes wouldn't take the bytes as a picture. Hermes stages a
 * picture under its name's extension, so a name ending in something else
 * ("Event 8.30") gets the extension added and a wrong picture extension
 * ("flyer.jpg" holding a PNG) is replaced, as on the phone (issue 3331).
 */
export function typedPicture(name: string, base64: string): { name: string; mime: string } | null {
  if (!base64) return null
  const mime = pictureType(firstBytes(base64, 16))
  if (!mime) return null
  const extensions = PICTURE_EXTENSIONS[mime]
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (extensions.includes(ext)) return { name, mime }
  return { name: withPictureExtension(name, extensions[0]), mime }
}

function isPlainText(base64: string): boolean {
  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    if (bytes.includes(0)) return false
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/** The kind and type Hermes takes a staged file as in a room, or null where it takes it as nothing. */
export function roomUploadKind(a: StagedAttachment): { kind: 'image' | 'pdf' | 'file'; mime: string } | null {
  if (!a.base64 || a.size > ROOM_MAX_FILE_BYTES) return null
  const head = firstBytes(a.base64, 16)
  const picture = pictureType(head)
  if (picture) return { kind: 'image', mime: picture }
  if (startsWith(head, ascii('%PDF-'))) return { kind: 'pdf', mime: 'application/pdf' }
  const declared = a.mime.toLowerCase()
  // A picture or PDF Hermes doesn't recognize (HEIC, a damaged file) isn't taken as a plain file.
  if (declared.startsWith('image/') || declared === 'application/pdf') return null
  if (declared.startsWith('text/') || !declared || declared === 'application/octet-stream') {
    return isPlainText(a.base64) ? { kind: 'file', mime: 'text/plain' } : declared.startsWith('text/') ? null : { kind: 'file', mime: 'application/octet-stream' }
  }
  return { kind: 'file', mime: declared }
}

/** Why these files can't go into a room message, checked before anything goes up, or null. */
export function roomUploadProblem(attachments: StagedAttachment[]): string | null {
  const refused = attachments.filter(a => !roomUploadKind(a))
  if (refused.length) return t('A group chat can’t take {names}.', { names: refused.map(a => displayName(a.name)).join(', ') })
  if (attachments.length > ROOM_MAX_FILES) return t('A group chat message takes up to {count} files.', { count: ROOM_MAX_FILES })
  if (attachments.reduce((sum, a) => sum + a.size, 0) > ROOM_MAX_MESSAGE_BYTES) return t('A group chat message takes up to 25 MB of files.')
  return null
}

async function digest(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
}

/** The staged file and its bytes: a retry of the same file reuses the upload Hermes kept. */
export async function roomUploadId(a: StagedAttachment): Promise<string> {
  const staged = a.id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)
  return `conduit-${staged}-${await digest(a.base64)}`
}

export interface RoomManifest {
  attachment_id: string
  kind: string
  name: string
  size: number
  mime: string
}

/** Uploads a room message's files with `groups.attachment.upload`, for `groups.send`'s `attachments`. */
export async function uploadRoomAttachments(rpc: Rpc, roomId: string, attachments: StagedAttachment[]): Promise<RoomManifest[]> {
  const problem = roomUploadProblem(attachments)
  if (problem) throw new Error(problem)
  const manifests: RoomManifest[] = []
  for (const a of attachments) {
    const { kind, mime } = roomUploadKind(a)!
    const result = await rpc<Record<string, unknown>>('groups.attachment.upload', {
      room_id: roomId,
      upload_id: await roomUploadId(a),
      kind,
      name: a.name,
      mime,
      data_base64: a.base64
    })
    const id = typeof result?.attachment_id === 'string' ? result.attachment_id : ''
    if (!id) throw new Error(t('Hermes didn’t keep {name}.', { name: displayName(a.name) }))
    manifests.push({
      attachment_id: id,
      kind: typeof result.kind === 'string' ? result.kind : kind,
      name: typeof result.name === 'string' ? result.name : a.name,
      size: typeof result.size === 'number' ? result.size : a.size,
      mime: typeof result.mime === 'string' ? result.mime : mime
    })
  }
  return manifests
}
