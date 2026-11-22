import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { ConnectionStatus, ScreenWindowRequest } from '@shared/ipc'
import { BotScreen } from './BotScreen'
import { screenWindowHash, screenWindowRequest } from '@shared/screenWindows'

/**
 * A bot's screen in a window of its own (Eric, 2026-11-21): the main
 * window's chat, its text and its tool output stay in view while the
 * screen is watched or driven. Done closes the window; a sign-out or a
 * lock closes it too, and another dashboard closes it from the main process.
 */
export function ScreenWindow({ screen }: { screen: ScreenWindowRequest }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])
  useEffect(() => {
    document.title = t("{name}'s Screen", { name: screen.botName })
  }, [screen.botName])
  useEffect(() => {
    if (status && (status.phase === 'locked' || status.phase === 'signed-out' || !status.url)) window.close()
  }, [status])
  return (
    <div className="screen-window-page">
      {/* Kept through a reconnect, as in the main window, so a takeover isn't handed back by a dropped socket. */}
      {status?.url ? (
        <BotScreen
          profile={screen.profile}
          botName={screen.botName}
          viewerId={screen.viewerId}
          host={screen.host}
          onViewer={viewerId => {
            if (screenWindowRequest(window.location.hash)?.viewerId !== viewerId)
              window.history.replaceState(null, '', screenWindowHash({ ...screen, viewerId }))
          }}
          onClose={() => window.close()}
        />
      ) : null}
    </div>
  )
}
