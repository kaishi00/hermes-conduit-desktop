import { useRef, type ReactNode } from 'react'
import { useShownAgain } from '../state/keptScroll'

/**
 * A pane kept mounted while another section shows. Away, it renders what it
 * last showed, so the rest of the window's updates skip it (its own state
 * still updates), and the CSS keeps its layout without painting it.
 * `onShown` runs as it's shown again.
 */
export function KeptPane({ away, onShown, children }: { away: boolean; onShown?: () => void; children: ReactNode }) {
  const shown = useRef(children)
  if (!away) shown.current = children
  useShownAgain(away, onShown)
  return (
    <div className={`chats-section${away ? ' away' : ''}`} inert={away}>
      {shown.current}
    </div>
  )
}
