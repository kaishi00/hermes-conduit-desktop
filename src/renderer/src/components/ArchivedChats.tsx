import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  CHAT_LIST_MAX_PAGES,
  CHAT_LIST_PAGE,
  chatListPath,
  rowsFromResponse,
  unreadProfiles,
  type ChatRow,
  type UnreadProfile
} from '../state/chats'
import { ask, cancelFrontDialog } from '../state/dialogs'
import { isArchivedVoiceChat, parseVoiceTags, type VoiceList } from '../state/voiceList'
import { inSelectMenu } from './Select'

interface Props {
  host: string
  profile: string | null
  visibleVoiceIds?: ReadonlySet<string>
  onClose: () => void
  onRestore: (row: ChatRow) => Promise<boolean>
  onDelete: (row: ChatRow) => Promise<boolean>
}

interface ArchivedRow extends ChatRow {
  model?: string
}

type Action = 'restore' | 'delete'
type Life = {
  host: string
  active: boolean
  read: number
  loading: boolean
  offset: number
  hasMore: boolean
  pending: Set<string>
  removed: Set<string>
  voice: VoiceList
  voiceLoading: Set<string>
  voiceErrors: Set<string>
  voiceVersions: Map<string, number>
  /** Aborts when this read's sheet closes or its dashboard changes: a question still up goes with it. */
  left: AbortController
}
type View = {
  host: string
  rows: ArchivedRow[]
  unread: UnreadProfile[]
  loading: boolean
  hasMore: boolean
  error: string | null
  pending: Set<string>
  voice: VoiceList
  voiceLoading: Set<string>
  voiceErrors: Set<string>
  actionErrors: Map<string, Action>
}

const rowKey = (row: ChatRow) => `${(row.profile || 'default').toLowerCase()}\0${row.id}`
const sameProfile = (rowProfile: string | undefined, profile: string) => (rowProfile || 'default').toLowerCase() === profile.toLowerCase()
const voiceUnavailable = (row: ChatRow, voice: VoiceList) =>
  !!row.autoArchived && !voice.tags.has((row.profile || 'default').toLowerCase())
const emptyView = (host: string): View => ({
  host,
  rows: [],
  unread: [],
  loading: true,
  hasMore: false,
  error: null,
  pending: new Set(),
  voice: { tags: new Map(), callChats: new Map() },
  voiceLoading: new Set(),
  voiceErrors: new Set(),
  actionErrors: new Map()
})

/** Keep model names from the dashboard for search and drop live pinned backfill rows (`archived: false`). */
function archivedPage(body: unknown): { rows: ArchivedRow[]; rawCount: number } {
  const sessions = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && 'sessions' in body && Array.isArray(body.sessions)
      ? body.sessions
      : []
  const archived = sessions.filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== 'object') return false
    const flag = (item as { archived?: unknown }).archived
    return flag === undefined || flag === true || flag === 1
  })
  const models = new Map<string, string>()
  for (const item of archived) {
    const id = 'id' in item && typeof item.id === 'string' ? item.id : 'session_id' in item && typeof item.session_id === 'string' ? item.session_id : ''
    const model = 'model' in item && typeof item.model === 'string' ? item.model : 'model_id' in item && typeof item.model_id === 'string' ? item.model_id : ''
    const profile = 'profile' in item && typeof item.profile === 'string' && item.profile ? item.profile : 'default'
    if (id && model) models.set(`${profile.toLowerCase()}\0${id}`, model)
  }
  return {
    rawCount: archived.length,
    rows: rowsFromResponse({ sessions: archived }).map(row => {
      const model = models.get(rowKey(row))
      return model ? { ...row, model } : row
    })
  }
}

/** Offsets and totals can arrive as JSON numbers or numeric strings. */
function paginationNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}

/** Archived chats from the active dashboard, across profiles, excluding the voice rows still shown in Chats. */
export function ArchivedChats({ host, profile, visibleVoiceIds, onClose, onRestore, onDelete }: Props) {
  const [view, setView] = useState(() => emptyView(host))
  const [query, setQuery] = useState('')
  const life = useRef<Life | null>(null)
  const currentHost = useRef(host)
  const currentVisibleVoiceIds = useRef(visibleVoiceIds)
  const close = useRef(onClose)
  const done = useRef<HTMLButtonElement>(null)
  currentHost.current = host
  currentVisibleVoiceIds.current = visibleVoiceIds
  close.current = onClose

  const isCurrent = (ticket: Life) => ticket.active && life.current === ticket && currentHost.current === ticket.host
  const update = (ticket: Life, change: (previous: View) => View) => {
    if (!isCurrent(ticket)) return
    setView(previous => (isCurrent(ticket) && previous.host === ticket.host ? change(previous) : previous))
  }

  const publishVoice = (ticket: Life) => {
    const voice = { tags: new Map(ticket.voice.tags), callChats: new Map(ticket.voice.callChats) }
    const voiceLoading = new Set(ticket.voiceLoading)
    const voiceErrors = new Set(ticket.voiceErrors)
    update(ticket, previous => ({ ...previous, voice, voiceLoading, voiceErrors }))
  }

  /** Read fresh tags for this archive read: useVoiceList's snapshot may predate a new auto-archive. */
  const readVoice = async (ticket: Life, profile: string) => {
    if (!isCurrent(ticket)) return
    const key = profile.toLowerCase()
    const version = (ticket.voiceVersions.get(key) ?? 0) + 1
    ticket.voiceVersions.set(key, version)
    ticket.voiceLoading.add(key)
    ticket.voiceErrors.delete(key)
    publishVoice(ticket)
    try {
      const path = `/api/plugins/conduit_push/voice/tags${key === 'default' ? '' : `?profile=${encodeURIComponent(profile)}`}`
      const answer = await gateway.http('GET', path)
      if (!isCurrent(ticket) || ticket.voiceVersions.get(key) !== version) return
      if (!answer || typeof answer !== 'object' || ('ok' in answer && answer.ok === false) || !('tags' in answer) || !answer.tags || typeof answer.tags !== 'object' || Array.isArray(answer.tags)) {
        throw new Error('Invalid voice tags')
      }
      const parsed = parseVoiceTags(answer)
      ticket.voice.tags.set(key, parsed.tags)
      ticket.voice.callChats.set(key, parsed.callChats)
    } catch (error) {
      if (isCurrent(ticket) && ticket.voiceVersions.get(key) === version) {
        if ((error as { code?: unknown } | null)?.code === 404) {
          // A host without the Conduit plugin has no plugin-archived voice rows; saved calls still match by endReason.
          ticket.voice.tags.set(key, new Map())
          ticket.voice.callChats.set(key, new Set())
        } else {
          ticket.voiceErrors.add(key)
        }
      }
    } finally {
      if (isCurrent(ticket) && ticket.voiceVersions.get(key) === version) {
        ticket.voiceLoading.delete(key)
        publishVoice(ticket)
      }
    }
  }

  /** Read at most a batch at a time; a full last page offers another batch. */
  const load = async (ticket: Life, reset = false) => {
    if (!isCurrent(ticket) || ticket.loading) return
    ticket.loading = true
    const read = ++ticket.read
    const profiles = new Map<string, string>()
    if (reset) {
      ticket.offset = 0
      ticket.hasMore = false
      for (const [key, version] of ticket.voiceVersions) ticket.voiceVersions.set(key, version + 1)
      ticket.voice = { tags: new Map(), callChats: new Map() }
      ticket.voiceLoading.clear()
      ticket.voiceErrors.clear()
    }
    update(ticket, previous => ({
      ...previous,
      ...(reset ? { rows: [], unread: [], hasMore: false, voice: { tags: new Map(), callChats: new Map() }, voiceLoading: new Set<string>(), voiceErrors: new Set<string>() } : {}),
      loading: true,
      error: null
    }))
    try {
      for (let page = 0; page < CHAT_LIST_MAX_PAGES; page++) {
        const offset = ticket.offset
        const body = await gateway.http('GET', chatListPath(offset, 'only'))
        if (!isCurrent(ticket) || read !== ticket.read) return
        const { rows: pageRows, rawCount } = archivedPage(body)
        const rows = pageRows.filter(row => !ticket.removed.has(rowKey(row)))
        let voiceChanged = false
        for (const row of rows) {
          if (!row.autoArchived) continue
          const name = row.profile || 'default'
          const key = name.toLowerCase()
          if (profiles.has(key) || ticket.voice.tags.has(key) || ticket.voiceLoading.has(key)) continue
          profiles.set(key, name)
          ticket.voiceVersions.set(key, (ticket.voiceVersions.get(key) ?? 0) + 1)
          ticket.voice.tags.delete(key)
          ticket.voice.callChats.delete(key)
          ticket.voiceLoading.add(key)
          ticket.voiceErrors.delete(key)
          voiceChanged = true
        }
        if (voiceChanged) publishVoice(ticket)
        const unread = unreadProfiles(body)
        const metadata = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
        const nextValue = ('next_offset' in metadata ? metadata.next_offset : undefined) ?? ('nextOffset' in metadata ? metadata.nextOffset : undefined)
        const moreValue = ('has_more' in metadata ? metadata.has_more : undefined) ?? ('hasMore' in metadata ? metadata.hasMore : undefined)
        const total = paginationNumber('total' in metadata ? metadata.total : undefined)
        const nextOffset = paginationNumber(nextValue)
        const explicitMore = moreValue === true || (typeof moreValue === 'number' && moreValue !== 0) ||
          (typeof moreValue === 'string' && ['true', '1', 'yes'].includes(moreValue.toLowerCase()))
        const explicitNoMore = moreValue === false || moreValue === 0 ||
          (typeof moreValue === 'string' && ['false', '0', 'no'].includes(moreValue.toLowerCase()))
        const pageStep = Math.min(rawCount, CHAT_LIST_PAGE)
        const next = nextOffset !== undefined && nextOffset > offset ? nextOffset : offset + pageStep
        ticket.offset = next
        ticket.hasMore = !explicitNoMore && rawCount > 0 && Number.isSafeInteger(next) && next > offset && (
          explicitMore || (nextOffset !== undefined && nextOffset > offset) ||
          (total !== undefined ? offset + pageStep < total : pageStep >= CHAT_LIST_PAGE)
        )
        update(ticket, previous => {
          const seen = new Set(previous.rows.map(rowKey))
          const errors = new Map(previous.unread.map(item => [item.profile.toLowerCase(), item]))
          for (const item of unread) errors.set(item.profile.toLowerCase(), item)
          return {
            ...previous,
            rows: [...previous.rows, ...rows.filter(row => !seen.has(rowKey(row)))],
            unread: [...errors.values()],
            hasMore: ticket.hasMore
          }
        })
        if (!ticket.hasMore) break
      }
    } catch (error) {
      if (isCurrent(ticket) && read === ticket.read) {
        update(ticket, previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }))
      }
    } finally {
      if (isCurrent(ticket) && read === ticket.read) {
        ticket.loading = false
        update(ticket, previous => ({ ...previous, loading: false }))
        // Fetch after the batch, so even rows on its last page are classified with a fresh read.
        for (const name of profiles.values()) void readVoice(ticket, name)
      }
    }
  }

  useEffect(() => {
    const ticket: Life = {
      host, active: true, read: 0, loading: false, offset: 0, hasMore: false, pending: new Set(), removed: new Set(),
      voice: { tags: new Map(), callChats: new Map() }, voiceLoading: new Set(), voiceErrors: new Set(), voiceVersions: new Map(),
      left: new AbortController()
    }
    life.current = ticket
    setView(emptyView(host))
    void load(ticket)
    return () => {
      ticket.active = false
      // A delete confirmation still up would confirm nothing now, so it closes with the sheet.
      ticket.left.abort()
    }
  }, [host])

  useEffect(() => {
    done.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || inSelectMenu(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (!cancelFrontDialog()) close.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const act = async (row: ChatRow, action: Action) => {
    const ticket = life.current
    if (!ticket || !isCurrent(ticket) || ticket.host !== host) return
    if (voiceUnavailable(row, ticket.voice) || (currentVisibleVoiceIds.current?.has(row.id) && isArchivedVoiceChat(row, ticket.voice))) return
    const key = rowKey(row)
    if (ticket.pending.has(key)) return
    ticket.pending.add(key)
    update(ticket, previous => {
      const pending = new Set(previous.pending).add(key)
      const actionErrors = new Map(previous.actionErrors)
      actionErrors.delete(key)
      return { ...previous, pending, actionErrors }
    })
    let ok = false
    let cancelled = false
    try {
      if (action === 'delete') {
        const confirmed = await ask(`${t('Delete conversation?')}\n\n${row.title}\n${t('This permanently deletes the conversation and cannot be undone.')}`, {
          confirm: t('Delete'),
          destructive: true,
          signal: ticket.left.signal
        })
        if (!isCurrent(ticket)) return
        if (!confirmed) cancelled = true
        if (voiceUnavailable(row, ticket.voice) || (currentVisibleVoiceIds.current?.has(row.id) && isArchivedVoiceChat(row, ticket.voice))) cancelled = true
      }
      if (!cancelled) ok = await (action === 'restore' ? onRestore(row) : onDelete(row))
    } catch {
      // Keep the row and its error visible for another attempt.
    }
    if (!isCurrent(ticket)) return
    ticket.pending.delete(key)
    if (ok) ticket.removed.add(key)
    update(ticket, previous => {
      const pending = new Set(previous.pending)
      const actionErrors = new Map(previous.actionErrors)
      pending.delete(key)
      if (!ok && !cancelled) actionErrors.set(key, action)
      return { ...previous, pending, actionErrors, rows: ok ? previous.rows.filter(item => rowKey(item) !== key) : previous.rows }
    })
    if (ok && (ticket.loading || ticket.hasMore)) {
      // Removing a row shifts the dashboard's offsets. Restart an unfinished read so it can't skip a row.
      ticket.read++
      ticket.loading = false
      void load(ticket, true)
    }
  }

  // A host change hides the old host's rows even before the effect starts its new read.
  const shown = view.host === host ? view : emptyView(host)
  const needle = query.trim().toLowerCase()
  const rows = shown.rows.filter(row =>
    (!profile || sameProfile(row.profile, profile)) &&
    !(visibleVoiceIds?.has(row.id) && isArchivedVoiceChat(row, shown.voice)) &&
    (!needle || `${row.title} ${row.id} ${row.preview ?? ''} ${row.profile || 'default'} ${row.source ?? ''} ${row.model ?? ''}`.toLowerCase().includes(needle))
  )
  const unread = shown.unread.filter(item => !profile || sameProfile(item.profile, profile))

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-sheet archived-chats" role="dialog" aria-modal="true" aria-label={t('Archived chats')} onClick={event => event.stopPropagation()}>
        <header>
          <h2>{t('Archived chats')}</h2>
          <span className="spacer" />
          <button ref={done} className="link" onClick={onClose}>{t('Done')}</button>
        </header>
        <label className="chatlist-search archived-chats-search">
          <span className="sr-only">{t('Search chats')}</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search chats')} />
        </label>
        {rows.length ? (
          <ul className="archived-chats-list">
            {rows.map(row => {
              const key = rowKey(row)
              const pending = shown.pending.has(key)
              const error = shown.actionErrors.get(key)
              const voiceProfile = row.profile || 'default'
              const voiceKey = voiceProfile.toLowerCase()
              const unavailable = voiceUnavailable(row, shown.voice)
              return (
                <li key={key} aria-busy={pending}>
                  <div className="archived-chats-details">
                    <span className="row-title">{row.title}</span>
                    <span className="meta">{row.profile || 'default'}</span>
                    {unavailable ? (
                      <span className="error-text" role="status">
                        {t('Voice tags are unavailable. Restore and delete are disabled until they can be read.')}
                        {shown.voiceLoading.has(voiceKey) ? ` ${t('Loading…')}` : null}
                        {shown.voiceErrors.has(voiceKey) ? <button className="link" onClick={() => { if (life.current?.host === host) void readVoice(life.current, voiceProfile) }}>{t('Retry')}</button> : null}
                      </span>
                    ) : null}
                    {error ? <span className="error-text" role="alert">{error === 'restore' ? t('Could not restore this chat.') : t('Could not delete this chat.')}</span> : null}
                  </div>
                  <button className="link" aria-label={`${t('Restore')}: ${row.title}`} disabled={pending || unavailable} onClick={() => void act(row, 'restore')}>{t('Restore')}</button>
                  <button className="link danger" aria-label={`${t('Delete')}: ${row.title}`} disabled={pending || unavailable} onClick={() => void act(row, 'delete')}>{t('Delete')}</button>
                </li>
              )
            })}
          </ul>
        ) : null}
        {shown.loading ? <div className="empty" role="status">{t('Loading chats…')}</div> : null}
        {shown.error !== null ? (
          <div className="archived-chats-error" role="alert">
            <span>{t('Could not load archived chats.')}{shown.error ? ` ${shown.error}` : ''}</span>
            <button className="link" onClick={() => { if (life.current) void load(life.current) }}>{t('Retry')}</button>
          </div>
        ) : null}
        {unread.length ? (
          <div className="archived-chats-error" role="alert">
            {unread.map(item => (
              <span key={item.profile}>
                {item.corrupt
                  ? t('Hermes couldn’t read {profile}’s chats: its chat history on the host is damaged.', { profile: item.profile })
                  : item.error
                    ? t('Hermes couldn’t read {profile}’s chats: {error}', { profile: item.profile, error: item.error })
                    : t('Hermes couldn’t read {profile}’s chats.', { profile: item.profile })}
              </span>
            ))}
            <button className="link" disabled={shown.loading} onClick={() => { if (life.current) void load(life.current, true) }}>{t('Retry')}</button>
          </div>
        ) : null}
        {!shown.loading && shown.error === null && !unread.length && !shown.hasMore && !rows.length ? (
          <div className="empty">{needle ? t('No matching conversations') : t('No archived chats.')}</div>
        ) : null}
        {!shown.loading && shown.error === null && shown.hasMore ? (
          <button className="secondary archived-chats-more" onClick={() => { if (life.current) void load(life.current) }}>{t('Show More')}</button>
        ) : null}
      </div>
    </div>
  )
}
