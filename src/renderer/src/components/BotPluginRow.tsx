import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { botPluginPath, botPluginState, offersTurnOn, turnOnBotPlugin, type BotPluginState } from '../state/botPlugin'

/**
 * Edit Bot's Turn On, after the phone's (hermes-conduit issue 2803): shown
 * only for a bot whose profile has the Conduit plugin off, and gone once
 * it's on. An older plugin, or none, shows nothing.
 */
export function BotPluginRow({ bot, botName }: { bot: string; botName: string }) {
  const [state, setState] = useState<BotPluginState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setState(null)
    // A dropped read is tried again, so the row isn't lost while Edit Bot is open.
    const delays = [3_000, 10_000, 30_000]
    const read = () => {
      gateway
        .http('GET', botPluginPath(bot), undefined, 30_000)
        .then(body => live && setState(botPluginState(body)))
        .catch(() => {
          const delay = delays.shift()
          if (live && delay !== undefined) timer = setTimeout(read, delay)
        })
    }
    read()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [bot])

  if (!offersTurnOn(state)) return null

  const turnOn = async () => {
    setBusy(true)
    setError(null)
    const failure = await turnOnBotPlugin(gateway.http, bot)
    setBusy(false)
    if (failure) setError(failure)
    else setState(current => (current ? { ...current, on: true } : current))
  }

  return (
    <section className="pset-section">
      <p className="meta">{t("The Conduit plugin is off for {name}, so its notifications, group rooms, Folder and cards don't work.", { name: botName })}</p>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="pset-row">
        <button className="secondary" onClick={() => void turnOn()} disabled={busy}>
          {t('Turn On')}
        </button>
      </div>
    </section>
  )
}
