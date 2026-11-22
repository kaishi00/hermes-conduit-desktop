import { useEffect, useState } from 'react'
import { formatDate, t } from '@shared/i18n'
import { gateway } from '../gateway'
import { dashboardHost } from '../state/dashboardProfile'
import { hermesUpdateRunning } from '../state/hostActions'
import { readStatus } from '../state/pluginUpdate'
import {
  GATEWAY_WORK,
  POLL_MS,
  readGatewayWork,
  runRestartNow,
  useRestartNow,
  workLines,
  type GatewayWork,
  type RestartNowHost
} from '../state/gatewayWork'

/** The dashboard on screen, for as long as it stays on screen: a switch mid-run stops its calls. */
function connectionTo(host: string): RestartNowHost {
  const onHost = () => {
    if (dashboardHost() !== host) throw new Error(t('Connect to this dashboard first.'))
  }
  return {
    http: async (method, path, timeoutMs) => {
      onHost()
      return gateway.http(method, path, method === 'POST' ? {} : undefined, timeoutMs)
    },
    rpc: async (method, params) => {
      onHost()
      return gateway.rpc(method, params)
    }
  }
}

/**
 * Under "Letting running tasks finish…" (Restart Gateway and the plugin update alike), after the
 * phone's GatewayWaitView: what the restart waits on, when it goes ahead anyway, and Restart Now.
 * Reads the plugin every few seconds while it shows; with a plugin that can't say, it shows nothing.
 */
export function GatewayWait({ capabilities }: { capabilities?: string[] | null }) {
  const host = dashboardHost()
  // Restart Gateway's row has no plugin status of its own: it asks once.
  const [asked, setAsked] = useState<string[] | null>(null)
  useEffect(() => {
    if (capabilities !== undefined) return
    let live = true
    void readStatus().then(status => live && setAsked(status.state === 'reported' ? status.capabilities : null))
    return () => {
      live = false
    }
  }, [capabilities, host])
  const capable = !!(capabilities === undefined ? asked : capabilities)?.includes(GATEWAY_WORK)
  const [work, setWork] = useState<GatewayWork | null>(null)
  const [, tick] = useState(0)
  const { running, failure } = useRestartNow(host)

  useEffect(() => {
    if (!capable) return
    let live = true
    const read = async () => {
      const latest = await readGatewayWork(connectionTo(host).http)
      if (live && latest) setWork(latest)
    }
    void read()
    const poll = setInterval(() => void read(), POLL_MS)
    // Running times move on between reads too.
    const clock = setInterval(() => tick(n => n + 1), 30_000)
    return () => {
      live = false
      clearInterval(poll)
      clearInterval(clock)
    }
  }, [capable, host])

  if (!capable) return null
  const hint = t('Stops the running tasks and restarts the gateway now.')
  return (
    <div className="gateway-wait">
      {work ? (
        <div className="meta gateway-wait-lines">
          {workLines(work).map((line, index) => (
            <div key={index}>{line}</div>
          ))}
          {work.restartsBy ? (
            <div>{t('Restarts on its own by {time}', { time: formatDate(work.restartsBy, { timeStyle: 'short' }) })}</div>
          ) : null}
        </div>
      ) : null}
      {failure ? (
        <p className="plugin-degraded" role="alert">
          {failure}
        </p>
      ) : null}
      <button
        className="link gateway-restart-now"
        disabled={running}
        title={hint}
        onClick={() => void runRestartNow(host, connectionTo(host), dashboardHost, hermesUpdateRunning(host))}
      >
        {running ? t('Stopping running tasks…') : t('Restart Now')}
      </button>
    </div>
  )
}
