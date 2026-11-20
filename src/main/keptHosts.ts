/**
 * Combined dashboards (the phone's AppState+CombinedDashboards.swift, stage
 * 3): the hosts switched on in Settings' Combine Dashboards, two or more,
 * are one group. Once the host on screen has connected, the group's others
 * sign in quietly beside it with what was saved for them, up to three at
 * once (four with the one on screen), and stay connected while it's in use.
 * Their events are dropped here; the window reads what it shows of them
 * (Needs you) through `http`. One whose sign-in is refused waits until it's
 * opened, and one that can't connect is tried again after 30 s, doubling to
 * 5 minutes. Switching to one takes up its open socket.
 */
import { Connection, type ConnectionStore, type HandedSocket, type SocketFactory } from './connection'
import type { Fetch } from './auth'
import type { ConnectionStatus, KeptHost, KeptHostState } from '../shared/ipc'

/** Kept beside the one on screen (stage 0's cap of four live dashboards). */
export const MAX_KEPT = 3
/** What the window may ask a kept host over its socket. */
export const KEPT_RPC_METHODS: readonly string[] = ['profiles.list', 'profiles.get_asset', 'groups.list']
export const KEPT_BACKOFF = { baseDelayMs: 30_000, capMs: 300_000, jitter: false }

export interface KeptHostsDeps {
  fetch: Fetch
  store: ConnectionStore
  createSocket: SocketFactory
  onChange: (hosts: KeptHost[]) => void
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

const stateOf = (status: ConnectionStatus): KeptHostState | null =>
  status.phase === 'open' ? 'live' : status.phase === 'connecting' ? 'connecting' : status.phase === 'reconnecting' ? 'down' : status.phase === 'failed' ? 'signIn' : null

export class KeptHosts {
  private readonly kept = new Map<string, { connection: Connection; state: KeptHostState }>()

  constructor(private readonly deps: KeptHostsDeps) {}

  list(): KeptHost[] {
    return [...this.kept.entries()].map(([url, { state }]) => ({ url, state }))
  }

  /** Follows the host on screen: keeps the group's others while it's signed in, starting them once it has connected. */
  sync(active: ConnectionStatus): void {
    const group = (this.deps.store.list?.() ?? []).filter(h => h.combined)
    if (group.length < 2 || !active.url || active.phase === 'signed-out' || active.phase === 'locked') return this.stopAll()
    const wanted = group.filter(h => h.url !== active.url).slice(0, MAX_KEPT).map(h => h.url)
    let changed = false
    for (const url of [...this.kept.keys()]) {
      if (!wanted.includes(url)) changed = this.stop(url) || changed
    }
    if (active.phase === 'open') {
      for (const url of wanted) if (!this.kept.has(url)) changed = this.start(url) || changed
    }
    if (changed) this.deps.onChange(this.list())
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

  /** A read through a kept host's connection; only GETs, since what it shows only opens through a switch. */
  async http<T>(url: string, path: string): Promise<T> {
    const kept = this.kept.get(url)
    if (!kept || kept.state !== 'live') throw new Error('Not connected to that Hermes.')
    return kept.connection.http<T>('GET', path, undefined, 6_000)
  }

  /** A read over a kept host's socket: only what lists that host's bots, reads their pictures and lists its group chats. */
  async rpc<T>(url: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!KEPT_RPC_METHODS.includes(method)) throw new Error('Only reads can go to another dashboard.')
    const kept = this.kept.get(url)
    if (!kept || kept.state !== 'live') throw new Error('Not connected to that Hermes.')
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
      createSocket: this.deps.createSocket,
      onStatus: status => {
        const kept = this.kept.get(url)
        const state = stateOf(status)
        if (kept?.connection !== connection || !state || state === kept.state) return
        kept.state = state
        this.deps.onChange(this.list())
      },
      // Fenced while another host is on screen: opening it runs the usual sync.
      onEvent: () => undefined,
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
    this.kept.delete(url)
    kept.connection.close()
    return true
  }
}
