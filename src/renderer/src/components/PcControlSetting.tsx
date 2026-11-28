import { t } from '@shared/i18n'
import type { PcControlState } from '@shared/ipc'
import { pcAllowed } from '@shared/pcControl'

/**
 * Settings › Control from Hermes: bots drive this computer from wherever
 * their Hermes runs (main/pcControl.ts). Off until turned on here, which
 * downloads the driver (Eric 2026-11-27: not everyone wants it); only the
 * bots ticked here can ask; each chat asks first; Stop is on the bar and
 * here. Turning it off can delete the driver too.
 */
export function PcControlSetting({ state, bots, host }: { state: PcControlState | null; bots: readonly { name: string; title: string }[]; host: string }) {
  if (!state || state.driver === 'unsupported') return null
  const set = (change: Partial<PcControlState> & { bot?: { name: string; host: string; on: boolean } }) =>
    void window.conduit.pcControl.set(change).catch(() => undefined)
  // Ticks are kept per dashboard (desktop issue 729): this dashboard's bots, not same-named ones elsewhere.
  const toggleBot = (name: string, on: boolean) => host && set({ bot: { name, host, on } })
  const ticked = bots.filter(bot => pcAllowed(state.bots, host, bot.name))
  return (
    <section className="settings-group">
      <h2>{t('Control from Hermes')}</h2>
      <dl className="settings-card pc-control-setting">
        <dt>{t('Let bots control this computer')}</dt>
        <dd>
          <label className="toggle">
            <input type="checkbox" checked={state.on} onChange={e => set({ on: e.target.checked })} />
            {t('Bots you pick can see this screen, click and type, wherever their Hermes runs')}
          </label>
          <p className="meta">{t('Each chat asks you here first. A bar on top of your screen shows while a bot is in control, with Stop ({keys}).', { keys: state.platform === 'mac' ? '⌘⌥⇧S' : 'Ctrl+Alt+Shift+S' })}</p>
          {state.on && state.driver === 'downloading' && <p className="meta">{t('Downloading the driver… {percent}%', { percent: Math.round(state.progress * 100) })}</p>}
          {state.on && (state.driver === 'failed' || state.driver === 'missing') && (
            <p className="meta">
              {t('The driver couldn’t be downloaded.')} <button onClick={() => void window.conduit.pcControl.install()}>{t('Try Again')}</button>
            </p>
          )}
          {!state.on && state.driver === 'ready' && (
            <p className="meta">
              {t('The driver is still downloaded.')} <button onClick={() => void window.conduit.pcControl.deleteDriver()}>{t('Delete It')}</button>
            </p>
          )}
          {state.active && (
            <p className="meta">
              {t('{bot} is controlling this computer', { bot: state.active.bot })}
              {state.active.host ? ` · ${state.active.host}` : ''} <button onClick={() => window.conduit.pcControl.stop()}>{t('Stop')}</button>
            </p>
          )}
        </dd>
        {state.on && (
          <>
            <dt>{t('This computer’s name')}</dt>
            <dd>
              <input
                type="text"
                defaultValue={state.name}
                placeholder={state.shownName}
                maxLength={64}
                aria-label={t('This computer’s name')}
                onBlur={e => e.target.value !== state.name && set({ name: e.target.value.trim() })}
              />
              <p className="meta">{t('Bots use it to tell your computers apart.')}</p>
            </dd>
            <dt>{t('Bots allowed')}</dt>
            <dd>
              {bots.map(bot => (
                <label key={bot.name} className="toggle">
                  <input type="checkbox" checked={pcAllowed(state.bots, host, bot.name)} onChange={e => toggleBot(bot.name, e.target.checked)} />
                  {bot.title || bot.name}
                </label>
              ))}
              {!ticked.length && <p className="meta">{t('No bot can ask until you tick one.')}</p>}
              <p className="meta">{t('Ticks count on this dashboard only.')}</p>
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}
