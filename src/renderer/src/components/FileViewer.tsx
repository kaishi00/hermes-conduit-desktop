import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { isPagePath, stagedViewName, viewedType } from '@shared/viewFileRules'
import type { StagedAttachment } from '../state/attachments'
import { parsePreview, readTextPath } from '../state/workspace'
import { Markdown } from './Markdown'
import { PageFrame, pageAddress } from './PagePreview'
import { inSelectMenu } from './Select'
import { openPageInBrowser } from '../state/saveMedia'
import { OverWindow } from './OverWindow'

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

/** How a file staged in the composer is shown: by its name, or its type when its name doesn't say; a page as its text, since it isn't on the host to draw. */
export function stagedViewerKind(staged: Pick<StagedAttachment, 'name' | 'mime'>): ViewerKind {
  const kind = viewerKind(stagedViewName(staged.name, staged.mime) ?? staged.name)
  if (kind === 'page') return 'text'
  // A recording in a video container (an audio-only .webm) plays as sound.
  return kind === 'video' && staged.mime.toLowerCase().startsWith('audio/') ? 'audio' : kind
}

/** A staged file's words, or null when its bytes aren't UTF-8 text. */
export function stagedText(base64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

/** Where the viewer's file is: on the Hermes host, which Download saves, or staged in the composer, not sent yet. */
export type ViewedFile =
  | { path: string; profile?: string; saving: boolean; onDownload: () => void }
  | { staged: StagedAttachment }

/**
 * A file a chat's file card opens, over the window, as the phone's card opens
 * it in its viewers (desktop#554): a page in the sandboxed frame `::preview`
 * draws in, a picture, sound, video or PDF from a copy Conduit downloads
 * (viewFiles.ts), a Markdown file formatted, other text as it is. A file that
 * isn't text and none of those says so, and Download stays in its header,
 * with Open in Browser for a page (Eric 2026-11-25). A file staged in the
 * composer opens here too, from its chip, to check before it's sent
 * (desktop#611): from a copy of its bytes, its text read from them, a page as
 * its text; it has no Download, being the person's own file.
 */
export function FileViewer({ file, name, onClose }: { file: ViewedFile; name: string; onClose: () => void }) {
  const staged = 'staged' in file ? file.staged : null
  const path = 'path' in file ? file.path : ''
  const profile = 'path' in file ? file.profile : undefined
  const kind = staged ? stagedViewerKind(staged) : viewerKind(path)
  const [shown, setShown] = useState<Shown>(null)
  useEffect(() => {
    let live = true
    setShown(null)
    const show = (next: Shown) => live && setShown(next)
    const failed = (e: unknown) => show({ error: e instanceof Error && e.message ? e.message : t("Couldn't open this file.") })
    if (staged) {
      if (kind === 'markdown' || kind === 'text') {
        const text = stagedText(staged.base64)
        show(text === null ? { error: t("This file isn't text, so it can't be shown here.") } : { text })
      } else {
        window.conduit.viewStagedFile(staged.name, staged.mime, staged.base64).then(answer => show('url' in answer ? { url: answer.url } : { error: answer.error }), failed)
      }
    } else if (kind === 'page') {
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
  }, [path, profile, kind, staged])
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
  // `assistant`: drawn on the page now, it keeps the reply's text styles (Markdown, code) it had inside the reply.
  return (
    <OverWindow>
      <div className="page-full file-viewer assistant" role="dialog" aria-label={name}>
        <div className="page-full-head">
          <span className="page-preview-name" title={path || name}>
            {name}
          </span>
          {'path' in file && kind === 'page' ? (
            <button className="secondary" onClick={() => void openPageInBrowser(path, profile)}>
              {t('Open in Browser')}
            </button>
          ) : null}
          {'path' in file ? (
            <button className="secondary" disabled={file.saving} onClick={file.onDownload}>
              {t('Download')}
            </button>
          ) : null}
          <button className="secondary" onClick={onClose}>
            {t('Done')}
          </button>
        </div>
        {body()}
      </div>
    </OverWindow>
  )
}
