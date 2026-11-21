import { describe, expect, it } from 'vitest'
import { EDGE_MAX_STEP, EDGE_ZONE, edgeStep, laneScrollTarget, lanesInView, wheelSideways } from '../src/renderer/src/state/boardScroll'

describe('board scrolling', () => {
  it('rolls the board while a dragged card is at its edge, faster nearer it, and stops at the ends', () => {
    // A board from x 100 to 1100, scrolled part way along 2000 px.
    expect(edgeStep(600, 100, 1100, 500, 2000)).toBe(0)
    expect(edgeStep(1100, 100, 1100, 500, 2000)).toBe(EDGE_MAX_STEP)
    expect(edgeStep(100, 100, 1100, 500, 2000)).toBe(-EDGE_MAX_STEP)
    const half = edgeStep(1100 - EDGE_ZONE / 2, 100, 1100, 500, 2000)
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(EDGE_MAX_STEP)
    // Just inside the zone still moves.
    expect(edgeStep(1100 - EDGE_ZONE + 1, 100, 1100, 500, 2000)).toBe(1)
    // Already at an end: nothing more that way.
    expect(edgeStep(1100, 100, 1100, 2000, 2000)).toBe(0)
    expect(edgeStep(100, 100, 1100, 0, 2000)).toBe(0)
    // A narrow board keeps its edge zones to a quarter each.
    expect(edgeStep(150, 100, 300, 50, 500)).toBe(0)
    expect(edgeStep(120, 100, 300, 50, 500)).toBeLessThan(0)
  })

  it('turns an up-and-down wheel sideways, except over a lane that scrolls or a sideways swipe', () => {
    const turn = (deltaY: number, more: Partial<{ deltaX: number; deltaMode: number; shiftKey: boolean }> = {}) => ({ deltaX: 0, deltaY, deltaMode: 0, shiftKey: false, ...more })
    expect(wheelSideways(turn(100), false, 800)).toBe(100)
    expect(wheelSideways(turn(-100), false, 800)).toBe(-100)
    expect(wheelSideways(turn(3, { deltaMode: 1 }), false, 800)).toBe(48)
    expect(wheelSideways(turn(1, { deltaMode: 2 }), false, 800)).toBe(800)
    // Over a lane whose cards scroll, the wheel scrolls the lane.
    expect(wheelSideways(turn(100), true, 800)).toBeNull()
    // Shift+wheel and a trackpad's sideways swipe already go sideways.
    expect(wheelSideways(turn(100, { shiftKey: true }), false, 800)).toBeNull()
    expect(wheelSideways(turn(10, { deltaX: 40 }), false, 800)).toBeNull()
    expect(wheelSideways(turn(0), false, 800)).toBeNull()
  })

  it('marks the lanes at least half on screen', () => {
    const lanes = [0, 1, 2, 3, 4].map(i => ({ left: 18 + i * 276, width: 264 }))
    expect(lanesInView(lanes, 0, 900)).toEqual([true, true, true, false, false])
    // Scrolled so the first lane is mostly gone and the fourth mostly shown.
    expect(lanesInView(lanes, 200, 900)).toEqual([false, true, true, true, false])
    expect(lanesInView([{ left: 0, width: 0 }], 0, 900)).toEqual([false])
  })

  it('brings a chip’s lane to the leading edge, as far as the board goes', () => {
    expect(laneScrollTarget(18, 18, 1300)).toBe(0)
    expect(laneScrollTarget(570, 18, 1300)).toBe(552)
    expect(laneScrollTarget(1950, 18, 1300)).toBe(1300)
  })
})
