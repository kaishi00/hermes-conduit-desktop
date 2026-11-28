import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { PluginRelease } from '@shared/ipc'
import {
  FEATURES,
  REPOSITORY,
  STEP_COUNT,
  canUpdateHere,
  parseChangelog,
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
import { GatewayWait } from './GatewayWait'
import { useMouseBack } from '../state/mouseBack'
import { currentUpdate, readStatus, runUpdate, setUpdate, updateStartedAt, useUpdateRow } from '../state/pluginUpdate'
import { dashboardHost } from '../state/dashboardProfile'
import { hostName } from '../state/hostNames'
import { keptStateLabel, useKeptHosts } from '../state/keptHosts'
import {
  dismissHostUpdate,
  forgetHostPluginRows,
  hostUpdateRunning,
  readHostPlugin,
  runHostUpdate,
  useHostPluginRows,
  type HostPluginRow
} from '../state/otherHostsPluginUpdate'
import type { KeptHost } from '@shared/ipc'

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
  // A row from another dashboard, or a held scan whose job moved on, goes (desktop#289, #318).
  const current = useUpdateRow()

  const refresh = useCallback(async () => {
    setChecking(true)
    setStatus(await readStatus())
    setChecking(false)
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
                      void runUpdate(() => void refresh(), false, latest)
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
          capabilities={status.state === 'reported' ? status.capabilities : null}
          onDismiss={() => setUpdate({ phase: 'idle' })}
          onAcceptScan={canUpdate ? () => void runUpdate(() => void refresh(), true, latest) : null}
        />
      </section>

      <OtherDashboards
        latest={latest}
        thisNeedsUpdate={canUpdate && current.phase !== 'updating' && current.phase !== 'scanHeld' && (available || restart)}
        onUpdateThis={() => void runUpdate(() => void refresh(), false, latest)}
      />

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

function UpdateRow({
  state,
  capabilities,
  onDismiss,
  onAcceptScan,
  startedAt = updateStartedAt(),
  showsWait = true
}: {
  state: UpdateState
  /** The plugin's, read when the page opened: the wait's list needs it to name the work (0.135+). */
  capabilities: string[] | null
  onDismiss: () => void
  onAcceptScan: (() => void) | null
  /** When the run started: this dashboard's, unless another dashboard's row says. */
  startedAt?: number
  /** The running-work list and Restart Now under the drain step: this dashboard's only. */
  showsWait?: boolean
}) {
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
            {state.step === 'draining' && showsWait ? <GatewayWait capabilities={capabilities} /> : null}
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

/** Whether a row's plugin waits on an update or its restart, and Conduit can run it there. */
function hostNeedsUpdate(row: HostPluginRow, latest: string | null): boolean {
  return canUpdateHere(row.status) && (updateAvailable(row.status, latest) || restartPending(row.status))
}

/**
 * The other combined dashboards' plugins, each with its version and Update, and Update All for every
 * dashboard that needs one, this one included: no switch to update each (Eric, 2026-11-28).
 */
function OtherDashboards({ latest, thisNeedsUpdate, onUpdateThis }: { latest: string | null; thisNeedsUpdate: boolean; onUpdateThis: () => void }) {
  const own = dashboardHost()
  const kept = useKeptHosts(own).filter(h => h.url !== own)
  const rows = useHostPluginRows()
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [, tick] = useState(0)
  const live = kept.filter(h => h.state === 'live').map(h => h.url)
  const liveKey = live.join('\n')
  useEffect(() => {
    // Asked on every visit, and as each one connects; a run going reads it when it ends.
    for (const host of liveKey ? liveKey.split('\n') : []) if (!hostUpdateRunning(host)) void readHostPlugin(host)
  }, [liveKey])
  const keptKey = kept.map(h => h.url).join('\n')
  useEffect(() => forgetHostPluginRows(keptKey ? keptKey.split('\n') : []), [keptKey])
  const anyRunning = kept.some(h => rows.get(h.url)?.update.phase === 'updating')
  useEffect(() => {
    if (!anyRunning) return
    const timer = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(timer)
  }, [anyRunning])
  if (!kept.length) return null
  const due = live.filter(host => {
    const row = rows.get(host)
    // A held scan waits on its own Update Anyway.
    return !!row && row.update.phase !== 'updating' && row.update.phase !== 'scanHeld' && hostNeedsUpdate(row, latest)
  })
  const allCount = due.length + (thisNeedsUpdate ? 1 : 0)
  return (
    <section className="pset-section">
      <h2>{t('Other dashboards')}</h2>
      <p className="meta">{t('Your combined dashboards, each with its own copy of the plugin. Update them here without switching.')}</p>
      {kept.map(host => (
        <OtherDashboardRow key={host.url} host={host} row={rows.get(host.url)} latest={latest} />
      ))}
      {allCount > 1 ? (
        confirmingAll ? (
          <div className="plugin-confirm">
            <p>
              <strong>{t('Update the plugin on every dashboard that needs it?')}</strong>
            </p>
            <p className="meta">
              {t(
                "Each host updates its plugin, then restarts its gateway and dashboard once running chats finish. You'll get a notification as each one is done."
              )}
            </p>
            <div className="pset-actions">
              <button className="secondary" onClick={() => setConfirmingAll(false)}>
                {t('Cancel')}
              </button>
              <button
                className="primary"
                onClick={() => {
                  setConfirmingAll(false)
                  // This dashboard's run only when nothing has started it meanwhile.
                  if (thisNeedsUpdate && currentUpdate().phase !== 'updating') onUpdateThis()
                  for (const host of due) void runHostUpdate(host, false, latest)
                }}
              >
                {t('Update All')}
              </button>
            </div>
          </div>
        ) : (
          <button className="primary" onClick={() => setConfirmingAll(true)}>
            {t('Update All ({count})', { count: String(allCount) })}
          </button>
        )
      ) : null}
    </section>
  )
}

function OtherDashboardRow({ host, row, latest }: { host: KeptHost; row: HostPluginRow | undefined; latest: string | null }) {
  const [confirming, setConfirming] = useState(false)
  const status = row?.status ?? { state: 'unknown' as const }
  const update = row?.update ?? { phase: 'idle' as const }
  const available = updateAvailable(status, latest)
  const restart = restartPending(status)
  const running = runningVersion(status)
  const canUpdate = host.state === 'live' && canUpdateHere(status)
  const showsAction = update.phase !== 'updating' && update.phase !== 'scanHeld' && (available || restart)
  const line = (() => {
    if (host.state !== 'live') return keptStateLabel(host.state)
    if (status.state === 'unknown') return row?.checking ? t("Checking this dashboard's notifier…") : t("Couldn't reach this dashboard's notifier.")
    if (status.state === 'missing') return t('Missing or out of date on this host. Open this dashboard to install it.')
    if (available && latest) return t('Version {version} is available.', { version: latest })
    if (restart) return t('The new plugin is on the host. Hermes needs a restart to use it.')
    if (status.managedBy !== null)
      return status.managedBy ? t('{name} keeps the plugin up to date.', { name: status.managedBy }) : t("This dashboard's host keeps the plugin up to date.")
    return t('Up to date')
  })()
  return (
    <div className="plugin-host">
      <div className="pset-row">
        <span>{hostName(host.url)}</span>
        <span className={available || restart ? 'plugin-version attention' : 'plugin-version meta'}>{running ?? '—'}</span>
      </div>
      <p className="meta">{line}</p>
      {showsAction ? (
        confirming ? (
          <div className="plugin-confirm">
            <p>
              <strong>{restart && !available ? t('Finish the update?') : t('Update the Conduit plugin?')}</strong>
            </p>
            <p className="meta">
              {t(
                "Hermes updates the plugin on the host, then restarts its gateway and dashboard once running chats finish. You can close Conduit: you'll get a notification when it's done."
              )}
            </p>
            <div className="pset-actions">
              <button className="secondary" onClick={() => setConfirming(false)}>
                {t('Cancel')}
              </button>
              <button
                className="primary"
                onClick={() => {
                  setConfirming(false)
                  void runHostUpdate(host.url, false, latest)
                }}
              >
                {restart && !available ? t('Restart Hermes') : t('Update and Restart Hermes')}
              </button>
            </div>
          </div>
        ) : (
          <button className="secondary" disabled={!canUpdate} onClick={() => setConfirming(true)}>
            {restart && !available ? t('Finish Update') : t('Update to {version}', { version: latest ?? '' })}
          </button>
        )
      ) : null}
      {showsAction && host.state === 'live' && status.state === 'reported' && !canUpdate ? (
        <p className="meta">{t('Update Hermes, or run the commands under Do it manually.')}</p>
      ) : null}
      <UpdateRow
        state={update}
        capabilities={null}
        startedAt={row?.startedAt ?? 0}
        showsWait={false}
        onDismiss={() => dismissHostUpdate(host.url)}
        onAcceptScan={canUpdate ? () => void runHostUpdate(host.url, true, latest) : null}
      />
    </div>
  )
}
