import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

const MARGIN = 8

/**
 * Where a menu opened at `anchor` goes so all of it shows: at the point, moved
 * left and up just enough to stay `MARGIN` inside the window, and never past
 * its top-left corner. Measured, not guessed: a menu whose lines change (a
 * file's menu on a folder, Pulse's two choices) keeps its last line reachable
 * (issues 447, 454).
 */
export function fitMenu(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  view: { width: number; height: number }
): { left: number; top: number } {
  return {
    left: Math.max(MARGIN, Math.min(anchor.x, view.width - size.width - MARGIN)),
    top: Math.max(MARGIN, Math.min(anchor.y, view.height - size.height - MARGIN))
  }
}

/**
 * A menu kept inside the window by its drawn size: put `ref` on the menu and
 * `style` on it too. Until it's measured it draws hidden at the point, so it
 * never flashes past the edge.
 */
export function useFittedMenu<E extends HTMLElement = HTMLDivElement>(anchor: { x: number; y: number } | null) {
  const ref = useRef<E>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor) return setAt(null)
    const fit = () => {
      if (!ref.current) return setAt(null)
      const { width, height } = ref.current.getBoundingClientRect()
      setAt(fitMenu(anchor, { width, height }, { width: window.innerWidth, height: window.innerHeight }))
    }
    fit()
    // A window made smaller while the menu is open keeps it inside.
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [anchor])
  const style: CSSProperties | undefined = !anchor ? undefined : at ?? { left: anchor.x, top: anchor.y, visibility: 'hidden' }
  return { ref, style }
}
