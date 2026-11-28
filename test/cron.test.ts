import { describe, expect, it } from 'vitest'
import {
  createBody,
  createReasoningUpdate,
  modelSummary,
  pinsModel,
  cronPath,
  deliveryChoices,
  describeExpression,
  describeInterval,
  jobDraftFrom,
  jobUpdates,
  newJobDraft,
  nextRunLine,
  parseDate,
  parseJobs,
  parseRuns,
  scheduleDraftFrom,
  scheduleString,
  scheduleText,
  statusLabel,
  timeText,
  type CronJob
} from '../src/renderer/src/state/cron'

const job = (fields: Partial<CronJob> = {}): CronJob => ({ id: 'j1', enabled: true, ...fields })

describe('scheduled jobs', () => {
  it('reads the list leniently, sorted by name, from an array or {jobs}', () => {
    const raw = [
      { id: 'b', name: 'Zeta', enabled: true, schedule: { kind: 'cron', expr: '0 8 * * 1-5', display: '0 8 * * 1-5' }, profile: 'work' },
      { id: 'a', name: 'alpha', enabled: 'false', schedule: { kind: 'interval', minutes: 120.0 }, next_run_at: '2026-11-18T10:00:00+00:00' },
      { name: 'no id' },
      'junk'
    ]
    const jobs = parseJobs(raw)
    expect(jobs.map(j => j.id)).toEqual(['a', 'b'])
    expect(jobs[0]).toMatchObject({ enabled: false, schedule: { kind: 'interval', minutes: 120 } })
    expect(jobs[1]!.profile).toBe('work')
    expect(parseJobs({ jobs: raw }).length).toBe(2)
    expect(parseJobs(null)).toEqual([])
  })

  it('says a schedule in words, and keeps Hermes’ own wording for the rest', () => {
    const eight = timeText(8, 0)
    expect(describeExpression('0 8 * * 1-5')).toBe(`Weekdays at ${eight}`)
    expect(describeExpression('0 8 * * 0,6')).toBe(`Weekends at ${eight}`)
    expect(describeExpression('0 8 * * *')).toBe(`Daily at ${eight}`)
    expect(describeExpression('0 8 1 * *')).toBe(`Monthly on day 1 at ${eight}`)
    expect(describeExpression('*/15 * * * *')).toBe('Every 15 minutes')
    expect(describeExpression('0 */2 * * *')).toBe('Every 2 hours')
    expect(describeExpression('5 * * * *')).toBe('Every hour at :05')
    expect(describeExpression('0 8 * * 1,3')).toMatch(/^Every Monday and Wednesday at /)
    expect(describeExpression('0 8,20 * * *')).toBeNull()
    expect(describeInterval(1440 * 3)).toBe('Every 3 days')
    expect(scheduleText(job({ scheduleDisplay: 'every monday 9am' }))).toBe('every monday 9am')
    expect(scheduleText(job({ schedule: { kind: 'interval', minutes: 60 } }))).toBe('Every hour')
  })

  it('says when a job runs next, or why it won’t', () => {
    const now = Date.parse('2026-11-18T12:00:00Z')
    expect(nextRunLine(job({ nextRunAt: '2026-11-18T15:00:00Z' }), now)).toBe('Next run in 3 hours')
    expect(nextRunLine(job({ nextRunAt: '2026-11-18T12:20:00Z' }), now)).toBe('Next run in 20 minutes')
    expect(nextRunLine(job({ enabled: false, nextRunAt: '2026-11-18T15:00:00Z' }), now)).toBe('Paused')
    expect(nextRunLine(job({ state: 'completed' }), now)).toBe('Finished')
    expect(statusLabel(job())).toBe('Active')
  })

  it('reads Hermes’ run times: ISO with microseconds, epoch seconds and milliseconds', () => {
    expect(parseDate('2026-11-18T10:00:00.123456+00:00')?.toISOString()).toBe('2026-11-18T10:00:00.123Z')
    expect(parseDate('1795000000')?.getTime()).toBe(1795000000000)
    expect(parseDate('1795000000000')?.getTime()).toBe(1795000000000)
    expect(parseDate('soon')).toBeNull()
  })

  it('reads runs: a conversation by its id, a script’s run without one', () => {
    const runs = parseRuns({ runs: [{ id: 'cron_j1_1', title: 'Morning', started_at: 1795000000, is_active: true }, { title: 'Script output', source: 'cron_output', started_at: 1794990000 }] })
    expect(runs[0]).toMatchObject({ key: 'cron_j1_1', id: 'cron_j1_1', startedAt: 1795000000000, active: true })
    expect(runs[1]).toMatchObject({ key: 'run-1', id: undefined, title: 'Script output', outputOnly: true })
  })

  it('opens only a run with a session: a script’s output row has an id that names none (issue 3455)', () => {
    const runs = parseRuns({
      runs: [
        { id: 'local-409c9669', source: 'cron', title: 'IPv6 sweep' },
        { id: 'cron_output:4f00afd560b2:2026-11-28_10-10-45', source: 'cron_output', preview: '**Status:** silent (empty output)' },
        { source: 'cron_output', session: { id: 'cron_output:4f00afd560b2:exec:3' } },
        { id: 'cron_4f00afd560b2_20261128_095300' },
        { id: 'future-row', source: 'something_new' }
      ]
    })
    expect(runs.map(run => run.id)).toEqual(['local-409c9669', undefined, undefined, 'cron_4f00afd560b2_20261128_095300', undefined])
    expect(runs.map(run => run.outputOnly)).toEqual([false, true, true, false, true])
    expect(runs[1]).toMatchObject({ key: 'cron_output:4f00afd560b2:2026-11-28_10-10-45', preview: '**Status:** silent (empty output)' })
    expect(new Set(runs.map(run => run.key)).size).toBe(5)
  })

  it('names the profile in a path, the default one too', () => {
    expect(cronPath('/api/cron/jobs', 'all')).toBe('/api/cron/jobs?profile=all')
    expect(cronPath('/api/cron/jobs/a/runs?limit=20', 'default')).toBe('/api/cron/jobs/a/runs?limit=20&profile=default')
    expect(cronPath('/api/cron/jobs', undefined)).toBe('/api/cron/jobs')
  })
})

describe('the scheduled-job editor', () => {
  it('turns each shape into what Hermes parses', () => {
    const base = newJobDraft(0).schedule
    expect(scheduleString({ ...base, mode: 'time', hour: 8, minute: 30, days: [1, 2, 3, 4, 5] })).toBe('30 8 * * 1-5')
    expect(scheduleString({ ...base, mode: 'time', days: [0, 1, 2, 3, 4, 5, 6] })).toBe('0 8 * * *')
    expect(scheduleString({ ...base, mode: 'time', days: [6, 0] })).toBe('0 8 * * 0,6')
    expect(scheduleString({ ...base, mode: 'time', days: [] })).toBeNull()
    expect(scheduleString({ ...base, mode: 'interval', intervalValue: 2, intervalUnit: 'hours' })).toBe('every 2h')
    expect(scheduleString({ ...base, mode: 'interval', intervalValue: 0 })).toBeNull()
    expect(scheduleString({ ...base, mode: 'custom', custom: '  every monday 9am ' })).toBe('every monday 9am')
    expect(scheduleString({ ...base, mode: 'once', runAt: '2026-12-01T09:00' })).toMatch(/^2026-12-01T09:00:00[+-]\d{2}:\d{2}$/)
  })

  it('opens a job’s schedule in the shape it was made in, else as custom text', () => {
    expect(scheduleDraftFrom({ kind: 'interval', minutes: 180 }, undefined)).toMatchObject({ mode: 'interval', intervalValue: 3, intervalUnit: 'hours' })
    expect(scheduleDraftFrom({ kind: 'cron', expr: '15 7 * * 1-5' }, undefined)).toMatchObject({ mode: 'time', hour: 7, minute: 15, days: [1, 2, 3, 4, 5] })
    expect(scheduleDraftFrom({ kind: 'cron', expr: '0 8,20 * * *' }, undefined)).toMatchObject({ mode: 'custom', custom: '0 8,20 * * *' })
  })

  it('sends a new job whole and an edit only what changed', () => {
    const draft = { ...newJobDraft(0), name: ' Brief ', prompt: 'Summarize my inbox' }
    expect(createBody(draft)).toEqual({ name: 'Brief', prompt: 'Summarize my inbox', schedule: '0 8 * * *', deliver: 'local' })
    expect(createBody({ ...draft, prompt: ' ' })).toBeNull()
    const saved = job({ name: 'Brief', prompt: 'Summarize my inbox', schedule: { kind: 'cron', expr: '0 8 * * *' }, deliver: 'telegram' })
    const original = jobDraftFrom(saved)
    expect(jobUpdates(original, original)).toEqual({})
    expect(jobUpdates({ ...original, prompt: 'New', schedule: { ...original.schedule, hour: 9 } }, original)).toEqual({ prompt: 'New', schedule: '0 9 * * *' })
    // A script job can do without a prompt.
    expect(jobDraftFrom(job({ script: 'check.py' })).promptOptional).toBe(true)
  })

  it('pins a job’s model and reasoning, sends only what changed, and clears both for the profile’s', () => {
    const draft = { ...newJobDraft(0), name: 'Brief', prompt: 'Go', provider: 'anthropic', model: 'claude-sonnet', reasoning: 'high' }
    // Hermes' create takes the model; the reasoning follows as an edit.
    expect(createBody(draft)).toMatchObject({ model: 'claude-sonnet', provider: 'anthropic', base_url: '' })
    expect(createBody(draft)).not.toHaveProperty('reasoning_effort')
    expect(createReasoningUpdate(draft)).toEqual({ reasoning_effort: 'high' })
    expect(createBody({ ...draft, provider: '', model: '' })).not.toHaveProperty('model')
    expect(createReasoningUpdate({ ...draft, reasoning: '' })).toBeNull()

    const pinned = job({ prompt: 'Go', model: 'claude-sonnet', provider: 'anthropic', reasoningEffort: 'high' })
    const original = jobDraftFrom(pinned)
    expect(original).toMatchObject({ model: 'claude-sonnet', provider: 'anthropic', reasoning: 'high', runsAgent: true })
    expect(jobUpdates(original, original)).toEqual({})
    expect(jobUpdates({ ...original, reasoning: 'low' }, original)).toEqual({ reasoning_effort: 'low' })
    expect(jobUpdates({ ...original, model: '', provider: '', reasoning: '' }, original)).toEqual({
      model: '',
      provider: '',
      base_url: '',
      reasoning_effort: ''
    })
    expect(jobUpdates({ ...original, model: 'gpt-5', provider: 'openai' }, original)).toEqual({ model: 'gpt-5', provider: 'openai', base_url: '' })

    expect(pinsModel(pinned)).toBe(true)
    expect(modelSummary(pinned)).toBe('claude-sonnet · High')
    expect(pinsModel(job({}))).toBe(false)
    expect(modelSummary(job({}))).toBe('Profile default')
    // A job that runs no agent has no model.
    expect(modelSummary(job({ noAgent: true }))).toBeNull()
    expect(jobDraftFrom(job({ noAgent: true })).runsAgent).toBe(false)
  })

  it('keeps a job’s delivery target in the picker when Hermes doesn’t list it', () => {
    const targets = [{ id: 'local', name: 'Local', homeTargetSet: true }]
    expect(deliveryChoices(targets, 'origin').map(c => c.id)).toEqual(['local', 'origin'])
    expect(deliveryChoices([], 'local').map(c => c.id)).toEqual(['local'])
  })
})
