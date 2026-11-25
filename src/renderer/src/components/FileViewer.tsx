import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { isPagePath, viewedType } from '@shared/viewFileRules'
import { parsePreview, readTextPath } from '../state/workspace'
import { Markdown } from './Markdown'
import { PageFrame, pageAddress } from './PagePreview'
import { inSelectMenu } from './Select'
import { openPageInBrowser } from '../state/saveMedia'

/** How the viewer shows a file, by its name: a page, a copy (picture, sound, video, PDF) or its text. */
export type ViewerKind = 'page' | 'image' | 'audio' | 'video' | 'pdf' | 'markdown' | 'text'

export function viewerKind(path: string): ViewerKind {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  if (isPagePath(path)) return 'page'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  // What Conduit can draw from a copy goes by the copy's type; anything else (a HEIC, an AVI) is read as text, which says it isn't.
  const type = viewedType(path) ?? ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (type === 'application/pdf') return 'pdf'
  return 'text'
}

type Shown = { url: string } | { text: string } | { error: string } | null

/**
 * A file a chat's file card opens, over the window, as the phone's card opens
 * it in its viewers (desktop#554): a page in the sandboxed frame `::preview`
 * draws in, a picture, sound, video or PDF from a copy Conduit downloads
 * (viewFiles.ts), a Markdown file formatted, other text as it is. A file that
 * isn't text and none of those says so, and Download stays in its header,
 * with Open in Browser for a page (Eric 2026-11-25).
 */
export function FileViewer({
  path,
  name,
  profile,
  saving,
  onDownload,
  onClose
}: {
  path: string
  name: string
  profile?: string
  saving: boolean
  onDownload: () => void
  onClose: () => void
}) {
  const kind = viewerKind(path)
  const [shown, setShown] = useState<Shown>(null)
  useEffect(() => {
    let live = true
    setShown(null)
    const show = (next: Shown) => live && setShown(next)
    const failed = (e: unknown) => show({ error: e instanceof Error && e.message ? e.message : t("Couldn't open this file.") })
    if (kind === 'page') {
      void pageAddress(path, profile).then(url => show(url ? { url } : { error: t("Couldn't open this file.") }), failed)
    } else if (kind === 'markdown' || kind === 'text') {
      gateway
        .http('GET', readTextPath(path, profile), undefined, 30_000)
        .then(raw => {
          const preview = parsePreview(raw)
          show(preview.binary ? { error: t("This file isn't text, so it can't be shown here.") } : { text: preview.text })
        })
        .catch(failed)
    } else {
      // Closing the viewer, or its file changing, stops a copy still downloading.
      const ticket = crypto.randomUUID()
      window.conduit.viewHostFile(path, profile, ticket).then(answer => show('url' in answer ? { url: answer.url } : { error: answer.error }), failed)
      return () => {
        live = false
        window.conduit.cancelViewHostFile(ticket)
      }
    }
    return () => {
      live = false
    }
  }, [path, profile, kind])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event)) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const unplayable = () => setShown({ error: t("Couldn't open this file.") })
  const body = () => {
    if (shown === null) return <p className="meta file-viewer-note">{t('Loading…')}</p>
    if ('error' in shown) return <p className="meta file-viewer-note">{shown.error}</p>
    if ('text' in shown)
      return kind === 'markdown' ? (
        <div className="file-viewer-text file-viewer-markdown">
          <Markdown text={shown.text} />
        </div>
      ) : (
        <pre className="ws-code file-viewer-text">{shown.text}</pre>
      )
    switch (kind) {
      case 'page':
        return <PageFrame url={shown.url} title={name} />
      case 'image':
        return (
          <div className="file-viewer-media">
            <img src={shown.url} alt={name} onError={unplayable} />
          </div>
        )
      case 'audio':
        return (
          <div className="file-viewer-media">
            <audio controls autoPlay src={shown.url} onError={unplayable} />
          </div>
        )
      case 'video':
        return (
          <div className="file-viewer-media">
            <video controls autoPlay src={shown.url} onError={unplayable} />
          </div>
        )
      default:
        return <iframe className="file-viewer-pdf" title={name} src={shown.url} />
    }
  }
  return (
    <div className="page-full file-viewer" role="dialog" aria-label={name}>
      <div className="page-full-head">
        <span className="page-preview-name" title={path}>
          {name}
        </span>
        {kind === 'page' ? (
          <button className="secondary" onClick={() => void openPageInBrowser(path, profile)}>
            {t('Open in Browser')}
          </button>
        ) : null}
        <button className="secondary" disabled={saving} onClick={onDownload}>
          {t('Download')}
        </button>
        <button className="secondary" onClick={onClose}>
          {t('Done')}
        </button>
      </div>
      {body()}
    </div>
  )
}
