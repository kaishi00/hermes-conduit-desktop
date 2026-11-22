import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { locale, t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import {
  EVERY_DAY,
  WEEKDAYS,
  WEEKENDS,
  absoluteDateText,
  canSave,
  createBody,
  createReasoningUpdate,
  deliveryChoices,
  deliveryTitle,
  displayName,
  isActive,
  isFinished,
  jobDraftFrom,
  jobUpdates,
  modelSummary,
  newJobDraft,
  nextRunLine,
  pinsModel,
  previewSchedule,
  runTime,
  scheduleText,
  statusLabel,
  type CronJob,
  type CronRun,
  type DeliveryTarget,
  type IntervalUnit,
  type JobDraft,
  type ScheduleMode
} from '../state/cron'
import { useCron, type CronSource } from '../state/useCron'
import { ProfileColumn } from './ProfileColumn'
import type { MixedTile } from '../state/botOrder'
import type { HostBadge } from '../state/keptHosts'
import { Icon } from './icons'
import { REASONING_LEVELS } from '../state/models'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelChooser } from './ModelChooser'
import { ModelCatalogNote, RefreshModelsButton } from './ModelCatalogNote'
import { ask } from '../state/dialogs'
import { Select } from './Select'

interface Props {
  bots: Bot[] | null
  connected: boolean
  /** The profile the list shows (null: every one), shared with Chats. */
  profile: string | null
  onProfile: (profile: string | null) => void
  /**
   * The Chats column's faces: every combined dashboard's profiles. Another dashboard's face lists
   * that profile's jobs, read and changed through its kept connection, with no switch.
   */
  tiles?: readonly MixedTile[]
  badgeFor?: (tile: MixedTile) => HostBadge | null
  /** Opens a run's conversation. */
  onOpenRun: (run: CronRun, job: CronJob) => void
  /** The Board | Scheduled switch, for the header. */
  segment?: ReactNode
}

/** Pinned jobs, kept on this computer as "profile\tjobID", "host\tprofile\tjobID" for another dashboard's (Hermes has no pin for a job). */
const PIN_KEY = 'conduit.pinnedCronJobs'
const readPins = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
const pinKey = (job: CronJob) => `${job.host ? `${job.host}\t` : ''}${job.profile ?? 'default'}\t${job.id}`
const jobKey = pinKey

type Pane = { kind: 'job'; key: string } | { kind: 'edit'; job: CronJob | null } | null

/**
 * Tasks > Scheduled, after the phone's: Hermes' scheduled jobs with their
 * schedules in words, when each runs next and an on/off switch; a job's
 * details hold Run now, its settings and its run history, each run a
 * conversation. Jobs are made and changed here or by asking Hermes.
 */
export function ScheduledJobs({ bots, connected, profile, onProfile, tiles = [], badgeFor, onOpenRun, segment }: Props) {
  /** Another dashboard's profile the list shows, picked by its face. */
  const [far, setFar] = useState<{ host: string; name: string } | null>(null)
  const farHosts = useMemo(() => [...new Set(tiles.filter(tile => !tile.own).map(tile => tile.host))], [tiles])
  // A far face whose dashboard is no longer combined goes back to All.
  const shownFar = far && farHosts.includes(far.host) ? far : null
  // All lists every combined dashboard's jobs, as Chats' All lists their chats.
  const sources = useMemo<CronSource[]>(
    () =>
      shownFar
        ? [{ host: shownFar.host, profile: shownFar.name }]
        : profile
          ? [{ host: null, profile }]
          : [{ host: null, profile: null }, ...farHosts.map(host => ({ host, profile: null }))],
    [shownFar, profile, farHosts]
  )
  const cron = useCron(sources, connected)
  const pickProfile = (next: string | null) => {
    setFar(null)
    onProfile(next)
  }
  const pickFar = (tile: MixedTile) => {
    onProfile(null)
    setFar({ host: tile.host, name: tile.bot.name })
  }
  const [pins, setPins] = useState(readPins)
  const [pane, setPane] = useState<Pane>(null)
  const [menu, setMenu] = useState<{ job: CronJob; x: number; y: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  useEffect(() => setPane(null), [profile, shownFar?.host, shownFar?.name])

  const jobs = cron.jobs ?? []
  const pinned = useMemo(() => pins.flatMap(key => jobs.filter(job => pinKey(job) === key)), [pins, jobs])
  const others = useMemo(() => jobs.filter(job => !pins.includes(pinKey(job))), [pins, jobs])
  const selected = pane?.kind === 'job' ? jobs.find(job => jobKey(job) === pane.key) ?? null : null
  const tileOf = (job: CronJob) => {
    const name = (job.profile ?? 'default').toLowerCase()
    return tiles.find(tile => (job.host ? !tile.own && tile.host === job.host : tile.own) && tile.bot.name.toLowerCase() === name)
  }
  const botTitle = (job: CronJob) => tileOf(job)?.bot.title ?? (job.host ? undefined : bots?.find(b => b.name === (job.profile ?? 'default'))?.title) ?? job.profile ?? ''
  // The list names each job's bot while it holds more than one profile's.
  const namesBots = !profile && !shownFar && Math.max(tiles.length, bots?.length ?? 0) > 1
  const showColumn = tiles.length > 1

  function togglePin(job: CronJob) {
    const key = pinKey(job)
    const next = pins.includes(key) ? pins.filter(k => k !== key) : [...pins, key]
    setPins(next)
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next))
    } catch {
      // Kept for this window only.
    }
  }

  async function act(action: 'pause' | 'resume' | 'trigger', job: CronJob) {
    setNote(null)
    const failure = await cron.act(action, job)
    if (failure) setNote(failure)
    else if (action === 'trigger') setNote(t('{name} is running. Its run shows in its history in a moment.', { name: displayName(job) }))
  }

  async function remove(job: CronJob) {
    const detail = t("This removes {name} from Hermes, so it won't run again. Chats from its past runs are kept.", { name: displayName(job) })
    if (!(await ask(`${t('Delete scheduled job?')}\n\n${detail}`, { confirm: t('Delete'), destructive: true }))) return
    setNote(null)
    const failure = await cron.remove(job)
    if (failure) {
      setNote(failure)
      return
    }
    if (pins.includes(pinKey(job))) togglePin(job)
    if (pane?.kind === 'job' && pane.key === jobKey(job)) setPane(null)
  }

  const row = (job: CronJob, isPinned: boolean) => (
    <div
      key={jobKey(job)}
      className="row-wrap job-row-wrap"
      onContextMenu={e => {
        e.preventDefault()
        setMenu({ job, x: e.clientX, y: e.clientY })
      }}
    >
      <button className="row job-row" aria-current={selected && jobKey(selected) === jobKey(job) ? 'true' : undefined} onClick={() => setPane({ kind: 'job', key: jobKey(job) })}>
        <span className="row-title">
          {isPinned ? <Icon name="pin" className="row-pin" /> : null}
          {displayName(job)}
        </span>
        <span className="meta">{scheduleText(job) ?? t('No schedule')}</span>
        {pinsModel(job) && modelSummary(job) ? <span className="meta job-model">{modelSummary(job)}</span> : null}
        <span className={`meta job-next${isActive(job) ? ' on' : ''}`}>
          <Icon name="clock" />
          {nextRunLine(job)}
          {namesBots && (job.profile || job.host) ? ` · ${botTitle(job)}` : ''}
        </span>
      </button>
      {!isFinished(job) ? (
        <label className="switch" title={job.enabled ? t('Pause') : t('Resume')}>
          <input
            type="checkbox"
            role="switch"
            aria-label={displayName(job)}
            checked={job.enabled}
            disabled={cron.busy !== null}
            onChange={e => void act(e.target.checked ? 'resume' : 'pause', job)}
          />
          <span aria-hidden="true" />
        </label>
      ) : null}
      <button
        className="row-more"
        aria-label={t('More')}
        title={t('More')}
        aria-haspopup="menu"
        onClick={e => {
          e.stopPropagation()
          const box = e.currentTarget.getBoundingClientRect()
          setMenu(m => (m && jobKey(m.job) === jobKey(job) ? null : { job, x: box.right, y: box.bottom }))
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  )

  return (
    <>
      <section className={`chatlist${showColumn ? ' has-column' : ''}`} aria-label={t('Scheduled')}>
        {showColumn ? (
          <div className="profile-column-wrap">
            <ProfileColumn
              tiles={tiles}
              profile={shownFar ? null : profile}
              otherProfile={shownFar}
              onProfile={pickProfile}
              onOther={pickFar}
              badgeFor={badgeFor}
              unread={() => false}
              waits={() => 0}
            />
          </div>
        ) : null}
        <div className="chatlist-main">
        <div className="chatlist-head">
          {segment ?? <h1>{t('Scheduled')}</h1>}
          <button className="round" aria-label={t('New job')} title={t('New job')} disabled={!connected} onClick={() => setPane({ kind: 'edit', job: null })}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="chatlist-scroll">
          {cron.jobs === null && !cron.error ? <div className="empty">{t('Loading…')}</div> : null}
          {cron.error ? <div className="empty">{cron.error}</div> : null}
          {cron.jobs && !jobs.length ? <div className="empty">{t('No scheduled jobs yet. Make one with the + button, or ask Hermes to run something on a schedule.')}</div> : null}
          {pinned.length ? (
            <div role="group" aria-label={t('Pinned')}>
              <div className="sect">{t('Pinned')}</div>
              {pinned.map(job => row(job, true))}
            </div>
          ) : null}
          {others.length ? (
            <div role="group" aria-label={t('Jobs')}>
              {pinned.length ? <div className="sect">{t('Jobs')}</div> : null}
              {others.map(job => row(job, false))}
            </div>
          ) : null}
        </div>
        {menu ? (
          <div className="host-menu row-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}>
            <button role="menuitem" onClick={() => togglePin(menu.job)}>
              {pins.includes(pinKey(menu.job)) ? t('Unpin') : t('Pin')}
            </button>
            {!isFinished(menu.job) ? (
              <>
                <button role="menuitem" disabled={cron.busy !== null} onClick={() => void act('trigger', menu.job)}>
                  {t('Run now')}
                </button>
                <button role="menuitem" disabled={cron.busy !== null} onClick={() => void act(menu.job.enabled ? 'pause' : 'resume', menu.job)}>
                  {menu.job.enabled ? t('Pause') : t('Resume')}
                </button>
              </>
            ) : null}
            <button role="menuitem" onClick={() => setPane({ kind: 'edit', job: menu.job })}>
              {t('Edit')}
            </button>
            <button role="menuitem" className="danger" disabled={cron.busy !== null} onClick={() => void remove(menu.job)}>
              {t('Delete')}
            </button>
          </div>
        ) : null}
        </div>
      </section>
      <main className="needs job-pane">
        <div className="needs-inner">
          {note ? (
            <div className="model-note" role="status">
              {note}
              <button className="staged-remove" aria-label={t('Close')} onClick={() => setNote(null)}>
                <Icon name="close" />
              </button>
            </div>
          ) : null}
          {pane?.kind === 'edit' ? (
            <JobEditor
              key={pane.job ? jobKey(pane.job) : 'new'}
              job={pane.job}
              bots={bots}
              profile={shownFar ? shownFar.name : profile}
              host={pane.job ? (pane.job.host ?? null) : (shownFar?.host ?? null)}
              loadTargets={cron.deliveryTargets}
              onCancel={() => setPane(pane.job ? { kind: 'job', key: jobKey(pane.job) } : null)}
              onSave={async (draft, original, owner) => {
                if (pane.job) {
                  await cron.update(pane.job, jobUpdates(draft, original))
                  setPane({ kind: 'job', key: jobKey(pane.job) })
                } else {
                  const body = createBody(draft)
                  if (!body) return
                  const made = await cron.create(body, owner, shownFar?.host ?? null)
                  setPane(made ? { kind: 'job', key: jobKey(made) } : null)
                  // Hermes' create takes no reasoning; the new job gets it as an edit.
                  const reasoning = createReasoningUpdate(draft)
                  if (reasoning) {
                    try {
                      if (!made) throw new Error(t("Hermes sent a reply Conduit didn't understand. Updating Hermes and Conduit usually fixes this."))
                      await cron.update(made, reasoning)
                    } catch (e) {
                      setNote(t('The job is saved, but not its reasoning: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
                    }
                  }
                }
              }}
            />
          ) : selected ? (
            <JobDetails
              key={jobKey(selected)}
              job={selected}
              busy={cron.busy === selected.id}
              profileName={namesBots ? botTitle(selected) : null}
              loadRuns={cron.runs}
              onAct={action => void act(action, selected)}
              onEdit={() => setPane({ kind: 'edit', job: selected })}
              onDelete={() => void remove(selected)}
              onOpenRun={run => onOpenRun(run, selected)}
            />
          ) : (
            <div className="needs-empty">
              <Icon name="clock" />
              <span>{jobs.length ? t('Pick a job to see its details and run history.') : t('Scheduled jobs run a prompt on their own, on a schedule.')}</span>
              <span className="meta">{t('Each run is saved as its own conversation. Ask Hermes to add or change a schedule, or make one here.')}</span>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

function JobDetails({
  job,
  busy,
  profileName,
  loadRuns,
  onAct,
  onEdit,
  onDelete,
  onOpenRun
}: {
  job: CronJob
  busy: boolean
  profileName: string | null
  loadRuns: (job: CronJob) => Promise<CronRun[]>
  onAct: (action: 'pause' | 'resume' | 'trigger') => void
  onEdit: () => void
  onDelete: () => void
  onOpenRun: (run: CronRun) => void
}) {
  const [runs, setRuns] = useState<CronRun[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRuns(null)
    setFailure(null)
    loadRuns(job)
      .then(list => live && setRuns(list))
      .catch(e => live && setFailure(t('Could not load scheduled-job runs: {reason}', { reason: e instanceof Error ? e.message : String(e) })))
    return () => {
      live = false
    }
    // Read again after a run or a change: the job's last run moves.
  }, [job.id, job.profile, job.lastRunAt, loadRuns])

  return (
    <>
      <div className="job-head">
        <h1>{displayName(job)}</h1>
        <span className={`job-status ${isFinished(job) ? 'finished' : isActive(job) ? 'active' : 'paused'}`}>{statusLabel(job)}</span>
      </div>
      <div className="job-actions">
        {!isFinished(job) ? (
          <>
            <button className="primary" disabled={busy} onClick={() => onAct('trigger')}>
              {busy ? t('Working…') : t('Run now')}
            </button>
            <button className="secondary" disabled={busy} onClick={() => onAct(job.enabled ? 'pause' : 'resume')}>
              {job.enabled ? t('Pause') : t('Resume')}
            </button>
          </>
        ) : null}
        <button className="secondary" onClick={onEdit}>
          {t('Edit job')}
        </button>
        <button className="secondary danger" disabled={busy} onClick={onDelete}>
          {t('Delete job')}
        </button>
      </div>
      <dl className="job-facts">
        <dt>{t('Schedule')}</dt>
        <dd>{scheduleText(job) ?? '—'}</dd>
        <dt>{t('Next run')}</dt>
        <dd>{isFinished(job) ? '—' : runTime(job.nextRunAt)}</dd>
        <dt>{t('Last run')}</dt>
        <dd>{runTime(job.lastRunAt)}</dd>
        <dt>{t('Delivery')}</dt>
        <dd>{deliveryTitle(job.deliver ?? 'local')}</dd>
        {modelSummary(job) ? (
          <>
            <dt>{t('Model')}</dt>
            <dd>{modelSummary(job)}</dd>
          </>
        ) : null}
        {profileName ? (
          <>
            <dt>{t('Bot')}</dt>
            <dd>{profileName}</dd>
          </>
        ) : null}
        {job.lastError ? (
          <>
            <dt>{t('Last error')}</dt>
            <dd className="error-text">{job.lastError}</dd>
          </>
        ) : null}
      </dl>
      {job.prompt?.trim() ? (
        <section className="job-section">
          <h2>{t('Prompt')}</h2>
          <p className="job-prompt">{job.prompt}</p>
        </section>
      ) : null}
      <section className="job-section">
        <h2>{t('Run history')}</h2>
        {failure ? <p className="meta">{failure}</p> : null}
        {!runs && !failure ? <p className="meta">{t('Loading…')}</p> : null}
        {runs && !runs.length ? <p className="meta">{t('This job has not run yet.')}</p> : null}
        {runs?.map(run => (
          <button key={run.key} className="needs-row job-run" disabled={!run.id} onClick={() => onOpenRun(run)}>
            <span className="needs-body">
              <span className="needs-top">
                <span className="needs-title">{run.title ?? run.preview ?? t('Run')}</span>
                <span className="meta row-time">{run.active ? t('Running') : run.startedAt ? absoluteDateText(new Date(run.startedAt)) : ''}</span>
              </span>
              {/* The model, as the phone shows it: a run's preview is Hermes' own instructions to the job. */}
              {run.model ? <span className="meta">{run.model}</span> : null}
            </span>
          </button>
        ))}
      </section>
    </>
  )
}

const MODES: { mode: ScheduleMode; label: () => string }[] = [
  { mode: 'time', label: () => t('At a time') },
  { mode: 'interval', label: () => t('Every…') },
  { mode: 'once', label: () => t('Once') },
  { mode: 'custom', label: () => t('Custom') }
]

function JobEditor({
  job,
  bots,
  profile,
  host,
  loadTargets,
  onCancel,
  onSave
}: {
  job: CronJob | null
  bots: Bot[] | null
  profile: string | null
  /** Another combined dashboard the job is on (its models and delivery targets are read there); null for this one. */
  host: string | null
  loadTargets: (owner: string | undefined, host: string | null) => Promise<DeliveryTarget[]>
  onCancel: () => void
  onSave: (draft: JobDraft, original: JobDraft, owner: string | undefined) => Promise<void>
}) {
  const [original] = useState(() => (job ? jobDraftFrom(job) : newJobDraft()))
  const [draft, setDraft] = useState(original)
  const [owner, setOwner] = useState<string>(job?.profile ?? profile ?? 'default')
  const [targets, setTargets] = useState<DeliveryTarget[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadTargets(owner, host).then(list => live && setTargets(list))
    return () => {
      live = false
    }
  }, [owner, host, loadTargets])

  const catalog = useModelCatalog(useMemo(() => ({ profile: owner, explicit_only: true }), [owner]), { host })
  const modelValue = draft.provider || draft.model ? `${draft.provider}\n${draft.model}` : ''

  const schedule = draft.schedule
  const setSchedule = (patch: Partial<JobDraft['schedule']>) => setDraft(d => ({ ...d, schedule: { ...d.schedule, ...patch } }))
  const preview = previewSchedule(schedule)
  const choices = deliveryChoices(targets, draft.deliver)
  const target = choices.find(c => c.id === draft.deliver)
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
  const days = new Set(schedule.days)
  const preset = (list: number[]) => list.length === days.size && list.every(day => days.has(day))

  async function save() {
    if (saving || !canSave(draft)) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draft, original, owner)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <form
      className="job-editor"
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
    >
      <h1>{job ? t('Edit scheduled job') : t('New scheduled job')}</h1>
      {!job && !profile && (bots?.length ?? 0) > 1 ? (
        <label className="field">
          {t('Bot')}
          <Select value={owner} onChange={picked => setOwner(picked)}>
            {bots!.map(bot => (
              <option key={bot.name} value={bot.name}>
                {bot.title}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <label className="field">
        {t('Name')}
        <input value={draft.name} placeholder={t('Name, like Morning brief')} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} autoFocus />
      </label>
      <label className="field">
        {t('Prompt')}
        <textarea className="job-prompt-field" rows={5} value={draft.prompt} placeholder={t('What Hermes should do each time')} onChange={e => setDraft(d => ({ ...d, prompt: e.target.value }))} />
      </label>
      <fieldset className="field job-schedule">
        <legend>{t('Schedule')}</legend>
        <div className="segmented" role="radiogroup" aria-label={t('Repeats')}>
          {MODES.map(({ mode, label }) => (
            <button key={mode} type="button" role="radio" aria-checked={schedule.mode === mode} className={schedule.mode === mode ? 'on' : undefined} onClick={() => setSchedule({ mode })}>
              {label()}
            </button>
          ))}
        </div>
        {schedule.mode === 'time' ? (
          <>
            <label className="job-inline">
              {t('Time')}
              <input
                type="time"
                value={time}
                onChange={e => {
                  const [hour, minute] = e.target.value.split(':').map(Number)
                  if (Number.isInteger(hour) && Number.isInteger(minute)) setSchedule({ hour, minute })
                }}
              />
            </label>
            <div className="segmented">
              <button type="button" className={preset(EVERY_DAY) ? 'on' : undefined} onClick={() => setSchedule({ days: [...EVERY_DAY] })}>
                {t('Every day')}
              </button>
              <button type="button" className={preset(WEEKDAYS) ? 'on' : undefined} onClick={() => setSchedule({ days: [...WEEKDAYS] })}>
                {t('Weekdays')}
              </button>
              <button type="button" className={preset(WEEKENDS) ? 'on' : undefined} onClick={() => setSchedule({ days: [...WEEKENDS] })}>
                {t('Weekends')}
              </button>
            </div>
            <div className="job-days" role="group" aria-label={t('Days')}>
              {[1, 2, 3, 4, 5, 6, 0].map(day => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={days.has(day)}
                  onClick={() => setSchedule({ days: days.has(day) ? schedule.days.filter(d => d !== day) : [...schedule.days, day] })}
                >
                  {new Date(2000, 0, 2 + day).toLocaleDateString(locale(), { weekday: 'short' })}
                </button>
              ))}
            </div>
          </>
        ) : schedule.mode === 'interval' ? (
          <div className="job-inline">
            <input
              type="number"
              min={1}
              aria-label={t('Every…')}
              value={schedule.intervalValue}
              onChange={e => setSchedule({ intervalValue: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
            <Select aria-label={t('Unit')} value={schedule.intervalUnit} onChange={picked => setSchedule({ intervalUnit: picked as IntervalUnit })}>
              <option value="minutes">{t('Minutes')}</option>
              <option value="hours">{t('Hours')}</option>
              <option value="days">{t('Days')}</option>
            </Select>
          </div>
        ) : schedule.mode === 'once' ? (
          <label className="job-inline">
            {t('Runs at')}
            <input type="datetime-local" value={schedule.runAt} onChange={e => setSchedule({ runAt: e.target.value })} />
          </label>
        ) : (
          <>
            <input className="job-custom" value={schedule.custom} placeholder={t('0 9 * * 1 or every monday 9am')} onChange={e => setSchedule({ custom: e.target.value })} />
            <span className="meta">{t('A cron expression, or a phrase Hermes reads, like every 2h or weekdays at 9am.')}</span>
          </>
        )}
        <span className="meta">{preview ?? (schedule.mode === 'time' && !schedule.days.length ? t('Pick at least one day.') : schedule.mode === 'custom' && schedule.custom.trim() ? '' : t('Not a schedule yet.'))}</span>
      </fieldset>
      <label className="field">
        {t('Deliver to')}
        <Select value={draft.deliver} onChange={picked => setDraft(d => ({ ...d, deliver: picked }))}>
          {choices.map(choice => (
            <option key={choice.id} value={choice.id}>
              {deliveryTitle(choice.id, choice.name)}
            </option>
          ))}
        </Select>
        <span className="meta">
          {target && !target.homeTargetSet ? t('This platform has no home channel yet. Set one in Hermes, or the run is only saved.') : t('Each run is also saved as its own conversation.')}
        </span>
      </label>
      {draft.runsAgent ? (
        <div className="field job-model-field">
          <label>
            {t('Model')}
            <ModelChooser
              value={modelValue}
              providers={catalog.providers}
              defaultLabel={t('Profile default')}
              label={t('Model')}
              disabled={saving || !catalog.answered}
              onChange={next => {
                const [provider = '', model = ''] = next.split('\n')
                setDraft(d => ({ ...d, provider, model }))
              }}
              reasoning={{
                value: draft.reasoning,
                levels: REASONING_LEVELS,
                inheritLabel: t('Profile default'),
                onChange: reasoning => setDraft(d => ({ ...d, reasoning }))
              }}
            />
          </label>
          <div className="job-model-refresh">
            <ModelCatalogNote catalog={catalog} />
            <RefreshModelsButton catalog={catalog} />
          </div>
          <span className="meta">{t("Each run uses this model and reasoning. Profile default follows the profile's, so a change there reaches this job too.")}</span>
        </div>
      ) : null}
      {error ? <div className="error-text">{error}</div> : null}
      <div className="job-actions">
        <button type="submit" className="primary" disabled={saving || !canSave(draft)}>
          {saving ? t('Working…') : job ? t('Save') : t('Create')}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}
