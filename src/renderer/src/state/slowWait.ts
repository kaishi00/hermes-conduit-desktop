/**
 * A read that is taking longer than a host usually does, for a pane that has
 * nothing to draw until it answers: Settings > Usage waits on
 * `/api/analytics/usage`, Capabilities > Plugins on `/api/dashboard/plugins/hub`,
 * and either route can take ten seconds or more on a host carrying a large
 * library (desktop#444). A bare "Loading…" for that long reads as a frozen
 * screen, so the pane says it is still working instead.
 */
import { useEffect, useState } from 'react'

/** How long a read may take before its pane says it is still working. */
export const SLOW_WAIT_MS = 10_000

/** True once `waiting` has lasted `afterMs` without a break. */
export function useSlowWait(waiting: boolean, afterMs: number = SLOW_WAIT_MS): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!waiting) return setSlow(false)
    const timer = setTimeout(() => setSlow(true), afterMs)
    return () => clearTimeout(timer)
  }, [waiting, afterMs])
  return waiting && slow
}
