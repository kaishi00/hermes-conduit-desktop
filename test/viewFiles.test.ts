import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { byteRange, isPagePath, isViewedFileUrl, pageReadResult, viewedFileUrl, viewedType, viewerFrame } from '../src/shared/viewFileRules'
import { frameStays } from '../src/main/linkPolicy'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

describe('a file the chat’s file card opens (desktop#554)', () => {
  it('is copied down only when it’s a picture, sound, video or PDF, served as its type', () => {
    expect(viewedType('/srv/out/Report.PDF')).toBe('application/pdf')
    expect(viewedType('C:\\clips\\take.mp4')).toBe('video/mp4')
    expect(viewedType('/a/voice.ogg')).toBe('audio/ogg')
    expect(viewedType('/a/logo.svg')).toBe('image/svg+xml')
    expect(viewedType('/a/page.html')).toBeNull()
    expect(viewedType('/a/notes.md')).toBeNull()
    expect(viewedType('/a/Makefile')).toBeNull()
    expect(viewedType('/a/.pdf')).toBeNull()
  })

  it('opens a page in the browser only for .html, .htm and .xhtml', () => {
    expect(isPagePath('/a/report.html')).toBe(true)
    expect(isPagePath('/a/report.HTM')).toBe(true)
    expect(isPagePath('/a/report.xhtml')).toBe(true)
    expect(isPagePath('/a/report.html.txt')).toBe(false)
    expect(isPagePath('/a/report')).toBe(false)
  })

  it('has a copy address on its own scheme, whose frames (and the PDF viewer’s) stay', () => {
    const url = viewedFileUrl('abc', '/a/b/clip.webm')
    expect(url).toBe('conduit-file://abc/file.webm')
    expect(isViewedFileUrl(url)).toBe(true)
    expect(frameStays(false, viewerFrame(url))).toBe(true)
    expect(viewerFrame('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html')).toBe(true)
    expect(viewerFrame('chrome-extension://someoneelse/index.html')).toBe(false)
    expect(viewerFrame('https://example.com/')).toBe(false)
  })

  it('answers the byte range a player asks for', () => {
    expect(byteRange(null, 100)).toBeNull()
    expect(byteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(byteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(byteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(byteRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 })
    expect(byteRange('bytes=-300', 100)).toEqual({ start: 0, end: 99 })
    expect(byteRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(byteRange('bytes=20-10', 100)).toBe('unsatisfiable')
    expect(byteRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(byteRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(byteRange('bytes=0-1,4-5', 100)).toBeNull()
    expect(byteRange('items=0-1', 100)).toBeNull()
  })

  it('is shown by its kind, and the card offers Open, with Open in Browser for a page', async () => {
    // Paths the node typecheck doesn't follow: the components are the renderer's, checked by tsconfig.web.json.
    const viewer = '../src/renderer/src/components/FileViewer.tsx'
    const transcript = '../src/renderer/src/components/Transcript.tsx'
    const { viewerKind } = (await import(/* @vite-ignore */ viewer)) as { viewerKind: (path: string) => string }
    expect(viewerKind('/a/site/index.html')).toBe('page')
    expect(viewerKind('/a/site/index.xhtml')).toBe('page')
    expect(viewerKind('/a/paper.pdf')).toBe('pdf')
    expect(viewerKind('/a/README.md')).toBe('markdown')
    expect(viewerKind('/a/clip.mov')).toBe('video')
    expect(viewerKind('/a/voice.m4a')).toBe('audio')
    expect(viewerKind('/a/shot.png')).toBe('image')
    expect(viewerKind('/a/data.csv')).toBe('text')
    expect(viewerKind('/a/IMG_0001.HEIC')).toBe('text')
    expect(viewerKind('/a/old.avi')).toBe('text')
    const { Reply } = (await import(/* @vite-ignore */ transcript)) as { Reply: unknown }
    const page = renderToStaticMarkup(createElement(Reply as never, { text: 'Here it is.\n\nMEDIA:/srv/out/report.html' }))
    expect(page).toContain('>Open<')
    expect(page).toContain('>Open in Browser<')
    expect(page).toContain('>Download<')
    const clip = renderToStaticMarkup(createElement(Reply as never, { text: 'MEDIA:/srv/out/clip.mp4' }))
    expect(clip).toContain('>Open<')
    expect(clip).not.toContain('Open in Browser')
  })
})

describe('what Open in Browser got from read-text (issue 564)', () => {
  it('writes text only when text came back, downloads as a page only when the answer said so', () => {
    expect(pageReadResult('<html>mine</html>')).toEqual({ text: '<html>mine</html>', asPage: false })
    expect(pageReadResult({ page: true })).toEqual({ asPage: true })
    // A dashboard's HTML answer or an unreadable file is not a page to open.
    expect(pageReadResult(null)).toBeNull()
  })
})

describe('a copy the viewer or Open in Browser makes (copyDown)', () => {
  const setup = async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    return join(await mkdtemp(join(tmpdir(), 'conduit-copy-')), 'copy')
  }

  it('passes its cancel signal to the data-url fallback', async () => {
    const { copyDown } = await import('../src/main/hostFiles')
    const file = await setup()
    let seen: AbortSignal | undefined
    await copyDown(
      file,
      async () => { throw Object.assign(new Error('404'), { code: 404 }) },
      async signal => { seen = signal; return Buffer.from('PNG') }
    )
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen?.aborted).toBe(false)
  })

  it('takes a dashboard page answering the download route as no route, and reads the data URL', async () => {
    const { copyDown } = await import('../src/main/hostFiles')
    const { readFile } = await import('node:fs/promises')
    const file = await setup()
    let cancelled = false
    const body = new ReadableStream({ start: c => c.enqueue(new TextEncoder().encode('<html>dashboard</html>')), cancel: () => void (cancelled = true) })
    await copyDown(file, async () => new Response(body, { headers: { 'content-type': 'text/html' } }), async () => Buffer.from('PNG'))
    expect(await readFile(file, 'utf8')).toBe('PNG')
    expect(cancelled).toBe(true)
  })

  it('takes a page’s own HTML download as the file when copying a page', async () => {
    const { copyDown } = await import('../src/main/hostFiles')
    const { readFile } = await import('node:fs/promises')
    const file = await setup()
    await copyDown(file, async () => new Response('<html>mine</html>', { headers: { 'content-type': 'text/html' } }), async () => null, undefined, true)
    expect(await readFile(file, 'utf8')).toBe('<html>mine</html>')
  })

  it('stops when cancelled and leaves no file', async () => {
    const { copyDown } = await import('../src/main/hostFiles')
    const { readdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const file = await setup()
    const cancel = new AbortController()
    const slow = async (signal: AbortSignal) =>
      new Response(new ReadableStream({ start: c => { c.enqueue(new Uint8Array(100)); signal.addEventListener('abort', () => c.error(new Error('aborted'))) } }), { headers: { 'content-type': 'video/mp4' } })
    const copying = copyDown(file, slow, async () => Buffer.from('x'), cancel.signal)
    setTimeout(() => cancel.abort(), 50)
    await expect(copying).rejects.toThrow()
    expect(await readdir(dirname(file))).toEqual([])
  })
})
