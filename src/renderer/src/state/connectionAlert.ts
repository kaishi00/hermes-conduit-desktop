import { useEffect, useState } from 'react'
import type { ConnectionPhase, HostSummary, KeptHost } from '../../../shared/ipc'
import { t } from '../../../shared/i18n'
import { keptStateLabel } from './keptHosts'

/**
 * Connection is exception-driven (Eric, 2026-11-26): nothing while every Hermes is connected, a quiet
 * ring while reconnecting, amber with the reason on hover once it's been down a while, and a Sign In
 * the button names when a Hermes signed this computer out.
 */
export interface BrandAlert {
  tone: 'quiet' | 'warn' | 'signIn'
  /** The explanation, in the button's tooltip. */
  text: string
  /** How the Hermes you're on is doing, beside it in the list, when it isn't connected. */
  here?: string
  /** What the list offers for it, above the Hermes (Try Now, Repair Connection, Sign In to …). */
  actions?: { label: string; run: () => void }[]
}

/** Away this long before anything shows, so a quick reconnect doesn't flicker. */
export const AWAY_SHOWN_MS = 2_000
/** How long the Hermes you're on can be away before the quiet ring turns amber. */
export const DOWN_LONG_MS = 20_000

/** How long the Hermes you're on has been away: not at all or briefly, long enough to show, or long. */
export type Away = 'no' | 'shown' | 'long'

interface Inputs {
  phase: ConnectionPhase
  error?: string
  retryInSeconds?: number
  /** useAway's answer; while 'no', a reconnect in progress shows nothing yet. */
  away: Away
  currentUrl?: string
  hosts?: HostSummary[]
  /** The other dashboards kept beside this one, and how each is doing. */
  kept: KeptHost[]
  name: (url: string) => string
  onRetry: () => void
  onRepair?: () => void
  onSignIn: (url: string) => void
  /** An update started here has the Hermes you're on away: its banner says so, so only the others show here. */
  updating?: boolean
}

const RANK: Record<BrandAlert['tone'], number> = { quiet: 0, warn: 1, signIn: 2 }

/**
 * Connection, exception-driven (Eric, 2026-11-26): null while every Hermes is connected. Reconnecting
 * is a quiet ring, still away after a while is amber with the reason on hover, and a Hermes that
 * signed this computer out asks for a sign-in the list carries out.
 */
export function brandAlert(inputs: Inputs): BrandAlert | null {
  const { phase, error, retryInSeconds, away, currentUrl, hosts = [], kept, name } = inputs
  const parts: BrandAlert[] = []
  if ((phase === 'connecting' || phase === 'reconnecting') && away !== 'no' && !inputs.updating) {
    const here =
      phase === 'connecting'
        ? t('Connecting to Hermes…')
        : `${error ?? t('Not connected.')}${retryInSeconds ? ` ${t('Trying again in {seconds}s.', { seconds: retryInSeconds })}` : ''}`
    const actions: BrandAlert['actions'] = []
    if (phase === 'reconnecting') actions.push({ label: t('Try now'), run: inputs.onRetry })
    if (phase === 'reconnecting' && currentUrl && inputs.onRepair) actions.push({ label: t('Repair Connection'), run: inputs.onRepair })
    parts.push({ tone: away === 'long' ? 'warn' : 'quiet', text: here, here, actions })
  }
  // Only the group's own: a kept host that's no longer saved has nothing to sign in to.
  const saved = new Set(hosts.map(h => h.url))
  for (const host of kept) {
    if (host.url === currentUrl || !saved.has(host.url)) continue
    if (host.state === 'signIn') {
      parts.push({
        tone: 'signIn',
        text: `${name(host.url)} · ${keptStateLabel('signIn')}`,
        actions: [{ label: t('Sign In to {host}…', { host: name(host.url) }), run: () => inputs.onSignIn(host.url) }]
      })
    } else if (host.state === 'down') {
      parts.push({ tone: 'warn', text: `${name(host.url)} · ${keptStateLabel('down')}` })
    }
  }
  if (!parts.length) return null
  // Sign-ins first in the list, as they're the ones only you can fix.
  parts.sort((a, b) => RANK[b.tone] - RANK[a.tone])
  return {
    tone: parts[0].tone,
    text: parts.map(p => p.text).join('\n'),
    here: parts.find(p => p.here)?.here,
    actions: parts.flatMap(p => p.actions ?? [])
  }
}

/** How long the Hermes you're on has been away; back to 'no' as soon as it's open again. */
export function useAway(phase: ConnectionPhase, shown = AWAY_SHOWN_MS, long = DOWN_LONG_MS): Away {
  const gone = phase === 'connecting' || phase === 'reconnecting'
  const [away, setAway] = useState<Away>('no')
  useEffect(() => {
    setAway('no')
    if (!gone) return
    const timers = [setTimeout(() => setAway('shown'), shown), setTimeout(() => setAway('long'), long)]
    return () => timers.forEach(clearTimeout)
  }, [gone, shown, long])
  return away
}
