import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { installationId } from './pinnedOrder'
import { PRESENT_CAPABILITY, answerResult, exchange, isExpired, localResults, withResult, type ConfirmOutcome, type PresentedConfirm } from './presented'
import { everyWhileVisible } from './visibility'
import { usePcControlState } from './pcControl'

/** A confirmation and the profile whose Hermes waits on it. */
export interface WaitingConfirm {
  profile: string
  prompt: PresentedConfirm
}

const store = localResults()
const device = () => ({ installationId: installationId(), name: navigator.platform?.startsWith('Mac') ? 'Conduit for Mac' : navigator.platform?.startsWith('Win') ? 'Conduit for Windows' : 'Conduit for desktop', version: __APP_VERSION__ })
/** How often what waits is read while the window shows: a room's ask waits 30 s for an answer before the agent moves on. */
const EXCHANGE_MS = 15_000

/**
 * The confirmations Hermes waits on in each of your bots' profiles, read
 * every 15 s while the window shows and right after an answer, which goes
 * up with the next exchange (kept across launches until it lands).
 */
export function usePresented(connected: boolean, host: string, capabilities: readonly string[], profiles: readonly string[]) {
  const served = capabilities.includes(PRESENT_CAPABILITY)
  const [waiting, setWaiting] = useState<Record<string, PresentedConfirm[]>>({})
  const epoch = useRef(0)
  const running = useRef(new Set<string>())
  const profileKey = [...new Set(profiles)].sort().join('\n')

  useEffect(() => {
    epoch.current++
    setWaiting({})
  }, [host])

  const syncProfile = useCallback(
    async (profile: string) => {
      if (!served || !connected || running.current.has(profile)) return
      running.current.add(profile)
      const at = epoch.current
      try {
        const prompts = await exchange((path, body) => gateway.http('POST', path, body), store, `${host}|${profile}`, profile, device())
        if (epoch.current !== at) return
        setWaiting(current => (JSON.stringify(current[profile] ?? []) === JSON.stringify(prompts) ? current : { ...current, [profile]: prompts }))
      } catch {
        // What was read stays; the next exchange tries again.
      } finally {
        running.current.delete(profile)
      }
    },
    [served, connected, host]
  )

  const syncAll = useCallback(() => {
    for (const profile of profileKey ? profileKey.split('\n') : []) void syncProfile(profile)
  }, [profileKey, syncProfile])

  useEffect(() => {
    if (!served || !connected) return
    syncAll()
    return everyWhileVisible(syncAll, EXCHANGE_MS)
  }, [served, connected, syncAll])

  /** The user's answer: off screen at once, and sent to the host now. */
  const answer = useCallback(
    (item: WaitingConfirm, outcome: ConfirmOutcome, editText?: string) => {
      const result = answerResult(item.prompt, outcome, editText)
      if (!result) return
      const scope = `${host}|${item.profile}`
      store.write(scope, withResult(store.read(scope), result))
      setWaiting(current => ({ ...current, [item.profile]: (current[item.profile] ?? []).filter(p => p.id !== item.prompt.id) }))
      void syncProfile(item.profile)
    },
    [host, syncProfile]
  )

  const now = Date.now() / 1000
  // This computer's own ask is its dialog (Control from Hermes); another computer's is answered here.
  const computer = usePcControlState()?.id
  const list: WaitingConfirm[] = Object.entries(waiting).flatMap(([profile, prompts]) =>
    prompts.filter(p => !isExpired(p, now) && !(p.pc && computer && p.pc.computer === computer)).map(prompt => ({ profile, prompt }))
  )
  return { served, waiting: served && connected ? list : [], answer }
}
