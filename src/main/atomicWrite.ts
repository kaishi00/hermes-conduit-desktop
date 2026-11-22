/**
 * Saves a small file so a crash or power loss mid-save leaves the old copy or
 * the new one, never a torn file (desktop#297): the bytes go to a temporary
 * file beside it, are flushed to disk, and then replace it in one rename.
 */
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export function writeFileAtomic(path: string, data: string, mode = 0o666): void {
  sweepTemporary(path)
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    const fd = openSync(temp, 'w', mode)
    try {
      // writeFileSync on a descriptor writes every byte, where one writeSync may write fewer.
      writeFileSync(fd, data)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, path)
  } catch (e) {
    rmSync(temp, { force: true })
    throw e
  }
}

/** Temporary files an earlier save left when the app died mid-write. */
function sweepTemporary(path: string): void {
  const name = basename(path)
  try {
    for (const entry of readdirSync(dirname(path))) {
      if (entry.startsWith(`${name}.`) && entry.endsWith('.tmp') && /^[0-9a-f]{8}$/.test(entry.slice(name.length + 1, -4))) rmSync(join(dirname(path), entry), { force: true })
    }
  } catch {
    // Left for the next save.
  }
}

/**
 * Keeps a copy of a file that's there but can't be read, beside it as `.corrupt`,
 * before the next save replaces it, so what it held isn't lost for good.
 */
export function keepUnreadable(path: string): void {
  try {
    if (existsSync(path)) copyFileSync(path, `${path}.corrupt`)
  } catch {
    // Nothing more to keep.
  }
}
