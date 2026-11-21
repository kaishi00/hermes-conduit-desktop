/**
 * Which window's page opened each live socket (a call's, a bot's screen
 * stream), so the sockets go with the page that opened them (desktop#254).
 * A page goes when its window closes, and also when the window reloads (a
 * language change reloads every window): a reload keeps the same
 * webContents, so its `destroyed` never fires, and a stream the old page
 * opened would keep streaming to a page that discards it. Kept free of
 * Electron so the rules are tested on their own.
 */

export interface LiveClose {
  code: number
  reason: string
}

/** A window that closed: a clean close, so Hermes ends what the viewer had. Its hold was handed back already (screenWindowSet.ts). */
export const PAGE_CLOSED: LiveClose = { code: 1000, reason: 'Window closed' }

/**
 * A page that reloaded: not a clean close, so Hermes keeps a takeover the
 * page held. The reloaded page watches again as the same viewer (#246), so
 * the hold stays this window's.
 */
export const PAGE_RELOADED: LiveClose = { code: 4001, reason: 'Page reloaded' }

/** Whether a navigation replaces the window's page: its main frame, not a hash or history change within the page. */
export function replacesPage(navigation: { isMainFrame: boolean; isSameDocument: boolean }): boolean {
  return navigation.isMainFrame && !navigation.isSameDocument
}

export class LiveOwners {
  private readonly byOwner = new Map<number, Set<string>>()
  private readonly ownerOf = new Map<string, number>()

  /** Notes a socket the owner's page opened. */
  add(owner: number, id: string): void {
    let ids = this.byOwner.get(owner)
    if (!ids) this.byOwner.set(owner, (ids = new Set()))
    ids.add(id)
    this.ownerOf.set(id, owner)
  }

  /** A socket that ended on its own, or that its page closed. */
  remove(id: string): void {
    const owner = this.ownerOf.get(id)
    if (owner === undefined) return
    this.ownerOf.delete(id)
    const ids = this.byOwner.get(owner)
    ids?.delete(id)
    if (ids && !ids.size) this.byOwner.delete(owner)
  }

  /** The sockets the owner's page still has, forgotten here: the page went, and the caller ends them. */
  take(owner: number): string[] {
    const ids = [...(this.byOwner.get(owner) ?? [])]
    this.byOwner.delete(owner)
    for (const id of ids) this.ownerOf.delete(id)
    return ids
  }

  sockets(owner: number): string[] {
    return [...(this.byOwner.get(owner) ?? [])]
  }
}
