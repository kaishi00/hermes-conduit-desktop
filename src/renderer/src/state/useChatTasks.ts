import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { everyWhileVisible } from './visibility'
import { afterRead, chatTasksPath, isOpenTask, parseChatTasks, type ChatTask } from './chatTasks'

/**
 * The open chat's Kanban tasks (desktop#553), from the plugin's
 * `/sessions/kanban-tasks`: read as the chat opens or reconnects, when a
 * turn ends (the turn that put them on the board), and every 15 s while one
 * is still open and the window shows, so the line follows them to the end. Another chat starts
 * with none. A plugin or Hermes that can't tell shows nothing.
 */
export function useChatTasks(sessionId: string | null, profile: string | undefined, connected: boolean, running: boolean) {
  const [tasks, setTasks] = useState<ChatTask[]>([])
  const seenOpen = useRef(new Set<string>())
  const current = useRef(sessionId)
  current.current = sessionId
  const scope = `${profile ?? ''}\n${sessionId ?? ''}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const read = useCallback(async () => {
    const sid = current.current
    const asked = scopeRef.current
    if (!sid) return
    try {
      const answer = parseChatTasks(await gateway.http('GET', chatTasksPath(sid, profile)))
      if (scopeRef.current !== asked) return
      const listed = answer.supported ? answer.tasks : []
      setTasks(afterRead(listed, seenOpen.current))
    } catch {
      // An older plugin (404), a chat Hermes has no row for yet, or a failed read: the line stays as it was.
    }
  }, [profile])

  useEffect(() => {
    seenOpen.current = new Set()
    setTasks([])
    if (sessionId && connected) void read()
  }, [scope, sessionId, connected, read])

  // A turn that ended may have put cards on the board.
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) void read()
    wasRunning.current = running
  }, [running, read])

  const anyOpen = tasks.some(isOpenTask)
  useEffect(() => {
    if (!anyOpen || !connected) return
    return everyWhileVisible(() => void read(), 15_000)
  }, [anyOpen, connected, read])

  return { tasks, refresh: read }
}
