import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { WORK, botDoing, parseWork, sameWork, workPath, type WorkItem, type WorkSnapshot } from './work'
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

  // The first page of the bot's Resolved list, read when a reply's card or
  // ref names work its open list doesn't (the phone's resolvedLists), and
  // again once more work is resolved. Kept per count, so a card asks once.
  const [resolved, setResolved] = useState<{ bot: string; count: number; items: WorkItem[] } | null>(null)
  const resolvedRead = useRef<string | null>(null)
  /** The newest read asked: only its answer is kept, whatever count it was for. */
  const resolvedAsk = useRef(0)
  const resolvedCount = snapshot?.resolvedCount ?? 0
  const readResolved = useCallback(() => {
    if (!connected || resolvedCount <= 0) return
    const key = `${bot}\u001f${resolvedCount}`
    if (resolvedRead.current === key) return
    resolvedRead.current = key
    const mine = generation.current
    const ask = ++resolvedAsk.current
    gateway
      .http('GET', workPath(`${WORK}?resolved=1`, bot))
      .then(answer => {
        // A read answered after a newer one was asked is dropped.
        if (generation.current !== mine || ask !== resolvedAsk.current) return
        setResolved({ bot, count: resolvedCount, items: parseWork(answer).items })
      })
      .catch(() => {
        // Asked again by the next card or count, not in a loop.
        if (resolvedRead.current === key) resolvedRead.current = null
      })
  }, [bot, connected, resolvedCount])
  useEffect(() => {
    resolvedRead.current = null
    resolvedAsk.current += 1
    setResolved(null)
  }, [bot, connected])
  // A count that fell (the plugin's history started over) makes the page kept stale.
  useEffect(() => {
    if (resolved && resolvedCount < resolved.count) {
      // A read already asked at the new count stands; one for the old count is dropped.
      if (resolvedRead.current === `${resolved.bot}\u001f${resolved.count}`) {
        resolvedRead.current = null
        resolvedAsk.current += 1
      }
      setResolved(null)
    }
  }, [resolved, resolvedCount])

  return { snapshot, error, reload: load, resolved: resolved?.bot === bot ? resolved.items : null, readResolved }
}

/**
 * Every bot's workstream chats, so the Chats list leaves them to their
 * bots, resolved ones too, and each bot's counts for its Bots home pill.
 * Read when the roster changes and as sessions change or turns end.
 */
export interface BotWork {
  working: number
  needsYou: number
  /** What it's doing now (botDoing), shown under its name while it works. */
  doing?: string | null
}

/** How often the Bots list reads work again while a bot works, for the step it's on. */
export const DOING_POLL_MS = 5000

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
        if (answer) byBot.set(profiles[index]!, { working: answer.working, needsYou: answer.needsYou, doing: botDoing(answer) })
      })
      const sessions = new Set(answers.flatMap(answer => answer?.sessionIds ?? []))
      // The same answer keeps the same state, so the Chats list and Bots home don't redraw for nothing (desktop#199).
      setState(current => (sameWork(current, sessions, byBot) ? current : { sessions, byBot }))
      // While any bot works, read again every few seconds, so its row follows the step it's on.
      const busy = [...byBot.values()].some(work => work.working > 0)
      if (busy && !poll) poll = everyWhileVisible(() => void read(), DOING_POLL_MS)
      else if (!busy && poll) {
        poll()
        poll = null
      }
    }
    let poll: (() => void) | null = null
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
      poll?.()
      if (timer) clearTimeout(timer)
    }
  }, [key, connected])
  return state
}
