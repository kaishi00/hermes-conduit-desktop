import { useRef } from 'react'

/** What a kept scroll position reads and sets on its list. */
export interface Scroller {
  scrollTop: number
}

/**
 * A list's scroll position that outlives the list: a dashboard switch draws
 * the window afresh (App's Shell is keyed by host), and the Bots sidebar
 * opens where it was rather than at the top. The new list may draw short at
 * first (another dashboard's rooms arrive a moment later), so it keeps
 * trying on each draw until it reaches the spot or you scroll yourself.
 */
export class KeptScroll {
  private top = 0
  private restoring = false

  /** A list drew for the first time: it starts restoring the kept spot. */
  opened(): void {
    this.restoring = this.top > 0
  }

  /** After each draw: puts the list back at the kept spot while restoring. */
  drew(el: Scroller): void {
    if (!this.restoring) return
    el.scrollTop = this.top
    // The browser stops at the list's end; once it reaches the spot, it's done.
    if (el.scrollTop >= this.top - 1) this.restoring = false
  }

  /** The list scrolled: kept, unless it's the restore moving it. */
  scrolled(el: Scroller): void {
    if (!this.restoring) this.top = el.scrollTop
  }

  /** You scrolled, clicked or typed in the list: your spot wins over the kept one. */
  touched(): void {
    this.restoring = false
  }
}

/** The Bots sidebar's, for the whole window: its side pane and its group chat page share it. */
export const botSideScroll = new KeptScroll()

/**
 * Calls `onShown` as a pane kept mounted comes back from away, during that
 * render, so the children drawing it again see what it set (the Bots
 * sidebar's kept scroll restores in its own layout effect, which runs
 * before a parent's). A side effect in render, so `onShown` must be safe to
 * run twice (StrictMode) or for a render that's thrown away: arming a
 * restore that the next draw settles, as `botSideScroll.opened()` does.
 */
export function useShownAgain(away: boolean, onShown?: () => void): void {
  const wasAway = useRef(away)
  if (wasAway.current && !away) onShown?.()
  wasAway.current = away
}
