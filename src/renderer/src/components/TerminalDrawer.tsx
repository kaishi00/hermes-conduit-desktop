import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  CLOSE_GONE,
  Drawn,
  TERMINALS_SOCKET,
  closePath,
  createPath,
  inputFrame,
  listPath,
  parseFrame,
  parseList,
  parseRow,
  reconnectDelayMs,
  reconnects,
  resizeFrame,
  socketQuery,
  type TerminalRow
} from '../state/terminals'
import { TabStrip } from './TabStrip'
import { Icon } from './icons'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Listed = { available: boolean; reason: string | null; terminals: TerminalRow[] } | { error: string } | 'loading'

/**
 * The workbench's terminals (issue 450), in a drawer under its views: shells
 * on the Hermes host in the chat's folder, a tab each. They keep running when
 * the drawer folds or Conduit closes, and come back with what they wrote
 * meanwhile. Closing a tab ends its shell.
 */
export function TerminalDrawer({
  root,
  profile,
  onFold,
  folded
}: {
  root: string
  profile?: string
  /** Folds the drawer to its tab row (its terminals keep running). */
  onFold: () => void
  folded: boolean
}) {
  const [listed, setListed] = useState<Listed>('loading')
  const [active, setActive] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const read = useCallback(async () => {
    try {
      const list = parseList(await gateway.http('GET', listPath(root, profile)))
      setListed(list)
      setActive(current => (current && list.terminals.some(row => row.id === current) ? current : (list.terminals.at(-1)?.id ?? null)))
    } catch (e) {
      // An older plugin has no terminals route.
      setListed({ error: (e as { code?: unknown }).code === 404 ? t('Update the Conduit plugin on this host to open terminals here.') : message(e) })
    }
  }, [root, profile])
  useEffect(() => {
    setListed('loading')
    void read()
  }, [read])

  const start = async () => {
    setStarting(true)
    setFailed(null)
    try {
      const answer = (await gateway.http('POST', createPath(profile), { root, cols: 100, rows: 24 })) as { terminal?: unknown }
      const row = parseRow(answer?.terminal)
      if (!row) throw new Error(t("The terminal didn't start."))
      setListed(current => (current !== 'loading' && !('error' in current) ? { ...current, terminals: [...current.terminals, row] } : current))
      setActive(row.id)
      if (folded) onFold()
    } catch (e) {
      setFailed(message(e))
    } finally {
      setStarting(false)
    }
  }
  const close = async (row: TerminalRow) => {
    setListed(current => (current !== 'loading' && !('error' in current) ? { ...current, terminals: current.terminals.filter(r => r.id !== row.id) } : current))
    setActive(current => (current === row.id ? null : current))
    try {
      await gateway.http('DELETE', closePath(row.id, profile))
    } catch {
      // Already gone (its shell ended, or the dashboard restarted).
    }
    void read()
  }
  const ended = (id: string, code: number | null) =>
    setListed(current =>
      current !== 'loading' && !('error' in current) ? { ...current, terminals: current.terminals.map(r => (r.id === id ? { ...r, exited: true, exitCode: code } : r)) } : current
    )
  const gone = (id: string) =>
    setListed(current => (current !== 'loading' && !('error' in current) ? { ...current, terminals: current.terminals.filter(r => r.id !== id) } : current))

  const terminals = listed !== 'loading' && !('error' in listed) ? listed.terminals : []
  const shownId = terminals.some(r => r.id === active) ? active : (terminals.at(-1)?.id ?? null)
  const available = listed !== 'loading' && !('error' in listed) && listed.available

  return (
    <section className={`bench-drawer${folded ? ' folded' : ''}`} aria-label={t('Terminals')}>
      <TabStrip
        tabs={terminals}
        keyOf={row => row.id}
        active={shownId}
        label={row => ({ title: row.title, icon: <Icon name="terminal" />, ended: row.exited, hint: row.exited ? t('Ended') : undefined })}
        onPick={row => {
          setActive(row.id)
          if (folded) onFold()
        }}
        onClose={row => void close(row)}
        onNewTab={available ? () => void start() : undefined}
        newTabLabel={t('New Terminal')}
        ariaLabel={t('Terminals')}
        className="bench-drawer-tabs"
        trailing={
          <button className="git-icon" title={folded ? t('Show Terminals') : t('Hide Terminals')} aria-label={folded ? t('Show Terminals') : t('Hide Terminals')} onClick={onFold}>
            <Icon name={folded ? 'chevronUp' : 'chevronDown'} />
          </button>
        }
      />
      {/* Folded, the views stay mounted, so their shells keep their sockets and screens. */}
      <div className="bench-drawer-body" hidden={folded}>
        {listed === 'loading' ? (
          <div className="bench-note">{t('Loading…')}</div>
        ) : 'error' in listed ? (
          <div className="bench-note">{listed.error}</div>
        ) : !listed.available ? (
          <div className="bench-note">{listed.reason ?? t('Terminals aren’t available on this Hermes.')}</div>
        ) : !terminals.length ? (
          <div className="bench-empty small">
            <p className="meta">{t('A terminal here is a shell on the Hermes host, in this chat’s folder. It keeps running while Conduit is closed.')}</p>
            <button className="primary" disabled={starting} onClick={() => void start()}>
              {t('New Terminal')}
            </button>
          </div>
        ) : null}
        {failed ? <div className="bench-note error-text">{failed}</div> : null}
        {terminals.map(row => (
          <TerminalView key={row.id} row={row} profile={profile} shown={row.id === shownId && !folded} onEnded={code => ended(row.id, code)} onGone={() => gone(row.id)} />
        ))}
      </div>
    </section>
  )
}

/** The terminal's colors, from the app's own. */
function theme(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    background: '#00000000',
    foreground: value('--text', '#e6e6ea'),
    cursor: value('--accent', '#e0ab47'),
    cursorAccent: value('--surface', '#16181e'),
    selectionBackground: value('--terminal-selection', 'rgba(224, 171, 71, 0.3)')
  }
}

function TerminalView({
  row,
  profile,
  shown,
  onEnded,
  onGone
}: {
  row: TerminalRow
  profile?: string
  shown: boolean
  onEnded: (code: number | null) => void
  onGone: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<{ term: Terminal; fit: FitAddon } | null>(null)
  const callbacks = useRef({ onEnded, onGone })
  callbacks.current = { onEnded, onGone }

  useEffect(() => {
    if (!host.current) return
    const term = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'Menlo, Consolas, monospace',
      fontSize: 12.5,
      scrollback: 5000,
      theme: theme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    view.current = { term, fit }
    const drawn = new Drawn()
    let socket: string | null = null
    let exited = false
    let attempt = 0
    let retry = 0
    let disposed = false
    const send = (data: string) => {
      if (socket) window.conduit.liveSend(socket, data)
    }
    const open = async () => {
      const opened = await window.conduit.liveOpen(TERMINALS_SOCKET, socketQuery(row.id, drawn.end, profile))
      if (disposed) {
        if (opened.ok) window.conduit.liveClose(opened.id)
        return
      }
      if (!opened.ok) return later()
      socket = opened.id
    }
    const later = () => {
      window.clearTimeout(retry)
      retry = window.setTimeout(() => !disposed && void open(), reconnectDelayMs(attempt++))
    }
    const off = window.conduit.onLive(event => {
      if (event.id !== socket) return
      if (event.type === 'open') {
        attempt = 0
        send(resizeFrame(term.cols, term.rows))
      } else if (event.type === 'message') {
        const frame = parseFrame(event.data)
        if (!frame) return
        if (frame.type === 'output') {
          const fresh = drawn.fresh(frame.bytes, frame.end)
          if (fresh) term.write(fresh)
        } else if (frame.type === 'exit') {
          exited = true
          term.write(`\r\n\x1b[2m${t('[The shell ended with code {code}]', { code: frame.code ?? 0 })}\x1b[0m\r\n`)
          callbacks.current.onEnded(frame.code)
        }
      } else if (event.type === 'close') {
        socket = null
        if (event.code === CLOSE_GONE && !exited) return callbacks.current.onGone()
        if (reconnects(event.code, exited)) later()
      }
    })
    const typed = term.onData(data => send(inputFrame(data)))
    const resized = term.onResize(({ cols, rows }) => send(resizeFrame(cols, rows)))
    const observer = new ResizeObserver(() => {
      if (host.current?.offsetParent) {
        try {
          fit.fit()
        } catch {
          // Not laid out yet.
        }
      }
    })
    observer.observe(host.current)
    void open()
    return () => {
      disposed = true
      window.clearTimeout(retry)
      off()
      typed.dispose()
      resized.dispose()
      observer.disconnect()
      if (socket) window.conduit.liveClose(socket)
      term.dispose()
      view.current = null
    }
  }, [row.id, profile])

  useEffect(() => {
    if (!shown || !view.current) return
    const { term, fit } = view.current
    requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        // Not laid out yet.
      }
      term.focus()
    })
  }, [shown])

  return <div className="bench-terminal" ref={host} hidden={!shown} />
}
