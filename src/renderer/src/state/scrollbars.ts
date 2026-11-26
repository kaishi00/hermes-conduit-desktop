/**
 * Marks whatever is scrolling with `.scrolling` for a moment, so its
 * scrollbar shows while it moves and goes once it stops (app.css: scrollbars
 * are only there while you use them, as the platform's overlay ones are).
 */
export const SCROLLING_CLASS = 'scrolling'
/** How long a scrollbar stays after the last scroll. */
export const SCROLLBAR_LINGER_MS = 900

/**
 * Chromium doesn't repaint a styled (::-webkit-scrollbar) thumb when only
 * :hover or a class on its scroller changes: it keeps the old look until
 * something else redraws the bar. Taking the bar away for one layout and
 * giving it back redraws it with the new look; the scroll position stays,
 * as overflow: hidden still scrolls.
 */
export function repaintScrollbar(el: HTMLElement): void {
  const before = el.style.overflowY
  el.style.overflowY = 'hidden'
  void el.offsetWidth
  el.style.overflowY = before
}

const scrolls = (el: Element): el is HTMLElement =>
  el instanceof HTMLElement && el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY)

export function watchScrolling(root: Document = document, linger = SCROLLBAR_LINGER_MS): () => void {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>()
  const onScroll = (event: Event) => {
    const target = event.target === root ? root.scrollingElement : event.target
    if (!(target instanceof Element)) return
    target.classList.add(SCROLLING_CLASS)
    clearTimeout(timers.get(target))
    timers.set(
      target,
      setTimeout(() => {
        target.classList.remove(SCROLLING_CLASS)
        timers.delete(target)
        // Not under the pointer, its thumb goes now rather than at the next redraw.
        if (target instanceof HTMLElement && !hovered.includes(target)) repaintScrollbar(target)
      }, linger)
    )
  }
  // The scrollers under the pointer: entering or leaving one redraws its bar, so hover shows it.
  let hovered: HTMLElement[] = []
  const onPointer = (event: Event) => {
    const next: HTMLElement[] = []
    for (let el = event.target instanceof Element ? event.target : null; el; el = el.parentElement) if (scrolls(el)) next.push(el)
    for (const el of hovered) if (!next.includes(el) && !el.classList.contains(SCROLLING_CLASS)) repaintScrollbar(el)
    for (const el of next) if (!hovered.includes(el) && !el.classList.contains(SCROLLING_CLASS)) repaintScrollbar(el)
    hovered = next
  }
  const onLeave = (event: Event) => {
    // Out of the window: nothing is hovered any more.
    if ((event as MouseEvent).relatedTarget) return
    for (const el of hovered) if (!el.classList.contains(SCROLLING_CLASS)) repaintScrollbar(el)
    hovered = []
  }
  // Scroll doesn't bubble: listen in the capture phase to hear every scroller.
  root.addEventListener('scroll', onScroll, { capture: true, passive: true })
  root.addEventListener('pointerover', onPointer, { passive: true })
  root.addEventListener('pointerout', onLeave, { passive: true })
  return () => {
    root.removeEventListener('scroll', onScroll, { capture: true })
    root.removeEventListener('pointerover', onPointer)
    root.removeEventListener('pointerout', onLeave)
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }
}
