/**
 * Control from Hermes, the asking side: while it's on, each allowed bot's
 * plugin (notifier `pc-control`) is asked for work on a long poll
 * (`GET /pc/next`, held open up to 25 seconds), each action goes to the main
 * process to run (main/pcControl.ts), and the answer goes back on
 * `POST /pc/result`. A chat not allowed yet is asked first: the dialog here
 * and, from plugin 0.204, the same ask on the phone (`ask`), which the dialog
 * follows on `GET /pc/ask` and answers on `POST /pc/ask`; the first answer
 * counts. Stop tells every allowed bot's plugin, Stop pressed elsewhere
 * (`stopped` on /pc/next) takes the bar away, and a bot taken off the list
 * (or the feature turned off) tells its plugin this computer no longer
 * offers control.
 */
import { useEffect, useRef, useState } from 'react'
import type { PcControlState, PcRequest } from '../../../shared/ipc'
import { gateway } from '../gateway'
import { STATUS_PATH, askPluginStatus, serves } from './plugin'

export const PC_CAPABILITY = 'pc-control'
const BASE = '/api/plugins/conduit_push/pc'
export const PC_WAIT_S = 25
const RETRY_MS = 5_000

const withQuery = (path: string, profile: string, query: Record<string, string> = {}) => {
  const params = new URLSearchParams(query)
  if (profile && profile !== 'default') params.set('profile', profile)
  const text = params.toString()
  return `${path}${text ? `?${text}` : ''}`
}

export const pcPath = (path: string, profile: string, query: Record<string, string> = {}) => withQuery(BASE + path, profile, query)

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The actions in a /pc/next answer, with the bot named for the ask and the bar. */
export function requestsFrom(body: unknown, profile: string, bot: string): PcRequest[] {
  const raw = ((body ?? {}) as { requests?: unknown }).requests
  return (Array.isArray(raw) ? raw : []).flatMap((item): PcRequest[] => {
    const r = (item ?? {}) as Record<string, unknown>
    if (!str(r.id) || !str(r.session) || !str(r.action)) return []
    return [
      {
        id: str(r.id),
        session: str(r.session),
        chat: str(r.chat),
        action: str(r.action),
        args: r.args && typeof r.args === 'object' ? (r.args as Record<string, unknown>) : {},
        needs_ok: r.needs_ok !== false,
        ...(str(r.takes_over) ? { takes_over: str(r.takes_over) } : {}),
        ...(str(r.ask) ? { ask: str(r.ask) } : {}),
        bot,
        profile
      }
    ]
  })
}

type AskAnswer = 'allowed' | 'denied' | 'closed' | 'waiting' | 'gone'
const ASK_POLL_MS = 1_000
const askAnswer = (body: unknown): AskAnswer => {
  const status = str(((body ?? {}) as { status?: unknown }).status)
  return status === 'allowed' || status === 'denied' || status === 'closed' || status === 'waiting' ? status : 'gone'
}

export interface AskSide {
  /** The dialog on this computer: 'closed' once close() took it away. */
  local: (request: PcRequest) => Promise<'allowed' | 'denied' | 'closed'>
  close: (session: string) => void
  /** The phone's copy, as it stands. */
  read: (request: PcRequest) => Promise<AskAnswer>
  /** This computer's answer to the phone's copy: the one that stands. */
  settle: (request: PcRequest, answer: 'allowed' | 'denied') => Promise<AskAnswer>
  wait: (ms: number) => Promise<void>
}

/**
 * Whether the request's chat may drive this computer: the dialog here, and
 * the phone's copy of the ask when the plugin made one. Whichever answers
 * first counts: the phone's answer closes the dialog, and the dialog's goes
 * to the plugin, which says whether the phone got there first. An ask that
 * ran out or was taken back is a no.
 */
/** Stop wins only when both counts are known and differ; a failed state read falls back to asking (issue 735). */
export function stoppedSince(gen: number | undefined, stops: number | undefined): boolean {
  return typeof gen === 'number' && typeof stops === 'number' && stops !== gen
}

export async function askEverywhere(request: PcRequest, side: AskSide): Promise<boolean> {
  const local = side.local(request)
  if (!request.ask) return (await local) === 'allowed'
  let settled = false
  const phone = (async (): Promise<AskAnswer> => {
    while (!settled) {
      await side.wait(ASK_POLL_MS)
      if (settled) break
      const now = await side.read(request).catch((): AskAnswer => 'waiting')
      // An older plugin without the route, or one that forgot the ask: the dialog alone decides.
      if (now === 'gone') return new Promise<AskAnswer>(() => undefined)
      if (now !== 'waiting') return now
    }
    return 'waiting'
  })()
  const first = await Promise.race([local.then(answer => ({ from: 'here' as const, answer })), phone.then(answer => ({ from: 'phone' as const, answer }))])
  settled = true
  if (first.from === 'phone') {
    side.close(request.session)
    return first.answer === 'allowed'
  }
  if (first.answer === 'closed') return false
  const stands = await side.settle(request, first.answer).catch((): AskAnswer => first.answer)
  return stands === 'gone' || stands === 'waiting' ? first.answer === 'allowed' : stands === 'allowed'
}

/** The bots that may ask: picked in Settings, and still bots on this dashboard. */
export const askingProfiles = (state: PcControlState | null, bots: readonly { name: string }[]) =>
  state?.on && state.driver === 'ready' ? state.bots.filter(name => bots.some(bot => bot.name === name)) : []

export function usePcControlState(): PcControlState | null {
  const [state, setState] = useState<PcControlState | null>(null)
  useEffect(() => {
    let live = true
    void window.conduit.pcControl.state().then(next => live && setState(next), () => undefined)
    const stop = window.conduit.pcControl.onState(next => setState(next))
    return () => {
      live = false
      stop()
    }
  }, [])
  return state
}

const askSide = (profile: string, computer: string): AskSide => ({
  local: request => window.conduit.pcControl.ask(request),
  close: session => window.conduit.pcControl.closeAsk(session),
  read: async request => {
    try {
      return askAnswer(await gateway.http('GET', pcPath('/ask', profile, { computer, id: request.ask ?? '' }), undefined, 10_000))
    } catch (error) {
      // A plugin without the route: the dialog alone decides, with no more reads.
      if ((error as { code?: unknown })?.code === 404) return 'gone'
      throw error
    }
  },
  settle: async (request, answer) => askAnswer(await gateway.http('POST', pcPath('/ask', profile), { computer, id: request.ask, answer }, 10_000)),
  wait: ms => new Promise(resolve => setTimeout(resolve, ms))
})

/** Asks each allowed bot's plugin for work while connected. */
export function usePcControl(connected: boolean, bots: readonly { name: string; title: string }[], state: PcControlState | null) {
  const profiles = askingProfiles(state, bots)
  const key = profiles.join('\n')
  const titles = useRef(new Map<string, string>())
  titles.current = new Map(bots.map(bot => [bot.name, bot.title || bot.name]))
  const offered = useRef(new Set<string>())

  useEffect(() => {
    if (!connected || !state || !key) return
    const names = key.split('\n')
    let live = true
    const loops = names.map(async profile => {
      const status = await askPluginStatus(() => gateway.http('GET', withQuery(STATUS_PATH, profile), undefined, 12_000)).catch(() => null)
      if (!live || (status && status.state === 'reported' && !serves(status, [PC_CAPABILITY]))) return
      offered.current.add(profile)
      while (live) {
        let requests: PcRequest[] = []
        try {
          const body = await gateway.http(
            'GET',
            pcPath('/next', profile, { computer: state.id, name: state.shownName, platform: state.platform, wait: String(PC_WAIT_S) }),
            undefined,
            (PC_WAIT_S + 10) * 1000
          )
          requests = requestsFrom(body, profile, titles.current.get(profile) ?? profile)
          // Stop pressed elsewhere (the phone): the bar goes before anything new runs.
          if ((body as { stopped?: unknown } | null)?.stopped === true) window.conduit.pcControl.stoppedElsewhere()
          // Stop pressed from here on stops the whole batch, not just the action running then.
          const gen = (await window.conduit.pcControl.state().catch(() => null))?.stops
          if (typeof gen === 'number') requests = requests.map(request => ({ ...request, gen }))
        } catch {
          await new Promise(resolve => setTimeout(resolve, RETRY_MS))
          continue
        }
        for (const request of requests) {
          if (!live) return
          let result: Record<string, unknown>
          try {
            // Stopped since this batch came in: answer stopped without asking first.
            const stops = typeof request.gen === 'number' ? (await window.conduit.pcControl.state().catch(() => null))?.stops : undefined
            if (stoppedSince(request.gen, stops)) result = { ok: false, code: 'stopped' }
            else {
              const allowed = !request.needs_ok || (await askEverywhere(request, askSide(profile, state.id)))
              result = allowed ? await window.conduit.pcControl.run(request) : { ok: false, grant: 'denied' }
            }
          } catch (error) {
            result = { ok: false, code: 'failed', message: String(error) }
          }
          await gateway.http('POST', pcPath('/result', profile), { computer: state.id, id: request.id, result }, 30_000).catch(() => undefined)
        }
      }
    })
    return () => {
      live = false
      void Promise.allSettled(loops)
    }
  }, [connected, key, state?.id, state?.shownName, state?.platform])

  // Stop (the bar, the hotkey, Settings): every allowed bot's plugin hears it.
  useEffect(() => {
    if (!state?.id) return
    return window.conduit.pcControl.onStopped(() => {
      for (const profile of state.bots) void gateway.http('POST', pcPath('/stop', profile), { computer: state.id }, 10_000).catch(() => undefined)
    })
  }, [state?.id, state?.bots.join('\n')])

  // A bot taken off the list, or control turned off: its plugin stops listing this computer.
  useEffect(() => {
    if (!connected || !state?.id) return
    const now = new Set(profiles)
    for (const profile of [...offered.current]) {
      if (now.has(profile)) continue
      offered.current.delete(profile)
      void gateway.http('DELETE', pcPath('/computer', profile, { computer: state.id }), undefined, 10_000).catch(() => undefined)
    }
  }, [connected, key, state?.id])

  // Leaving this dashboard (a switch or signing out): best effort, its plugin stops
  // listing this computer now; if the request can't land, it counts it offline after 45 s.
  const id = useRef(state?.id)
  id.current = state?.id
  useEffect(
    () => () => {
      const computer = id.current
      if (!computer) return
      for (const profile of offered.current) void gateway.http('DELETE', pcPath('/computer', profile, { computer }), undefined, 10_000).catch(() => undefined)
      offered.current.clear()
    },
    []
  )
}
