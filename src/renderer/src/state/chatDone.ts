/**
 * Done chats, after the phone's ChatDoneMarks (hermes-conduit: Done chats). A
 * chat the user or their agent marked done; the plugin keeps the marks per
 * profile (`/chats/done`, plugin 0.182.0+), so the phone, the iPad and this app
 * show the same ones, under every id of the chat it was given: its lineage
 * root, which a compaction keeps, and its sessions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatRow } from './chats'

export const CHAT_DONE = 'chat-done'
export const DONE_PATH = '/api/plugins/conduit_push/chats/done'
/** The plugin keeps at most this many of a chat's ids. */
const MAX_IDS = 8
/** A profile's marks are read at most this often while the list changes. */
export const DONE_READ_INTERVAL_MS = 15_000

export interface DoneMark {
  ids: string[]
  at: number
  byAgent: boolean
}

/** Each profile's marks, by its lowercase name; null until one has been read (an older plugin never answers). */
export type DoneMarks = Record<string, DoneMark[]> | null

const profileKey = (profile?: string | null) => (profile || 'default').toLowerCase()

export const donePath = (profile?: string | null) =>
  profile && profile !== 'default' ? `${DONE_PATH}?profile=${encodeURIComponent(profile)}` : DONE_PATH

/** The ids a mark is kept under: the lineage root first, then the row's own. */
export const doneIds = (row: ChatRow): string[] => [...new Set([row.lineageRoot, row.id].filter((id): id is string => !!id))].slice(0, MAX_IDS)

/** The route's answer; null when it isn't one. */
export function parseDone(body: unknown): DoneMark[] | null {
  const rows = body && typeof body === 'object' ? (body as Record<string, unknown>).done : undefined
  if (!Array.isArray(rows)) return null
  return rows.flatMap(row => {
    const o = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    const ids = Array.isArray(o.ids) ? o.ids.filter((id): id is string => typeof id === 'string' && !!id) : []
    return ids.length && typeof o.at === 'number' ? [{ ids, at: o.at * 1000, byAgent: o.by === 'agent' }] : []
  })
}

export function isDone(marks: DoneMarks, row: ChatRow): boolean {
  const ids = new Set(doneIds(row))
  return !!marks?.[profileKey(row.profile)]?.some(mark => mark.ids.some(id => ids.has(id)))
}

/** The chat marked done, or open again, before the plugin answers. */
export function settingDone(marks: DoneMarks, row: ChatRow, done: boolean, now = Date.now()): DoneMarks {
  const key = profileKey(row.profile)
  const ids = new Set(doneIds(row))
  const kept = (marks?.[key] ?? []).filter(mark => !mark.ids.some(id => ids.has(id)))
  return { ...(marks ?? {}), [key]: done ? [{ ids: doneIds(row), at: now, byAgent: false }, ...kept] : kept }
}

type Http = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>

/**
 * The listed profiles' marks, read again as the list changes (`version`), each
 * profile at most every DONE_READ_INTERVAL_MS. `available` says the plugin keeps
 * them: Done in the menus and filters waits for it.
 */
export function useChatDone(http: Http, connected: boolean, profiles: string[], version: string, host: string) {
  const [marks, setMarks] = useState<DoneMarks>(null)
  const readAt = useRef(new Map<string, number>())
  const hostRef = useRef(host)
  useEffect(() => {
    hostRef.current = host
    readAt.current.clear()
    setMarks(null)
  }, [host])

  const read = useCallback(
    async (profile: string) => {
      const askedHost = hostRef.current
      readAt.current.set(profileKey(profile), Date.now())
      try {
        const done = parseDone(await http('GET', donePath(profile)))
        if (done && hostRef.current === askedHost) setMarks(current => ({ ...(current ?? {}), [profileKey(profile)]: done }))
      } catch {
        // An older plugin, or the host away: the marks stay as they were.
      }
    },
    [http]
  )

  const key = profiles.join('\t')
  useEffect(() => {
    if (!connected) return
    const now = Date.now()
    for (const profile of key.split('\t')) {
      const last = readAt.current.get(profileKey(profile))
      if (last === undefined || now - last >= DONE_READ_INTERVAL_MS) void read(profile)
    }
  }, [connected, key, version, read])

  const toggle = useCallback(
    (row: ChatRow) => {
      const done = !isDone(marks, row)
      setMarks(current => settingDone(current, row, done))
      http('POST', donePath(row.profile), { ids: doneIds(row), done }).catch(() => void read(row.profile ?? 'default'))
    },
    [http, marks, read]
  )

  return { marks, available: marks !== null, toggle }
}
