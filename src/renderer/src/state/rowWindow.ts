/**
 * A transcript long enough that its whole history costs every frame draws a
 * window of its rows: its newest, and the rows above them as the reader
 * scrolls up (desktop#291). The chat still holds every item — the paths that
 * change a row by its key (reactions, pins, boards, undo, take-back) read the
 * whole list — but only the window's rows are drawn, so a streaming reply
 * lays out its own row per frame rather than the history behind it.
 */
import type { Row } from './runs'

/** Rows a window holds at its smallest: a tall window's worth, and then some. */
export const WINDOW_ROWS = 200

/** Rows a window takes on when the reader scrolls to the top of it. */
export const WINDOW_PAGE = 200

/** How near the top of the drawn rows, in px, a scroll takes on the rows above them. */
export const WINDOW_EDGE = 800

/** The rows a window draws, `[start, end)`: always to the newest row, so a streaming reply's row is drawn. */
export interface RowWindow {
  start: number
  end: number
}

/**
 * The rows a window draws for a chat of `count` rows: its newest WINDOW_ROWS,
 * or from `start` when the reader scrolled up, and never above them — a chat
 * that got shorter (an undo) draws its newest rows rather than nothing.
 */
export function rowWindow(count: number, start: number | null): RowWindow {
  const end = Math.max(0, count)
  const newest = Math.max(0, end - WINDOW_ROWS)
  const from = start === null ? newest : Math.min(Math.max(0, start), newest)
  return { start: from, end }
}

/** The start a window takes on when the reader scrolls to the top of it: WINDOW_PAGE rows more, or the chat's first row. */
export function olderStart(start: number | null, count: number): number {
  const from = start === null ? Math.max(0, count - WINDOW_ROWS) : start
  return Math.max(0, from - WINDOW_PAGE)
}

/** Whether a scroll this far down asks a window for the rows above it. */
export function nearTop(scrollTop: number): boolean {
  return scrollTop <= WINDOW_EDGE
}

/** What a scroll finds: where the scroller is, and the window it drew. */
export interface ScrollAt {
  /** A jump to a row is still scrolling to it. */
  jumping: boolean
  /** The scroller is at its end. */
  atEnd: boolean
  scrollTop: number
  /** The first row the window draws. */
  start: number
  /** The rows the chat holds. */
  count: number
  /** The reader scrolled the window up from the chat's newest rows. */
  scrolledUp: boolean
}

/**
 * What a scroll does (the transcript's scroll listener): whether the reader
 * follows the end from here (`follows`), the start the window takes on
 * (`start`: null is the chat's newest rows; left out, the window stays), and
 * whether the stored page before the chat's first row is asked for (`older`).
 * A jump on its way keeps its window and follows nothing. At the end, only a
 * window the reader scrolled up gives its rows back, since every frame of a
 * streaming reply scrolls there too. Near the top the window takes on the
 * rows above it, and once it holds the chat's first row, the page before.
 */
export function scrollStep(at: ScrollAt): { follows: boolean; start?: number | null; older?: boolean } {
  if (at.jumping) return { follows: false }
  if (at.atEnd) return at.scrolledUp ? { follows: true, start: null } : { follows: true }
  if (!nearTop(at.scrollTop)) return { follows: false }
  return at.start !== 0 ? { follows: false, start: olderStart(at.start, at.count) } : { follows: false, older: true }
}

/** The row holding the item `key`, as drawn: one row of its own, or the run it joined. -1 when the chat has no such row. */
export function rowIndex(rows: readonly Row[], key: string): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.type === 'item' ? row.item.key === key : row.items.some(item => item.key === key)) return i
  }
  return -1
}

/** The key a row is known by: its item's, or its run's first. */
export function rowKey(row: Row): string {
  return row.type === 'item' ? row.item.key : row.id
}

/**
 * Where a window that started at `start`, on the row `anchor`, starts now.
 * Rows read in above the chat's (a stored page before the one it opened on)
 * push every index down, and the window stays on the rows it drew: it starts
 * on the row holding `anchor`, wherever that is. Null, the chat's newest
 * rows, when the chat no longer has that row: another chat in the same pane.
 */
export function heldStart(rows: readonly Row[], start: number | null, anchor: string | undefined): number | null {
  if (start === null || anchor === undefined) return start
  const first = rows[start]
  if (first && (first.type === 'item' ? first.item.key === anchor : first.items.some(item => item.key === anchor))) return start
  const at = rowIndex(rows, anchor)
  return at < 0 ? null : at
}

/** The start a window takes on to draw the row at `index` near its middle: a jump to a row the window left out. */
export function startAt(index: number, count: number): number {
  const newest = Math.max(0, count - WINDOW_ROWS)
  return Math.max(0, Math.min(index - Math.floor(WINDOW_ROWS / 2), newest))
}

/** A windowed transcript's way to draw a row it left out, answering whether the chat has that row at all. */
export type RowOpener = (key: string) => boolean

const openers: { scroller: HTMLElement; open: RowOpener }[] = []

/**
 * Registers a windowed transcript's scroller, so a jump to a row it left out
 * can widen its window first. Call the answer when it goes away.
 */
export function registerRowOpener(scroller: HTMLElement, open: RowOpener): () => void {
  const entry = { scroller, open }
  openers.push(entry)
  return () => {
    const at = openers.indexOf(entry)
    if (at >= 0) openers.splice(at, 1)
  }
}

/** No escaping means no safe selector: answer nothing rather than match the wrong row. */
const escapeKey = (key: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : null)

/**
 * The drawn element for `key` in `container`, widened into the window first
 * when the transcript there left it out: a jump from a pin, a quote or Show in
 * Chat lands on rows the window doesn't draw yet. The opener draws them
 * before it answers, so the element is there to return; null when the chat has
 * no such row. Not for use while rendering, as the opener draws.
 */
export function rowElement(container: HTMLElement, key: string): HTMLElement | null {
  const escaped = escapeKey(key)
  if (!escaped) return null
  const find = () => {
    return container.querySelector<HTMLElement>(`[data-key="${escaped}"]`)
      // A step inside a run shares its row: the run carries its steps' keys.
      ?? [...container.querySelectorAll<HTMLElement>('[data-step-keys]')]
        .find(row => row.getAttribute('data-step-keys')?.split(/\s+/).includes(key)) ?? null
  }
  const drawn = find()
  if (drawn) return drawn
  const opener = openers.find(o => o.scroller === container) ?? openers.find(o => container.contains(o.scroller))
  if (!opener || !opener.open(key)) return null
  return find()
}
