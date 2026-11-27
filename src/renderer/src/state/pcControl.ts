/**
 * Control from Hermes, the asking side: while it's on, each allowed bot's
 * plugin (notifier `pc-control`) is asked for work on a long poll
 * (`GET /pc/next`, held open up to 25 seconds), each action goes to the main
 * process to run (main/pcControl.ts, which asks first when the chat isn't
 * allowed yet), and the answer goes back on `POST /pc/result`. Stop tells
 * every allowed bot's plugin, and a bot taken off the list (or the feature
 * turned off) tells its plugin this computer no longer offers control.
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
        bot,
        profile
      }
    ]
  })
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
        } catch {
          await new Promise(resolve => setTimeout(resolve, RETRY_MS))
          continue
        }
        for (const request of requests) {
          if (!live) return
          let result: Record<string, unknown>
          try {
            result = await window.conduit.pcControl.run(request)
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
