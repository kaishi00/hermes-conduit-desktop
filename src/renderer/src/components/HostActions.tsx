import { useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  CHECK_PATH,
  canUpdateHere,
  dismissRestart,
  dismissUpdate,
  restartInProgress,
  startCheck,
  startRestart,
  startUpdate,
  updateInProgress,
  useHostActions,
  type RestartStage,
  type RestartState,
  type UpdateCheck,
  type UpdateState,
  type UpdateStep
} from '../state/hostActions'
import { ask } from '../state/dialogs'
import { GatewayWait } from './GatewayWait'

// Hermes' update check probes its checkout's git remotes and can take most of a minute (40 s on a real host).
const request = (method: 'GET' | 'POST', path: string) =>
  gateway.http(method, path, method === 'POST' ? {} : undefined, path.startsWith(CHECK_PATH) ? 90_000 : 30_000)

interface Row {
  title: string
  detail?: string
  /** The detail is Hermes' own log line, shown verbatim. */
  log?: boolean
  command?: string
  tone: 'busy' | 'good' | 'news' | 'warn' | 'bad'
}

function Status({ row, onDismiss }: { row: Row; onDismiss?: () => void }) {
  return (
    <div className={`host-status tone-${row.tone}`} role="status">
      <span className="host-status-mark" aria-hidden="true">
        {row.tone === 'busy' ? <span className="spinner" /> : row.tone === 'good' ? '✓' : row.tone === 'news' ? '↑' : '!'}
      </span>
      <div className="host-status-text">
        <strong>{row.title}</strong>
        {row.detail ? <div className={row.log ? 'meta host-log' : 'meta'}>{row.detail}</div> : null}
        {row.command ? <code className="host-command">{row.command}</code> : null}
      </div>
      {onDismiss && row.tone !== 'busy' ? (
        <button className="link" aria-label={t('Dismiss')} onClick={onDismiss}>
          ✕
        </button>
      ) : null}
    </div>
  )
}

const available = (check: UpdateCheck) =>
  check.sourceVersion ? t('Hermes {version} is available', { version: check.sourceVersion }) : t('An update is available')

function stepTitle(step: UpdateStep): string {
  if (step === 'starting') return t('Asking Hermes to update…')
  if (step === 'updating') return t('Updating Hermes…')
  return t('Hermes is restarting on the new version…')
}

function updateRow(state: UpdateState): Row | null {
  switch (state.kind) {
    case 'idle':
      return null
    case 'checking':
      return { title: t('Checking for updates…'), tone: 'busy' }
    case 'checked': {
      const check = state.check
      if (canUpdateHere(check)) return { title: available(check), tone: 'news' }
      // An install this dashboard can't update in place.
      if (check.updateAvailable) return { title: available(check), detail: check.message, command: check.updateCommand, tone: 'warn' }
      if (check.behind === undefined && !check.canApply && check.updateCommand)
        return { title: t('Update Hermes on the host'), detail: check.message, command: check.updateCommand, tone: 'warn' }
      if (check.behind === undefined) return { title: t("Couldn't check for updates"), detail: check.message, tone: 'warn' }
      return { title: t('Hermes is up to date'), detail: check.message, tone: 'good' }
    }
    case 'updating':
      return { title: stepTitle(state.step), detail: state.detail, log: true, tone: 'busy' }
    case 'updated':
      return { title: state.version ? t('Hermes updated to {version}', { version: state.version }) : t('Hermes updated'), tone: 'good' }
    case 'failed':
      return { title: t("Couldn't update Hermes"), detail: state.detail, log: true, tone: 'bad' }
    case 'checkFailed':
      return { title: t("Couldn't check for updates"), detail: state.detail, tone: 'warn' }
    case 'manual':
      return { title: t('Update Hermes on the host'), detail: state.message, command: state.command, tone: 'warn' }
    case 'notBackYet':
      return { title: t("Hermes isn't back yet"), detail: t('The update may still be running. Check for updates again in a few minutes.'), tone: 'warn' }
    case 'unsupported':
      return { title: t("This Hermes can't update from Conduit"), detail: t('Run hermes update on the host.'), tone: 'warn' }
  }
}

function stageTitle(stage: RestartStage): string {
  if (stage === 'draining') return t('Letting running tasks finish…')
  if (stage === 'starting') return t('Starting the gateway…')
  return t('Stopping the gateway…')
}

function restartRow(state: RestartState): Row | null {
  switch (state.kind) {
    case 'idle':
      return null
    case 'requesting':
      return { title: t('Asking Hermes to restart the gateway…'), tone: 'busy' }
    case 'restarting':
      return { title: stageTitle(state.stage), detail: state.detail, log: true, tone: 'busy' }
    case 'restarted':
      return {
        title: t('Gateway restarted'),
        detail: state.sharedProfiles.length ? t('Profiles on this gateway: {profiles}', { profiles: state.sharedProfiles.join(', ') }) : undefined,
        tone: 'good'
      }
    case 'failed':
      return { title: t("Couldn't restart the gateway"), detail: state.detail, log: true, tone: 'bad' }
    case 'failedToStart':
      return { title: t("The gateway didn't start"), detail: t('Run hermes gateway status on the host to see why.'), tone: 'bad' }
    case 'notBackYet':
      return {
        title: t("The gateway isn't back yet"),
        detail: t('It may still be finishing running tasks. Run hermes gateway status on the host to check.'),
        tone: 'warn'
      }
    case 'unsupported':
      return {
        title: t("This Hermes can't restart its gateway from Conduit"),
        detail: t('Update Hermes, or run hermes gateway restart on the host.'),
        tone: 'warn'
      }
  }
}

/**
 * Settings' Hermes version and Restart Gateway, after the phone's Settings >
 * Connection: the host's version, whether it's behind and what's new, Update
 * Hermes, Check for Updates, and Restart Gateway with each step as it lands.
 */
export function HostActions({ host, connected }: { host: string; connected: boolean }) {
  const { update, restart, version } = useHostActions(host)
  const busy = updateInProgress(update) || restartInProgress(restart) || !connected

  // Hermes answers from its cache, so opening Settings is cheap; an update's outcome stays.
  useEffect(() => {
    if (connected && ['idle', 'checked', 'checkFailed'].includes(update.kind)) void startCheck(host, request, false)
    // Once per host and connection.
  }, [host, connected])
  // Hermes back after an update that wasn't back yet checks again, so the version shows. A dismissed row stays dismissed.
  const previous = useRef(update.kind)
  useEffect(() => {
    const was = previous.current
    previous.current = update.kind
    if (connected && was === 'notBackYet' && update.kind === 'idle') void startCheck(host, request, false)
  }, [update.kind, host, connected])

  const check = update.kind === 'checked' ? update.check : null
  const row = updateRow(update)
  const restartShown = restartRow(restart)

  const confirmUpdate = async () => {
    const lines = [t("Hermes pulls the new version and restarts. Chats and messaging channels pause until it's back.")]
    if (check?.rollbackTo)
      lines.push(t('This host is newer than the {release} release; updating moves it back to that release.', { release: check.rollbackTo }))
    if (!(await ask(`${t('Update Hermes on your host?')}\n\n${lines.join('\n\n')}`, { confirm: t('Update Hermes') }))) return
    void startUpdate(host, request, t("Hermes can't update itself here."), () => void window.conduit.reconnect())
  }

  const confirmRestart = async () => {
    const text = `${t('Restart the gateway?')}\n\n${t(
      "Hermes restarts its gateway process. Messaging channels, running sessions and any profiles that share this gateway reconnect once it's back."
    )}`
    if (await ask(text, { confirm: t('Restart Gateway') })) void startRestart(host, request)
  }

  return (
    <>
      <dt>{t('Version')}</dt>
      <dd className="host-actions">
        {(check?.currentVersion ?? version) ? <div>{check?.currentVersion ?? version}</div> : null}
        {row ? <Status row={row} onDismiss={update.kind === 'checked' || update.kind === 'checking' ? undefined : () => dismissUpdate(host)} /> : null}
        {check && canUpdateHere(check) && check.commits.length ? (
          <div className="host-news">
            <div className="meta">{t("What's new")}</div>
            <ul>
              {check.commits.slice(0, 6).map(commit => (
                <li key={commit.sha} className="meta">
                  {commit.summary}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="pset-actions">
          {check && canUpdateHere(check) ? (
            <button className="primary" disabled={busy} onClick={confirmUpdate}>
              {t('Update Hermes')}
            </button>
          ) : null}
          <button className="secondary" disabled={busy} onClick={() => void startCheck(host, request, true)}>
            {t('Check for Updates')}
          </button>
        </div>
        <p className="meta settings-caption">
          {t("Update Hermes runs hermes update on your host. Hermes restarts on the new version, and Conduit reconnects when it's back.")}
        </p>
      </dd>
      <dt>{t('Gateway')}</dt>
      <dd className="host-actions">
        {restartShown ? <Status row={restartShown} onDismiss={() => dismissRestart(host)} /> : null}
        {restart.kind === 'restarting' && restart.stage === 'draining' ? <GatewayWait /> : null}
        <div className="pset-actions">
          <button className="secondary" disabled={busy} onClick={confirmRestart}>
            {t('Restart Gateway')}
          </button>
        </div>
      </dd>
    </>
  )
}
