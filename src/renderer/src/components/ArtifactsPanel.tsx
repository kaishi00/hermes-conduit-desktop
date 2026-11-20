import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { GatewayError, gateway } from '../gateway'
import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import {
  FILTERS,
  days,
  filterTitle,
  includes,
  kindTitle,
  listPath,
  matches,
  merged,
  openablePath,
  parsePage,
  parsePins,
  pinBody,
  pinsPath,
  unpinPath,
  type ArtifactFilter,
  type ArtifactItem
} from '../state/artifacts'
import { dayLabel } from '../state/groups'
import { dataUrlPath, parsePreview, readTextPath, sizeText } from '../state/workspace'
import { PageFrame, pageAddress } from './PagePreview'
import { GatewayPicture, PictureProfile } from './Picture'
import { Icon, type IconName } from './icons'
import { useKeptArtifacts, type HostBadge, type KeptArtifact } from '../state/keptHosts'
import type { KeptHost } from '@shared/ipc'
import { HostBadgeMark } from './CombinedDashboards'

interface Props {
  profile?: string
  /** The chat's ids; empty lists every chat's. */
  sessionIds: string[]
  /** Reads the list again when it changes: each reply's end. */
  refreshKey?: number
  /** The chat's folder: a file inside it can be shown there. */
  folder?: string | null
  onShowInFolder?: (path: string) => void
  /** Opens the chat an artifact came from, on the every-chat list. */
  onOpenChat?: (item: ArtifactItem) => void
  onClose?: () => void
  /** The side panel's tabs, atop it. */
  tabs?: ReactNode
  /** A page of its own rather than a panel beside the chat. */
  page?: boolean
  /** Combined dashboards, on the page: the hosts kept beside this one, whose artifacts list after its own. */
  kept?: readonly KeptHost[]
  /** This host and the others, for their chips and badges. */
  dashboards?: { url: string; name: string; badge: HostBadge | null }[]
  /** Show in Chat on another host's artifact: switch there and open it. */
  onOpenOtherChat?: (item: KeptArtifact) => void
}

type Tab = ArtifactFilter | 'saved'
type Listing = { items: ArtifactItem[]; nextBefore: number | null } | 'loading' | { error: string }
type Viewer = { item: ArtifactItem; image?: string; page?: string; text?: string; error?: string }

const ICONS: Record<ArtifactItem['kind'], IconName> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  page: 'code',
  document: 'file',
  file: 'file',
  link: 'link'
}

const failure = (e: unknown) =>
  e instanceof GatewayError && e.code === 404
    ? t('Update the Conduit plugin on your Hermes host to see artifacts here. Settings › Conduit plugin can update it.')
    : e instanceof Error
      ? e.message
      : String(e)

const inside = (path: string, folder?: string | null) =>
  !!folder && (path === folder || path.startsWith(folder.replace(/[\\/]+$/, '') + '/') || path.startsWith(folder.replace(/[\\/]+$/, '') + '\\'))

/** Artifacts beside a chat, or every chat's on a page, after the phone's In This Chat sheet and Artifacts screen. */
export function ArtifactsPanel({ profile, sessionIds, refreshKey, folder, onShowInFolder, onOpenChat, onClose, page, kept, dashboards, onOpenOtherChat, tabs }: Props) {
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [words, setWords] = useState('')
  const [listing, setListing] = useState<Listing>('loading')
  const [saved, setSaved] = useState<ArtifactItem[] | null | { error: string }>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const ids = sessionIds.join('\n')
  const load = useRef(0)

  // The search, a moment after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setWords(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const filter: ArtifactFilter = tab === 'saved' ? 'all' : tab
  useEffect(() => {
    if (tab === 'saved') return
    const id = ++load.current
    const path = listPath({ profile, sessionIds, filter, query: words })
    // A list without a search opens on what it showed last time, then reads Hermes again (keptAnswers.ts).
    const keep = words ? null : answerKeeper(path)
    const kept = words ? undefined : keptAnswer(path)
    setListing(current =>
      current !== 'loading' && !('error' in current) && refreshKey !== undefined ? current : kept !== undefined ? parsePage(kept) : 'loading'
    )
    gateway
      .http('GET', path, undefined, 30_000)
      .then(r => {
        if (id !== load.current) return
        keep?.(r)
        setListing(parsePage(r))
      })
      .catch((e: unknown) => id === load.current && setListing({ error: failure(e) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, ids, filter, words, refreshKey, tab, reload])

  const readSaved = useCallback(() => {
    const path = pinsPath(profile)
    const keep = answerKeeper(path)
    const kept = keptAnswer(path)
    if (kept !== undefined) setSaved(current => current ?? parsePins(kept))
    gateway
      .http('GET', path, undefined, 20_000)
      .then(r => {
        keep(r)
        setSaved(parsePins(r))
      })
      .catch((e: unknown) => setSaved({ error: failure(e) }))
  }, [profile])
  useEffect(() => readSaved(), [readSaved])

  // The other combined hosts' artifacts, on the page only; a chip per host shows its alone, a second tap every one again.
  const others = useKeptArtifacts(kept ?? [], !!page && !!dashboards && dashboards.length > 1 && tab !== 'saved', filter, words, reload)
  const [onlyHost, setOnlyHost] = useState<string | null>(null)
  const here = dashboards?.[0]?.url
  const elsewhere = (item: ArtifactItem): KeptArtifact | null => ('dashboard' in item && typeof item.dashboard === 'string' ? (item as KeptArtifact) : null)
  const dashboardOf = (item: ArtifactItem) => dashboards?.find(d => d.url === elsewhere(item)?.dashboard)

  /** A file's data, from the host it's on. */
  const fileData = async (item: ArtifactItem, path: string): Promise<unknown> => {
    const other = elsewhere(item)
    if (!other) return gateway.http('GET', dataUrlPath(path, profile), undefined, 60_000)
    const outcome = await window.conduit.keptHttp(other.dashboard, dataUrlPath(path, other.dashboardProfile))
    if (!outcome.ok) throw new Error(outcome.error)
    return outcome.result
  }

  const savedItems = Array.isArray(saved) ? saved : []
  const chats = useMemo(() => new Set(sessionIds), [ids]) // eslint-disable-line react-hooks/exhaustive-deps
  // A chat's own saved ones; every chat's on the page.
  const ownSaved = savedItems.filter(item => !chats.size || chats.has(item.sessionId))
  const savedIds = new Set(savedItems.map(item => item.id))

  const more = async () => {
    if (listing === 'loading' || 'error' in listing || listing.nextBefore === null) return
    const before = listing.nextBefore
    setBusy('more')
    try {
      const next = parsePage(await gateway.http('GET', listPath({ profile, sessionIds, filter, query: words, before }), undefined, 30_000))
      setListing(current => (current === 'loading' || 'error' in current ? current : { items: merged(current.items, next.items), nextBefore: next.nextBefore }))
    } catch (e) {
      setNote(failure(e))
    } finally {
      setBusy(null)
    }
  }

  const toggleSaved = async (item: ArtifactItem) => {
    setBusy(item.id)
    try {
      if (savedIds.has(item.id)) {
        await gateway.http('DELETE', unpinPath(item, profile), undefined, 20_000)
        setSaved(current => (Array.isArray(current) ? current.filter(i => i.id !== item.id) : current))
      } else {
        // Saving copies the file on the host, which takes a moment for a large one.
        await gateway.http('POST', pinsPath(profile), pinBody(item), 90_000)
        readSaved()
      }
    } catch (e) {
      setNote(savedIds.has(item.id) ? t("Couldn't Remove from Saved") : t("Couldn't Save"))
      console.warn(e)
    } finally {
      setBusy(null)
    }
  }

  const download = async (item: ArtifactItem) => {
    const path = openablePath(item)
    if (!path) return
    setBusy(item.id)
    try {
      const raw = (await fileData(item, path)) as { data_url?: unknown; dataUrl?: unknown } | null
      const url = typeof raw?.data_url === 'string' ? raw.data_url : typeof raw?.dataUrl === 'string' ? raw.dataUrl : null
      if (!url) throw new Error(t("Couldn't save the file. Try again."))
      const a = document.createElement('a')
      a.href = url
      a.download = item.name
      a.click()
    } catch (e) {
      setNote(e instanceof Error ? e.message : t("Couldn't save the file. Try again."))
    } finally {
      setBusy(null)
    }
  }

  const open = async (item: ArtifactItem) => {
    if (item.kind === 'link' && item.url) return void window.open(item.url, '_blank')
    const path = openablePath(item)
    if (!path) return setViewer({ item, error: t('This file is no longer on your Hermes host.') })
    setViewer({ item })
    try {
      const other = elsewhere(item)
      if (other && item.kind !== 'image') {
        // A page or a text file opens through that host's own window.
        const outcome = await window.conduit.keptHttp(other.dashboard, readTextPath(path, other.dashboardProfile))
        if (!outcome.ok) throw new Error(outcome.error)
        const preview = parsePreview(outcome.result)
        setViewer(current =>
          current?.item.id !== item.id ? current : preview.binary ? { item, error: t("This file isn't text, so it can't be shown here.") } : { item, text: preview.text }
        )
        return
      }
      if (item.kind === 'image') {
        const raw = (await fileData(item, path)) as { data_url?: unknown; dataUrl?: unknown } | null
        const url = typeof raw?.data_url === 'string' ? raw.data_url : typeof raw?.dataUrl === 'string' ? raw.dataUrl : null
        setViewer(current => (current?.item.id === item.id ? (url ? { item, image: url } : { item, error: t("Couldn't open this file.") }) : current))
        return
      }
      if (item.kind === 'page') {
        const url = await pageAddress(path, profile)
        setViewer(current => (current?.item.id === item.id ? (url ? { item, page: url } : { item, error: t("Couldn't open this file.") }) : current))
        return
      }
      const preview = parsePreview(await gateway.http('GET', readTextPath(path, profile), undefined, 30_000))
      setViewer(current =>
        current?.item.id !== item.id
          ? current
          : preview.binary
            ? { item, error: t("This file isn't text, so it can't be shown here.") }
            : { item, text: preview.text }
      )
    } catch (e) {
      setViewer(current => (current?.item.id === item.id ? { item, error: e instanceof Error ? e.message : String(e) } : current))
    }
  }

  const meta = (item: ArtifactItem) =>
    [
      dashboardOf(item) ? [dashboardOf(item)!.name, elsewhere(item)?.dashboardProfile].filter(Boolean).join(' · ') : '',
      kindTitle(item.kind),
      item.source === 'attached' ? t('You sent') : '',
      item.host ?? '',
      item.size !== undefined ? sizeText(item.size) : '',
      !chats.size && item.sessionTitle ? item.sessionTitle : '',
      item.exists ? '' : t('No longer on the host'),
      !item.exists && item.keptPath ? t('Kept copy') : ''
    ]
      .filter(Boolean)
      .join(' · ')

  const row = (item: ArtifactItem) => {
    const path = openablePath(item)
    return (
      <div key={item.id} className={`artifact-row${item.exists || item.keptPath ? '' : ' gone'}`}>
        <button className="artifact-main" title={item.path ?? item.url} onClick={() => void open(item)}>
          <span className="artifact-thumb">
            {dashboardOf(item)?.badge ? <HostBadgeMark badge={dashboardOf(item)!.badge!} /> : item.kind === 'image' && path ? (
              <GatewayPicture path={path} name={item.name} className="artifact-picture" fallback={<Icon name="image" />} />
            ) : (
              <Icon name={ICONS[item.kind]} />
            )}
          </span>
          <span className="artifact-body">
            <span className="artifact-name">{item.name}</span>
            <span className="meta artifact-meta">{meta(item)}</span>
            {item.note ? <span className="artifact-note">{item.note}</span> : null}
          </span>
        </button>
        <span className="artifact-actions">
          {elsewhere(item) ? null : (
          <button
            className={`staged-remove${savedIds.has(item.id) ? ' on' : ''}`}
            aria-label={savedIds.has(item.id) ? t('Remove from Saved') : t('Save')}
            title={savedIds.has(item.id) ? t('Remove from Saved') : t('Save')}
            disabled={busy === item.id || saved === null || (!Array.isArray(saved) && !savedIds.has(item.id))}
            onClick={() => void toggleSaved(item)}
          >
            <Icon name="star" />
          </button>
          )}
          {path && item.kind !== 'link' ? (
            <button className="staged-remove" aria-label={t('Download')} title={t('Download')} disabled={busy === item.id} onClick={() => void download(item)}>
              ↓
            </button>
          ) : null}
          {item.path && item.exists && onShowInFolder && inside(item.path, folder) ? (
            <button className="staged-remove" aria-label={t('Show in Folder')} title={t('Show in Folder')} onClick={() => onShowInFolder(item.path!)}>
              <Icon name="folder" />
            </button>
          ) : null}
          {elsewhere(item) ? (
            onOpenOtherChat ? (
              <button className="staged-remove" aria-label={t('Show in Chat')} title={t('Show in Chat')} onClick={() => onOpenOtherChat(elsewhere(item)!)}>
                <Icon name="chats" />
              </button>
            ) : null
          ) : onOpenChat ? (
            <button className="staged-remove" aria-label={t('Show in Chat')} title={t('Show in Chat')} onClick={() => onOpenChat(item)}>
              <Icon name="chats" />
            </button>
          ) : null}
          <button
            className="staged-remove"
            aria-label={item.kind === 'link' ? t('Copy Link') : t('Copy Path')}
            title={item.kind === 'link' ? t('Copy Link') : t('Copy Path')}
            onClick={() => void navigator.clipboard.writeText(item.url ?? item.path ?? '')}
          >
            <Icon name="copy" />
          </button>
        </span>
      </div>
    )
  }

  const grouped = (items: ArtifactItem[], at?: (item: ArtifactItem) => number) =>
    days(items, at).map(group => (
      <section key={group.day} className="artifact-day">
        <h4 className="meta">{dayLabel(group.day)}</h4>
        {group.items.map(row)}
      </section>
    ))

  const list = () => {
    if (tab === 'saved') {
      if (saved === null) return <div className="ws-note">{t('Loading…')}</div>
      if (!Array.isArray(saved)) return <div className="ws-note error-text">{saved.error}</div>
      const shown = ownSaved.filter(item => matches(item, query))
      if (!shown.length)
        return query.trim() ? (
          <div className="ws-note">{t('Nothing here matches.')}</div>
        ) : (
          <div className="artifact-empty">
            <strong>{t('Nothing Saved Yet')}</strong>
            <p className="meta">
              {t('Save an artifact with its star to keep it here. Hermes keeps a copy of each file, so it still opens after its chat is gone.')}
            </p>
          </div>
        )
      return grouped(shown, item => item.savedAt ?? item.at)
    }
    if (listing === 'loading') return <div className="ws-note">{t('Loading…')}</div>
    if ('error' in listing)
      return (
        <div className="artifact-empty">
          <strong>{t("Artifacts couldn't load")}</strong>
          <p className="meta">{listing.error}</p>
        </div>
      )
    const own = onlyHost && onlyHost !== here ? [] : listing.items
    const theirs = others.filter(item => !onlyHost || item.dashboard === onlyHost)
    const items = (theirs.length ? [...own, ...theirs].sort((a, b) => b.at - a.at) : own).filter(item => includes(filter, item.kind))
    if (!items.length)
      return words ? (
        <div className="ws-note">{t('Nothing here matches.')}</div>
      ) : (
        <div className="artifact-empty">
          <strong>{t('No Artifacts Yet')}</strong>
          <p className="meta">
            {chats.size
              ? t('Files, pages and links from this chat show up here once Hermes has saved it.')
              : t('Files Hermes sends or writes, pages it draws, files you attach and links show up here.')}
          </p>
        </div>
      )
    return (
      <>
        {grouped(items)}
        {listing.nextBefore !== null ? (
          <button className="secondary artifact-more" disabled={busy === 'more'} onClick={() => void more()}>
            {busy === 'more' ? t('Loading…') : t('Show More')}
          </button>
        ) : null}
      </>
    )
  }

  const shownViewer = viewer ? (
    <div className="ws-viewer">
      <div className="ws-viewer-head">
        <button className="staged-remove" data-back aria-label={t('Back')} title={t('Back')} onClick={() => setViewer(null)}>
          ‹
        </button>
        <span className="ws-viewer-name" title={viewer.item.path ?? viewer.item.url}>
          {viewer.item.name}
        </span>
        <span className="spacer" />
        {openablePath(viewer.item) ? (
          <button className="secondary" disabled={busy === viewer.item.id} onClick={() => void download(viewer.item)}>
            {t('Download')}
          </button>
        ) : null}
      </div>
      {viewer.error ? (
        <p className="meta artifact-viewer-note">{viewer.error}</p>
      ) : viewer.image ? (
        <div className="ws-image">
          <img src={viewer.image} alt={viewer.item.name} />
        </div>
      ) : viewer.page !== undefined ? (
        <PageFrame url={viewer.page} title={viewer.item.name} />
      ) : viewer.text !== undefined ? (
        <pre className="ws-code artifact-text">{viewer.text}</pre>
      ) : (
        <p className="meta artifact-viewer-note">{t('Loading…')}</p>
      )}
    </div>
  ) : null

  return (
    <PictureProfile.Provider value={profile}>
      <aside className={page ? 'artifacts-page' : 'ws-panel artifacts-panel'} aria-label={chats.size ? t('In This Chat') : t('Artifacts')}>
        {tabs}
        <div className="ws-head">
          <Icon name="paperclip" />
          <span className="ws-title">{chats.size ? t('In This Chat') : t('Artifacts')}</span>
          <span className="spacer" />
          <button
            className="staged-remove"
            aria-label={t('Refresh')}
            title={t('Refresh')}
            onClick={() => {
              setListing('loading')
              setReload(n => n + 1)
              readSaved()
            }}
          >
            ↻
          </button>
          {onClose ? (
            <button className="staged-remove" aria-label={t('Close')} title={t('Close')} onClick={onClose}>
              <Icon name="close" />
            </button>
          ) : null}
        </div>
        {note ? (
          <div className="model-note" role="status">
            {note}
            <button className="staged-remove" aria-label={t('Close')} onClick={() => setNote(null)}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
        {shownViewer ?? (
          <>
            <label className="chatlist-search ws-search">
              <Icon name="search" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search names and chats')} spellCheck={false} />
            </label>
            <div className="filter-chips artifact-chips" role="group" aria-label={t('Artifacts')}>
              {FILTERS.map(f => (
                <button key={f} className={tab === f ? 'on' : ''} aria-pressed={tab === f} onClick={() => setTab(f)}>
                  {filterTitle(f)}
                </button>
              ))}
              {Array.isArray(saved) || saved === null ? (
                <button className={tab === 'saved' ? 'on' : ''} aria-pressed={tab === 'saved'} onClick={() => setTab('saved')}>
                  {t('Saved')}
                  {ownSaved.length ? ` ${ownSaved.length}` : ''}
                </button>
              ) : null}
              {page && dashboards && dashboards.length > 1 && tab !== 'saved'
                ? dashboards.map(d => (
                    <button
                      key={d.url}
                      className={`artifact-host-chip${onlyHost === d.url ? ' on' : ''}`}
                      aria-pressed={onlyHost === d.url}
                      onClick={() => setOnlyHost(current => (current === d.url ? null : d.url))}
                    >
                      {d.badge ? <HostBadgeMark badge={d.badge} /> : null}
                      {d.name}
                    </button>
                  ))
                : null}
            </div>
            <div className="ws-tree artifact-list">{list()}</div>
          </>
        )}
      </aside>
    </PictureProfile.Provider>
  )
}
