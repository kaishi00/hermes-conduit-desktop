import type { ScreenWindowRequest } from './ipc'

/**
 * A screen window's bot: its profile on the dashboard on screen, or that
 * profile on another combined dashboard (its host before the profile), so
 * two dashboards' bots of one name each have their own window.
 */
export function screenKey(host: string | undefined, profile: string): string {
  return host ? `${host}\u001f${profile}` : profile
}

/** A screen key's dashboard (none for the one on screen) and profile. */
export function parseScreenKey(key: string): { host?: string; profile: string } {
  const at = key.lastIndexOf('\u001f')
  return at < 0 ? { profile: key } : { host: key.slice(0, at), profile: key.slice(at + 1) }
}

/** The page hash a bot's screen window opens on. */
export function screenWindowHash(screen: ScreenWindowRequest): string {
  return `#screen=${encodeURIComponent(JSON.stringify(screen))}`
}

/** The bot's screen a window of its own was opened on, from its page's hash; null for any other page. */
export function screenWindowRequest(hash: string): ScreenWindowRequest | null {
  const match = /^#screen=(.+)$/.exec(hash)
  if (!match) return null
  try {
    const raw = JSON.parse(decodeURIComponent(match[1]!)) as Partial<ScreenWindowRequest> | null
    if (!raw || typeof raw.profile !== 'string' || !raw.profile) return null
    return {
      profile: raw.profile,
      botName: typeof raw.botName === 'string' && raw.botName ? raw.botName : raw.profile,
      viewerId: typeof raw.viewerId === 'string' && raw.viewerId ? raw.viewerId : undefined,
      ...(typeof raw.host === 'string' && raw.host ? { host: raw.host } : {})
    }
  } catch {
    return null
  }
}

/** JSON-RPC's internal error: Hermes didn't refuse the hand back, so it's tried again. */
const INTERNAL_ERROR = -32603

/**
 * A closed screen's hand back, tried again after 1, 3 and 9 seconds when it
 * fails for a reason other than Hermes refusing it, as the phone's owed
 * hand back is. `owed` is asked before each try, so one the user's next
 * takeover overtook is never sent.
 */
export async function releaseScreen(
  rpc: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  profile: string,
  viewerId: string,
  owed: () => boolean = () => true,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<boolean> {
  for (const wait of [0, 1_000, 3_000, 9_000]) {
    if (wait) await sleep(wait)
    // Reopened or taken over again since: a late hand back would drop the new takeover.
    if (!owed()) return false
    try {
      await rpc('display.lease.release', { profile, viewer_id: viewerId })
      return true
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code
      if (code !== undefined && code !== INTERNAL_ERROR) return false
    }
  }
  return false
}
