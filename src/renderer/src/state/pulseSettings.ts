/**
 * Settings > Pulse, after the phone's: Pulse's state as GET /pulse answers
 * it, the settings PUT /pulse takes, and what Pulse remembers. Pulse is one
 * per host, so none of these take a profile.
 */
import { t } from '../../../shared/i18n'

export interface PulseSettings {
  enabled: boolean
  running: boolean
  staleBuild: boolean
  hostProblem: string
  homeChat: { id: string; title: string; pinned: boolean } | null
  homeProblem: string
  profile: string
  nudge: string
  dailyReport: boolean
  reportTimes: string[]
  briefTime: string
  nextReportAt: number | null
  timeZone: string
  privatePushes: boolean | null
  quietDays: number[]
  /** When a vacation ends, epoch seconds. */
  quietUntil: number | null
  /** ["22:00", "07:00"], or null for no night. */
  night: [string, string] | null
  note: string
  reportProfiles: 'all' | 'this'
  otherProfiles: string[]
  /**
   * The other profiles left out by name while Pulse reads every profile
   * (hermes-conduit issue 3241), or null on a plugin that can't leave any out.
   */
  excludedProfiles: string[] | null
  memory: boolean
  memoryCounts: Record<string, number>
  followups: boolean
  lookFirst: boolean | null
  inboxDeadlines: boolean | null
  tokensToday: number
  dailyTokens: number
  followupTokensToday: number
  followupDailyTokens: number
  followupDailyTokensSet: boolean
  recent: { at: number; kind: string; state: string; detail: string }[]
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const maybeBool = (value: unknown) => (typeof value === 'boolean' ? value : null)
const TIME = /^\d{2}:\d{2}$/

export function parseSettings(raw: unknown): PulseSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const chat = s.home_chat && typeof s.home_chat === 'object' ? (s.home_chat as Record<string, unknown>) : null
  const night =
    Array.isArray(s.night) && s.night.length === 2 && s.night.every(v => typeof v === 'string' && TIME.test(v)) ? (s.night as [string, string]) : null
  const counts: Record<string, number> = {}
  if (s.memory_counts && typeof s.memory_counts === 'object') {
    for (const [kind, count] of Object.entries(s.memory_counts as Record<string, unknown>)) if (num(count) > 0) counts[kind] = num(count)
  }
  return {
    enabled: s.enabled === true,
    running: s.running === true,
    staleBuild: s.stale_build === true,
    hostProblem: str(s.host_problem),
    homeChat: chat && str(chat.id) ? { id: str(chat.id), title: str(chat.title), pinned: chat.pinned === true } : null,
    homeProblem: str(s.home_problem),
    profile: str(s.profile) || 'default',
    nudge: NUDGES.includes(str(s.nudge)) ? str(s.nudge) : 'balanced',
    dailyReport: s.daily_report === true,
    reportTimes: Array.isArray(s.report_times) ? s.report_times.filter((v): v is string => typeof v === 'string' && TIME.test(v)) : [],
    briefTime: TIME.test(str(s.brief_time)) ? str(s.brief_time) : '08:00',
    nextReportAt: typeof s.next_report_at === 'number' ? s.next_report_at : null,
    timeZone: str(s.time_zone),
    privatePushes: maybeBool(s.private_pushes),
    quietDays: Array.isArray(s.quiet_days) ? s.quiet_days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d < 7) : [],
    quietUntil: typeof s.quiet_until === 'number' ? s.quiet_until : null,
    night,
    note: str(s.note),
    reportProfiles: s.report_profiles === 'all' ? 'all' : 'this',
    otherProfiles: Array.isArray(s.other_profiles) ? s.other_profiles.filter((v): v is string => typeof v === 'string') : [],
    excludedProfiles: Array.isArray(s.excluded_profiles) ? s.excluded_profiles.filter((v): v is string => typeof v === 'string') : null,
    memory: s.memory === true,
    memoryCounts: counts,
    followups: s.followups === true,
    lookFirst: maybeBool(s.look_first),
    inboxDeadlines: maybeBool(s.inbox_deadlines),
    tokensToday: num(s.tokens_today),
    dailyTokens: num(s.daily_tokens),
    followupTokensToday: num(s.followup_tokens_today),
    followupDailyTokens: num(s.followup_daily_tokens),
    followupDailyTokensSet: s.followup_daily_tokens_set === true,
    recent: (Array.isArray(s.recent) ? s.recent : [])
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .map(row => ({ at: num(row.at), kind: str(row.kind), state: str(row.state), detail: str(row.detail) }))
  }
}

/**
 * The other profiles Pulse can leave out, each with whether it is: the ones
 * it reads and the ones left out, by name. Empty unless it reads every
 * profile on a plugin that takes the list.
 */
export function profileChoices(state: Pick<PulseSettings, 'reportProfiles' | 'otherProfiles' | 'excludedProfiles'>): { name: string; leftOut: boolean }[] {
  if (state.reportProfiles !== 'all' || !state.excludedProfiles) return []
  const leftOut = new Set(state.excludedProfiles)
  return [...new Set([...state.otherProfiles, ...state.excludedProfiles])]
    .sort((a, b) => Number(b === 'default') - Number(a === 'default') || a.localeCompare(b)) // the plugin's order: the default profile first
    .map(name => ({ name, leftOut: leftOut.has(name) }))
}

/** `excluded_profiles` as it is sent once ``name`` is left out, or read again. */
export function excludedAfter(state: Pick<PulseSettings, 'excludedProfiles'>, name: string, leftOut: boolean): string[] {
  const others = (state.excludedProfiles ?? []).filter(kept => kept !== name)
  return leftOut ? [...others, name] : others
}

export const NUDGES = ['gentle', 'balanced', 'eager']

export function nudgeTitle(level: string): string {
  return level === 'gentle' ? t('Gentle') : level === 'eager' ? t('Eager') : t('Balanced')
}

export function nudgeDetail(level: string): string {
  if (level === 'gentle') return t("Only what's worth interrupting you for: one reminder a day, and promises checked less often.")
  if (level === 'eager') return t('Small things too: six reminders a day, and promises checked sooner.')
  return t("A heads-up on what's open or coming due: three reminders a day.")
}

export const MEMORY_BUDGETS = [100_000, 200_000, 300_000, 500_000, 1_000_000, 2_000_000]
export const FOLLOWUP_BUDGETS = [30_000, 60_000, 150_000, 300_000, 600_000, 1_000_000]

/** The presets, with the current one added when it's set to something else. */
export function budgets(presets: number[], current: number): number[] {
  return [...new Set([...presets, ...(current > 0 ? [current] : [])])].sort((a, b) => a - b)
}

const KIND_ORDER = ['commitment', 'promise', 'intention', 'interest', 'fact', 'watch', 'deadline']

export function kindTitle(kind: string): string {
  switch (kind) {
    case 'commitment':
      return t('Commitments')
    case 'promise':
      return t('Promises')
    case 'intention':
      return t('Intentions')
    case 'interest':
      return t('Interests')
    case 'fact':
      return t('Facts')
    case 'watch':
      return t('Things to watch')
    case 'deadline':
      return t('Deadlines')
    default:
      return kind
  }
}

/** Known kinds first, in order, then any others by name. */
export function sortedKinds(kinds: Iterable<string>): string[] {
  const rank = (kind: string) => (KIND_ORDER.includes(kind) ? KIND_ORDER.indexOf(kind) : KIND_ORDER.length)
  return [...new Set(kinds)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export interface MemoryItem {
  id: number
  kind: string
  text: string
  evidence: string
  due: string
  mentionedAt: number
}

export function parseMemory(raw: unknown): MemoryItem[] {
  const items = (raw as { items?: unknown } | null)?.items
  return (Array.isArray(items) ? items : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && Number.isInteger(row.id))
    .map(row => ({
      id: row.id as number,
      kind: str(row.kind),
      text: str(row.text),
      evidence: str(row.evidence),
      due: str(row.due),
      mentionedAt: num(row.mentioned_at)
    }))
}

/** Report times as the plugin keeps them, at most twelve. */
export const MAX_REPORT_TIMES = 12

/** A time an hour after the last, for Add a time; one not already listed. */
export function nextTime(times: string[]): string {
  const minutes = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5))
  let at = times.length ? (minutes(times[times.length - 1]!) + 60) % 1440 : 9 * 60
  for (let tries = 0; tries < 24 && times.includes(clock(at)); tries++) at = (at + 60) % 1440
  return clock(at)
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** A day, YYYY-MM-DD, as the plugin's time zone has it. */
export function dayIn(zone: string, ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
  }
}

/** The weekdays as the plugin numbers them (Monday 0), in this locale's week order, with their short names. */
export function weekdays(language: string | undefined): { day: number; short: string; name: string }[] {
  // 2024-01-01 was a Monday.
  const names = Array.from({ length: 7 }, (_, day) => {
    const date = new Date(Date.UTC(2024, 0, 1 + day, 12))
    return {
      day,
      short: date.toLocaleDateString(language, { weekday: 'narrow', timeZone: 'UTC' }),
      name: date.toLocaleDateString(language, { weekday: 'long', timeZone: 'UTC' })
    }
  })
  let first = 1
  try {
    const info = new Intl.Locale(language ?? navigator.language ?? 'en') as unknown as { weekInfo?: { firstDay?: number }; getWeekInfo?: () => { firstDay?: number } }
    first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1
  } catch {
    // Monday first.
  }
  const start = (first + 6) % 7 // Intl's 1 (Monday)..7 (Sunday) to the plugin's 0..6
  return [...names.slice(start), ...names.slice(0, start)]
}

/** A recent check's kind, as Settings names it. */
export function checkTitle(kind: string): string {
  switch (kind) {
    case 'report':
      return t('Report')
    case 'probe':
      return t('Chat check')
    case 'moment':
      return t('At a place')
    case 'followup':
      return t('Follow-up')
    case 'brief':
      return t('Morning brief')
    default:
      return kind
  }
}
