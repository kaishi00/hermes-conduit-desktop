/**
 * Scheduled jobs, after the phone's Tasks > Scheduled: Hermes' cron jobs from
 * the dashboard's `/api/cron/jobs`, their schedules in plain words ("Weekdays
 * at 8:00 AM" for "0 8 * * 1-5"), when each runs next, and the editor's
 * draft, turned into the schedule string Hermes' parse_schedule reads.
 */
import { locale, t } from '../../../shared/i18n'
import { reasoningTitle } from './models'

/** Hermes' parsed schedule: `cron` carries `expr`, `interval` its `minutes`, `once` its `run_at`. */
export interface CronSchedule {
  kind?: string
  expr?: string
  minutes?: number
  runAt?: string
  display?: string
}

export interface CronJob {
  id: string
  name?: string
  prompt?: string
  enabled: boolean
  state?: string
  deliver?: string
  schedule?: CronSchedule
  scheduleDisplay?: string
  nextRunAt?: string
  lastRunAt?: string
  lastError?: string
  noAgent?: boolean
  script?: string
  model?: string
  provider?: string
  reasoningEffort?: string
  /** The profile that holds it, from a list of every profile's jobs. */
  profile?: string
  /** Another combined dashboard that holds it (its URL); none for this dashboard's. */
  host?: string
}

/** One run of a job: an agent run is a conversation (`id`); a script's run has only its output. */
export interface CronRun {
  key: string
  id?: string
  title?: string
  preview?: string
  model?: string
  profile?: string
  /** Another combined dashboard's run (its URL), from its job there. */
  host?: string
  /** Epoch milliseconds. */
  startedAt?: number
  active: boolean
}

const text = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const bool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase())
  return false
}

const integer = (value: unknown): number | undefined => {
  if (typeof value === 'boolean') return undefined
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? Math.trunc(number) : undefined
}

/** Lenient: a field of an unexpected type is dropped rather than the whole job. */
export function parseJob(raw: unknown): CronJob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const id = text(row.id) ?? text(row.job_id)
  if (!id) return null
  const rawSchedule = row.schedule && typeof row.schedule === 'object' ? (row.schedule as Record<string, unknown>) : null
  const minutes = integer(rawSchedule?.minutes)
  return {
    id,
    name: text(row.name),
    prompt: typeof row.prompt === 'string' ? row.prompt : undefined,
    enabled: bool(row.enabled),
    state: text(row.state),
    deliver: text(row.deliver),
    schedule: rawSchedule
      ? {
          kind: text(rawSchedule.kind),
          expr: text(rawSchedule.expr),
          minutes: minutes && minutes > 0 ? minutes : undefined,
          runAt: text(rawSchedule.run_at),
          display: text(rawSchedule.display)
        }
      : typeof row.schedule === 'string'
        ? { expr: text(row.schedule) }
        : undefined,
    scheduleDisplay: text(row.schedule_display),
    nextRunAt: text(row.next_run_at),
    lastRunAt: text(row.last_run_at),
    lastError: text(row.last_error),
    noAgent: row.no_agent === undefined || row.no_agent === null ? undefined : bool(row.no_agent),
    script: text(row.script),
    model: text(row.model),
    provider: text(row.provider),
    reasoningEffort: text(row.reasoning_effort)?.toLowerCase(),
    profile: text(row.profile)
  }
}

/** `GET /api/cron/jobs`: an array, or one under `jobs`; sorted by name. */
export function parseJobs(raw: unknown): CronJob[] {
  const values = Array.isArray(raw) ? raw : Array.isArray((raw as { jobs?: unknown })?.jobs) ? (raw as { jobs: unknown[] }).jobs : []
  return values
    .map(parseJob)
    .filter((job): job is CronJob => job !== null)
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }))
}

/** `GET /api/cron/jobs/{id}/runs`: `{runs}` (or an array), newest first. */
export function parseRuns(raw: unknown): CronRun[] {
  const object = (raw ?? {}) as Record<string, unknown>
  const values = Array.isArray(raw) ? raw : Array.isArray(object.runs) ? object.runs : Array.isArray(object.items) ? object.items : []
  const runs: CronRun[] = []
  values.forEach((value, index) => {
    if (!value || typeof value !== 'object') return
    const outer = value as Record<string, unknown>
    const row = (outer.session && typeof outer.session === 'object' ? outer.session : outer) as Record<string, unknown>
    const id = text(row.id) ?? text(row.session_id)
    const seconds = Number(row.started_at ?? row.last_active)
    runs.push({
      key: id ?? `run-${index}`,
      id,
      title: text(row.title) ?? text(row.name),
      preview: text(row.preview) ?? text(row.summary),
      model: text(row.model),
      profile: text(row.profile),
      startedAt: Number.isFinite(seconds) && seconds > 0 ? (seconds > 10_000_000_000 ? seconds : seconds * 1000) : undefined,
      active: row.is_active === true
    })
  })
  return runs
}

/** A cron path with the profile named, as the phone sends it (the default included). */
export function cronPath(path: string, profile?: string | null): string {
  if (!profile) return path
  return `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
}

export const displayName = (job: CronJob): string => job.name ?? job.id

/** A finished one-shot job won't run again on its own, even if its record still reads enabled. */
export const isFinished = (job: CronJob): boolean => job.state?.toLowerCase() === 'completed'

export const isActive = (job: CronJob): boolean => job.enabled && !isFinished(job)

export function statusLabel(job: CronJob): string {
  if (isFinished(job)) return t('Finished')
  return isActive(job) ? t('Active') : t('Paused')
}

// MARK: Schedule in words

export function describeInterval(minutes: number): string {
  if (minutes === 1) return t('Every minute')
  if (minutes === 60) return t('Every hour')
  if (minutes === 1440) return t('Every day')
  if (minutes % 1440 === 0) return t('Every {count} days', { count: minutes / 1440 })
  if (minutes % 60 === 0) return t('Every {count} hours', { count: minutes / 60 })
  return t('Every {count} minutes', { count: minutes })
}

/** "*\/N" (or "0/N") as N. */
function step(field: string): number | null {
  const parts = field.split('/')
  if (parts.length !== 2 || (parts[0] !== '*' && parts[0] !== '0') || !/^\d+$/.test(parts[1]!)) return null
  const value = Number(parts[1])
  return value > 0 ? value : null
}

const plainInt = (field: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(field)) return null
  const value = Number(field)
  return value >= min && value <= max ? value : null
}

/** The days a day-of-week field names, Sunday as 0 (cron's 7 too), or null for names and steps. */
export function weekdays(field: string): Set<number> | null {
  const days = new Set<number>()
  for (const item of field.split(',')) {
    const bounds = item.split('-')
    if (bounds.length === 1) {
      const day = plainInt(bounds[0]!, 0, 7)
      if (day === null) return null
      days.add(day % 7)
    } else if (bounds.length === 2) {
      const start = plainInt(bounds[0]!, 0, 7)
      const end = plainInt(bounds[1]!, 0, 7)
      if (start === null || end === null || start > end) return null
      for (let day = start; day <= end; day++) days.add(day % 7)
    } else {
      return null
    }
  }
  return days.size ? days : null
}

const sameDays = (days: Set<number>, list: number[]) => days.size === list.length && list.every(day => days.has(day))

/** "8:00 AM" (or "08:00"), the computer's or the language's clock. */
export function timeText(hour: number, minute: number): string {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
}

/** The days' names, Monday first, as a list ("Monday and Wednesday"). */
function weekdayNames(days: Set<number>): string {
  const names = [1, 2, 3, 4, 5, 6, 0]
    .filter(day => days.has(day))
    // 2 January 2000 was a Sunday.
    .map(day => new Date(2000, 0, 2 + day).toLocaleDateString(locale(), { weekday: 'long' }))
  try {
    return new Intl.ListFormat(locale(), { type: 'conjunction' }).format(names)
  } catch {
    return names.join(', ')
  }
}

/** A five-field cron expression in words, or null for a pattern this doesn't cover. */
export function describeExpression(expression: string): string | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string]
  if (month !== '*') return null

  if (hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    if (minute === '*') return t('Every minute')
    const minuteStep = step(minute)
    if (minuteStep && 60 % minuteStep === 0) return minuteStep === 1 ? t('Every minute') : describeInterval(minuteStep)
    const value = plainInt(minute, 0, 59)
    if (value === null) return null
    return value === 0 ? t('Every hour') : t('Every hour at :{minute}', { minute: String(value).padStart(2, '0') })
  }
  const hourStep = step(hour)
  if (hourStep && 24 % hourStep === 0 && plainInt(minute, 0, 0) === 0 && dayOfMonth === '*' && dayOfWeek === '*') {
    return hourStep === 1 ? t('Every hour') : describeInterval(hourStep * 60)
  }

  const minuteValue = plainInt(minute, 0, 59)
  const hourValue = plainInt(hour, 0, 23)
  if (minuteValue === null || hourValue === null) return null
  const time = timeText(hourValue, minuteValue)
  if (dayOfMonth === '*') {
    if (dayOfWeek === '*') return t('Daily at {time}', { time })
    const days = weekdays(dayOfWeek)
    if (!days) return null
    if (sameDays(days, [1, 2, 3, 4, 5])) return t('Weekdays at {time}', { time })
    if (sameDays(days, [0, 6])) return t('Weekends at {time}', { time })
    if (days.size === 7) return t('Daily at {time}', { time })
    return t('Every {days} at {time}', { days: weekdayNames(days), time })
  }
  const day = plainInt(dayOfMonth, 1, 31)
  if (dayOfWeek === '*' && day !== null) return t('Monthly on day {day} at {time}', { day, time })
  return null
}

export function describeSchedule(schedule: CronSchedule | undefined): string | null {
  if (!schedule) return null
  switch (schedule.kind?.toLowerCase()) {
    case 'interval':
      return schedule.minutes ? describeInterval(schedule.minutes) : null
    case 'once': {
      const date = schedule.runAt ? parseDate(schedule.runAt) : null
      return date ? t('Once, {date}', { date: absoluteDateText(date) }) : null
    }
    default: {
      const expr = schedule.expr ?? schedule.display
      return expr ? describeExpression(expr) : null
    }
  }
}

/** The schedule line for a job: plain words when the pattern is a common one, otherwise Hermes' own wording. */
export function scheduleText(job: CronJob): string | null {
  const described = describeSchedule(job.schedule)
  if (described) return described
  const display = job.scheduleDisplay ?? job.schedule?.display ?? job.schedule?.expr
  if (!display) return null
  return describeExpression(display) ?? display
}

// MARK: Times

/** Hermes' run times: ISO 8601 with or without an offset (read in local time), or epoch seconds or ms. */
export function parseDate(raw: string): Date | null {
  const trimmed = raw.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed)
    const ms = number > 10_000_000_000 ? number : number * 1000
    return ms <= 253_402_300_799_000 ? new Date(ms) : null
  }
  // Python's isoformat can carry microseconds, which Date doesn't read everywhere.
  const iso = trimmed.replace(/(\.\d{3})\d+/, '$1')
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const RELATIVE_HORIZON = 20 * 60 * 60 * 1000

const startOfDay = (ms: number) => {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** When a run happens: "in 25 minutes", "in 3 hours", "tomorrow, 8:00 AM", "Monday 8:00 AM", "Oct 27, 8:00 AM". */
export function runTimeText(date: Date, now = Date.now()): string {
  const interval = date.getTime() - now
  const relative = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const magnitude = Math.abs(interval)
  const sign = interval < 0 ? -1 : 1
  if (interval < RELATIVE_HORIZON) {
    if (magnitude < 90 * 60_000) return relative.format(sign * Math.max(1, Math.round(magnitude / 60_000)), 'minute')
    if (magnitude < RELATIVE_HORIZON) return relative.format(sign * Math.round(magnitude / 3_600_000), 'hour')
    return relative.format(sign * Math.round(magnitude / 86_400_000), 'day')
  }
  const dayOffset = Math.round((startOfDay(date.getTime()) - startOfDay(now)) / 86_400_000)
  const time = date.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  if (dayOffset <= 1) return `${relative.format(dayOffset, 'day')}, ${time}`
  if (dayOffset < 7) return date.toLocaleString(locale(), { weekday: 'long', hour: 'numeric', minute: '2-digit' })
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleString(locale(), { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** A run's full date and time, for the job's details. */
export function absoluteDateText(date: Date): string {
  return date.toLocaleString(locale(), { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "Next run in 3 hours", or the job's state when it won't run again. */
export function nextRunLine(job: CronJob, now = Date.now()): string {
  if (!isActive(job) || !job.nextRunAt) return statusLabel(job)
  const date = parseDate(job.nextRunAt)
  return t('Next run {time}', { time: date ? runTimeText(date, now) : job.nextRunAt })
}

/** A run time for the details, or "—". */
export function runTime(raw: string | undefined): string {
  if (!raw) return '—'
  const date = parseDate(raw)
  return date ? absoluteDateText(date) : raw
}

// MARK: Editor

export type ScheduleMode = 'time' | 'interval' | 'once' | 'custom'
export type IntervalUnit = 'minutes' | 'hours' | 'days'

const UNIT_MINUTES: Record<IntervalUnit, number> = { minutes: 1, hours: 60, days: 1440 }
const UNIT_SUFFIX: Record<IntervalUnit, string> = { minutes: 'm', hours: 'h', days: 'd' }

export interface ScheduleDraft {
  mode: ScheduleMode
  /** The schedule's wall clock. */
  hour: number
  minute: number
  /** Days of the week, Sunday as 0; all seven is every day. */
  days: number[]
  intervalValue: number
  intervalUnit: IntervalUnit
  /** A local date and time, "YYYY-MM-DDTHH:mm" (a datetime-local field's value). */
  runAt: string
  custom: string
}

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS = [1, 2, 3, 4, 5]
export const WEEKENDS = [0, 6]

const pad = (value: number) => String(value).padStart(2, '0')

/** A date as a datetime-local field's value. */
export function localDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function newScheduleDraft(now = Date.now()): ScheduleDraft {
  return { mode: 'time', hour: 8, minute: 0, days: [...EVERY_DAY], intervalValue: 1, intervalUnit: 'hours', runAt: localDateTime(new Date(now + 3_600_000)), custom: '' }
}

/** "M H * * D" with a plain minute and hour. */
function timeOfDay(expression: string): { hour: number; minute: number; days: number[] } | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5 || fields[2] !== '*' || fields[3] !== '*') return null
  const minute = plainInt(fields[0]!, 0, 59)
  const hour = plainInt(fields[1]!, 0, 23)
  if (minute === null || hour === null) return null
  if (fields[4] === '*') return { hour, minute, days: [...EVERY_DAY] }
  const days = weekdays(fields[4]!)
  return days ? { hour, minute, days: [...days].sort() } : null
}

/** A job's schedule in the editor's shapes; anything else stays as custom text, so saving unchanged leaves it alone. */
export function scheduleDraftFrom(schedule: CronSchedule | undefined, display: string | undefined, now = Date.now()): ScheduleDraft {
  const draft = newScheduleDraft(now)
  const kind = schedule?.kind?.toLowerCase()
  if (kind === 'interval' && schedule?.minutes) {
    const unit: IntervalUnit = schedule.minutes % 1440 === 0 ? 'days' : schedule.minutes % 60 === 0 ? 'hours' : 'minutes'
    return { ...draft, mode: 'interval', intervalUnit: unit, intervalValue: schedule.minutes / UNIT_MINUTES[unit] }
  }
  const runAt = kind === 'once' && schedule?.runAt ? parseDate(schedule.runAt) : null
  if (runAt) return { ...draft, mode: 'once', runAt: localDateTime(runAt) }
  const expression = schedule?.expr ?? schedule?.display ?? display ?? ''
  const parsed = timeOfDay(expression)
  if (parsed) return { ...draft, mode: 'time', ...parsed }
  return { ...draft, mode: 'custom', custom: expression }
}

/** The local time with its offset, so the profile's zone doesn't move a one-off run. */
function isoWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${localDateTime(date)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** What Hermes is sent, or null while the draft isn't a schedule yet. */
export function scheduleString(draft: ScheduleDraft): string | null {
  switch (draft.mode) {
    case 'time': {
      if (!draft.days.length) return null
      const days = new Set(draft.days)
      const field = days.size === 7 ? '*' : sameDays(days, WEEKDAYS) ? '1-5' : [...days].sort().join(',')
      return `${draft.minute} ${draft.hour} * * ${field}`
    }
    case 'interval':
      return Number.isInteger(draft.intervalValue) && draft.intervalValue > 0 ? `every ${draft.intervalValue}${UNIT_SUFFIX[draft.intervalUnit]}` : null
    case 'once': {
      const date = new Date(draft.runAt)
      return Number.isNaN(date.getTime()) ? null : isoWithOffset(date)
    }
    case 'custom':
      return draft.custom.trim() || null
  }
}

/** The draft as Hermes would read it, for the plain-words preview. */
export function previewSchedule(draft: ScheduleDraft): string | null {
  const value = scheduleString(draft)
  if (!value) return null
  switch (draft.mode) {
    case 'interval':
      return describeInterval(draft.intervalValue * UNIT_MINUTES[draft.intervalUnit])
    case 'once':
      return describeSchedule({ kind: 'once', runAt: value })
    default:
      return describeExpression(value)
  }
}

export interface JobDraft {
  name: string
  prompt: string
  schedule: ScheduleDraft
  deliver: string
  /** A job that runs a script or no agent can do without a prompt. */
  promptOptional: boolean
  /** A job that runs no agent has no model to pin. */
  runsAgent: boolean
  /** The job's own model and provider, both empty for the profile's. */
  model: string
  provider: string
  /** The job's own reasoning level, empty for the profile's. */
  reasoning: string
}

export function newJobDraft(now = Date.now()): JobDraft {
  return {
    name: '',
    prompt: '',
    schedule: newScheduleDraft(now),
    deliver: 'local',
    promptOptional: false,
    runsAgent: true,
    model: '',
    provider: '',
    reasoning: ''
  }
}

export function jobDraftFrom(job: CronJob, now = Date.now()): JobDraft {
  return {
    name: job.name ?? '',
    prompt: job.prompt ?? '',
    schedule: scheduleDraftFrom(job.schedule, job.scheduleDisplay, now),
    deliver: job.deliver || 'local',
    promptOptional: job.noAgent === true || !!job.script,
    runsAgent: job.noAgent !== true,
    model: job.model ?? '',
    provider: job.provider ?? '',
    reasoning: job.reasoningEffort ?? ''
  }
}

/** Whether the job runs on a model or reasoning of its own rather than the profile's. */
export const pinsModel = (job: CronJob): boolean => !!(job.model || job.provider || job.reasoningEffort)

/**
 * What the job runs on, as the phone's Model row says it: the model and its
 * reasoning ("claude-sonnet · High"), or Profile default. Null for a job
 * that runs no agent.
 */
export function modelSummary(job: CronJob): string | null {
  if (job.noAgent === true) return null
  const model = job.model || (job.provider ? t('Default') : t('Profile default'))
  return job.reasoningEffort ? `${model} · ${reasoningTitle(job.reasoningEffort)}` : model
}

/**
 * The model's fields. The profile's clears the job's model, provider and
 * endpoint; a pick names its provider, and clears an endpoint kept for the
 * one before, which would otherwise override the new provider's.
 */
function modelFields(draft: JobDraft): Record<string, unknown> {
  return { model: draft.model, provider: draft.provider, base_url: '' }
}

const sameModel = (a: JobDraft, b: JobDraft) => a.model === b.model && a.provider === b.provider

export function canSave(draft: JobDraft): boolean {
  return scheduleString(draft.schedule) !== null && (draft.promptOptional || draft.prompt.trim() !== '')
}

/** POST /api/cron/jobs. */
export function createBody(draft: JobDraft): Record<string, unknown> | null {
  const schedule = scheduleString(draft.schedule)
  if (!canSave(draft) || !schedule) return null
  const body: Record<string, unknown> = { name: draft.name.trim(), prompt: draft.prompt.trim(), schedule, deliver: draft.deliver }
  return draft.runsAgent && (draft.model || draft.provider) ? { ...body, ...modelFields(draft) } : body
}

/** Hermes' create takes a model but no reasoning, so a new job's reasoning follows as an edit once it exists. */
export function createReasoningUpdate(draft: JobDraft): Record<string, unknown> | null {
  return draft.runsAgent && draft.reasoning ? { reasoning_effort: draft.reasoning } : null
}

/** PUT /api/cron/jobs/{id}'s `updates`: only what changed, so what the form doesn't show stays as it is. */
export function jobUpdates(draft: JobDraft, original: JobDraft): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  if (draft.name.trim() !== original.name.trim()) updates.name = draft.name.trim()
  if (draft.prompt.trim() !== original.prompt.trim()) updates.prompt = draft.prompt.trim()
  const schedule = scheduleString(draft.schedule)
  if (schedule && schedule !== scheduleString(original.schedule)) updates.schedule = schedule
  if (draft.deliver !== original.deliver) updates.deliver = draft.deliver
  if (draft.runsAgent && !sameModel(draft, original)) Object.assign(updates, modelFields(draft))
  // Empty clears it: the profile's reasoning again.
  if (draft.runsAgent && draft.reasoning !== original.reasoning) updates.reasoning_effort = draft.reasoning
  return updates
}

/** Where a job's output goes: `local` (saved only) or a connected platform's home channel. */
export interface DeliveryTarget {
  id: string
  name: string
  /** False when the platform has no home channel to deliver to yet. */
  homeTargetSet: boolean
}

export function parseDeliveryTargets(raw: unknown): DeliveryTarget[] {
  const values = Array.isArray(raw) ? raw : Array.isArray((raw as { targets?: unknown })?.targets) ? (raw as { targets: unknown[] }).targets : []
  return values.flatMap(value => {
    const row = (value ?? {}) as Record<string, unknown>
    const id = text(row.id)
    if (!id) return []
    return [{ id, name: text(row.name) ?? id, homeTargetSet: row.home_target_set !== false }]
  })
}

/** The picker's choices: what Hermes lists, with the job's current target kept when it isn't listed. */
export function deliveryChoices(targets: DeliveryTarget[], current: string): DeliveryTarget[] {
  const listed = targets.length ? targets : [{ id: 'local', name: 'local', homeTargetSet: true }]
  if (!current || listed.some(target => target.id === current)) return listed
  return [...listed, { id: current, name: current, homeTargetSet: true }]
}

export function deliveryTitle(id: string, name?: string): string {
  if (id === 'local') return t('Save only')
  if (id === 'origin') return t('Home channel')
  return name && name !== id ? name : id.charAt(0).toUpperCase() + id.slice(1)
}
