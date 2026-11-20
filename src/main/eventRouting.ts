/**
 * Which windows a gateway event goes to (desktop#200). The main window gets
 * every event (its list, notifications, titles and docks read them). The
 * wake-phrase listener gets none: it never listens. Another window (a chat
 * in its own window, Quick Ask) gets the events with no session, those of
 * the sessions it opened, and those of a session no window opened, so a
 * session that only an event names (a compaction's new one) still reaches
 * everyone. A window opens a session through its own `session.resume` or
 * `session.create`, which main notes before the answer goes back, so no
 * event of it can slip past between the two.
 */
export const SESSION_OPENING_METHODS: ReadonlySet<string> = new Set(['session.resume', 'session.create'])

export class EventRouter {
  /** The sessions each window opened, by its webContents id. */
  private readonly opened = new Map<number, Set<string>>()

  /** Notes the sessions a window's call opened: the answer's live id and stored id. */
  noteOpened(windowId: number, method: string, params: Record<string, unknown> | undefined, result: unknown): void {
    if (!SESSION_OPENING_METHODS.has(method)) return
    const answer = (result ?? {}) as { session_id?: unknown; stored_session_id?: unknown }
    const ids = [answer.session_id, answer.stored_session_id, method === 'session.resume' ? params?.session_id : undefined]
    let set = this.opened.get(windowId)
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue
      if (!set) this.opened.set(windowId, (set = new Set()))
      set.add(id)
    }
  }

  /** Whether a window that isn't the main one gets an event of this session. */
  wants(windowId: number, sessionId: string | undefined): boolean {
    if (!sessionId) return true
    if (this.opened.get(windowId)?.has(sessionId)) return true
    for (const [id, sessions] of this.opened) if (id !== windowId && sessions.has(sessionId)) return false
    return true
  }

  forget(windowId: number): void {
    this.opened.delete(windowId)
  }

  /** Another dashboard: its sessions are opened anew. */
  clear(): void {
    this.opened.clear()
  }
}
