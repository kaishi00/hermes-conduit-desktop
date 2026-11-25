/**
 * Host files a chat's file card opens in Conduit's viewer (desktop#554), as
 * the phone's card opens them in its viewers: a picture, a sound, a video or
 * a PDF is copied down to a folder of Conduit's own in the system's temporary
 * folder and served from the file scheme, which answers byte ranges so a
 * player can seek. The last six copies are kept and the rest removed; the
 * folder is emptied as Conduit starts and as it quits. A page opened in the
 * browser is copied there too. The rules are in
 * src/shared/viewFileRules.ts.
 */
import { app, protocol, shell } from 'electron'
import { createReadStream, rmSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { hostFileName, streamToFile } from './hostFiles'
import { FILE_SCHEME, KEPT_VIEWS, byteRange, isPagePath, viewedFileUrl, viewedType } from '../shared/viewFileRules'

interface View {
  file: string
  type: string
}

const views = new Map<string, View>()

const folder = () => join(app.getPath('temp'), 'conduit-view')

/** Removes the copies; one another program holds open (a page the browser still shows) stays, and startup or quit carries on. */
function emptyFolder(): void {
  try {
    rmSync(folder(), { recursive: true, force: true })
  } catch (error) {
    console.warn('Conduit: viewed files left in place', error)
  }
}

/** The scheme's privileges, registered with the page scheme's before the app is ready. */
export const FILE_SCHEME_PRIVILEGES = { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }

/** Once the app is ready: empties what an earlier run left and serves the copies. */
export function serveViewedFiles(): void {
  emptyFolder()
  app.on('will-quit', emptyFolder)
  protocol.handle(FILE_SCHEME, async request => {
    const view = views.get(new URL(request.url).hostname)
    const size = view ? await stat(view.file).then(s => s.size, () => null) : null
    if (!view || size === null) return new Response('Not found', { status: 404 })
    const headers: Record<string, string> = {
      'Content-Type': view.type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
    const range = byteRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    const { start, end } = range ?? { start: 0, end: size - 1 }
    headers['Content-Length'] = String(Math.max(0, end - start + 1))
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    const body = size === 0 ? null : (Readable.toWeb(createReadStream(view.file, { start, end })) as unknown as globalThis.ReadableStream)
    return new Response(body, { status: range ? 206 : 200, headers })
  })
}

type Download = (signal: AbortSignal) => Promise<Response>
type DataUrl = () => Promise<Buffer | null>
/** Hermes' read of a file as text (/api/fs/read-text): null when it isn't text or was cut short. */
type ReadText = () => Promise<string | null>

/**
 * Copies a host file to `file`: from `download`'s stream, or `dataUrl`'s
 * bytes for a Hermes without the download route (which `download` says by
 * throwing a 404 or 405, or by answering with the dashboard's own page).
 * `cancel` stops it, and a stopped copy leaves no file.
 */
async function copyDown(file: string, download: Download, dataUrl: DataUrl, cancel?: AbortSignal): Promise<void> {
  const stop = new AbortController()
  const onCancel = () => stop.abort()
  cancel?.addEventListener('abort', onCancel)
  try {
    if (cancel?.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' })
    const response = await download(stop.signal)
    // A dashboard that serves its page for a route it doesn't know has no download route.
    if (/text\/html/i.test(response.headers.get('content-type') ?? '')) {
      void response.body?.cancel().catch(() => undefined)
      throw Object.assign(new Error('no download route'), { code: 404 })
    }
    if (!response.body) throw new Error('no body')
    await streamToFile(response.body as NodeReadableStream, file, () => stop.abort())
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if ((code !== 404 && code !== 405) || stop.signal.aborted) throw error
    const bytes = await dataUrl()
    if (cancel?.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' })
    if (!bytes) throw Object.assign(new Error('unreadable'), { code: 415 })
    await writeFile(file, bytes)
  } finally {
    cancel?.removeEventListener('abort', onCancel)
  }
}

/** Copies `path` down for the viewer and gives its address; null when the viewer doesn't show this kind of file from a copy. */
export async function viewHostFile(path: string, download: Download, dataUrl: DataUrl, cancel?: AbortSignal): Promise<string | null> {
  const type = viewedType(path)
  if (!type) return null
  await mkdir(folder(), { recursive: true })
  const id = randomUUID()
  const file = join(folder(), id)
  await copyDown(file, download, dataUrl, cancel)
  views.set(id, { file, type })
  while (views.size > KEPT_VIEWS) {
    const [oldest, view] = views.entries().next().value!
    views.delete(oldest)
    void rm(view.file, { force: true }).catch(() => undefined)
  }
  return viewedFileUrl(id, path)
}

/**
 * Copies a page (.html, .htm, .xhtml) down and opens it in the default
 * browser, where it runs as any downloaded page does (Eric 2026-11-25,
 * desktop#554). It's read as text, as the in-app frame reads it, so a
 * dashboard answering an unknown route with its own page can't stand in for
 * it; one too long for that read is downloaded. Its copy stays until Conduit
 * quits, since the browser may read it again; false when it isn't a page or
 * the system couldn't open it.
 */
export async function openPageInBrowser(path: string, readText: ReadText, download: Download, dataUrl: DataUrl): Promise<boolean> {
  if (!isPagePath(path)) return false
  const dir = join(folder(), 'pages', randomUUID())
  await mkdir(dir, { recursive: true })
  const file = join(dir, hostFileName(path))
  const text = await readText()
  if (text !== null) await writeFile(file, text)
  else await copyDown(file, download, dataUrl)
  return (await shell.openPath(file)) === ''
}
