/**
 * Saving a file that lives on the Hermes host: its name for the save dialog,
 * the dashboard path it's read from, a data URL's bytes for a Hermes
 * without /api/fs/download, and the download written into place whole.
 */
import { createWriteStream } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'

/** How long a download may go without a byte before the save gives up. */
export const DOWNLOAD_IDLE_MS = 60_000

/** The file's own name, safe as a save dialog's default: the last part of a host path, no folder or odd characters. */
export function hostFileName(path: string): string {
  const last = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const clean = last.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim()
  return clean && clean !== '.' && clean !== '..' ? clean.slice(0, 200) : 'file'
}

/** `/api/fs/download` or `/api/fs/read-data-url` for `path`, in a profile's scope when it isn't the default. */
export function hostFilePath(route: 'download' | 'read-data-url', path: string, profile?: string): string {
  const query = `path=${encodeURIComponent(path)}`
  return profile && profile !== 'default' ? `/api/fs/${route}?${query}&profile=${encodeURIComponent(profile)}` : `/api/fs/${route}?${query}`
}

/** A base64 data URL's bytes, or null when it isn't one. */
export function dataUrlBytes(value: unknown): Buffer | null {
  if (typeof value !== 'string') return null
  const match = /^data:[^,;]*(?:;[^,;]*)*;base64,(.*)$/s.exec(value)
  return match ? Buffer.from(match[1]!, 'base64') : null
}

/**
 * Streams a download to `destination` through a `.conduit-part` file beside
 * it, renamed into place only once every byte is in. A transfer cut short, or
 * one that sends nothing for `idleMs`, removes the part and throws, so the
 * chosen path never holds a truncated file and a file already there is left
 * as it was (desktop#206). Each save has its own part file, so two saves to
 * the same path never write into one, and it's flushed to disk before the
 * rename, so a crash can't leave an empty file in its place (desktop#216).
 * `abort` stops the request that feeds `body`.
 */
export async function streamToFile(body: ReadableStream, destination: string, abort?: () => void, idleMs = DOWNLOAD_IDLE_MS): Promise<void> {
  const part = `${destination}.${process.pid}-${randomBytes(4).toString('hex')}.conduit-part`
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Transform({
    transform(chunk, _encoding, done) {
      arm()
      done(null, chunk)
    }
  })
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      abort?.()
      stalled.destroy(new Error('The download stopped sending.'))
    }, idleMs)
  }
  arm()
  try {
    await pipeline(Readable.fromWeb(body), stalled, createWriteStream(part))
    const written = await open(part, 'r+')
    try {
      await written.sync()
    } finally {
      await written.close()
    }
    await rename(part, destination)
  } catch (error) {
    await rm(part, { force: true }).catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
