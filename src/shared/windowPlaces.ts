/**
 * Where a window opens: the place it had when it was last moved or resized
 * (Eric, 2026-11-27), kept on a screen that is still there. Pure, so the
 * main process's windowPlaces.ts and the tests share it.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A window's last place: its normal (unmaximized) bounds and whether it was maximized. */
export interface WindowPlace extends Rect {
  maximized?: boolean
}

/** The call window is the Live call shortcut's small one, kept apart from the chat windows' size. */
export type WindowKind = 'main' | 'chat' | 'screen' | 'call'

/** How much of the window's top strip must be on a screen to keep it where it was: enough to grab and drag. */
const GRAB_WIDTH = 120
const GRAB_HEIGHT = 32
/** A second window of a kind opens this far down and right of one already there, so it isn't hidden under it. */
export const CASCADE_STEP = 28

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A stored place, or null when the file holds something else. */
export function readPlace(value: unknown): WindowPlace | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, width, height, maximized } = value as Record<string, unknown>
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width <= 0 || height <= 0) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), maximized: maximized === true }
}

function overlap(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

const area = (r: Rect | null) => (r ? r.width * r.height : 0)

/**
 * The bounds to open at: the saved ones when their top strip is still on a
 * screen (a screen unplugged, or its resolution lowered, since), fitted inside
 * that screen; otherwise the saved size centered on the primary screen.
 * `workAreas[0]` is the primary screen's.
 */
export function placeOnScreen(saved: Rect, workAreas: readonly Rect[], min: { width: number; height: number }): Rect {
  if (!workAreas.length) return saved
  const strip: Rect = { x: saved.x, y: saved.y, width: saved.width, height: Math.min(GRAB_HEIGHT, saved.height) }
  const grabbable = workAreas.filter(area => {
    const shared = overlap(strip, area)
    return shared && shared.width >= Math.min(GRAB_WIDTH, saved.width) && shared.height >= Math.min(GRAB_HEIGHT, saved.height) / 2
  })
  const home = grabbable.length
    ? grabbable.reduce((best, area) => (overlapArea(saved, area) > overlapArea(saved, best) ? area : best))
    : workAreas[0]
  const width = Math.max(Math.min(saved.width, home.width), Math.min(min.width, home.width))
  const height = Math.max(Math.min(saved.height, home.height), Math.min(min.height, home.height))
  if (!grabbable.length) {
    return { x: Math.round(home.x + (home.width - width) / 2), y: Math.round(home.y + (home.height - height) / 2), width, height }
  }
  // Kept where it was, nudged in so none of it hangs off that screen.
  const x = Math.min(Math.max(saved.x, home.x), home.x + home.width - width)
  const y = Math.min(Math.max(saved.y, home.y), home.y + home.height - height)
  return { x, y, width, height }
}

function overlapArea(a: Rect, b: Rect): number {
  return area(overlap(a, b))
}

/**
 * A new window of a kind, with others of that kind already open: down and
 * right of any that sit at its spot, wrapping to the screen's top left when
 * that would run off it.
 */
export function cascade(place: Rect, taken: readonly { x: number; y: number }[], workArea?: Rect): Rect {
  let { x, y } = place
  for (let tries = 0; tries < 20 && taken.some(t => Math.abs(t.x - x) < 4 && Math.abs(t.y - y) < 4); tries++) {
    x += CASCADE_STEP
    y += CASCADE_STEP
    if (workArea && (x + place.width > workArea.x + workArea.width || y + place.height > workArea.y + workArea.height)) {
      x = workArea.x
      y = workArea.y
    }
  }
  return { ...place, x, y }
}

/** The bounds to put back after unmaximizing, when Windows gave a different size than the window had (a frameless window can come back at its first size). */
export function restoreFix(now: Rect, normal: Rect | null): Rect | null {
  if (!normal) return null
  if (Math.abs(now.width - normal.width) <= 1 && Math.abs(now.height - normal.height) <= 1) return null
  return normal
}

/**
 * What to save for a window opened at `opened`: those bounds again while it
 * is within a few pixels of them. At fractional scaling (150% on Windows) a
 * window comes out a pixel or three bigger than asked, which would otherwise
 * grow it a little on every launch.
 */
export function steadyPlace(now: Rect, opened: Rect | null, slack = 4): Rect {
  if (!opened) return now
  const near = (a: number, b: number) => Math.abs(a - b) <= slack
  return {
    x: near(now.x, opened.x) ? opened.x : now.x,
    y: near(now.y, opened.y) ? opened.y : now.y,
    width: near(now.width, opened.width) ? opened.width : now.width,
    height: near(now.height, opened.height) ? opened.height : now.height
  }
}
