import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { PAN_SLOP, edgeStep, laneScrollTarget, lanesInView, wheelSideways } from './boardScroll'

/** Things a press on the board starts on that aren't the board itself: a card, a button, a field. */
const NOT_BOARD = 'button, a, input, select, textarea, [draggable="true"], .card'

/**
 * Tasks > Board's lanes container, moved without its scrollbar (see
 * boardScroll.ts): which lanes are on screen for the chips, a chip's jump,
 * the wheel and a grab on empty space, and rolling on while a card is
 * dragged to the edge. `laneKey` changes when the lanes do.
 */
export function useBoardScroll(lanes: RefObject<HTMLDivElement | null>, laneKey: string) {
  const [inView, setInView] = useState<boolean[]>([])

  const laneElements = useCallback(() => {
    const el = lanes.current
    return el ? [...el.querySelectorAll<HTMLElement>(':scope > .lane')] : []
  }, [lanes])

  // Which lanes are on screen: on a scroll, a resize, and when the lanes change.
  useEffect(() => {
    const el = lanes.current
    if (!el) return
    let frame = 0
    const measure = () => {
      frame = 0
      const shown = lanesInView(
        laneElements().map(lane => ({ left: lane.offsetLeft, width: lane.offsetWidth })),
        el.scrollLeft,
        el.clientWidth
      )
      setInView(was => (was.length === shown.length && was.every((v, i) => v === shown[i]) ? was : shown))
    }
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    el.addEventListener('scroll', soon, { passive: true })
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon)
    resized?.observe(el)
    return () => {
      el.removeEventListener('scroll', soon)
      resized?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [lanes, laneKey, laneElements])

  // The wheel: up and down moves the board sideways wherever it can't scroll a lane.
  useEffect(() => {
    const el = lanes.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || e.ctrlKey) return
      const cards = (e.target as Element | null)?.closest?.('.lane-cards')
      const overScrollingLane = !!cards && cards.scrollHeight > cards.clientHeight + 1
      const sideways = wheelSideways(e, overScrollingLane, el.clientWidth)
      if (sideways === null) return
      e.preventDefault()
      el.scrollLeft += sideways
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [lanes, laneKey])

  // A grab on empty board space (a lane header, the gaps, under the cards) pans it.
  useEffect(() => {
    const el = lanes.current
    if (!el) return
    let start: { x: number; scrollLeft: number; id: number } | null = null
    let panning = false
    const end = () => {
      if (start && panning && el.hasPointerCapture(start.id)) el.releasePointerCapture(start.id)
      start = null
      panning = false
      el.classList.remove('panning')
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse' || el.scrollWidth <= el.clientWidth) return
      if ((e.target as Element | null)?.closest?.(NOT_BOARD)) return
      start = { x: e.clientX, scrollLeft: el.scrollLeft, id: e.pointerId }
    }
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      if (!panning) {
        if (Math.abs(dx) < PAN_SLOP) return
        panning = true
        el.setPointerCapture(start.id)
        el.classList.add('panning')
        window.getSelection()?.removeAllRanges()
      }
      el.scrollLeft = start.scrollLeft - dx
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', end)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      el.removeEventListener('lostpointercapture', end)
    }
  }, [lanes, laneKey])

  // A dragged card near the board's side rolls it on, until the card leaves the edge or is dropped.
  const edge = useRef<{ x: number; frame: number; stale: number }>({ x: 0, frame: 0, stale: 0 })
  const stopEdge = useCallback(() => {
    const state = edge.current
    if (state.frame) cancelAnimationFrame(state.frame)
    if (state.stale) window.clearTimeout(state.stale)
    state.frame = 0
    state.stale = 0
  }, [])
  const dragAt = useCallback(
    (x: number) => {
      const el = lanes.current
      if (!el) return
      const state = edge.current
      state.x = x
      // Dragover keeps coming while the card is held still; when it stops, so does the board.
      if (state.stale) window.clearTimeout(state.stale)
      state.stale = window.setTimeout(stopEdge, 400)
      if (state.frame) return
      const roll = () => {
        const box = el.getBoundingClientRect()
        const step = edgeStep(state.x, box.left, box.right, el.scrollLeft, el.scrollWidth - el.clientWidth)
        if (!step) {
          state.frame = 0
          return
        }
        el.scrollLeft += step
        state.frame = requestAnimationFrame(roll)
      }
      roll()
    },
    [lanes, stopEdge]
  )
  useEffect(() => stopEdge, [stopEdge])

  /** Brings lane `index` to the board's leading edge. */
  const jumpTo = useCallback(
    (index: number) => {
      const el = lanes.current
      const lane = laneElements()[index]
      if (!el || !lane) return
      const padding = parseFloat(getComputedStyle(el).paddingLeft) || 0
      const left = laneScrollTarget(lane.offsetLeft, padding, el.scrollWidth - el.clientWidth)
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
    },
    [lanes, laneElements]
  )

  return { inView, jumpTo, dragAt, stopEdge }
}
