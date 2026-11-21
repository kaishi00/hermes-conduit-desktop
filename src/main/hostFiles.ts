/**
 * Saving a file that lives on the Hermes host: its name for the save dialog,
 * the dashboard path it's read from, a data URL's bytes for a Hermes
 * without /api/fs/download, and the download written into place whole.
 */
import { createWriteStream } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { open, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
 * as it was (desktop#206). Each save has its own part file (24 random bits),
 * so two saves to the same path practically never write into one (about one
 * in 16.7 million for two at once), and it's flushed to disk before the
 * rename, so a crash can't leave an empty file in its place (desktop#216).
 * Its name stays short (a Windows path near MAX_PATH), and part files of the
 * same destination a crash left over a day ago are swept as a save starts.
 * `abort` stops the request that feeds `body`.
 */
export async function streamToFile(body: ReadableStream, destination: string, abort?: () => void, idleMs = DOWNLOAD_IDLE_MS): Promise<void> {
  const part = `${destination}.${randomBytes(3).toString('hex')}.conduit-part`
  await sweepStaleParts(destination)
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

export const STALE_PART_MS = 24 * 60 * 60 * 1000

/**
 * A part file's name after its destination's, as each build named it:
 * `.<6 hex>.conduit-part` now, `.<pid>-<8 hex>.conduit-part` and a bare
 * `.conduit-part` before (desktop#238, desktop#213). So `foo.txt`'s sweep
 * never takes `foo.txt.bak.<hex>.conduit-part`, another destination's.
 */
const PART_SUFFIX = /^(?:[0-9a-f]{6}\.|\d+-[0-9a-f]{8}\.)?conduit-part$/

/** Whether `name` is one of `destination`'s part files. */
export function isPartOf(name: string, destination: string): boolean {
  const prefix = `${basename(destination)}.`
  return name.startsWith(prefix) && PART_SUFFIX.test(name.slice(prefix.length))
}

/** Removes `destination`'s part files older than STALE_PART_MS, left by a save a crash cut off. */
export async function sweepStaleParts(destination: string, now = Date.now()): Promise<void> {
  const dir = dirname(destination)
  try {
    for (const name of await readdir(dir)) {
      if (!isPartOf(name, destination)) continue
      const path = join(dir, name)
      const info = await stat(path).catch(() => null)
      if (info && now - info.mtimeMs > STALE_PART_MS) await rm(path, { force: true }).catch(() => undefined)
    }
  } catch {
    // A folder that can't be listed has nothing to sweep here; the save says what's wrong.
  }
}
