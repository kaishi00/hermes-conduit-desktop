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
import { hasBareBots, pcAllowed } from '../../../shared/pcControl'

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

/** The actions in a /pc/next answer, with the bot and its dashboard named for the ask and the bar. */
export function requestsFrom(body: unknown, profile: string, bot: string, host: string, hostName: string): PcRequest[] {
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
        profile,
        host,
        hostName
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

/** The longest wait between reads of the phone's copy while they keep failing. */
const ASK_POLL_MAX_MS = 8_000

/** How long to wait before the next read of the phone's copy: doubled for each failure in a row. */
export const askPollDelay = (failures: number) => Math.min(ASK_POLL_MAX_MS, ASK_POLL_MS * 2 ** Math.max(0, failures))

/**
 * Whether the request's chat may drive this computer: the dialog here, and
 * the phone's copy of the ask when the plugin made one. Whichever answers
 * first counts: the phone's answer closes the dialog, and the dialog's goes
 * to the plugin, which says whether the phone got there first. An ask that
 * ran out or was taken back is a no. A dialog taken away here (Stop, the
 * feature turned off, the bot unticked) is `stopped`, which the bot hears as
 * Stop rather than as the user's no (desktop issue 735).
 */
export async function askEverywhere(request: PcRequest, side: AskSide): Promise<'allowed' | 'denied' | 'stopped'> {
  const fromHere = (answer: 'allowed' | 'denied' | 'closed') => (answer === 'closed' ? 'stopped' : answer)
  const local = side.local(request)
  if (!request.ask) return fromHere(await local)
  let settled = false
  const phone = (async (): Promise<AskAnswer> => {
    let failures = 0
    while (!settled) {
      await side.wait(askPollDelay(failures))
      if (settled) break
      let now: AskAnswer
      try {
        now = await side.read(request)
        failures = 0
      } catch {
        // A dashboard that's down for a moment: read again, less often while it stays down.
        failures++
        continue
      }
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
    return first.answer === 'allowed' ? 'allowed' : 'denied'
  }
  if (first.answer === 'closed') return 'stopped'
  const stands = await side.settle(request, first.answer).catch((): AskAnswer => first.answer)
  return (stands === 'gone' || stands === 'waiting' ? first.answer === 'allowed' : stands === 'allowed') ? 'allowed' : 'denied'
}

/**
 * Whether a batch's action still goes ahead, from the stop count read now:
 * `stopped` when Stop was pressed since the batch came in, `unknown` when the
 * count couldn't be read (then nothing is asked or run: main would refuse it
 * anyway), else `go`.
 */
export function batchStill(request: PcRequest, stops: number | undefined): 'go' | 'stopped' | 'unknown' {
  if (typeof request.gen !== 'number') return 'go'
  if (typeof stops !== 'number') return 'unknown'
  return stops === request.gen ? 'go' : 'stopped'
}

/** The phone's copy of an ask from a GET /pc/ask, where a plugin without the route (404) is `gone`. */
export async function readAsk(get: () => Promise<unknown>): Promise<AskAnswer> {
  try {
    return askAnswer(await get())
  } catch (error) {
    // A plugin without the route: the dialog alone decides, with no more reads.
    if ((error as { code?: unknown })?.code === 404) return 'gone'
    throw error
  }
}

/** The bots that may ask: this dashboard's bots picked in Settings on this dashboard. */
export const askingProfiles = (state: PcControlState | null, bots: readonly { name: string }[], host: string) =>
  state?.on && state.driver === 'ready' ? bots.filter(bot => pcAllowed(state.bots, host, bot.name)).map(bot => bot.name) : []

/** The profiles told about Stop: this dashboard's allowed bots, and any it asked for work since. */
export function stopProfiles(bots: readonly string[], host: string, offered: Iterable<string>): string[] {
  const prefix = `${host}\n`
  return [...new Set([...bots.filter(bot => bot.startsWith(prefix)).map(bot => bot.slice(prefix.length)), ...offered])]
}

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
  read: request => readAsk(() => gateway.http('GET', pcPath('/ask', profile, { computer, id: request.ask ?? '' }), undefined, 10_000)),
  settle: async (request, answer) => askAnswer(await gateway.http('POST', pcPath('/ask', profile), { computer, id: request.ask, answer }, 10_000)),
  wait: ms => new Promise(resolve => setTimeout(resolve, ms))
})

/** Asks each allowed bot's plugin for work while connected. */
export function usePcControl(connected: boolean, host: string, hostName: string, bots: readonly { name: string; title: string }[], state: PcControlState | null) {
  const profiles = askingProfiles(state, bots, host)
  const key = profiles.join('\n')
  const titles = useRef(new Map<string, string>())
  titles.current = new Map(bots.map(bot => [bot.name, bot.title || bot.name]))
  const offered = useRef(new Set<string>())
  const shownHost = useRef(hostName)
  shownHost.current = hostName
  // The dashboard showing now, which a running action's result is checked against.
  const showing = useRef(host)
  showing.current = host

  // A list saved before it was kept per dashboard goes to the one showing now (shared/pcControl.ts).
  // Tried again until it holds: a write that failed would leave every tick doing nothing (desktop#740 review).
  const bare = !!state && hasBareBots(state.bots)
  useEffect(() => {
    if (!connected || !host || !bare) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const again = () => {
      if (live) timer = setTimeout(adopt, RETRY_MS)
    }
    const adopt = () =>
      void window.conduit.pcControl.set({ adopt: host }).then(next => {
        if (hasBareBots(next.bots)) again()
      }, again)
    adopt()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [connected, host, bare])

  useEffect(() => {
    if (!connected || !state || !key) return
    const names = key.split('\n')
    let live = true
    // The asks on screen for this dashboard, taken away when it goes (desktop#740 review).
    const asking = new Set<string>()
    const loops = names.map(async profile => {
      const status = await askPluginStatus(() => gateway.http('GET', withQuery(STATUS_PATH, profile), undefined, 12_000)).catch(() => null)
      if (!live || (status && status.state === 'reported' && !serves(status, [PC_CAPABILITY]))) return
      offered.current.add(profile)
      while (live) {
        let requests: PcRequest[] = []
        let stamped = true
        try {
          // The stop count before asking: Stop pressed while the poll is held open stops what it brings too.
          let gen = (await window.conduit.pcControl.state().catch(() => null))?.stops
          const body = await gateway.http(
            'GET',
            pcPath('/next', profile, { computer: state.id, name: state.shownName, platform: state.platform, wait: String(PC_WAIT_S) }),
            undefined,
            (PC_WAIT_S + 10) * 1000
          )
          requests = requestsFrom(body, profile, titles.current.get(profile) ?? profile, host, shownHost.current)
          // Stop pressed elsewhere (the phone): the bar goes before anything new runs. The plugin already
          // answered what was waiting, so what came with it counts from that Stop on.
          if ((body as { stopped?: unknown } | null)?.stopped === true) {
            window.conduit.pcControl.stoppedElsewhere()
            gen = (await window.conduit.pcControl.state().catch(() => null))?.stops
          }
          // Stop pressed from here on stops the whole batch, not just the action running then. A count that
          // couldn't be read asks and runs nothing (desktop#740 review).
          stamped = typeof gen === 'number'
          if (typeof gen === 'number') requests = requests.map(request => ({ ...request, gen }))
        } catch {
          await new Promise(resolve => setTimeout(resolve, RETRY_MS))
          continue
        }
        for (const request of requests) {
          if (!live) {
            // The same dashboard picked up again: the rest of the batch hears Stop rather than nothing (desktop#762 review).
            if (showing.current !== host) return
            await gateway.http('POST', pcPath('/result', profile), { computer: state.id, id: request.id, result: { ok: false, code: 'stopped' } }, 30_000).catch(() => undefined)
            continue
          }
          let result: Record<string, unknown>
          try {
            // Stopped since this batch came in: answer stopped without asking first.
            const stops = typeof request.gen === 'number' ? (await window.conduit.pcControl.state().catch(() => null))?.stops : undefined
            const still = stamped ? batchStill(request, stops) : 'unknown'
            if (still === 'stopped') result = { ok: false, code: 'stopped' }
            else if (still === 'unknown') result = { ok: false, code: 'failed', message: 'Conduit couldn’t read whether Stop was pressed.' }
            else {
              asking.add(request.session)
              const answer = request.needs_ok ? await askEverywhere(request, askSide(profile, state.id)).finally(() => asking.delete(request.session)) : 'allowed'
              // Left this dashboard while it asked: nothing runs, and no answer goes to the one now showing. The same
              // dashboard picked up again still gets the ask's answer, stopped when its dialog was closed (desktop#759 review).
              if (!live && showing.current !== host) return
              result =
                answer === 'allowed'
                  ? await window.conduit.pcControl.run(request)
                  : answer === 'stopped'
                    ? { ok: false, code: 'stopped' }
                    : { ok: false, grant: 'denied' }
            }
          } catch (error) {
            result = { ok: false, code: 'failed', message: String(error) }
          }
          // Left this dashboard while it ran: its result (a capture, typed text, a command's output) never goes
          // to the one showing now, which the gateway reaches (desktop#744 review). The same dashboard picked up
          // again (a blip in the connection, a change to the bots or the name) still gets its answer.
          if (!live && showing.current !== host) return
          await gateway.http('POST', pcPath('/result', profile), { computer: state.id, id: request.id, result }, 30_000).catch(() => undefined)
        }
      }
    })
    return () => {
      live = false
      for (const session of asking) window.conduit.pcControl.closeAsk(session)
      void Promise.allSettled(loops)
    }
  }, [connected, host, key, state?.id, state?.shownName, state?.platform])

  // Stop (the bar, the hotkey, Settings): every allowed bot's plugin on this dashboard hears it.
  useEffect(() => {
    if (!state?.id || !host) return
    return window.conduit.pcControl.onStopped(() => {
      for (const profile of stopProfiles(state.bots, host, offered.current))
        void gateway.http('POST', pcPath('/stop', profile), { computer: state.id }, 10_000).catch(() => undefined)
    })
  }, [state?.id, host, state?.bots.join('\n')])

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
