import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { t } from '@shared/i18n'
import type { PluginRelease } from '@shared/ipc'
import { gateway } from '../gateway'
import {
  FEATURES,
  HOST_FOLLOW_LIMIT_MS,
  REPOSITORY,
  SELF_UPDATE_PATH,
  STATUS_PATH,
  selfUpdatePath,
  STEP_COUNT,
  canUpdateHere,
  jobState,
  parseChangelog,
  pluginStatus,
  releaseNotes,
  restartPending,
  runningVersion,
  serves,
  stepNumber,
  updateAvailable,
  type ChangeKind,
  type PluginStatus,
  type UpdateState,
  type UpdateStep
} from '../state/plugin'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const httpCode = (e: unknown) => (e as { code?: unknown })?.code

/** The update outlives the page: leaving Settings and coming back shows where it stands. */
let update: UpdateState = { phase: 'idle' }
let startedAt = 0
let running = false
const listeners = new Set<() => void>()
const setUpdate = (next: UpdateState) => {
  update = next
  listeners.forEach(l => l())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function readStatus(): Promise<PluginStatus> {
  try {
    return pluginStatus(await gateway.http('GET', STATUS_PATH))
  } catch (e) {
    return httpCode(e) === 404 ? { state: 'missing' } : { state: 'unknown' }
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Hands the update to the host and follows its job, as the phone's runOnHost does. */
async function runUpdate(onDone: () => void, acceptScan = false) {
  if (running) return
  running = true
  startedAt = Date.now()
  setUpdate({ phase: 'updating', step: 'downloading' })
  try {
    let job: Record<string, unknown> | null = null
    try {
      const started = (await gateway.http('POST', selfUpdatePath(acceptScan))) as { job?: Record<string, unknown> }
      job = started?.job ?? null
    } catch (e) {
      // No answer may still have started it: follow one that runs.
      const code = httpCode(e)
      if (code !== undefined && code !== 0) return setUpdate({ phase: 'failed', detail: message(e) })
      const probe = (await gateway.http('GET', SELF_UPDATE_PATH).catch(() => null)) as { job?: Record<string, unknown> } | null
      job = probe?.job ?? null
    }
    const id = job?.id
    if (!job || typeof id !== 'string') return setUpdate({ phase: 'failed', detail: null })
    for (;;) {
      const state = jobState(job)
      if (state && state.phase !== 'updating') return setUpdate(state)
      if (state) setUpdate(state)
      if (Date.now() - startedAt > HOST_FOLLOW_LIMIT_MS) return setUpdate({ phase: 'runningOnHost' })
      await pause(2000)
      // Reads fail while the dashboard restarts; the next poll asks again.
      let latest: { job?: Record<string, unknown> } | null
      try {
        latest = (await gateway.http('GET', SELF_UPDATE_PATH)) as { job?: Record<string, unknown> }
      } catch {
        continue
      }
      if (!latest?.job || latest.job.id !== id) {
        // The restarted dashboard lost the job: its report says where it stands.
        const status = await readStatus()
        return setUpdate(
          status.state === 'reported' && !status.restartNeeded
            ? { phase: 'updated', version: status.loadedVersion ?? status.version }
            : { phase: 'needsDashboardRestart', detail: null }
        )
      }
      job = latest.job
    }
  } finally {
    running = false
    onDone()
  }
}

function featureTitle(id: string): string {
  switch (id) {
    case 'chatTakeover':
      return t('Taking chats over from Hermes Desktop')
    case 'savedCalls':
      return t('Saved voice calls')
    case 'liveVoiceContext':
      return t('Memory, personality and web search in live voice')
    case 'geminiLive':
      return t('Gemini Live')
    case 'qwenLive':
      return t('Qwen Live')
    case 'gptLive':
      return t('GPT-Live')
    case 'grokLive':
      return t('Grok Live')
    case 'encryptedNotifications':
      return t('Encrypted notifications')
    case 'pairing':
      return t('Pairing from Conduit')
    case 'hermesCalls':
      return t('Calls from Hermes')
    case 'agentSettings':
      return t('Let Hermes change settings')
    case 'healthSync':
      return t('Health data')
    default:
      return t('Updates from Conduit')
  }
}

function stepTitle(step: UpdateStep, chats = 1): string {
  switch (step) {
    case 'downloading':
      return t('Downloading the plugin…')
    case 'draining':
      return t('Letting running tasks finish…')
    case 'restartingGateway':
      return t('Restarting the gateway…')
    case 'waitingForChats':
      return t('Waiting for {count} running chats to finish…', { count: String(chats) })
    default:
      return t('Restarting the dashboard…')
  }
}

function degradedText(code: string): string {
  if (code === 'workstream-recovery')
    return t(
      "A workstream that a Hermes restart stops stays interrupted instead of picking up again, because the plugin couldn't find how this Hermes stops its turns."
    )
  if (code === 'workspace-files') return t("The Folder is closed: Hermes couldn't say which folder it keeps files in. Check the files settings on the host.")
  return t("The plugin reports a limit on this host that this version of Conduit doesn't know ({code}).", { code })
}

const kindTitle = (kind: ChangeKind) => (kind === 'security' ? t('Security fixes') : kind === 'fixes' ? t('Fixes') : t('New and improved'))

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Settings > Conduit plugin, after the phone's: the version, what an update brings, Update, and what the plugin does here. */
export function ConduitPluginPage({ onBack }: { onBack: () => void }) {
  useMouseBack(onBack)
  const [status, setStatus] = useState<PluginStatus>({ state: 'unknown' })
  const [checking, setChecking] = useState(true)
  const [release, setRelease] = useState<PluginRelease>({ version: null, changelog: null })
  const [confirming, setConfirming] = useState(false)
  const [showsCommands, setShowsCommands] = useState(false)
  const [, tick] = useState(0)
  const current = useSyncExternalStore(subscribe, () => update)

  const refresh = useCallback(async () => {
    setChecking(true)
    setStatus(await readStatus())
    setChecking(false)
  }, [])
  useEffect(() => {
    // A held scan's Update Anyway belongs to the host that held it: after a switch to another
    // dashboard (or a job that has since moved on) the row would force an update there unseen.
    // Only the host's answer clears it; a read that fails leaves it as it was.
    const held = update
    if (held.phase !== 'scanHeld') return
    void gateway
      .http('GET', SELF_UPDATE_PATH)
      .then(r => {
        const id = (r as { job?: { id?: unknown } })?.job?.id
        if (update === held && (!held.id || id !== held.id)) setUpdate({ phase: 'idle' })
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    void refresh()
    window.conduit
      .pluginRelease()
      .then(setRelease)
      .catch(() => undefined)
  }, [refresh])
  useEffect(() => {
    if (current.phase !== 'updating') return
    const timer = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(timer)
  }, [current.phase])
  useEffect(() => {
    // No plugin, or an update the host couldn't run: the steps open by themselves.
    if (status.state === 'missing' || current.phase === 'failed') setShowsCommands(true)
  }, [status.state, current.phase])

  const latest = release.version
  const available = updateAvailable(status, latest)
  const restart = restartPending(status)
  const managed = status.state === 'reported' && status.managedBy !== null
  const running = runningVersion(status)
  const notes =
    available && latest ? releaseNotes(parseChangelog(release.changelog), running ?? (status.state === 'reported' ? status.version : null), latest) : null
  const canUpdate = canUpdateHere(status)
  const showsAction = current.phase !== 'updating' && (available || restart)

  const statusText = (() => {
    if (status.state === 'unknown')
      return checking ? t("Checking this dashboard's notifier…") : t("Couldn't reach this dashboard's notifier. Open this page again to retry.")
    if (status.state === 'missing')
      return t("Missing or out of date on this dashboard's host, so features like taking chats over from Hermes Desktop won't work.")
    if (available && latest) return t('Version {version} is available.', { version: latest })
    if (restart) return t('The new plugin is on the host. Hermes needs a restart to use it.')
    if (managed)
      return status.managedBy ? t('{name} keeps the plugin up to date.', { name: status.managedBy }) : t("This dashboard's host keeps the plugin up to date.")
    return t("Up to date on this dashboard's host")
  })()

  const confirmText = managed
    ? t('The new plugin is already on the host. Hermes restarts its gateway and dashboard to run it, once running chats finish.')
    : t(
        "Hermes updates the plugin on the host, then restarts its gateway and dashboard once running chats finish. You can close Conduit: you'll get a notification when it's done."
      )

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Conduit plugin')}</h1>
      </div>
      <p className="meta">
        {t("The plugin on your Hermes host serves Conduit's notifications, live voice, calls from Hermes and more. Each dashboard's host has its own copy.")}
      </p>

      <section className="pset-section">
        <div className="pset-row">
          <span>{t('Version')}</span>
          <span className={available || restart ? 'plugin-version attention' : 'plugin-version meta'}>{running ?? '—'}</span>
        </div>
        <p className="meta">{statusText}</p>
        {status.state === 'reported'
          ? status.degraded.map(code => (
              <p key={code} className="plugin-degraded">
                ⚠ {degradedText(code)}
              </p>
            ))
          : null}
        {notes ? (
          <>
            {notes.released || notes.security ? (
              <p className={notes.security ? 'plugin-degraded' : 'meta'}>
                {[notes.released ? t('Released {day}', { day: formatDay(notes.released) }) : null, notes.security ? t('Includes security fixes') : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            {notes.changes.length ? (
              <details className="plugin-notes">
                <summary>{t("What's new in {version}", { version: notes.version })}</summary>
                {(['security', 'fixes', 'new'] as ChangeKind[]).map(kind => {
                  const items = notes.changes.filter(c => c.kind === kind)
                  if (!items.length) return null
                  return (
                    <div key={kind} className={`plugin-kind ${kind}`}>
                      <h3>{kindTitle(kind)}</h3>
                      <ul>
                        {items.map((change, index) => (
                          <li key={`${change.version}-${index}`}>
                            <span className="meta">{change.version}</span> {change.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </details>
            ) : null}
          </>
        ) : null}
        {showsAction ? (
          <>
            {confirming ? (
              <div className="plugin-confirm">
                <p>
                  <strong>{managed || (restart && !available) ? t('Finish the update?') : t('Update the Conduit plugin?')}</strong>
                </p>
                <p className="meta">{confirmText}</p>
                <div className="pset-actions">
                  <button className="secondary" onClick={() => setConfirming(false)}>
                    {t('Cancel')}
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      setConfirming(false)
                      void runUpdate(() => void refresh())
                    }}
                  >
                    {managed || (restart && !available) ? t('Restart Hermes') : t('Update and Restart Hermes')}
                  </button>
                </div>
              </div>
            ) : (
              <button className="primary" disabled={!canUpdate} onClick={() => setConfirming(true)}>
                {restart && !available ? t('Finish Update') : t('Update to {version}', { version: latest ?? '' })}
              </button>
            )}
            {!canUpdate ? <p className="meta">{t('Update Hermes, or run the commands under Do it manually.')}</p> : null}
          </>
        ) : null}
        <UpdateRow
          state={current}
          onDismiss={() => setUpdate({ phase: 'idle' })}
          onAcceptScan={canUpdate ? () => void runUpdate(() => void refresh(), true) : null}
        />
      </section>

      {status.state === 'reported' ? (
        <section className="pset-section">
          <h2>{t('What it does here')}</h2>
          <ul className="plugin-features">
            {FEATURES.map(feature => {
              const served = serves(status, feature.capabilities)
              return (
                <li key={feature.id} className={served ? 'on' : undefined}>
                  <span aria-hidden="true">{served ? '✓' : '–'}</span>
                  <span>{featureTitle(feature.id)}</span>
                  <span className="meta">{served ? t('Supported') : managed ? t('Not on this host') : t('Update needed')}</span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {!managed ? (
        <section className="pset-section">
          <h2>{t('Do it manually')}</h2>
          <details open={showsCommands} onToggle={e => setShowsCommands((e.target as HTMLDetailsElement).open)}>
            <summary className="meta">{t("Run these on the dashboard's host when Conduit can't update it, such as on an older Hermes.")}</summary>
            <ol className="plugin-commands">
              <li>
                <span>{status.state === 'missing' ? t('Install the notifier') : t('Update the notifier')}</span>
                <code>{status.state === 'missing' ? `hermes plugins install ${REPOSITORY} --enable` : 'hermes plugins update conduit_push'}</code>
              </li>
              <li>
                <span>{t('Restart the gateway')}</span>
                <code>hermes gateway restart</code>
              </li>
            </ol>
            <p className="meta">{t('Then restart the Hermes dashboard, so it serves the new plugin.')}</p>
          </details>
        </section>
      ) : null}
    </div>
  )
}

function UpdateRow({ state, onDismiss, onAcceptScan }: { state: UpdateState; onDismiss: () => void; onAcceptScan: (() => void) | null }) {
  if (state.phase === 'idle') return null
  let title: string
  let detail: string | null = null
  let tone = ''
  switch (state.phase) {
    case 'updating':
      title = stepTitle(state.step, state.chats)
      break
    case 'updated':
      title = state.version ? t('Conduit plugin {version} is ready', { version: state.version }) : t('The Conduit plugin is up to date')
      tone = 'ok'
      break
    case 'needsDashboardRestart':
      title = t('Restart the Hermes dashboard to finish')
      detail = state.detail
        ? `${t('The gateway restarted and runs the new plugin. Only the dashboard still runs the old one.')} ${state.detail}`
        : t('The new plugin is on the host, and only the dashboard still runs the old one. Restart the dashboard on the host once.')
      tone = 'warn'
      break
    case 'failed':
      title = t("Couldn't update the Conduit plugin")
      detail = state.detail
      tone = 'bad'
      break
    case 'scanHeld': {
      title = t('Hermes held the update for your OK')
      const notShown = state.count - state.findings.length
      detail = [
        state.count
          ? t("Hermes' install scan on the host asks you to confirm this update. Findings: {count}", { count: String(state.count) })
          : t("Hermes' install scan on the host asks you to confirm this update."),
        ...state.findings.map(line => `• ${line}`),
        notShown > 0 ? t('Not shown here: {count}', { count: String(notShown) }) : null,
        t("An older Hermes' scan often flags the plugin's own tests. Update Anyway accepts the scan for this update only; updating Hermes clears it for good.")
      ]
        .filter(Boolean)
        .join('\n')
      tone = 'warn'
      break
    }
    default:
      title = t('Still updating on the host')
      detail = t("The update is still running on the host. You'll get a notification when it's done.")
  }
  return (
    <div className={`plugin-update ${tone}`} role="status">
      <div className="plugin-update-text">
        <strong>{title}</strong>
        {state.phase === 'updating' ? (
          <>
            <progress max={STEP_COUNT} value={stepNumber(state.step)} />
            <span className="meta">
              {t('Step {current} of {last} · {time}', {
                current: String(stepNumber(state.step)),
                last: String(STEP_COUNT),
                time: elapsed(Date.now() - startedAt)
              })}
            </span>
          </>
        ) : null}
        {detail ? <span className={state.phase === 'scanHeld' ? 'meta plugin-scan-findings' : 'meta'}>{detail}</span> : null}
      </div>
      {state.phase === 'scanHeld' && onAcceptScan ? (
        <button className="primary" onClick={onAcceptScan}>
          {t('Update Anyway')}
        </button>
      ) : null}
      {state.phase !== 'updating' ? (
        <button className="staged-remove" aria-label={t('Dismiss')} title={t('Dismiss')} onClick={onDismiss}>
          ×
        </button>
      ) : null}
    </div>
  )
}
