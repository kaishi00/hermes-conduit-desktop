import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadableStream } from 'node:stream/web'
import { dataUrlBytes as hostBytes, hostFileName, hostFilePath, streamToFile } from '../src/main/hostFiles'
import { dataUrlBytes, pictureFileName } from '../src/renderer/src/state/saveMedia'

describe('saving pictures, files and audio to this computer', () => {
  it('names the file from the host path, safely', () => {
    expect(hostFileName('/home/h/out/voice note.ogg')).toBe('voice note.ogg')
    expect(hostFileName('C:\\Users\\h\\a:b?.txt')).toBe('a_b_.txt')
    expect(hostFileName('/tmp/')).toBe('tmp')
    expect(hostFileName('..')).toBe('file')
  })

  it("reads from the dashboard, in a secondary bot's profile", () => {
    expect(hostFilePath('download', '/a b.png')).toBe('/api/fs/download?path=%2Fa%20b.png')
    expect(hostFilePath('read-data-url', '/x', 'nahida')).toBe('/api/fs/read-data-url?path=%2Fx&profile=nahida')
    expect(hostFilePath('download', '/x', 'default')).toBe('/api/fs/download?path=%2Fx')
  })

  it('writes a download into place only once every byte is in (desktop#206)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-save-'))
    const whole = join(dir, 'whole.png')
    await streamToFile(bytesThen(['ab', 'cd']), whole)
    expect(await readFile(whole, 'utf8')).toBe('abcd')

    const cut = join(dir, 'cut.png')
    await expect(streamToFile(bytesThen(['ab'], new Error('socket hang up')), cut)).rejects.toThrow('socket hang up')
    expect(await readdir(dir)).toEqual(['whole.png'])

    // A file already at the chosen path stays as it was.
    await expect(streamToFile(bytesThen(['xy'], new Error('reset')), whole)).rejects.toThrow('reset')
    expect(await readFile(whole, 'utf8')).toBe('abcd')
  })

  it('gives two saves to the same path a part file each (desktop#216)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-save-'))
    const target = join(dir, 'same.txt')
    const big = (letter: string) => Array.from({ length: 64 }, () => letter.repeat(4096))
    await Promise.all([streamToFile(bytesThen(big('a')), target), streamToFile(bytesThen(big('b')), target)])
    const text = await readFile(target, 'utf8')
    expect(text.length).toBe(64 * 4096)
    expect(new Set(text).size).toBe(1)
    expect(await readdir(dir)).toEqual(['same.txt'])
  })

  it('gives up on a download that stops sending, and stops its request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-save-'))
    const target = join(dir, 'stalled.bin')
    await writeFile(join(dir, 'other'), '')
    let aborted = false
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ab'))
      }
    })
    await expect(streamToFile(stalled, target, () => (aborted = true), 30)).rejects.toThrow('stopped sending')
    expect(aborted).toBe(true)
    expect(await readdir(dir)).toEqual(['other'])
  })

  it("decodes a data URL's bytes", () => {
    expect(hostBytes('data:audio/ogg;base64,aGk=')?.toString()).toBe('hi')
    expect(hostBytes('data:text/plain,hi')).toBeNull()
    expect(hostBytes(3)).toBeNull()
    expect(new TextDecoder().decode(dataUrlBytes('data:image/png;base64,aGk=')!)).toBe('hi')
    expect(dataUrlBytes('https://x/y.png')).toBeNull()
  })

  it("gives a picture the extension its data names", () => {
    expect(pictureFileName('cat.png', 'data:image/jpeg;base64,')).toBe('cat.png')
    expect(pictureFileName('cat', 'data:image/jpeg;base64,')).toBe('cat.jpg')
    expect(pictureFileName('', 'data:image/svg+xml;base64,')).toBe('Picture.svg')
    expect(pictureFileName('cat', 'blob:x')).toBe('cat')
  })
})

/** A download body that sends `chunks`, then fails with `error` or ends. */
function bytesThen(chunks: string[], error?: Error): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      if (error) controller.error(error)
      else controller.close()
    }
  })
}
