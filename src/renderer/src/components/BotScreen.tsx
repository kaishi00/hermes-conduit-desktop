import { useCallback, useEffect, useRef, useState } from 'react'
import { screenKey } from '@shared/screenWindows'
import RFB from '@novnc/novnc'
import { t } from '@shared/i18n'
import type { LiveSocketEvent } from '@shared/ipc'
import { gateway, GatewayError } from '../gateway'
import { useRequests } from '../state/useNeedsYou'
import {
  CONTROL_TAKEN,
  MAX_RAPID_EVICTIONS,
  aspect,
  holds,
  installEnding,
  keysyms,
  newerLease,
  parseLease,
  parseStatus,
  viewerHash,
  withLine,
  type ScreenLease,
  type ScreenStatus
} from '../state/botScreen'
import { Icon } from './icons'
import { ask } from '../state/dialogs'
import { inSelectMenu } from './Select'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
type Stream = 'idle' | 'connecting' | 'live' | { lost: string }

/**
 * A WebSocket as noVNC reads one, with the main process at the other end:
 * it opens the screen's stream with this sign-in's credential and passes
 * the frames through, as the phone's viewer page is fed by the app.
 */
class Channel {
  binaryType = 'arraybuffer'
  protocol = ''
  readyState = 0
  onopen: ((event: object) => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((event: object) => void) | null = null
  socket: string | null = null
  send(data: ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== 1 || !this.socket) return
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    window.conduit.liveSend(this.socket, bytes.slice())
  }
  close() {
    if (this.readyState >= 2) return
    this.readyState = 2
    if (this.socket) window.conduit.liveClose(this.socket, 1000)
  }
  opened() {
    if (this.readyState !== 0) return
    this.readyState = 1
    this.onopen?.({})
  }
  received(bytes: Uint8Array) {
    if (this.readyState !== 1) return
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer })
  }
  closed(code: number, reason: string) {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.({ code: code || 1006, reason, wasClean: code === 1000 })
  }
}

// Viewers whose stream already ended.
const ended = new WeakSet<RFB>()

/**
 * A bot's screen, after the phone's Bot's Screen sheet: what it's doing,
 * live; Take Over for a sign-in or a CAPTCHA, then Hand Back; Start and
 * Stop; and its install on the host, with the log and the sudo password
 * Hermes asks for. It fills a window of its own (ScreenWindow), so the chat
 * stays in view. Its viewer id and hold go to the main process, which hands
 * back a hold when the window closes and gives a reopened window the same id.
 */
export function BotScreen({
  profile,
  botName,
  viewerId,
  host,
  onViewer,
  onClose
}: {
  profile: string
  botName: string
  viewerId?: string
  /** Another combined dashboard's bot, which the main process keeps its hold under. */
  host?: string
  /** The viewer id Hermes gave this page, so a reload watches as the same viewer. */
  onViewer?: (viewerId: string) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<ScreenStatus | null>(null)
  const [state, setState] = useState<'loading' | 'unsupported' | 'ready' | { failed: string }>('loading')
  const [stream, setStream] = useState<Stream>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [password, setPassword] = useState('')
  const [hash, setHash] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [typing, setTyping] = useState('')
  const screen = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const channel = useRef<Channel | null>(null)
  const generation = useRef(0)
  const statusRef = useRef(status)
  statusRef.current = status
  const viewer = useRef<string | null>(viewerId ?? null)
  const evictions = useRef({ count: 0, dialedAt: 0 })
  const early = useRef<LiveSocketEvent[]>([])
  const iHold = !!status && holds(status.lease, hash)
  const sudo = useRequests(true).find(r => r.method === 'display.install.sudo' && (!status || r.params.profile_key === status.profileKey))

  const display = useCallback(
    <T = Record<string, unknown>,>(method: string, params: Record<string, unknown> = {}) => gateway.rpc<T>(method, { ...params, profile }),
    [profile]
  )

  const applyLease = useCallback((lease: ScreenLease) => {
    setStatus(current => (current && newerLease(current.lease, lease) ? { ...current, lease } : current))
  }, [])
  const apply = useCallback((next: ScreenStatus) => {
    setStatus(current =>
      // Across a stop or start the lease starts over; while it runs, an older one never replaces a newer.
      current && current.running && next.running && next.lease.epoch < current.lease.epoch ? { ...next, lease: current.lease } : next
    )
  }, [])

  const detach = useCallback(() => {
    generation.current++
    const ch = channel.current
    channel.current = null
    if (ch?.socket) window.conduit.liveClose(ch.socket, 1000)
    const client = rfb.current
    rfb.current = null
    // One that ended on its own (its stream closed) is already disconnected.
    if (client && !ended.has(client))
      try {
        client.disconnect()
      } catch {
        // Already gone.
      }
    setStream('idle')
  }, [])

  const attach = useCallback(async () => {
    const target = screen.current
    if (!target || !statusRef.current?.running) return
    detach()
    const mine = generation.current
    setStream('connecting')
    try {
      const observed = await display<Record<string, unknown>>('display.observe', viewer.current ? { viewer_id: viewer.current } : {})
      if (mine !== generation.current) return
      const ticket = observed.ticket
      const id = observed.viewer_id
      if (typeof ticket !== 'string' || typeof id !== 'string') throw new Error(t("Couldn't read the screen"))
      viewer.current = id
      const ownHash = await viewerHash(id)
      setHash(ownHash)
      const next = parseStatus(observed)
      if (next) apply(next)
      const ch = new Channel()
      channel.current = ch
      const client = new RFB(target, ch, { shared: true })
      client.scaleViewport = true
      client.resizeSession = false
      client.focusOnClick = true
      client.background = 'transparent'
      client.qualityLevel = 7
      client.viewOnly = !(next && holds(next.lease, ownHash))
      client.addEventListener('connect', () => mine === generation.current && setStream('live'))
      client.addEventListener('disconnect', () => ended.add(client))
      client.addEventListener('securityfailure', event => {
        if (mine !== generation.current) return
        const reason = String((event as CustomEvent<{ reason?: string }>).detail?.reason ?? '')
        detach()
        setStream({ lost: reason || t("The screen's stream was lost.") })
      })
      rfb.current = client
      evictions.current.dialedAt = Date.now()
      const opened = await window.conduit.screenOpen(typeof observed.path === 'string' ? observed.path : '/api/display/ws', ticket)
      if (mine !== generation.current) {
        if (opened.ok) window.conduit.liveClose(opened.id, 1000)
        return
      }
      if (!opened.ok) throw new Error(opened.error)
      ch.socket = opened.id
      // What came before the id did.
      for (const event of early.current.splice(0)) if (event.id === opened.id) route(event)
    } catch (e) {
      if (mine !== generation.current) return
      setStream({ lost: message(e) })
    }
    // `route` reads refs only.
  }, [display, detach, apply])

  const load = useCallback(async () => {
    try {
      const next = parseStatus(await display('display.status'))
      if (!next) return setState('unsupported')
      apply(next)
      setState(next.supported ? 'ready' : 'unsupported')
    } catch (e) {
      if (e instanceof GatewayError && e.code === -32601) setState('unsupported')
      else setState({ failed: message(e) })
    }
  }, [display, apply])

  // The stream's frames, from the main process.
  function route(event: LiveSocketEvent) {
    const ch = channel.current
    if (!ch || event.id !== ch.socket) return
    if (event.type === 'open') ch.opened()
    else if (event.type === 'binary') ch.received(event.data)
    else if (event.type === 'close') {
      ch.closed(event.code, event.reason)
      channel.current = null
      if (event.code === CONTROL_TAKEN) {
        // Someone took over from another device: watch again on a fresh ticket, a few times at most.
        const quick = Date.now() - evictions.current.dialedAt < 10_000
        evictions.current.count = quick ? evictions.current.count + 1 : 1
        if (evictions.current.count <= MAX_RAPID_EVICTIONS) void attach()
        else setStream({ lost: t('Someone else took control of the screen.') })
        return
      }
      setStream(event.code === 1000 ? 'idle' : { lost: t("The screen's stream was lost.") })
      void load()
    }
  }
  const routeRef = useRef(route)
  routeRef.current = route

  useEffect(
    () =>
      window.conduit.onLive(event => {
        if (channel.current && !channel.current.socket && event.id.startsWith('live-')) {
          early.current = [...early.current, event].slice(-64)
          return
        }
        routeRef.current(event)
      }),
    []
  )

  // Hermes' screen events for this bot.
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        if (!event.type.startsWith('display.')) return
        const payload = (event.payload ?? {}) as Record<string, unknown>
        const key = statusRef.current?.profileKey
        if (!key || payload.profile_key !== key) return
        if (event.type === 'display.lease') applyLease(parseLease(payload.lease))
        else if (event.type === 'display.status') {
          const next = parseStatus(payload)
          if (next) apply(next)
        } else if (event.type === 'display.install.log' && typeof payload.line === 'string') {
          setInstalling(true)
          setLog(lines => withLine(lines, payload.line as string))
        } else if (event.type === 'display.install.done') {
          setInstalling(false)
          const next = parseStatus(payload.status)
          if (next) apply(next)
          const ending = installEnding(typeof payload.code === 'number' ? payload.code : 1)
          if (ending === 'done') setLog([])
          else
            setError(
              ending === 'noSudo'
                ? t('This host has no sudo. Run the install command on the host yourself.')
                : t("The install didn't finish. Its log is below.")
            )
        }
      }),
    [apply, applyLease]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Watch it while it runs.
  const running = status?.running === true
  useEffect(() => {
    if (running && state === 'ready') void attach()
    else detach()
  }, [running, state, attach, detach])

  useEffect(() => {
    if (rfb.current) {
      rfb.current.viewOnly = !iHold
      if (iHold) rfb.current.focus()
    }
  }, [iHold])

  // The main process hands back a hold this window has when the window closes, which no page code outlives.
  // A reload (a language change) keeps the same viewer id, so its hold stays this window's.
  const onViewerRef = useRef(onViewer)
  onViewerRef.current = onViewer
  useEffect(() => {
    if (!hash || !viewer.current) return
    window.conduit.noteScreenViewer(screenKey(host, profile), viewer.current, iHold)
    onViewerRef.current?.(viewer.current)
  }, [profile, host, hash, iHold])
  useEffect(() => () => detach(), [detach])

  async function perform(work: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    perform(async () => {
      const next = parseStatus(await display('display.start'))
      if (next) apply(next)
    })
  const stop = async () => {
    if (!(await ask(`${t('Stop the screen?')}\n\n${t("The bot's open windows close. It starts again the next time it's needed.")}`))) return
    void perform(async () => {
      const answer = await display('display.stop')
      detach()
      const next = parseStatus(answer)
      if (next) apply(next)
    })
  }
  const takeOver = () =>
    perform(async () => {
      if (!viewer.current) return
      const answer = await display<Record<string, unknown>>('display.lease.acquire', { viewer_id: viewer.current, reason: 'Conduit' })
      applyLease(parseLease(answer.lease))
    })
  const handBack = (force = false) =>
    perform(async () => {
      const answer = await display<Record<string, unknown>>('display.lease.release', force ? { force: true } : { viewer_id: viewer.current })
      applyLease(parseLease(answer.lease))
    })
  const install = () =>
    perform(async () => {
      setLog([])
      try {
        const answer = await display<Record<string, unknown>>('display.install')
        setInstalling(answer.started === true)
      } catch (e) {
        // A long install may answer late; its log and its end come as events.
        if (!installing) throw e
      }
    })
  const switchImage = (approve: boolean) =>
    perform(async () => {
      const next = parseStatus(await display('display.switchSandboxImage', { approve }))
      if (next) apply(next)
    })
  const answerSudo = async () => {
    if (!sudo) return
    const value = password
    setPassword('')
    const sent = await window.conduit.answerRequest(sudo.id, { value })
    if (!sent) setError(t('Hermes needs your sudo password'))
  }
  const type = () => {
    const list = keysyms(typing)
    if (!rfb.current || !iHold || !list.length) return
    for (const keysym of list) {
      rfb.current.sendKey(keysym, null, true)
      rfb.current.sendKey(keysym, null, false)
    }
    setTyping('')
    rfb.current.focus()
  }

  // Esc leaves full screen, unless the screen has the keyboard.
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event) && !iHold) {
        event.preventDefault()
        setFull(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [full, iHold])

  const lease = status?.lease
  const controller = !lease
    ? ''
    : iHold
      ? t("You're in control")
      : lease.holder === 'human'
        ? t('Someone else is in control')
        : t('{name} is in control', { name: botName })

  const body = () => {
    if (state === 'loading') return <p className="meta">{t('Loading…')}</p>
    if (state === 'unsupported')
      return (
        <div className="screen-note">
          <h2>{t('No screen on this host')}</h2>
          <p className="meta">{t("A bot's screen needs Hermes on a Linux host and a recent Hermes.")}</p>
        </div>
      )
    if (typeof state === 'object')
      return (
        <div className="screen-note">
          <h2>{t("Couldn't read the screen")}</h2>
          <p className="meta">{state.failed}</p>
          <button className="secondary" onClick={() => void load()}>
            {t('Try Again')}
          </button>
        </div>
      )
    if (!status) return null
    if (!status.installed || installing || log.length)
      return (
        <div className="screen-note">
          <h2>{installing ? t('Installing on the host…') : log.length ? t('Install finished') : t("The screen isn't set up on this host yet")}</h2>
          {!installing && !log.length ? (
            <p className="meta">
              {t(
                "Installing adds a small desktop and its packages on the Hermes host (about 1 GB of disk). Hermes asks for the host's password if it needs one."
              )}
            </p>
          ) : null}
          {sudo ? (
            <form
              className="screen-sudo"
              onSubmit={e => {
                e.preventDefault()
                void answerSudo()
              }}
            >
              <label>
                <span>{t("The host's sudo password")}</span>
                <input type="password" autoFocus value={password} aria-label={t('Password')} onChange={e => setPassword(e.target.value)} />
              </label>
              <p className="meta">{t("It goes to the Hermes host only, for this install, and isn't kept.")}</p>
              <div className="pset-actions">
                <button type="button" className="secondary" onClick={() => void window.conduit.answerRequest(sudo.id, { value: '' })}>
                  {t('Cancel Install')}
                </button>
                <button type="submit" className="primary" disabled={!password}>
                  {t('Send')}
                </button>
              </div>
            </form>
          ) : null}
          {log.length ? <pre className="screen-log">{log.join('\n')}</pre> : null}
          {!installing && !log.length ? (
            <div className="pset-actions">
              <button className="primary" disabled={busy} onClick={() => void install()}>
                {t('Install on Host')}
              </button>
            </div>
          ) : null}
          {!installing && log.length ? (
            <div className="pset-actions">
              <button
                className="secondary"
                onClick={() => {
                  setLog([])
                  setError(null)
                  void load()
                }}
              >
                {t('Continue')}
              </button>
            </div>
          ) : null}
          {status.installCommand && !installing ? (
            <div className="screen-command">
              <span className="meta">{t('Or run this on the host:')}</span>
              <code>{status.installCommand}</code>
              <button className="link" onClick={() => void navigator.clipboard.writeText(status.installCommand!)}>
                {t('Copy Command')}
              </button>
            </div>
          ) : null}
        </div>
      )
    if (status.imageSwitch)
      return (
        <div className="screen-note">
          <h2>{t("The bot's sandbox needs the desktop image")}</h2>
          <p className="meta">
            {t('Its sandbox runs {current}. The screen needs {target}. Switching keeps its files; packages installed inside it come back on use.', {
              current: status.imageSwitch.current,
              target: status.imageSwitch.target
            })}
          </p>
          <div className="pset-actions">
            <button className="secondary" disabled={busy} onClick={() => void switchImage(false)}>
              {t('Keep Current Image')}
            </button>
            <button className="primary" disabled={busy} onClick={() => void switchImage(true)}>
              {t('Switch Image')}
            </button>
          </div>
        </div>
      )
    if (!status.running)
      return (
        <div className="screen-note">
          <h2>{t('The screen is off')}</h2>
          <p className="meta">{status.blocker ?? t('It starts when you start it here, and stops after a while nobody uses it.')}</p>
          <div className="pset-actions">
            <button className="primary" disabled={busy || !!status.blocker} onClick={() => void start()}>
              {t('Start Screen')}
            </button>
          </div>
        </div>
      )
    return null
  }

  const live = status?.running && state === 'ready' && status.installed && !installing && !log.length && !status.imageSwitch
  return (
    <div className={`screen-sheet${full ? ' full' : ''}`} role="dialog" aria-label={t("{name}'s Screen", { name: botName })}>
      <div className="screen-head">
        <div className="screen-titles">
          <h1>{t("{name}'s Screen", { name: botName })}</h1>
          {live && controller ? <span className={`meta${iHold ? ' screen-mine' : ''}`}>{controller}</span> : null}
        </div>
        {live ? (
          <>
            {iHold ? (
              <button className="primary" disabled={busy} onClick={() => void handBack()}>
                {t('Hand Back')}
              </button>
            ) : lease?.holder === 'human' ? (
              <button className="secondary" disabled={busy} onClick={() => void handBack(true)}>
                {t('Hand Back for Them')}
              </button>
            ) : (
              <button className="primary" disabled={busy || stream !== 'live'} onClick={() => void takeOver()}>
                {t('Take Over')}
              </button>
            )}
            <button className="secondary" onClick={() => setFull(!full)}>
              {full ? t('Exit Full Screen') : t('Full Screen')}
            </button>
            <button className="secondary danger" disabled={busy} onClick={stop}>
              {t('Stop Screen')}
            </button>
          </>
        ) : null}
        <button className="round" aria-label={t('Done')} title={t('Done')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {error ? <p className="error-text screen-error">{error}</p> : null}
      {body()}
      <div className={`screen-frame${live ? '' : ' hidden'}`} style={status ? { aspectRatio: String(aspect(status.geometry)) } : undefined}>
        <div ref={screen} className="screen-canvas" />
        {typeof stream === 'object' ? (
          <div className="screen-lost">
            <span>{stream.lost}</span>
            <button className="secondary" onClick={() => void attach()}>
              {t('Reconnect')}
            </button>
          </div>
        ) : stream === 'connecting' ? (
          <div className="screen-lost">
            <span className="meta">{t('Loading…')}</span>
          </div>
        ) : null}
      </div>
      {live && iHold ? (
        <form
          className="screen-type"
          onSubmit={e => {
            e.preventDefault()
            type()
          }}
        >
          <input value={typing} onChange={e => setTyping(e.target.value)} placeholder={t('Type on the screen')} aria-label={t('Type on the screen')} />
          <button type="submit" className="secondary" disabled={!typing}>
            {t('Send')}
          </button>
        </form>
      ) : null}
    </div>
  )
}
