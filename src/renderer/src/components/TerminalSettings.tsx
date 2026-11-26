import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { settingsPath } from '../state/terminals'

/**
 * Settings > Workspace & safety > Terminals (Eric, 2026-11-26, the coding
 * workspace's B): whether the workbench may open shells on this Hermes host.
 * It's the host's setting, for every profile and app; turning it off ends
 * every terminal running there. Hidden where the host can't run them (an
 * older plugin, Windows).
 */
export function TerminalSettings() {
  const [state, setState] = useState<{ enabled: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void gateway.http('GET', settingsPath).then(
      answer => {
        const row = answer as { enabled?: unknown; supported?: unknown } | null
        if (live && row && row.supported === true) setState({ enabled: row.enabled === true })
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [])
  if (!state) return null
  const change = async (enabled: boolean) => {
    setBusy(true)
    setFailed(null)
    try {
      const answer = (await gateway.http('POST', settingsPath, { enabled })) as { enabled?: unknown } | null
      setState({ enabled: answer?.enabled === true })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="pset-section">
      <h2>{t('Terminals')}</h2>
      <p className="meta">{t('The workbench beside a chat with a folder can open shells on this Hermes host, in that folder. This is for the whole host, every profile.')}</p>
      <div className="pset-row">
        <span>{t('Allow terminals')}</span>
        <label className="switch-inline">
          <input type="checkbox" checked={state.enabled} disabled={busy} aria-label={t('Allow terminals')} onChange={e => void change(e.target.checked)} />
        </label>
      </div>
      {state.enabled ? <p className="meta">{t('Turning terminals off ends every terminal running on this host.')}</p> : null}
      {failed ? <p className="error-text">{failed}</p> : null}
    </section>
  )
}
