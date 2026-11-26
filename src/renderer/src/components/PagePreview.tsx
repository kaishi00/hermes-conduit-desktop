import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { parsePreview, readTextPath } from '../state/workspace'
import { PictureProfile } from './Picture'
import { inSelectMenu } from './Select'
import { openPageInBrowser } from '../state/saveMedia'
import { isPagePath } from '@shared/viewFileRules'
import { pictureHost, refused } from '../state/gatewayPictures'
import { notePage, pageCacheKey, prunePages, rememberedPage, type PageCache } from '../state/pagePreviewCache'

const PLACEHOLDER = 280
const MIN_HEIGHT = 60
const MAX_HEIGHT = 900

// Pages already read, per dashboard and profile: a chat scrolled back draws them again at once.
const kept: PageCache = new Map()
/** Reads in flight, so blocks of the same page drawn together share one. */
const reading = new Map<string, Promise<string | null>>()
let keptHost: string | null = null

/** A page's address on the page scheme, read from this host once; null when it can't be shown. */
export async function pageAddress(path: string, profile?: string): Promise<string | null> {
  const host = pictureHost()
  // Every window follows its own host (the main window, Quick Ask, a docked room): another
  // dashboard's copies go as this one's first page is asked for.
  if (host !== keptHost) {
    keptHost = host
    prunePages(kept, host)
    reading.clear()
  }
  const key = pageCacheKey(path, profile, host)
  const known = rememberedPage(kept, path, profile, host)
  if (known === null) return null
  // The main process keeps the newest 40 pages: one it forgot is read again rather than drawn as "Not found".
  if (known !== undefined) {
    if (await window.conduit.pageServed(known).catch(() => true)) return known
    if (kept.get(key)?.url === known) kept.delete(key)
  }
  let read = reading.get(key)
  if (!read) {
    read = readPage(path, profile).then(({ url, refused: wasRefused }) => {
      // An answer that lands after a host switch belongs to the old dashboard.
      if (reading.get(key) === read) notePage(kept, path, profile, host, url, wasRefused)
      return url
    })
    reading.set(key, read)
    void read.finally(() => {
      if (reading.get(key) === read) reading.delete(key)
    })
  }
  return read
}

async function readPage(path: string, profile?: string): Promise<{ url: string | null; refused: boolean }> {
  let preview
  try {
    preview = parsePreview(await gateway.http('GET', readTextPath(path, profile), undefined, 30_000))
  } catch (error) {
    // Gone or not allowed is Hermes' answer; a timeout or a dropped connection may read next time.
    return { url: null, refused: refused(error) }
  }
  if (preview.binary || preview.truncated) return { url: null, refused: true }
  const url = await window.conduit.pageUrl(preview.text).catch(() => undefined)
  // Too big to serve is the page's own; a failed call to the main process may work next time.
  return url === undefined ? { url: null, refused: false } : { url, refused: url === null }
}

/** A page in a sandboxed frame: its own scripts run, it keeps nothing and reaches nothing but its height. */
export function PageFrame({ url, title, height, onHeight }: { url: string; title: string; height?: number; onHeight?: (height: number) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    if (!onHeight) return
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const reported = (event.data as { conduitPageHeight?: unknown } | null)?.conduitPageHeight
      if (typeof reported === 'number' && Number.isFinite(reported)) onHeight(reported)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [onHeight])
  return (
    <iframe
      ref={frame}
      className="page-frame"
      title={title}
      src={url}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      style={height === undefined ? undefined : { height }}
    />
  )
}

/** Hermes' `::preview{file="…"}` in a reply, after the phone's HTMLPreviewBlock; `fallback` when it can't be drawn. */
export function PagePreview({ path, name, fallback }: { path: string; name: string; fallback: ReactNode }) {
  const profile = useContext(PictureProfile)
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  const [height, setHeight] = useState(PLACEHOLDER)
  const [cut, setCut] = useState(false)
  const [full, setFull] = useState(false)
  useEffect(() => {
    let live = true
    setUrl(undefined)
    void pageAddress(path, profile).then(address => live && setUrl(address))
    return () => {
      live = false
    }
  }, [path, profile])
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event)) {
        event.preventDefault()
        event.stopPropagation()
        setFull(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [full])
  if (url === null) return <>{fallback}</>
  return (
    <div className="page-preview" title={path}>
      <div className="page-preview-head">
        <span className="page-preview-name">{name}</span>
        <button className="link" disabled={!url} onClick={() => setFull(true)}>
          {t('Open full screen')}
        </button>
      </div>
      {url ? (
        <PageFrame
          url={url}
          title={name}
          height={height}
          onHeight={reported => {
            setCut(reported > MAX_HEIGHT)
            setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(reported))))
          }}
        />
      ) : (
        <div className="page-frame page-frame-loading" style={{ height }} />
      )}
      {cut ? <div className="meta page-preview-cut">{t('The page goes on. Open it full screen to see the rest.')}</div> : null}
      {full && url ? (
        <div className="page-full" role="dialog" aria-label={name}>
          <div className="page-full-head">
            <span className="page-preview-name">{name}</span>
            {isPagePath(path) ? (
              <button className="secondary" onClick={() => void openPageInBrowser(path, profile)}>
                {t('Open in Browser')}
              </button>
            ) : null}
            <button className="secondary" onClick={() => setFull(false)}>
              {t('Done')}
            </button>
          </div>
          <PageFrame url={url} title={name} />
        </div>
      ) : null}
    </div>
  )
}
