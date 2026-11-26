/**
 * The chat's text size zooms the transcript's rows (`--chat-scale` on
 * `.transcript-inner`), and a scroller keeps its scrollTop as its rows grow or
 * shrink, so a size change moved the reader up or down the chat: from the
 * newest reply at 100% to a reply far above it at 170%. Each transcript's
 * scroller is registered here, and a size change keeps it on what it showed:
 * a reader at the end stays at the end, and one scrolled up keeps the row at
 * the top of the view, at the same point in it.
 */
import { atEnd } from './scrollEnd'

/** A box as the place reads it: its top and height on the page. */
export interface Box {
  top: number
  height: number
}

/** A transcript's scroller as the place reads and moves it. */
export interface ScaleScroller {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  box(): Box
  /** Its rows, top to bottom. */
  rows(): Iterable<{ box(): Box }>
}

/** Where a scroller was before a size change, and how to put it back after. */
export type Place = (() => void) | null

/** What `scroller` shows now, to put back once its rows are drawn at another size. */
export function placeOf(scroller: ScaleScroller): Place {
  // A pane kept mounted but hidden has nothing on show to keep.
  if (scroller.clientHeight === 0) return null
  if (atEnd(scroller)) {
    return () => {
      scroller.scrollTop = scroller.scrollHeight
    }
  }
  const view = scroller.box().top
  for (const row of scroller.rows()) {
    const was = row.box()
    if (was.top + was.height <= view) continue
    // How far down the row the top of the view is, as a share of the row: the row grows with the text.
    const share = was.height > 0 ? (view - was.top) / was.height : 0
    return () => {
      const now = row.box()
      scroller.scrollTop += now.top + share * now.height - scroller.box().top
    }
  }
  return null
}

const scrollers = new Set<HTMLElement>()

/** Keeps a transcript's scroller on its rows as the text size changes; call the answer when it goes away. */
export function keepPlaceOnScale(el: HTMLElement): () => void {
  scrollers.add(el)
  return () => {
    scrollers.delete(el)
  }
}

function asScaleScroller(el: HTMLElement): ScaleScroller {
  const box = (node: Element) => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top, height: rect.height }
  }
  return {
    get scrollTop() {
      return el.scrollTop
    },
    set scrollTop(value: number) {
      el.scrollTop = value
    },
    get scrollHeight() {
      return el.scrollHeight
    },
    get clientHeight() {
      return el.clientHeight
    },
    box: () => box(el),
    // The zoomed `.transcript-inner` holds the rows.
    rows: () => [...(el.querySelector('.transcript-inner')?.children ?? [])].map(child => ({ box: () => box(child) }))
  }
}

/** Draws the chat's text at `scale`, every transcript in this window staying on what it showed. */
export function drawChatScale(scale: number): void {
  const root = document.documentElement
  if (root.style.getPropertyValue('--chat-scale') === String(scale)) return
  const places = [...scrollers].map(el => placeOf(asScaleScroller(el)))
  root.style.setProperty('--chat-scale', String(scale))
  // Reading the rows after the change lays them out at the new size, before the window paints.
  for (const put of places) put?.()
}
