import { dashboardHttp, keptGateway } from '../gateway'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { answerKeeper, keptAnswer } from './keptAnswers'
import { LIVE_BOARD_POLL_MS, startKanbanStream, windowSockets } from './kanbanEvents'
import { boardPath, boardPollDelay, defaultAssignee, failedInTransit, FIRST_READ_RETRY_MS, parseBoard, parseBoards, parseTask, parseTaskDetail, type KanbanBoard, type KanbanBoardRow, type KanbanTask, type KanbanTaskDetail } from './kanban'

const BOARD_KEY = 'conduit.kanbanBoard'
/** Another dashboard's list of boards is read again this often while Board shows. */
export const FAR_BOARDS_POLL_MS = 60_000
/** A board on another combined dashboard, picked last: {"host", "slug"}. */
const FAR_BOARD_KEY = 'conduit.kanbanFarBoard'

const savedBoard = (): string | null => {
  try {
    return localStorage.getItem(BOARD_KEY)
  } catch {
    return null
  }
}

const savedFarBoard = (): { host: string; slug: string | null } | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(FAR_BOARD_KEY) ?? 'null') as { host?: unknown; slug?: unknown } | null
    return raw && typeof raw.host === 'string' ? { host: raw.host, slug: typeof raw.slug === 'string' ? raw.slug : null } : null
  } catch {
    return null
  }
}

const store = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Kept for this window only.
  }
}

/** One combined dashboard's boards, for the picker: this one's (host null) first. */
export interface BoardList {
  host: string | null
  boards: KanbanBoardRow[]
}

/**
 * The last board read on this dashboard, so opening Tasks again shows it at
 * once while the read runs, as the phone keeps its board, instead of an
 * empty board until the dashboard answers.
 */
let keptHost = ''
const kept = new Map<string, KanbanBoard>()
let keptBoards: KanbanBoardRow[] | null = null
/** Another dashboard's boards are kept for this run only, under its URL. */
const keptKey = (slug: string | null, host: string | null = null) => (host ? `${host}\n${slug ?? ''}` : (slug ?? ''))
const farLists = new Map<string, KanbanBoardRow[]>()

/** The dashboard signed in to; another one's board is never shown. */
export function setKanbanHost(host: string): void {
  if (host === keptHost) return
  keptHost = host
  kept.clear()
  keptBoards = null
}

/** This run's board, else the one kept on this computer from the last (keptAnswers.ts), so a launch opens on it too. */
function keptBoard(slug: string | null, host: string | null = null): KanbanBoard | null {
  const key = keptKey(slug, host)
  if (!kept.has(key) && !host) {
    const raw = keptAnswer(boardPath('/board', slug))
    if (raw !== undefined) {
      try {
        kept.set(key, parseBoard(raw))
      } catch {
        // Not a board any more: read afresh.
      }
    }
  }
  return kept.get(key) ?? null
}

/** Hermes says so when there's no board plugin: a 404 on its routes. */
const missing = (error: unknown) => (error as { code?: unknown } | null)?.code === 404 || /\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))

/**
 * The task board: its boards, the one picked (kept on this computer; the
 * server's current board is never changed), and its lanes, read again every
 * few seconds while `shown`. A board can be on another combined dashboard
 * (`farHosts`, those kept live now): it is read and changed through that
 * dashboard's kept connection, with no switch, at the poll's pace, since its
 * live stream runs on that dashboard's socket.
 */
export function useKanban(connected: boolean, shown: boolean, farHosts: readonly string[] = []) {
  const [boards, setBoards] = useState<KanbanBoardRow[] | null>(keptBoards)
  const [ownSlug, setOwnSlug] = useState<string | null>(savedBoard)
  const [farPick, setFarPick] = useState(savedFarBoard)
  // Another dashboard's board while that dashboard is kept; this one's otherwise.
  const host = farPick && farHosts.includes(farPick.host) ? farPick.host : null
  const slug = host ? farPick!.slug : ownSlug
  const http = useMemo(() => dashboardHttp(host), [host])
  const [board, setBoard] = useState<KanbanBoard | null>(() => keptBoard(slug, host))
  // Another board shown (a pick, or a far dashboard kept again or no longer): its kept copy, until the read.
  const shownKey = keptKey(slug, host)
  const lastKey = useRef(shownKey)
  useEffect(() => {
    if (lastKey.current === shownKey) return
    lastKey.current = shownKey
    setBoard(keptBoard(slug, host))
    setError(null)
    setUnavailable(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey])
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [assignee, setAssignee] = useState('default')
  const generation = useRef(0)
  /** The live event stream is up: the poll is only a backstop then. */
  const [live, setLive] = useState(false)
  const liveRef = useRef(false)
  const repace = useRef<(() => void) | null>(null)
  /** The tasks the stream's last batch touched, so an open task reads again at once. */
  const [touched, setTouched] = useState<{ revision: number; ids: ReadonlySet<string> }>({ revision: 0, ids: new Set() })

  /** Reads in a row that found the board as it was, which space the poll out. */
  const unchanged = useRef(0)

  /**
   * Reads the board. While nothing of it shows yet, a read lost in transit
   * asks once more after a second before the failure shows, as the phone
   * does; with a board on screen the poll's pace carries it.
   */
  const load = useCallback(async () => {
    const mine = ++generation.current
    const key = keptKey(slug, host)
    for (let attempt = 0; ; attempt++) {
      try {
        const path = boardPath('/board', slug)
        // Only this dashboard's board is kept on this computer for the next launch.
        const keep = host ? null : answerKeeper(path)
        const raw = await http('GET', path)
        if (mine !== generation.current) return
        const read = parseBoard(raw)
        const before = kept.get(key)
        const same = before !== undefined && JSON.stringify(before) === JSON.stringify(read)
        unchanged.current = same ? unchanged.current + 1 : 0
        // Written only when it changed: the poll reads every few seconds.
        if (keep && (!same || keptAnswer(path) === undefined)) keep(raw)
        kept.set(key, read)
        // The same read keeps the board drawn, unless a move shown at once is still on it.
        setBoard(current => (same && current === before ? current : read))
        setError(null)
        setUnavailable(false)
        return
      } catch (e) {
        if (mine !== generation.current) return
        if (attempt === 0 && !kept.has(key) && failedInTransit(e)) {
          await new Promise(resolve => setTimeout(resolve, FIRST_READ_RETRY_MS))
          if (mine !== generation.current) return
          continue
        }
        unchanged.current = 0
        if (missing(e) && !slug) setUnavailable(true)
        else setError(e instanceof Error ? e.message : String(e))
        return
      }
    }
  }, [slug, host, http])

  const loadBoards = useCallback(async () => {
    try {
      const list = parseBoards(await dashboardHttp(null)('GET', boardPath('/boards', null)))
      keptBoards = list
      setBoards(list)
      // A saved board that's gone falls back to the server's current one.
      if (ownSlug && !list.some(row => row.slug === ownSlug)) setOwnSlug(null)
    } catch {
      setBoards(list => list ?? [])
    }
  }, [ownSlug])

  // Who a new task goes to by default, on the board's own dashboard.
  useEffect(() => {
    if (!connected || !shown) return
    let live = true
    setAssignee('default')
    http('GET', boardPath('/orchestration', null))
      .then(raw => live && setAssignee(defaultAssignee(raw)))
      .catch(() => {
        // An older plugin: the default profile.
      })
    return () => {
      live = false
    }
  }, [connected, shown, http])

  // The other combined dashboards' boards, for the picker; one without the board plugin lists none.
  const farKey = farHosts.join('\n')
  const [farBoards, setFarBoards] = useState<ReadonlyMap<string, KanbanBoardRow[]>>(() => new Map(farLists))
  useEffect(() => {
    const hosts = farKey ? farKey.split('\n') : []
    for (const url of [...farLists.keys()]) if (!hosts.includes(url)) farLists.delete(url)
    setFarBoards(new Map(farLists))
    if (!connected || !shown || !hosts.length) return
    let live = true
    // A dashboard still connecting, or one that failed, keeps what it last listed and is read again on the minute.
    const read = () =>
      void Promise.all(
        hosts.map(async url => {
          try {
            farLists.set(url, parseBoards(await keptGateway(url).http('GET', boardPath('/boards', null))))
          } catch {
            // Kept as it was.
          }
        })
      ).then(() => live && setFarBoards(new Map(farLists)))
    read()
    const timer = setInterval(() => !document.hidden && read(), FAR_BOARDS_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [connected, shown, farKey])
  const lists = useMemo<BoardList[]>(
    () => [{ host: null, boards: boards ?? [] }, ...farHosts.flatMap(url => (farBoards.get(url)?.length ? [{ host: url, boards: farBoards.get(url)! }] : []))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boards, farBoards, farKey]
  )

  useEffect(() => {
    if (!connected || !shown) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    unchanged.current = 0
    const tick = async (first: boolean) => {
      if (first || document.visibilityState === 'visible') await load()
      if (!stopped) timer = setTimeout(() => void tick(false), liveRef.current ? LIVE_BOARD_POLL_MS : boardPollDelay(unchanged.current))
    }
    void tick(true)
    // The stream dropped: the next read comes at the board's own pace, not the backstop's.
    repace.current = () => {
      if (stopped || timer === undefined) return
      clearTimeout(timer)
      timer = setTimeout(() => void tick(false), boardPollDelay(unchanged.current))
    }
    return () => {
      stopped = true
      clearTimeout(timer)
      repace.current = null
    }
  }, [connected, shown, load])

  // The live stream, from the cursor the first read of this board gave, while the board shows and the window is visible.
  const cursor = board?.latestEventId
  const hasCursor = cursor !== undefined
  const startAt = useRef<number | undefined>(undefined)
  startAt.current = cursor
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  useEffect(() => {
    if (!connected || !shown || !visible || !hasCursor || host) return
    const stream = startKanbanStream({
      board: slug,
      since: startAt.current!,
      sockets: windowSockets,
      onBatch: ids => {
        void load()
        setTouched(current => ({ revision: current.revision + 1, ids }))
      },
      onConnected: up => {
        liveRef.current = up
        setLive(up)
        // Back down: the board's own pace again, from now.
        if (!up) {
          unchanged.current = 0
          repace.current?.()
        }
      }
    })
    return () => {
      stream.stop()
    }
  }, [connected, shown, visible, hasCursor, slug, host, load])

  useEffect(() => {
    if (connected && shown) void loadBoards()
  }, [connected, shown, loadBoards])

  /** A board by its slug, on another combined dashboard (`on`) or this one. */
  const pickBoard = useCallback((next: string | null, on: string | null = null) => {
    setBoard(keptBoard(next, on))
    if (on) {
      setFarPick({ host: on, slug: next })
      store(FAR_BOARD_KEY, JSON.stringify({ host: on, slug: next }))
      return
    }
    setFarPick(null)
    store(FAR_BOARD_KEY, null)
    setOwnSlug(next)
    store(BOARD_KEY, next)
  }, [])

  /** A task's change (status, assignee, priority, title, body); the task as Hermes now has it. */
  const patch = useCallback(
    async (task: KanbanTask, fields: Record<string, unknown>): Promise<KanbanTask | null> => {
      // Shown at once in its new lane; the read that follows settles it.
      if (typeof fields.status === 'string') {
        const status = fields.status
        setBoard(current =>
          current && {
            ...current,
            columns: current.columns.map(column => ({
              ...column,
              tasks: column.name === status ? [{ ...task, status }, ...column.tasks.filter(row => row.id !== task.id)] : column.tasks.filter(row => row.id !== task.id)
            }))
          }
        )
      }
      try {
        const raw = (await http('PATCH', boardPath(`/tasks/${encodeURIComponent(task.id)}`, slug), fields)) as { task?: unknown } | null
        return parseTask(raw?.task)
      } finally {
        void load()
      }
    },
    [slug, http, load]
  )

  const create = useCallback(
    async (body: Record<string, unknown>): Promise<{ task: KanbanTask | null; warning?: string }> => {
      const raw = (await http('POST', boardPath('/tasks', slug), body)) as { task?: unknown; warning?: unknown } | null
      void load()
      return { task: parseTask(raw?.task), warning: typeof raw?.warning === 'string' ? raw.warning : undefined }
    },
    [slug, http, load]
  )

  const remove = useCallback(
    async (task: KanbanTask): Promise<void> => {
      await http('DELETE', boardPath(`/tasks/${encodeURIComponent(task.id)}`, slug))
      void load()
    },
    [slug, http, load]
  )

  const comment = useCallback(
    async (task: KanbanTask, body: string): Promise<void> => {
      await http('POST', boardPath(`/tasks/${encodeURIComponent(task.id)}/comments`, slug), { body })
    },
    [slug, http]
  )

  const detail = useCallback(
    async (id: string): Promise<KanbanTaskDetail | null> => parseTaskDetail(await http('GET', boardPath(`/tasks/${encodeURIComponent(id)}`, slug))),
    [slug, http]
  )

  return { boards, lists, host, slug, pickBoard, board, error, unavailable, defaultAssignee: assignee, reload: load, patch, create, remove, comment, detail, live, touched }
}
