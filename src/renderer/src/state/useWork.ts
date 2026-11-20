import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { WORK, parseWork, sameWork, workPath, type WorkSnapshot } from './work'
import { everyWhileVisible } from './visibility'

/**
 * A bot's work, read when its profile opens and again as turns end, and
 * every few seconds while `live` (its Bot Chat, a workstream's chat or the
 * Work panel is open). Null when the host's plugin has no workstreams.
 */
export function useWork(profile: string | undefined, connected: boolean, live: boolean) {
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const bot = profile ?? 'default'

  const load = useCallback(async () => {
    const mine = generation.current
    try {
      const answer = parseWork(await gateway.http('GET', workPath(WORK, bot)))
      if (generation.current !== mine) return
      setSnapshot(answer)
      setError(null)
    } catch (e) {
      if (generation.current !== mine) return
      // An older plugin, or none: no Work panel, rather than an error.
      if ((e as { code?: unknown }).code === 404) setSnapshot(null)
      else setError(e instanceof Error ? e.message : String(e))
    }
  }, [bot])

  useEffect(() => {
    generation.current += 1
    setSnapshot(null)
    setError(null)
    if (!connected) return
    void load()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.conduit.onEvent(event => {
      if (event.type === 'message.complete' || event.type === 'sessions.changed' || event.type === 'approval.request') {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void load(), 800)
      }
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [bot, connected, load])

  useEffect(() => {
    if (!connected || !live) return
    // Only while the window shows; showing it again reads at once.
    return everyWhileVisible(() => void load(), 6000)
  }, [connected, live, load])

  return { snapshot, error, reload: load }
}

/**
 * Every bot's workstream chats, so the Chats list leaves them to their
 * bots, resolved ones too, and each bot's counts for its Bots home pill.
 * Read when the roster changes and as sessions change or turns end.
 */
export interface BotWork {
  working: number
  needsYou: number
}

export function useWorkSessions(profiles: string[], connected: boolean): { sessions: ReadonlySet<string>; byBot: ReadonlyMap<string, BotWork> } {
  const [state, setState] = useState<{ sessions: ReadonlySet<string>; byBot: ReadonlyMap<string, BotWork> }>({ sessions: new Set(), byBot: new Map() })
  const key = profiles.join('\n')
  useEffect(() => {
    if (!connected || !profiles.length) return
    let live = true
    const read = async () => {
      const answers = await Promise.all(
        profiles.map(profile =>
          gateway
            .http('GET', workPath(WORK, profile))
            .then(answer => parseWork(answer))
            .catch(() => null)
        )
      )
      if (!live) return
      const byBot = new Map<string, BotWork>()
      answers.forEach((answer, index) => {
        if (answer) byBot.set(profiles[index]!, { working: answer.working, needsYou: answer.needsYou })
      })
      const sessions = new Set(answers.flatMap(answer => answer?.sessionIds ?? []))
      // The same answer keeps the same state, so the Chats list and Bots home don't redraw for nothing (desktop#199).
      setState(current => (sameWork(current, sessions, byBot) ? current : { sessions, byBot }))
    }
    void read()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.conduit.onEvent(event => {
      if (event.type !== 'sessions.changed' && event.type !== 'message.complete') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void read(), 3000)
    })
    return () => {
      live = false
      off()
      if (timer) clearTimeout(timer)
    }
  }, [key, connected])
  return state
}
