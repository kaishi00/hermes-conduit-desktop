import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { everyWhileVisible } from './visibility'
import { LIVE_WORK_READ_MS, liveWorkActive, liveWorkPath, noLiveWork, parseLiveWork, type LiveWork } from './liveWork'

/**
 * The open chat's turn running in the gateway, on `hermes dashboard` (liveWork.ts), from the plugin's
 * `/sessions/live-work`: read as the chat opens or reconnects and as this app's own turn ends, then every
 * 5 s while a turn runs there or a message of the chat waits in the gateway's queue and the window shows.
 * `apply` hands each read to the chat (useChat's applyLiveWork). Another chat starts with nothing; the
 * gateway's own listener (`enabled` false) streams and lists it all itself.
 */
export function useLiveWork(
  sessionId: string | null,
  profile: string | undefined,
  enabled: boolean,
  running: boolean,
  waitsInGateway: boolean,
  apply: (work: LiveWork, was: LiveWork) => void
) {
  const [work, setWork] = useState<LiveWork>(noLiveWork)
  const last = useRef<LiveWork>(noLiveWork)
  const scope = `${profile ?? ''}\n${sessionId ?? ''}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => {
    last.current = noLiveWork
    setWork(noLiveWork)
  }, [scope])

  const read = useCallback(async () => {
    const asked = scopeRef.current
    if (!sessionId || !enabled) return
    let answer: LiveWork
    try {
      answer = parseLiveWork(await gateway.http('GET', liveWorkPath(sessionId, profile)))
    } catch {
      // An older plugin (404), a chat Hermes has no row for yet, or a failed read: nothing changes.
      return
    }
    if (scopeRef.current !== asked) return
    const was = last.current
    last.current = answer
    setWork(answer)
    applyRef.current(answer, was)
  }, [sessionId, profile, enabled])

  useEffect(() => {
    if (!running) void read()
  }, [scope, running, read])

  const follow = enabled && (liveWorkActive(work) || waitsInGateway)
  useEffect(() => {
    if (!follow) return
    return everyWhileVisible(() => void read(), LIVE_WORK_READ_MS)
  }, [follow, read])

  return work
}
