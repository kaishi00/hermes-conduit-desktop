/**
 * Replies the plugin sends no push for, so their notification here stays
 * quiet too (hermes-conduit: Notifications). The plugin decides as each reply
 * ends, on rules only the turn's own process knows: a reply that is only
 * [SILENT], a bot workstream's turn, a Bot Chat's answer to an update that
 * only says a workstream waits on the user, a room lead's routing pick, a
 * script's or Kanban worker's turn. It keeps the decision
 * (`/notifications/quiet-turns`, plugin 0.198.1+, quiet_turns.py) before
 * Hermes ends the turn, and a finished turn asks it before notifying.
 */
export const QUIET_TURNS_PATH = '/api/plugins/conduit_push/notifications/quiet-turns'
/** A decision not on hand yet (a slow disk, a hook still running) is asked for once more after this. */
export const QUIET_RETRY_MS = 1_500
/** How long before the turn's start, by the host's clock against ours, a decision still counts as this turn's. */
const CLOCK_SLACK_S = 2
/** A turn whose start this window never saw: a decision this recent is taken as its own. */
const UNSEEN_TURN_S = 30

type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>

export const quietTurnsPath = (ids: readonly string[], profile?: string | null) => {
  const query = ids.slice(0, 16).map(id => `session_id=${encodeURIComponent(id)}`)
  if (profile && profile !== 'default') query.push(`profile=${encodeURIComponent(profile)}`)
  return `${QUIET_TURNS_PATH}?${query.join('&')}`
}

/** The route's answer: whether the newest decision was quiet, and how old it is; null when none was kept. */
export function parseQuietTurn(body: unknown): { quiet: boolean; ageS: number } | null {
  const turn = body && typeof body === 'object' ? (body as { turn?: unknown }).turn : null
  if (!turn || typeof turn !== 'object') return null
  const { quiet, age_s: ageS } = turn as { quiet?: unknown; age_s?: unknown }
  return typeof quiet === 'boolean' && typeof ageS === 'number' && Number.isFinite(ageS) ? { quiet, ageS } : null
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Whether the plugin kept this chat's finished turn quiet. Only a decision made
 * since the turn started counts (`startedAt`, this computer's clock), so an
 * earlier turn's never stands in. Not on hand yet, it's asked for once more; an
 * older plugin, or one that can't say, lets the notification through.
 */
export async function keptQuiet(
  http: Http,
  ids: readonly string[],
  profiles: readonly (string | undefined)[],
  startedAt: number | null,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = sleep
): Promise<boolean> {
  if (!ids.length) return false
  const names = profiles.length ? [...new Set(profiles)] : [undefined]
  const ask = async (): Promise<boolean | null> => {
    const answers = await Promise.all(
      names.map(profile =>
        http('GET', quietTurnsPath(ids, profile)).then(
          body => ({ turn: parseQuietTurn(body), refused: false }),
          () => ({ turn: null, refused: true })
        )
      )
    )
    // Every profile refused (an older plugin): nothing to wait for.
    if (answers.every(a => a.refused)) return false
    const since = startedAt === null ? UNSEEN_TURN_S : (now() - startedAt) / 1000 + CLOCK_SLACK_S
    const own = answers.map(a => a.turn).filter((turn): turn is { quiet: boolean; ageS: number } => !!turn && turn.ageS <= since)
    return own.length ? own.some(turn => turn.quiet) : null
  }
  const first = await ask()
  if (first !== null) return first
  await wait(QUIET_RETRY_MS)
  return (await ask()) ?? false
}
