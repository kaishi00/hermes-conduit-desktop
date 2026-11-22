/**
 * Saves a small file so a crash or power loss mid-save leaves the old copy or
 * the new one, never a torn file (desktop#297): the bytes go to a temporary
 * file beside it, are flushed to disk, and then replace it in one rename.
 */
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

export function writeFileAtomic(path: string, data: string, mode = 0o666): void {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    const fd = openSync(temp, 'w', mode)
    try {
      writeSync(fd, data)
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
