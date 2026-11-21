import { useRef } from 'react'
import { clampWidth, snapsShut, storedAfterDrag, storedAfterStep, type ColumnBounds } from '../state/columnWidths'

/**
 * The line beside a column that drags its width, after the phone's
 * ColumnDivider. The column is the element before the line (sign 1, the
 * list) or after it (sign -1, the panel). A drag lays the column out live
 * and stores once when it ends; a double-click resets it; the arrow keys
 * step it by 40 px, Home and End to its least and most, Enter resets it.
 * With onCollapse, a drag well past the least width hides the column.
 */
export function ColumnDivider({
  label,
  bounds,
  sign,
  width,
  onLive,
  onCommit,
  onCollapse
}: {
  label: string
  bounds: ColumnBounds
  sign: 1 | -1
  /** The width shown now, or null at the standard width. */
  width: number | null
  onLive: (width: number | null) => void
  onCommit: (width: number | null) => void
  /** Hides the column, for a drag well past its least width. */
  onCollapse?: () => void
}) {
  const drag = useRef<{ x: number; start: number; moved: number | null; shut: boolean } | null>(null)

  const columnWidth = (line: HTMLElement) => {
    if (width !== null) return width
    let column = sign === 1 ? line.previousElementSibling : line.nextElementSibling
    // A wrapper that lays nothing out (the list's, display: contents) is measured by what it holds.
    if (column && !column.getBoundingClientRect().width && column.firstElementChild) column = column.firstElementChild
    // The chat list with its profile column beside it: the list's own width, as --list-width holds it.
    const main = column?.querySelector(':scope > .chatlist-main')
    if (main) return main.getBoundingClientRect().width
    return column ? column.getBoundingClientRect().width : bounds.min
  }

  return (
    <div
      className="column-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, start: columnWidth(e.currentTarget), moved: null, shut: false }
        e.currentTarget.classList.add('dragging')
        document.body.classList.add('resizing-columns')
      }}
      onPointerMove={e => {
        const state = drag.current
        if (!state) return
        state.moved = storedAfterDrag(state.start, e.clientX - state.x, sign, bounds)
        state.shut = !!onCollapse && snapsShut(state.start, e.clientX - state.x, sign, bounds)
        e.currentTarget.classList.toggle('closing', state.shut)
        if (state.moved !== null) onLive(state.moved)
      }}
      onPointerUp={e => end(e.currentTarget, e.pointerId)}
      onPointerCancel={e => end(e.currentTarget, e.pointerId)}
      onLostPointerCapture={() => {
        if (drag.current) end(null)
      }}
      onDoubleClick={() => onCommit(null)}
      onKeyDown={e => {
        const current = columnWidth(e.currentTarget)
        let next: number | null | undefined
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') next = storedAfterStep(current, (e.key === 'ArrowRight') === (sign === 1), bounds)
        else if (e.key === 'Home') next = bounds.min
        else if (e.key === 'End') next = bounds.max
        else if (e.key === 'Enter') next = null
        if (next === undefined) return
        e.preventDefault()
        onCommit(next === null ? null : clampWidth(next, bounds))
      }}
    />
  )

  function end(line: HTMLElement | null, pointerId?: number) {
    const state = drag.current
    drag.current = null
    document.querySelector('.column-divider.dragging')?.classList.remove('dragging', 'closing')
    document.body.classList.remove('resizing-columns')
    if (line && pointerId !== undefined && line.hasPointerCapture(pointerId)) line.releasePointerCapture(pointerId)
    // A press that didn't move keeps what was stored; a drag past the least width hides the column at the width it had.
    if (state?.shut && onCollapse) {
      onLive(null)
      onCollapse()
    } else if (state?.moved != null) onCommit(state.moved)
    else onLive(null)
  }
}
