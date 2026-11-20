import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { SAVED_ROWS, saveChatList, savedChatList } from './savedChatList'
import { CHAT_LIST_MAX_PAGES, CHAT_LIST_PAGE, chatListPath, keepSameRows, mergeRows, refreshFirstPage, responseCount, rowsFromResponse, type ChatRow } from './chats'

/**
 * The chat list, read when the connection opens and again when Hermes says
 * the sessions changed. `host`'s saved list stands in from launch until the
 * first read, saying Updating….
 */
export function useChatList(connected: boolean, host = '') {
  const [saved] = useState(() => savedChatList(host))
  const [rows, setRows] = useState<ChatRow[] | null>(saved)
  const [error, setError] = useState<string | null>(null)
  /** Archived rows Hermes stamped auto-archived: voice's (see voiceList.ts) are listed with the chats. */
  const [archived, setArchived] = useState<ChatRow[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dashboardList = useRef(true)

  const generation = useRef(0)

  const rowsRef = useRef<ChatRow[] | null>(saved)
  /**
   * Updating… (issue 2706): rows read before the connection dropped may be
   * out of date, so the read after it says so until its first page lands.
   * The list's own refreshes over a current list say nothing; a failed read
   * stops saying it and leaves the rows stale for the next one.
   */
  const stale = useRef(!!saved)
  const [updating, setUpdating] = useState(false)

  /**
   * The first page at once, then (on a full load) the rest page by page
   * behind it. A refresh reads only the first page, over the rows it has.
   */
  const load = useCallback(async (full = true) => {
    const ticket = ++generation.current
    let shown = false
    setUpdating(stale.current && !!rowsRef.current?.length)
    try {
      let body: unknown
      if (dashboardList.current) {
        try {
          body = await gateway.http('GET', chatListPath(0))
        } catch {
          // An older dashboard without the every-profile list: the gateway's own.
          dashboardList.current = false
        }
      }
      if (!dashboardList.current) body = await gateway.rpc('session.list', { limit: CHAT_LIST_PAGE })
      if (ticket !== generation.current) return
      const first = rowsFromResponse(body)
      const pageWasFull = dashboardList.current && responseCount(body) >= CHAT_LIST_PAGE
      let all = keepSameRows(rowsRef.current, !full && rowsRef.current ? refreshFirstPage(rowsRef.current, first, pageWasFull) : first)
      // A refresh that brings nothing new keeps the list as it is, and its saved copy.
      if (all !== rowsRef.current) {
        rowsRef.current = all
        setRows(all)
        saveChatList(host, all)
      }
      setError(null)
      stale.current = false
      setUpdating(false)
      shown = true
      if (!dashboardList.current) return
      void readArchived(ticket, full)
      if (!full) return
      for (let page = 1; page < CHAT_LIST_MAX_PAGES && responseCount(body) >= CHAT_LIST_PAGE; page++) {
        body = await gateway.http('GET', chatListPath(page * CHAT_LIST_PAGE))
        if (ticket !== generation.current) return
        const merged = mergeRows(all, rowsFromResponse(body))
        if (merged.length === all.length) continue
        all = merged
        rowsRef.current = all
        setRows(all)
        if (page * CHAT_LIST_PAGE < SAVED_ROWS) saveChatList(host, all)
      }
    } catch (e) {
      // A later page that fails leaves the chats already shown; the next refresh tries again.
      if (ticket !== generation.current || shown) return
      setUpdating(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [host])

  /** The archived pages' auto-archived rows, as deep as the list reads; a refresh reads the first page only. */
  const archivedRef = useRef<ChatRow[]>([])
  const readArchived = async (ticket: number, full: boolean) => {
    try {
      let found: ChatRow[] = []
      for (let page = 0; page < (full ? CHAT_LIST_MAX_PAGES : 1); page++) {
        const body = await gateway.http('GET', chatListPath(page * CHAT_LIST_PAGE, 'only'))
        if (ticket !== generation.current) return
        found = [...found, ...rowsFromResponse(body).filter(r => r.autoArchived)]
        if (responseCount(body) < CHAT_LIST_PAGE) break
      }
      const next = full ? found : mergeRows(archivedRef.current, found)
      archivedRef.current = next
      setArchived(next)
    } catch {
      // Voice's archived rows wait for the next read.
    }
  }

  const refreshSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(false), 400)
  }, [load])

  useEffect(() => {
    if (!connected) {
      // What's listed now predates the drop: the read once it's back says Updating….
      if (rowsRef.current) stale.current = true
      generation.current++
      setUpdating(false)
      return
    }
    void load()
    const off = window.conduit.onEvent(event => {
      if (event.type === 'sessions.changed' || event.type === 'session.title' || event.type === 'message.complete') {
        refreshSoon()
      }
    })
    return () => {
      off()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [connected, load, refreshSoon])

  /** Shows a row's change at once (a pin, a rename), ahead of the list Hermes sends next. */
  const patchRow = useCallback((id: string, patch: Partial<ChatRow> | null) => {
    const current = rowsRef.current
    if (!current) return
    const next = patch === null ? current.filter(r => r.id !== id) : current.map(r => (r.id === id ? { ...r, ...patch } : r))
    rowsRef.current = next
    setRows(next)
  }, [])

  return { rows, archived, error, updating, refresh: refreshSoon, patchRow }
}
