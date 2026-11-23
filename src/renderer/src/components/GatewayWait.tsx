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
 * Asks the plugin every few seconds until it answers: a drain-time 404 (the gateway has gone) is
 * definitive, so it stops the asking like a reported answer does, and only an unreadable answer
 * (`unknown`) asks again. With either "no", it shows nothing.
 */
export function GatewayWait({ capabilities }: { capabilities?: string[] | null }) {
  const host = dashboardHost()
  // Restart Gateway's row has no plugin status of its own: it asks once.
  const [asked, setAsked] = useState<string[] | null>(null)
  useEffect(() => {
    // undefined leaves the asking to this loop; a handed-down list, or an answer (reported or the
    // definitive 404), ends it here.
    if (capabilities !== undefined || asked) return
    // Asked again until the plugin answers: one failed read mid-drain mustn't hide Restart Now for
    // good. A 404 (`missing`) is definitive mid-drain — the gateway has gone — so it stops the
    // asking too; only an unreadable answer (`unknown`) asks again (desktop#378).
    let live = true
    const ask = () =>
      void readStatus().then(status => {
        if (!live) return
        if (status.state === 'reported') setAsked(status.capabilities)
        else if (status.state === 'missing') setAsked([])
      })
    ask()
    const again = setInterval(ask, POLL_MS)
    return () => {
      live = false
      clearInterval(again)
    }
  }, [capabilities, host, asked])
  const capable = !!(capabilities === undefined ? asked : capabilities)?.includes(GATEWAY_WORK)
  const [work, setWork] = useState<GatewayWork | null>(null)
  const [, tick] = useState(0)
  const { running, failure } = useRestartNow(host)

  useEffect(() => {
    if (!capable) return
    let live = true
    // One read at a time: a slow answer landing after a newer one would move the running times back.
    let reading = false
    const read = async () => {
      if (reading) return
      reading = true
      const latest = await readGatewayWork(connectionTo(host).http).finally(() => (reading = false))
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
        onClick={() => void runRestartNow(host, connectionTo(host), dashboardHost, () => hermesUpdateRunning(host))}
      >
        {running ? t('Stopping running tasks…') : t('Restart Now')}
      </button>
    </div>
  )
}
