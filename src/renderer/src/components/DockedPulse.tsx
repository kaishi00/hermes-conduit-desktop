import { useEffect, useState } from 'react'
import type { ConnectionStatus } from '@shared/ipc'
import { dockedPulseUrl } from '@shared/chatWindows'
import { useBots } from '../state/useBots'
import { usePulse } from '../state/usePulse'
import { PulsePage } from './PulsePage'

/**
 * Another combined dashboard's Pulse feed, in a frame on the main window's
 * Pulse page when its chip is picked (Pulse keeps a feed per dashboard; the
 * phone's no-switch stage 2): its cards, Why?, Do it, Done, Not now, thumbs,
 * settings and what it learned, all on that dashboard's kept connection, with
 * no switch. A card's chat opens docked in the main window's chat pane; a
 * card from no chat starts a new chat there in its profile.
 */
export function DockedPulse() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])
  const host = status?.url ?? ''
  const pulse = usePulse(status?.phase === 'open', true)
  // That dashboard's bots, hidden ones too, so its Pulse settings name the profile Pulse runs in by its bot's title.
  const roster = useBots(status?.phase === 'open', host, { withSessions: false })
  if (!host) return <div className="chat-window-page" />
  return (
    <div className="chat-window-page">
      <PulsePage
        pulse={pulse}
        onOpenChat={(target, draft) =>
          window.conduit.openChat({
            storedId: target.id ?? '',
            profile: target.profile,
            title: target.title,
            host,
            ...(draft ? { draft } : {}),
            ...(target.id ? {} : { fresh: true })
          })
        }
        bots={[...(roster.bots ?? []), ...roster.hidden]}
        connected={status?.phase === 'open'}
      />
    </div>
  )
}

/** The frame the main window's Pulse page shows another dashboard's feed in; the parent keys it by dashboard. */
export function DockedPulseFrame({ host }: { host: string }) {
  return <webview className="docked-chat-frame" src={dockedPulseUrl(window.location.href, host)} />
}
