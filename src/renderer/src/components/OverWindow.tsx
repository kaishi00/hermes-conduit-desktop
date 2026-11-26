import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Draws a view that covers the window (a file or page opened full screen) on
 * the page itself rather than where it's opened from. A chat's transcript
 * fades under its header with a mask and scales with the chat's text size,
 * and either would cut such a view to the transcript and scale it past the
 * window's edges (desktop#606). With no page (a test drawing to a string),
 * it draws in place.
 */
export function OverWindow({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body)
}
