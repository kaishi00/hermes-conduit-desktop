import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { gateway } from '../gateway'
import { parseReplySpeeds, replySpeedShown, replySpeedsPath, subscribeReplySpeedShown, type ReplySpeeds } from './replySpeeds'

/** Settings > Chat > Show reply speed, following a change made in this window or another. */
export function useReplySpeedShown(): boolean {
  return useSyncExternalStore(subscribeReplySpeedShown, replySpeedShown)
}

/**
 * The open chat's reply speeds while Show reply speed is on, from the plugin's
 * `/sessions/reply-speeds`: read as the chat opens or reconnects and when a
 * turn ends. Another chat starts with none; a plugin without the route, or a
 * chat Hermes has no row for yet, shows none.
 */
export function useReplySpeeds(sessionId: string | null, profile: string | undefined, connected: boolean, running: boolean) {
  const shown = useReplySpeedShown()
  const [speeds, setSpeeds] = useState<ReplySpeeds | undefined>()
  const scope = `${profile ?? ''}\n${sessionId ?? ''}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const read = useCallback(async () => {
    const asked = scopeRef.current
    if (!sessionId) return
    try {
      const answer = parseReplySpeeds(await gateway.http('GET', replySpeedsPath(sessionId, profile)))
      if (scopeRef.current === asked) setSpeeds(answer)
    } catch {
      // An older plugin (404), a chat Hermes has no row for yet, or a failed read: the speeds stay as they were.
    }
  }, [sessionId, profile])

  useEffect(() => {
    setSpeeds(undefined)
  }, [scope])
  useEffect(() => {
    if (shown && sessionId && connected && !running) void read()
  }, [shown, scope, sessionId, connected, running, read])

  return shown ? speeds : undefined
}
