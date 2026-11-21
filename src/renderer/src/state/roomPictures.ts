/**
 * A room message's pictures, read back from Hermes with
 * `groups.attachment.download` by the message that carries them, and kept
 * for the window's life so a poll or a scroll doesn't read them again. An
 * answer over 16 MB, or one that isn't a picture's base64, reads as gone
 * (its name shows instead) and isn't asked for again, as on the phone; a
 * read that fails may load when the message is shown again. A dashboard
 * switch drops them, so another Hermes's file never draws here (desktop#222).
 */
import { gateway } from '../gateway'
import { pictureType } from './attachments'
import { ROOM_FILE_READ_PATH, pictureFromRead } from './roomFiles'

const MAX_BYTES = 16 * 1024 * 1024
/** Read pictures by attachment id: a data URL, or null for one that won't load. */
export const keptPictures = new Map<string, string | null>()
const reading = new Map<string, Promise<string | null>>()

/** Drops every kept picture: the window now shows another dashboard. */
export function forgetRoomPictures(): void {
  keptPictures.clear()
  reading.clear()
  keptStored.clear()
  readingStored.clear()
}

/** The picture as a data URL, or null when it's gone or isn't one. */
export function pictureFromDownload(result: unknown): string | null {
  const data = (result as { data_base64?: unknown } | null)?.data_base64
  if (typeof data !== 'string' || !data || data.length > Math.ceil(MAX_BYTES / 3) * 4) return null
  try {
    const head = Uint8Array.from(atob(data.slice(0, 24)), c => c.charCodeAt(0))
    const mime = pictureType(head)
    return mime ? `data:${mime};base64,${data}` : null
  } catch {
    return null
  }
}

export function readRoomPicture(roomId: string, eventId: string, attachmentId: string): Promise<string | null> {
  if (keptPictures.has(attachmentId)) return Promise.resolve(keptPictures.get(attachmentId) ?? null)
  let read = reading.get(attachmentId)
  if (!read) {
    read = gateway
      .rpc('groups.attachment.download', { room_id: roomId, event_id: eventId, attachment_id: attachmentId })
      .then(
        result => {
          const url = pictureFromDownload(result)
          if (reading.get(attachmentId) === read) keptPictures.set(attachmentId, url)
          return url
        },
        // A failed read (no connection) may load on a later look.
        () => null
      )
      .finally(() => {
        if (reading.get(attachmentId) === read) reading.delete(attachmentId)
      })
    reading.set(attachmentId, read)
  }
  return read
}

/** Pictures the plugin stored for a room (`@file:` lines), read back by their path. */
const keptStored = new Map<string, string | null>()
const readingStored = new Map<string, Promise<string | null>>()

export const keptStoredPicture = (path: string) => keptStored.get(path)

export function readStoredPicture(path: string): Promise<string | null> {
  if (keptStored.has(path)) return Promise.resolve(keptStored.get(path) ?? null)
  let read = readingStored.get(path)
  if (!read) {
    read = gateway
      .http('GET', `${ROOM_FILE_READ_PATH}?path=${encodeURIComponent(path)}`)
      .then(
        result => {
          const url = pictureFromRead(result)
          if (readingStored.get(path) === read) keptStored.set(path, url)
          return url
        },
        () => null
      )
      .finally(() => {
        if (readingStored.get(path) === read) readingStored.delete(path)
      })
    readingStored.set(path, read)
  }
  return read
}
