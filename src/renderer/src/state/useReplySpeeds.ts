import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { gateway } from '../gateway'
import {
  newestReplySpeed,
  parseReplySpeeds,
  replySpeedInComposer,
  replySpeedShown,
  replySpeedsPath,
  subscribeReplySpeedShown,
  type ReplySpeeds
} from './replySpeeds'

/** Settings > Chat > Show reply speed, following a change made in this window or another. */
export function useReplySpeedShown(): boolean {
  return useSyncExternalStore(subscribeReplySpeedShown, replySpeedShown)
}

/** Settings > Chat > Show reply speed in the composer, following a change made in this window or another. */
export function useReplySpeedInComposer(): boolean {
  return useSyncExternalStore(subscribeReplySpeedShown, replySpeedInComposer)
}

/** The composer's reply speed chip: the newest finished reply's speed, `stale` (dimmed) until the next one is measured. */
export interface ComposerReplySpeed {
  rate: number
  stale: boolean
}

export interface ShownReplySpeeds {
  /** Each reply's, while Show reply speed is on. */
  rows?: ReplySpeeds
  /** The composer chip's, while Show reply speed in the composer is on. */
  composer?: ComposerReplySpeed
}

interface Read {
  scope: string
  speeds?: ReplySpeeds
  /** Read since the last turn ended: the newest reply's speed is this turn's. */
  fresh: boolean
}

/**
 * The open chat's reply speeds while either Reply speed switch is on, from the
 * plugin's `/sessions/reply-speeds`: read as the chat opens or reconnects and
 * when a turn ends. Another chat starts with none; a plugin without the route,
 * or a chat Hermes has no row for yet, shows none. The composer's chip keeps
 * the last speed it showed, dimmed, while a turn runs and until that turn's
 * speed is read: providers report tokens only at the end of a call. A view
 * with no composer (the Beside pane) passes `withComposer` false.
 */
export function useReplySpeeds(
  sessionId: string | null,
  profile: string | undefined,
  connected: boolean,
  running: boolean,
  withComposer = true
): ShownReplySpeeds {
  const shown = useReplySpeedShown()
  const inComposer = useReplySpeedInComposer() && withComposer
  const reading = shown || inComposer
  const scope = `${profile ?? ''}\n${sessionId ?? ''}`
  const [read, setRead] = useState<Read>({ scope, fresh: false })
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  // Another chat's read never shows here, not even for the render before the effects below run.
  const current = read.scope === scope ? read : { scope, fresh: false }
  const speeds = current.speeds

  const load = useCallback(async () => {
    const asked = scopeRef.current
    if (!sessionId) return
    try {
      const answer = parseReplySpeeds(await gateway.http('GET', replySpeedsPath(sessionId, profile)))
      if (scopeRef.current === asked) setRead({ scope: asked, speeds: answer, fresh: true })
    } catch {
      // An older plugin (404), a chat Hermes has no row for yet, or a failed read: the saved rows' speeds
      // stay; the newest turn's, which may be an earlier turn's, goes.
      if (scopeRef.current === asked) setRead(was => (was.scope === asked ? dropUnsaved(was) : was))
    }
  }, [sessionId, profile])

  useEffect(() => {
    setRead({ scope, fresh: false })
  }, [scope])
  useEffect(() => {
    // A new turn's reply isn't the one the last read's newest turn wrote.
    if (running) setRead(was => ({ ...dropUnsaved(was), fresh: false }))
  }, [running])
  useEffect(() => {
    if (reading && sessionId && connected && !running) void load()
  }, [reading, scope, sessionId, connected, running, load])

  // The composer chip's last speed, kept for this chat while the next turn's is still to come.
  const kept = useRef<{ scope: string; rate: number } | undefined>(undefined)
  const newest = current.fresh ? newestReplySpeed(speeds) : undefined
  if (current.fresh) kept.current = newest === undefined ? undefined : { scope, rate: newest }
  else if (kept.current?.scope !== scope) kept.current = undefined
  const composer = !inComposer
    ? undefined
    : current.fresh
      ? newest === undefined
        ? undefined
        : { rate: newest, stale: false }
      : kept.current
        ? { rate: kept.current.rate, stale: true }
        : undefined

  return { rows: shown ? speeds : undefined, composer }
}

function dropUnsaved(read: Read): Read {
  return read.speeds?.unsaved != null ? { ...read, speeds: { ...read.speeds, unsaved: undefined } } : read
}
