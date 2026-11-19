import { useEffect, useMemo, useRef, useState } from 'react'
import { underSource } from '../state/voiceList'
import { profileGroups, readClosedSections, readGroupByProfile, writeClosedSections, writeGroupByProfile } from '../state/profileGroups'
import { sectionRows, timeLabel, type ChatRow } from '../state/chats'
import type { Bot } from '../state/bots'
import { BotAvatar } from './BotsHome'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import { filterRows, isStarred, isUnread, type ChatFilter, type ChatMarks } from '../state/chatMarks'
import { sourceName, sourcesIn, type ChatSource } from '../state/chatSources'
import { contentRows, useContentSearch } from '../state/contentSearch'
import { arrangePinned, moved, usePinnedOrder } from '../state/pinnedOrder'
import { gateway } from '../gateway'

const FILTERS: { value: ChatFilter; label: () => string }[] = [
  { value: 'all', label: () => t('All') },
  { value: 'starred', label: () => t('Starred') },
  { value: 'unread', label: () => t('Unread') },
  { value: 'running', label: () => t('Running') },
  { value: 'waiting', label: () => t('Needs approval') }
]
/** Done chats' chips, offered once the plugin keeps the marks. */
const DONE_FILTERS: { value: ChatFilter; label: () => string }[] = [
  { value: 'inprogress', label: () => t('In progress') },
  { value: 'done', label: () => t('Done') }
]

/** A section of the list: a date's (or Pinned), or a profile's when grouped by profile. */
interface ListSection {
  title: string
  rows: ChatRow[]
  profile?: string
  hidden?: number
  extra?: number
}

interface Props {
  rows: ChatRow[] | null
  error: string | null
  selectedId: string | null
  runningIds: ReadonlySet<string>
  /** Chats Hermes waits on the user in (an approval or a question): Needs approval on the row. */
  waitingIds?: ReadonlySet<string>
  runningStatus?: string
  onSelect: (row: ChatRow) => void
  onNewChat: () => void
  /** The bots, for the profile strip and the rows' bot names. */
  bots?: Bot[] | null
  /** The profile the list shows (null: every one). */
  profile?: string | null
  onProfile?: (profile: string | null) => void
  /** A row's menu (right-click or ⋯): Pin or Unpin, Rename, Delete. */
  onPin?: (row: ChatRow) => void
  onRename?: (row: ChatRow, title: string) => void
  onDelete?: (row: ChatRow) => void
  /** Stars and read state, kept on this computer; the filter chips use them. */
  marks?: ChatMarks
  onStar?: (row: ChatRow) => void
  onToggleRead?: (row: ChatRow) => void
  /** Done chats, kept by the plugin: left out on a plugin that doesn't keep them. */
  isDone?: (row: ChatRow) => boolean
  onDone?: (row: ChatRow) => void
  /** Opens Projects, the phone's Chats › Projects. */
  onProjects?: () => void
  /** The host, so a Hermes without message search isn't asked again. */
  searchScope?: string
  /** Opens every pinned reply; left out while there are none. */
  onPinnedReplies?: () => void
  /** Move to Project: the projects a chat can move into (its profile's, each with its folder), read when asked. */
  moveTargets?: (row: ChatRow) => Promise<MoveTarget[]>
  onMove?: (row: ChatRow, target: MoveTarget) => void
  /** Open Beside: the row opens and the chat on screen stays beside it; only in a window wide enough for both. */
  onOpenBeside?: (row: ChatRow) => void
  canOpenBeside?: (row: ChatRow) => boolean
}

export interface MoveTarget {
  id: string
  title: string
  path: string
}

/** Profiles In messages asks at most, one request each. */
const MAX_SEARCH_PROFILES = 8
const NONE: ReadonlySet<string> = new Set()
const searchHttp = (path: string) => gateway.http('GET', path)
const prefsHttp = (method: 'GET' | 'PUT', path: string, body?: unknown) => gateway.http(method, path, body)

const sameProfile = (row: ChatRow, name: string) => (row.profile ?? 'default').toLowerCase() === name.toLowerCase()

export function ChatList({
  rows,
  error,
  selectedId,
  runningIds,
  waitingIds = NONE,
  runningStatus,
  onSelect,
  onNewChat,
  bots,
  profile = null,
  onProfile,
  onPin,
  onRename,
  onDelete,
  marks,
  onStar,
  onToggleRead,
  isDone,
  onDone,
  onProjects,
  onPinnedReplies,
  searchScope = '',
  moveTargets,
  onMove,
  onOpenBeside,
  canOpenBeside
}: Props) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ row: ChatRow; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const hasActions = !!(onPin || onRename || onDelete || onStar)
  // Move to Project's targets: null while they're read.
  const [moving, setMoving] = useState<MoveTarget[] | null | false>(false)
  const canMove = !!onMove && !!moveTargets
  useEffect(() => setMoving(false), [menu])
  async function startMove(row: ChatRow) {
    setMoving(null)
    const targets = await moveTargets!(row).catch(() => [])
    setMoving(current => (current === null ? targets : current))
  }
  const [filter, setFilter] = useState<ChatFilter>('all')
  /** The Sources filter: one source's chats, or null for every source. */
  const [source, setSource] = useState<ChatSource | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  function finishRename(save: boolean) {
    if (!renaming) return
    const row = rows?.find(r => r.id === renaming.id)
    const title = renaming.title.trim()
    setRenaming(null)
    if (save && row && title && title !== row.title) onRename?.(row, title)
  }
  const pinOrder = usePinnedOrder(searchScope, rows, prefsHttp)
  // All profiles, grouped by profile: a section per profile with its pinned chats and five newest (issue 1560, #1571).
  // Offered under All with two or more profiles, as the profile strip is.
  const canGroup = !profile && (bots?.length ?? 0) > 1
  const [groupByProfile, setGroupByProfile] = useState(readGroupByProfile)
  const grouped = canGroup && groupByProfile
  const [showingAll, setShowingAll] = useState<Set<string>>(() => new Set())
  const [closedSections, setClosedSections] = useState<string[]>(readClosedSections)
  const toggleSection = (p: string) => {
    const next = closedSections.includes(p) ? closedSections.filter(x => x !== p) : [...closedSections, p]
    setClosedSections(next)
    writeClosedSections(next)
  }
  const profileTitle = (p: string) => bots?.find(b => b.name.toLowerCase() === p)?.title ?? p
  // Pinned rows move while the list shows every pinned chat: not during a search or under a filter, nor grouped by profile.
  const canReorder = !query.trim() && filter === 'all' && !source && !grouped
  const { sections, listed, allowed, pinnedSection } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const inProfile = profile ? (rows ?? []).filter(r => sameProfile(r, profile)) : (rows ?? [])
    const marked = marks ? filterRows(inProfile, isDone || !DONE_FILTERS.some(f => f.value === filter) ? filter : 'all', marks, runningIds, waitingIds, isDone) : inProfile
    const sourced = source ? marked.filter(r => underSource(r, source)) : marked
    const filtered = q ? sourced.filter(r => `${r.title} ${r.preview ?? ''}`.toLowerCase().includes(q)) : sourced
    const sections = sectionRows(filtered)
    // The Pinned section in the person's order, arranged from every pinned chat the profile shown has.
    const pinned = arrangePinned(sectionRows(inProfile.filter(r => r.pinned))[0]?.rows ?? [], pinOrder.orders)
    const shown = new Set(filtered.map(r => r.id))
    const arranged: ListSection[] = grouped
      ? profileGroups(
          filtered,
          (bots ?? []).map(b => b.name),
          {
            // A search or a status or Starred filter lists every match; a source filter is still a browse.
            capped: !q && filter === 'all',
            showsAll: p => showingAll.has(p),
            openId: selectedId,
            pinnedOrder: list => arrangePinned(list, pinOrder.orders)
          }
        ).map(group => ({ title: profileTitle(group.profile), rows: group.rows, profile: group.profile, hidden: group.hidden, extra: group.extra }))
      : sections.map(section => (section.rows[0]?.pinned ? { ...section, rows: pinned.filter(r => shown.has(r.id)) } : section))
    return { sections: arranged, listed: filtered, allowed: filter !== 'all' || source ? sourced : undefined, pinnedSection: pinned }
  }, [rows, query, profile, marks, filter, runningIds, waitingIds, isDone, source, pinOrder.orders, grouped, showingAll, selectedId, bots])
  const movePinned = (row: ChatRow, to: number) => {
    const from = pinnedSection.findIndex(r => r.id === row.id)
    const next = moved(pinnedSection, from, to)
    if (next !== pinnedSection) pinOrder.reorder(next)
  }
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)
  // In messages: Hermes' full-text search, on the profile shown or every profile the list holds.
  const searchProfiles = useMemo(
    () => (profile ? [profile] : [...new Set((rows ?? []).map(r => r.profile || 'default'))].sort().slice(0, MAX_SEARCH_PROFILES)),
    [rows, profile]
  )
  const content = useContentSearch(query, rows ? searchProfiles : [], searchScope, searchHttp)
  const contentMatches = useMemo(
    () => (content.hits.length ? contentRows(content.hits, listed, rows ?? [], allowed).filter(m => !profile || sameProfile(m.row, profile)) : []),
    [content.hits, listed, rows, allowed, profile]
  )
  // The Sources filter shows once chats come from more than one place.
  const sources = useMemo(() => sourcesIn(rows ?? []), [rows])
  useEffect(() => {
    if (source && !sources.includes(source)) setSource(null)
  }, [sources, source])
  const showStrip = !!onProfile && (bots?.length ?? 0) > 1
  const botName = (row: ChatRow) => {
    if (!row.profile || row.profile === 'default' || profile) return null
    return bots?.find(b => b.name === row.profile)?.title ?? row.profile
  }

  // Bring the open chat into view once its row is there: a chat just made
  // from the composer shows up a moment after its first send.
  const scroller = useRef<HTMLDivElement>(null)
  const revealed = useRef<string | null>(null)
  const present = !!selectedId && sections.some(s => s.rows.some(r => r.id === selectedId))
  useEffect(() => {
    if (!present || revealed.current === selectedId) return
    revealed.current = selectedId
    scroller.current?.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [present, selectedId])

  return (
    <section className="chatlist" aria-label={t('Chats')}>
      <div className="chatlist-head">
        <h1>{t('Chats')}</h1>
        {onPinnedReplies ? (
          <button className="round" aria-label={t('Pinned replies')} title={t('Pinned replies')} onClick={onPinnedReplies}>
            <Icon name="pin" />
          </button>
        ) : null}
        {onProjects ? (
          <button className="round" aria-label={t('Projects')} title={t('Projects')} onClick={onProjects}>
            <Icon name="folder" />
          </button>
        ) : null}
        <button
          className="round"
          aria-label={t('New chat')}
          title={window.conduit.platform === 'darwin' ? t('New chat (⌘N)') : t('New chat (Ctrl+N)')}
          onClick={onNewChat}
        >
          <Icon name="plus" />
        </button>
      </div>
      <label className="chatlist-search">
        <Icon name="search" />
        <span className="sr-only">{t('Search chats')}</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search chats')} />
      </label>
      {showStrip ? <ProfileStrip bots={bots!} profile={profile} onProfile={onProfile!} /> : null}
      {marks ? (
        <div className="filter-chips" role="tablist" aria-label={t('Filter')}>
          {(isDone ? [...FILTERS, ...DONE_FILTERS] : FILTERS).map(({ value, label }) => (
            <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'on' : undefined} onClick={() => setFilter(value)}>
              {label()}
            </button>
          ))}
          {canGroup ? (
            <button
              role="switch"
              aria-checked={groupByProfile}
              className={groupByProfile ? 'on' : undefined}
              onClick={() => {
                setGroupByProfile(!groupByProfile)
                writeGroupByProfile(!groupByProfile)
              }}
            >
              {t('Group by profile')}
            </button>
          ) : null}
          {sources.length > 1 ? (
            <select
              className={`source-filter${source ? ' on' : ''}`}
              aria-label={t('Source')}
              value={source ?? ''}
              onChange={e => setSource((e.target.value || null) as ChatSource | null)}
            >
              <option value="">{t('All Sources')}</option>
              {sources.map(kind => (
                <option key={kind} value={kind}>
                  {sourceName(kind)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <div className="chatlist-scroll" ref={scroller}>
        {rows === null && !error ? <div className="empty">{t('Loading chats…')}</div> : null}
        {error ? <div className="empty">{t('Couldn’t load your chats: {error}', { error })}</div> : null}
        {rows && sections.length === 0 && !query.trim() ? (
          <div className="empty">
            {filter === 'starred'
              ? t('No starred chats. Star one from its menu to keep it here.')
              : filter === 'unread'
                ? t('No unread chats.')
                : filter === 'running'
                  ? t('Nothing is running.')
                  : filter === 'waiting'
                    ? t('No chat is waiting on your answer.')
                    : filter === 'inprogress' && isDone
                      ? t('Every chat here is marked done.')
                      : filter === 'done' && isDone
                        ? t('No done chats. Mark one done from its menu.')
                        : t('No chats yet. Start one with the + button.')}
          </div>
        ) : null}
        {sections.map(section => (
          <div key={section.profile ?? section.title} role="group" aria-label={section.title}>
            {section.profile ? (
              <button className="sect sect-profile" aria-expanded={!closedSections.includes(section.profile)} onClick={() => toggleSection(section.profile!)}>
                <Icon name="chevronDown" className={closedSections.includes(section.profile) ? 'closed' : undefined} />
                {section.title}
              </button>
            ) : (
              <div className="sect">{section.title}</div>
            )}
            {(section.profile && closedSections.includes(section.profile) ? [] : section.rows).map(row => {
              const waits = waitingIds.has(row.id)
              const running = !waits && runningIds.has(row.id)
              return (
                <div
                  key={row.id}
                  className={`row-wrap${dragging === row.id ? ' dragging' : ''}${dropAt?.id === row.id ? (dropAt.after ? ' drop-after' : ' drop-before') : ''}`}
                  draggable={canReorder && row.pinned && !renaming ? true : undefined}
                  onDragStart={
                    canReorder && row.pinned
                      ? e => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', row.title)
                          setDragging(row.id)
                        }
                      : undefined
                  }
                  onDragOver={
                    dragging && row.pinned
                      ? e => {
                          e.preventDefault()
                          const box = e.currentTarget.getBoundingClientRect()
                          const after = e.clientY > box.top + box.height / 2
                          if (dropAt?.id !== row.id || dropAt.after !== after) setDropAt({ id: row.id, after })
                        }
                      : undefined
                  }
                  onDrop={
                    dragging && row.pinned
                      ? e => {
                          e.preventDefault()
                          const moving = pinnedSection.find(r => r.id === dragging)
                          const from = pinnedSection.findIndex(r => r.id === dragging)
                          let to = pinnedSection.findIndex(r => r.id === row.id) + (dropAt?.after ? 1 : 0)
                          if (from < to) to -= 1
                          if (moving) movePinned(moving, to)
                          setDragging(null)
                          setDropAt(null)
                        }
                      : undefined
                  }
                  onDragEnd={() => {
                    setDragging(null)
                    setDropAt(null)
                  }}
                  onContextMenu={
                    hasActions
                      ? e => {
                          e.preventDefault()
                          setMenu({ row, x: e.clientX, y: e.clientY })
                        }
                      : undefined
                  }
                >
                  {renaming?.id === row.id ? (
                    <input
                      className="row-rename"
                      aria-label={t('Rename')}
                      autoFocus
                      value={renaming.title}
                      onChange={e => setRenaming({ id: row.id, title: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') finishRename(true)
                        else if (e.key === 'Escape') finishRename(false)
                      }}
                      onBlur={() => finishRename(true)}
                    />
                  ) : (
                    <button className={isDone?.(row) ? 'row done' : 'row'} aria-current={row.id === selectedId ? 'true' : undefined} onClick={() => onSelect(row)}>
                      <span className="row-top">
                        <span className="row-title">
                          {marks && isUnread(marks, row) && row.id !== selectedId ? <span className="unread-dot" role="img" aria-label={t('Unread')} /> : null}
                          {row.pinned ? <Icon name="pin" className="row-pin" /> : null}
                          {marks && isStarred(marks, row) ? <Icon name="star" className="row-pin row-star" /> : null}
                          {isDone?.(row) ? <Icon name="check" className="row-pin row-done" aria-label={t('Done')} /> : null}
                          {row.title}
                        </span>
                        {row.sourceKind && row.sourceKind !== 'chat' ? <span className="row-source">{sourceName(row.sourceKind)}</span> : null}
                        <span className="meta row-time">{timeLabel(row.activeAt)}</span>
                      </span>
                      {waits ? (
                        <span className="running waiting">{t('Needs approval')}</span>
                      ) : running ? (
                        <span className="running">
                          {t('Running')}
                          {runningStatus && row.id === selectedId ? ` · ${runningStatus}` : ''}
                        </span>
                      ) : row.preview || botName(row) ? (
                        <span className="meta">
                          {botName(row) ? `${botName(row)} · ` : ''}
                          {row.preview ?? ''}
                        </span>
                      ) : null}
                    </button>
                  )}
                  {hasActions && renaming?.id !== row.id ? (
                    <button
                      className="row-more"
                      aria-label={t('More')}
                      title={t('More')}
                      aria-haspopup="menu"
                      onClick={e => {
                        e.stopPropagation()
                        const box = e.currentTarget.getBoundingClientRect()
                        setMenu(m => (m?.row.id === row.id ? null : { row, x: box.right, y: box.bottom }))
                      }}
                    >
                      <Icon name="more" />
                    </button>
                  ) : null}
                </div>
              )
            })}
            {section.profile && !closedSections.includes(section.profile) && (section.hidden || section.extra) ? (
              <button
                className="row show-more"
                onClick={() =>
                  setShowingAll(current => {
                    const next = new Set(current)
                    if (section.hidden) next.add(section.profile!)
                    else next.delete(section.profile!)
                    return next
                  })
                }
              >
                {section.hidden ? t('Show {count} more', { count: section.hidden }) : t('Show fewer')}
              </button>
            ) : null}
          </div>
        ))}
        {query.trim() && (contentMatches.length || content.searching) ? (
          <div role="group" aria-label={t('In messages')}>
            <div className="sect content-sect">
              {t('In messages')}
              {content.searching ? (
                <span className="content-spinner" role="status" aria-label={t('Searching messages')}>
                  <Icon name="spinner" />
                </span>
              ) : null}
            </div>
            {contentMatches.map(match => (
              <div key={match.key} className="row-wrap">
                <button className="row" aria-current={match.row.id === selectedId ? 'true' : undefined} onClick={() => onSelect(match.row)}>
                  <span className="row-top">
                    <span className="row-title">{match.row.title || t('Untitled conversation')}</span>
                    <span className="meta row-time">{timeLabel(match.row.activeAt)}</span>
                  </span>
                  <span className="meta content-snippet">
                    {botName(match.row) ? `${botName(match.row)} · ` : ''}
                    {match.snippet.map((run, i) => (run.match ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>))}
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {rows && query.trim() && !sections.length && !contentMatches.length && !content.searching ? (
          <div className="empty">{t('No matching conversations')}</div>
        ) : null}
      </div>
      {menu ? (
        <div
          className="host-menu row-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 220),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - (moving ? 52 + 34 * Math.max(1, moving.length) : 220)))
          }}
        >
          {moving !== false ? (
            <>
              <button
                role="menuitem"
                onClick={e => {
                  e.stopPropagation()
                  setMoving(false)
                }}
              >
                ‹ {t('Move to Project')}
              </button>
              {moving === null ? <div className="menu-note">{t('Loading projects…')}</div> : null}
              {moving && !moving.length ? <div className="menu-note">{t('No Projects')}</div> : null}
              {moving?.map(target => (
                <button key={target.id} role="menuitem" title={target.path} onClick={() => onMove?.(menu.row, target)}>
                  {target.title}
                </button>
              ))}
            </>
          ) : (
            <>
              {onOpenBeside && canOpenBeside?.(menu.row) ? (
                <button role="menuitem" onClick={() => onOpenBeside(menu.row)}>
                  {t('Open Beside')}
                </button>
              ) : null}
              {onPin ? (
                <button
                  role="menuitem"
                  onClick={() => {
                    if (menu.row.pinned) pinOrder.drop(menu.row)
                    onPin(menu.row)
                  }}
                >
                  {menu.row.pinned ? t('Unpin') : t('Pin')}
                </button>
              ) : null}
              {canReorder && menu.row.pinned && pinnedSection.length > 1
                ? (() => {
                    const at = pinnedSection.findIndex(r => r.id === menu.row.id)
                    return (
                      <>
                        {at > 0 ? (
                          <button role="menuitem" onClick={() => movePinned(menu.row, at - 1)}>
                            {t('Move Earlier')}
                          </button>
                        ) : null}
                        {at >= 0 && at < pinnedSection.length - 1 ? (
                          <button role="menuitem" onClick={() => movePinned(menu.row, at + 1)}>
                            {t('Move Later')}
                          </button>
                        ) : null}
                      </>
                    )
                  })()
                : null}
              {onStar && marks ? (
                <button role="menuitem" onClick={() => onStar(menu.row)}>
                  {isStarred(marks, menu.row) ? t('Unstar') : t('Star')}
                </button>
              ) : null}
              {onDone && isDone ? (
                <button role="menuitem" onClick={() => onDone(menu.row)}>
                  {isDone(menu.row) ? t('Mark as Not Done') : t('Mark as Done')}
                </button>
              ) : null}
              {onToggleRead && marks && menu.row.id !== selectedId ? (
                <button role="menuitem" onClick={() => onToggleRead(menu.row)}>
                  {isUnread(marks, menu.row) ? t('Mark as read') : t('Mark as unread')}
                </button>
              ) : null}
              {onRename ? (
                <button role="menuitem" onClick={() => setRenaming({ id: menu.row.id, title: menu.row.title })}>
                  {t('Rename')}
                </button>
              ) : null}
              {canMove ? (
                <button
                  role="menuitem"
                  aria-haspopup="menu"
                  onClick={e => {
                    e.stopPropagation()
                    void startMove(menu.row)
                  }}
                >
                  {t('Move to Project')} ›
                </button>
              ) : null}
              {onDelete ? (
                <button role="menuitem" className="danger" onClick={() => onDelete(menu.row)}>
                  {t('Delete')}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

/** All, then each bot's face, the chosen one with its name: the list's profile. */
export function ProfileStrip({ bots, profile, onProfile }: { bots: Bot[]; profile: string | null; onProfile: (profile: string | null) => void }) {
  return (
    <div
      className="profile-strip"
      role="tablist"
      aria-label={t('Bots')}
      // A mouse wheel scrolls the strip sideways.
      onWheel={e => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
      }}
    >
      <button role="tab" className="profile-chip all" aria-selected={profile === null} onClick={() => onProfile(null)}>
        {t('All')}
      </button>
      {bots.map(bot => (
        // Only the chosen bot shows its name, so the strip fits the list's width; the rest are faces.
        <button
          key={bot.name}
          role="tab"
          className={`profile-chip${profile === bot.name ? '' : ' face-only'}`}
          aria-selected={profile === bot.name}
          aria-label={bot.title}
          title={bot.title}
          onClick={() => onProfile(profile === bot.name ? null : bot.name)}
        >
          <BotAvatar bot={bot} size={22} />
          {profile === bot.name ? <span>{bot.title}</span> : null}
        </button>
      ))}
    </div>
  )
}
