/**
 * Combined dashboards (the phone's AppState+CombinedDashboards.swift, stage
 * 3): the hosts switched on in Settings' Combine Dashboards, two or more,
 * are one group. Once the host on screen has connected, the group's others
 * sign in quietly beside it with what was saved for them, up to three at
 * once (four with the one on screen), and stay connected while it's in use.
 * The main window reads what it shows of them (Needs you) through `http`;
 * their events, requests and status go only to the chat windows open on
 * them (`connection`), which use their sockets whole. One whose sign-in is refused waits until it's
 * opened, and one that can't connect is tried again after 30 s, doubling to
 * 5 minutes. Switching to one takes up its open socket.
 */
import { Connection, type ConnectionStore, type HandedSocket, type SocketFactory } from './connection'
import type { Fetch } from './auth'
import { BOTS_META_KEY } from '../shared/botsMeta'
import type { ConnectionStatus, GatewayEventMessage, KeptHost, KeptHostState, PendingRequest } from '../shared/ipc'

/** Kept beside the one on screen (stage 0's cap of four live dashboards). */
export const MAX_KEPT = 3
/** What the window may ask a kept host over its socket. */
export const KEPT_RPC_METHODS: readonly string[] = ['profiles.list', 'profiles.get_asset', 'groups.list', 'model.options']
/**
 * The one change a kept socket takes: a bot's look in Hermes' `ui_meta['hermes-bots']` and nothing
 * else in that call, so a category filed or renamed on the combined Bots grid reaches another
 * dashboard's bots without a switch, as the phone writes them.
 */
export function keptRpcWritable(method: string, params: Record<string, unknown>): boolean {
  if (method !== 'profiles.configure' || typeof params.name !== 'string') return false
  if (!Object.keys(params).every(key => key === 'name' || key === 'ui_meta' || key === 'ui_meta_expected_revisions')) return false
  const botsOnly = (value: unknown) =>
    !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.keys(value).every(key => key === BOTS_META_KEY)
  return botsOnly(params.ui_meta) && (params.ui_meta_expected_revisions === undefined || botsOnly(params.ui_meta_expected_revisions))
}
/**
 * What another dashboard takes besides reads: its scheduled jobs and its task board, which Tasks
 * shows and changes in place, with no switch (Eric, 2026-11-22: Scheduled's faces and Board's
 * dropdown reach every combined dashboard), and its Conduit plugin's update, which Settings >
 * Conduit plugin starts there (Eric, 2026-11-28).
 */
export const KEPT_WRITE_PATHS: readonly string[] = ['/api/cron/jobs', '/api/plugins/kanban/', '/api/plugins/conduit_push/self/update']
const KEPT_WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE']
/**
 * Whether a change may go to `path` on another dashboard: under KEPT_WRITE_PATHS once the URL
 * parser has resolved it, and with no dot segment, plain or percent-encoded, that it would resolve.
 */
export function keptWritable(path: string): boolean {
  if (/\.\.|%2e/i.test(path)) return false
  let resolved: string
  try {
    resolved = new URL(path, 'http://kept.invalid').pathname
  } catch {
    return false
  }
  return KEPT_WRITE_PATHS.some(prefix => (prefix.endsWith('/') ? resolved.startsWith(prefix) : resolved === prefix || resolved.startsWith(`${prefix}/`)))
}
export const KEPT_BACKOFF = { baseDelayMs: 30_000, capMs: 300_000, jitter: false }
/** The longest a stopped kept host's connection stays open for its `beforeStop` work (a screen's hand back tries for 13 s). */
export const STOP_GRACE_MS = 15_000

export interface KeptHostsDeps {
  fetch: Fetch
  store: ConnectionStore
  createSocket: SocketFactory
  onChange: (hosts: KeptHost[]) => void
  onHermesName?: (url: string, name: string) => void
  /** A kept host's status, events and requests, for the chat windows open on it. */
  onStatus?: (url: string, status: ConnectionStatus) => void
  onEvent?: (url: string, event: GatewayEventMessage) => void
  onRequests?: (url: string, requests: PendingRequest[]) => void
  /**
   * A kept host is about to stop (it left the group, or the one on screen signed out): what still has to go
   * through its connection, such as handing back its bots' screens (desktop#351). The connection is still
   * `connection(url)` while this runs, and closes once what it returns settles, or after `STOP_GRACE_MS`.
   */
  beforeStop?: (url: string) => Promise<unknown> | void
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

const stateOf = (status: ConnectionStatus): KeptHostState | null =>
  status.phase === 'open' ? 'live' : status.phase === 'connecting' ? 'connecting' : status.phase === 'reconnecting' ? 'down' : status.phase === 'failed' ? 'signIn' : null


/** A kept host not connected now: the request never left, which the renderer tells apart (`not_connected`). */
const notConnected = () => Object.assign(new Error('Not connected to that Hermes.'), { data: { reason: 'not_connected' } })

export class KeptHosts {
  private readonly kept = new Map<string, { connection: Connection; state: KeptHostState }>()

  constructor(private readonly deps: KeptHostsDeps) {}

  list(): KeptHost[] {
    return [...this.kept.entries()].map(([url, { state }]) => ({ url, state }))
  }

  /** Follows the host on screen: keeps the group's others while it's signed in, starting them once it has connected. */
  sync(active: ConnectionStatus): void {
    if (!active.url || active.phase === 'signed-out' || active.phase === 'locked') return this.stopAll()
    const wanted = this.wanted(active.url)
    if (!wanted.length) return this.stopAll()
    let changed = false
    for (const url of [...this.kept.keys()]) {
      if (!wanted.includes(url)) changed = this.stop(url) || changed
    }
    if (active.phase === 'open') {
      for (const url of wanted) if (!this.kept.has(url)) changed = this.start(url) || changed
    }
    if (changed) this.deps.onChange(this.list())
  }

  /** The combined hosts kept beside this one on screen, whether connected yet or not. */
  wanted(active: string): string[] {
    const group = (this.deps.store.list?.() ?? []).filter(h => h.combined)
    if (group.length < 2) return []
    return group.filter(h => h.url !== active).slice(0, MAX_KEPT).map(h => h.url)
  }

  /** A kept host's connection whole, for a chat window open on it; null when it isn't kept. */
  connection(url: string): Connection | null {
    return this.kept.get(url)?.connection ?? null
  }

  stopAll(): void {
    if (!this.kept.size) return
    for (const url of [...this.kept.keys()]) this.stop(url)
    this.deps.onChange([])
  }

  /**
   * A switch to a kept host takes up its open socket rather than dialing
   * again (the phone's promotion of a live combined host). Null when it isn't
   * kept or isn't connected, and the switch dials as usual.
   */
  take(url: string): HandedSocket | null {
    const kept = this.kept.get(url)
    if (!kept || kept.state !== 'live') return null
    const handed = kept.connection.handOver()
    this.kept.delete(url)
    kept.connection.close()
    this.deps.onChange(this.list())
    return handed
  }

  /**
   * A request through a kept host's connection: a GET for anything it shows, and a change only to
   * what Tasks changes in place there (KEPT_WRITE_PATHS); the rest opens through a switch.
   */
  async http<T>(url: string, path: string, method = 'GET', body?: unknown): Promise<T> {
    if (method !== 'GET' && !(KEPT_WRITE_METHODS.includes(method) && keptWritable(path))) throw new Error('Only reads can go to another dashboard.')
    const kept = this.kept.get(url)
    if (!kept || kept.state !== 'live') throw notConnected()
    return method === 'GET' ? kept.connection.http<T>('GET', path, undefined, 6_000) : kept.connection.http<T>(method, path, body)
  }

  /**
   * A read over a kept host's socket: only what lists that host's bots, reads their pictures, lists its group chats
   * and lists its models (a far scheduled job's model picker); and a bot's look (keptRpcWritable).
   */
  async rpc<T>(url: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!KEPT_RPC_METHODS.includes(method) && !keptRpcWritable(method, params)) throw new Error('Only reads can go to another dashboard.')
    const kept = this.kept.get(url)
    if (!kept || kept.state !== 'live') throw notConnected()
    return kept.connection.rpc<T>(method, params)
  }

  private start(url: string): boolean {
    const store = this.deps.store
    if (!store.get?.(url)) return false
    const pinned: ConnectionStore = {
      load: () => store.get?.(url) ?? null,
      save: saved => store.update?.(saved),
      update: saved => store.update?.(saved),
      clear: () => undefined,
      list: () => store.list?.() ?? []
    }
    const connection: Connection = new Connection({
      fetch: this.deps.fetch,
      store: pinned,
      oidcStore: store,
      createSocket: this.deps.createSocket,
      onStatus: status => {
        const kept = this.kept.get(url)
        // One handed over to a switch, or stopped, says nothing more.
        if (kept?.connection !== connection) return
        this.deps.onStatus?.(url, status)
        const state = stateOf(status)
        if (!state || state === kept.state) return
        kept.state = state
        this.deps.onChange(this.list())
      },
      // Only to the chat windows open on it: the main window opens it through the usual sync.
      onEvent: event => {
        if (this.kept.get(url)?.connection === connection) this.deps.onEvent?.(url, event)
      },
      onRequests: requests => {
        if (this.kept.get(url)?.connection === connection) this.deps.onRequests?.(url, requests)
      },
      onHermesName: this.deps.onHermesName,
      refusedWaits: true,
      backoff: KEPT_BACKOFF,
      setTimeout: this.deps.setTimeout,
      clearTimeout: this.deps.clearTimeout
    })
    this.kept.set(url, { connection, state: 'connecting' })
    void connection.restore()
    return true
  }

  private stop(url: string): boolean {
    const kept = this.kept.get(url)
    if (!kept) return false
    // Run while it's still kept, so what it sends finds the connection.
    const last = this.deps.beforeStop?.(url)
    this.kept.delete(url)
    if (!last) {
      kept.connection.close()
      return true
    }
    // It says nothing more (it's no longer kept), and closes once that work is done.
    let closed = false
    let grace: unknown = null
    const close = () => {
      if (closed) return
      closed = true
      if (grace !== null) (this.deps.clearTimeout ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>)))(grace)
      kept.connection.close()
    }
    grace = (this.deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)))(close, STOP_GRACE_MS)
    void Promise.resolve(last).then(close, close)
    return true
  }
}
