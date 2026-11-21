import type { ScreenWindowRequest } from './ipc'

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
      viewerId: typeof raw.viewerId === 'string' && raw.viewerId ? raw.viewerId : undefined
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
 * hand back is.
 */
export async function releaseScreen(
  rpc: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  profile: string,
  viewerId: string,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<boolean> {
  for (const wait of [0, 1_000, 3_000, 9_000]) {
    if (wait) await sleep(wait)
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
