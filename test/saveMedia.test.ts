import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadableStream } from 'node:stream/web'
import { dataUrlBytes as hostBytes, hostFileName, hostFilePath, isDashboardPage, isPartOf, kanbanAttachmentPath, streamToFile, STALE_PART_MS } from '../src/main/hostFiles'
import { copyPicture, dataUrlBytes, pictureFileName } from '../src/renderer/src/state/saveMedia'

describe('saving pictures, files and audio to this computer', () => {
  it("saves a Kanban attachment from its board's route, never the dashboard's page in its place", () => {
    expect(kanbanAttachmentPath('3', null)).toBe('/api/plugins/kanban/attachments/3')
    expect(kanbanAttachmentPath('a/b', 'my board')).toBe('/api/plugins/kanban/attachments/a%2Fb?board=my%20board')
    expect(isDashboardPage('text/html; charset=utf-8', 'ROOT-HANDOFF.md')).toBe(true)
    expect(isDashboardPage('text/html', 'report.html')).toBe(false)

    expect(isDashboardPage('text/html', 'report.xhtml')).toBe(false)
    expect(isDashboardPage('text/html', 'REPORT.HTM')).toBe(false)
    expect(isDashboardPage('text/html', 'page.html5')).toBe(true)
    expect(isDashboardPage('text/html', 'report.html ')).toBe(false)
    // The check reads the attachment's own name: the save dialog's name is cut to 200 characters and loses the suffix.
    const long = `${'a'.repeat(200)}.html`
    expect(isDashboardPage('text/html', long)).toBe(false)
    expect(isDashboardPage('text/html', hostFileName(long))).toBe(true)
    expect(isDashboardPage('text/markdown', 'ROOT-HANDOFF.md')).toBe(false)
    expect(isDashboardPage(null, 'x.bin')).toBe(false)
  })

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

  it("sweeps a destination's part files a crash left a day ago", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-save-'))
    const target = join(dir, 'a.png')
    const old = join(dir, 'a.png.abc123.conduit-part')
    const fresh = join(dir, 'a.png.def456.conduit-part')
    const other = join(dir, 'b.png.abc123.conduit-part')
    for (const path of [old, fresh, other]) await writeFile(path, 'x')
    const then = new Date(Date.now() - STALE_PART_MS - 60_000)
    await utimes(old, then, then)
    await utimes(other, then, then)
    await streamToFile(bytesThen(['ok']), target)
    expect((await readdir(dir)).sort()).toEqual(['a.png', 'a.png.def456.conduit-part', 'b.png.abc123.conduit-part'])
  })

  it("sweeps only the destination's own part files, as every build named them (desktop#249)", () => {
    for (const name of ['foo.txt.abc123.conduit-part', 'foo.txt.4242-0123abcd.conduit-part', 'foo.txt.conduit-part']) expect(isPartOf(name, '/d/foo.txt')).toBe(true)
    // Another destination's (foo.txt.bak) and names that only look alike.
    for (const name of ['foo.txt.bak.abc123.conduit-part', 'foo.txt.bak.conduit-part', 'foo.txt.ABC123.conduit-part', 'foo.txt.abc12.conduit-part', 'foo.txt', 'bar.txt.abc123.conduit-part'])
      expect(isPartOf(name, '/d/foo.txt')).toBe(false)
  })

  it('takes a leftover named in another case where folders ignore case (desktop#276)', () => {
    expect(isPartOf('report.png.abc123.conduit-part', '/d/Report.png', true)).toBe(true)
    expect(isPartOf('report.png.abc123.conduit-part', '/d/Report.png', false)).toBe(false)
    // The part's own name stays strict.
    expect(isPartOf('report.png.ABC123.conduit-part', '/d/Report.png', true)).toBe(false)
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

  it("copies a picture's own bytes to the clipboard, and says when it couldn't", async () => {
    const copyImage = vi.fn(async (_bytes: ArrayBuffer) => true)
    vi.stubGlobal('window', { conduit: { copyImage } })
    try {
      expect(await copyPicture('data:image/png;base64,AQID')).toBe(true)
      expect([...new Uint8Array(copyImage.mock.calls[0]![0])]).toEqual([1, 2, 3])
      // Bytes the system can't read as a picture, and a page that can't draw them either.
      copyImage.mockResolvedValue(false)
      expect(await copyPicture('data:image/webp;base64,AQID')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
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
