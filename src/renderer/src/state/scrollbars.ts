/**
 * Marks whatever is scrolling with `.scrolling` for a moment, so its
 * scrollbar shows while it moves and goes once it stops (app.css: scrollbars
 * are only there while you use them, as the platform's overlay ones are).
 */
export const SCROLLING_CLASS = 'scrolling'
/** How long a scrollbar stays after the last scroll. */
export const SCROLLBAR_LINGER_MS = 900

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
      }, linger)
    )
  }
  // Scroll doesn't bubble: listen in the capture phase to hear every scroller.
  root.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => {
    root.removeEventListener('scroll', onScroll, { capture: true })
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }
}
