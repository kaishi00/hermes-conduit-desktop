/**
 * Moving around Tasks > Board's lanes without its scrollbar: the lane chips
 * above it (as the phone's jump bar), the wheel and a grab on empty board
 * space, and the board rolling on while a card is dragged to its edge.
 * The numbers live here, apart from the DOM, so tests can hold them.
 */

/** How far in from the board's side a dragged card starts it rolling. */
export const EDGE_ZONE = 60
/** The most the board rolls in one frame, with the card at its very edge. */
export const EDGE_MAX_STEP = 22
/** How far a press on empty board space moves before it's a pan, not a click. */
export const PAN_SLOP = 4

/**
 * How far to roll the board this frame for a card dragged at `x`: faster
 * the nearer the edge, negative toward the start, 0 outside the edge zones
 * or when the board is already at that end.
 */
export function edgeStep(x: number, left: number, right: number, scrollLeft: number, maxScroll: number): number {
  const zone = Math.min(EDGE_ZONE, (right - left) / 4)
  if (zone <= 0) return 0
  const depth = (into: number) => Math.min(1, Math.max(0, (zone - into) / zone))
  if (x < left + zone && scrollLeft > 0) return -Math.max(1, Math.round(EDGE_MAX_STEP * depth(x - left)))
  if (x > right - zone && scrollLeft < maxScroll) return Math.max(1, Math.round(EDGE_MAX_STEP * depth(right - x)))
  return 0
}

export interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  shiftKey: boolean
}

/**
 * How far a wheel turn moves the board sideways, or null to leave it to the
 * browser: over a lane whose cards scroll, the wheel scrolls that lane; a
 * sideways swipe and Shift+wheel already go sideways on their own. Anywhere
 * else (a lane header, the gaps, a lane that fits) an up-and-down turn
 * moves the board sideways, down going on toward Done.
 */
export function wheelSideways(e: WheelLike, overScrollingLane: boolean, pageWidth: number): number | null {
  if (e.shiftKey || overScrollingLane) return null
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.deltaY === 0) return null
  // deltaMode 1 is lines, 2 is pages.
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageWidth : 1
  return e.deltaY * unit
}

export interface LaneBox {
  left: number
  width: number
}

/** Which lanes are at least half on screen, so their chips show as in view. */
export function lanesInView(lanes: LaneBox[], scrollLeft: number, viewWidth: number): boolean[] {
  const start = scrollLeft
  const end = scrollLeft + viewWidth
  return lanes.map(lane => {
    const shown = Math.min(end, lane.left + lane.width) - Math.max(start, lane.left)
    return lane.width > 0 && shown >= lane.width / 2
  })
}

/** Where to scroll so a chip's lane sits at the board's leading edge, as far as the board goes. */
export function laneScrollTarget(laneLeft: number, padding: number, maxScroll: number): number {
  return Math.max(0, Math.min(maxScroll, laneLeft - padding))
}
