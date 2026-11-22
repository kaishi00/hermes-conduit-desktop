import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { releaseUrl, type UpdateState } from '@shared/updates'

/**
 * Settings > App > Updates: this copy's version, where the update stands,
 * Check for Updates, Restart to Update once one is downloaded, and Install
 * updates automatically. The Store's copy and a Linux package only say who
 * updates them.
 */
export function UpdatesSetting() {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.conduit.updates.state().then(setState, () => undefined)
    return window.conduit.updates.onState(setState)
  }, [])
  if (!state) return null
  const version = state.version ?? ''
  const status =
    state.phase === 'checking'
      ? t('Checking for updates…')
      : state.phase === 'none'
        ? t('Conduit is up to date')
        : state.phase === 'available'
          ? t('Version {version} is available', { version })
          : state.phase === 'downloading'
            ? t('Downloading version {version}… {percent}%', { version, percent: state.percent ?? 0 })
            : state.phase === 'ready'
              ? t('Version {version} is ready to install', { version })
              : state.phase === 'error'
                ? t("Couldn't check for updates")
                : state.phase === 'download-failed'
                  ? t('Couldn’t download version {version}', { version })
                  : null
  return (
    <>
      <dt>{t('Updates')}</dt>
      <dd className="updates-setting">
        <p>
          {t('Version {version}', { version: state.current })}
          {status && !state.off ? <span className="meta"> · {status}</span> : null}
        </p>
        {state.off === 'store' ? (
          <p className="meta">{t('The Microsoft Store keeps this copy up to date.')}</p>
        ) : state.off === 'linux-package' ? (
          <p className="meta">{t('This copy updates with the package manager it came from.')}</p>
        ) : state.off ? null : (
          <>
            <div className="updates-actions">
              {state.phase === 'ready' ? (
                <button className="primary" onClick={() => window.conduit.updates.install()}>
                  {t('Restart to Update')}
                </button>
              ) : state.phase === 'available' || state.phase === 'download-failed' ? (
                <button className="primary" onClick={() => void window.conduit.updates.download()}>
                  {state.phase === 'download-failed' ? t('Try Again') : t('Download')}
                </button>
              ) : (
                <button disabled={state.phase === 'checking' || state.phase === 'downloading'} onClick={() => void window.conduit.updates.check().then(setState, () => undefined)}>
                  {state.phase === 'error' ? t('Try Again') : t('Check for Updates')}
                </button>
              )}
              {version && (state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'download-failed') ? (
                <a href={releaseUrl(version)} target="_blank" rel="noreferrer">
                  {t('What’s new in {version}', { version })}
                </a>
              ) : null}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={state.auto} onChange={e => void window.conduit.updates.setAuto(e.target.checked).then(setState, () => undefined)} />
              {t('Install updates automatically')}
            </label>
            <p className="meta">{t('Conduit checks for a new version when it opens and every few hours, then installs it the next time you quit.')}</p>
          </>
        )}
      </dd>
    </>
  )
}
