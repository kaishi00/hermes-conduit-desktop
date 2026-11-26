import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { hostPageParts, shownAddress } from '@shared/browserAddress'
import { addressFor, addressHere } from '../state/browserTabs'
import type { BenchPage } from '../state/workbench'
import { Icon } from './icons'

/** What the bench uses of Electron's <webview>. */
type PageFrame = HTMLElement & {
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  getURL(): string
}

const HOST_PARTITION = 'conduit-host-pages'
const WEB_PARTITION = 'persist:conduit-web-pages'

/**
 * A Browser tab in the workbench (desktop issue 451): a port or localhost
 * address shows what a dev server on the Hermes host serves, through the
 * dashboard, and any other address is a web page, loaded here. The page is a
 * <webview> in a session of its own (main/hostPages.ts), kept while the tab
 * is hidden, so switching tabs doesn't reload it.
 */
export function BrowserView({
  page,
  hostKey,
  hostPages,
  shown,
  onChange
}: {
  page: BenchPage
  hostKey: string | null
  hostPages: boolean
  shown: boolean
  onChange: (next: BenchPage) => void
}) {
  const frame = useRef<PageFrame | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef(page)
  latest.current = page
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  // What the frame was sent to: it changes on a typed address or an opened link, never on the page's own navigation.
  const [load, setLoad] = useState<string | null>(() => addressHere(page.url, hostKey))
  const [typed, setTyped] = useState(() => (page.url ? shownAddress(page.url) : ''))
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [moves, setMoves] = useState({ back: false, forward: false })

  useEffect(() => {
    if (page.nav === 0) return
    const next = addressHere(latest.current.url, hostKey)
    setNote(null)
    setLoad(next)
    setTyped(next ? shownAddress(next) : '')
    // Sent here by an address or a link: the newest wins.
  }, [page.nav]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // The key arrives after the tab: a saved host page loads once it's known.
    if (load === null && latest.current.url && hostKey) setLoad(addressHere(latest.current.url, hostKey))
  }, [hostKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shown && !load) input.current?.focus()
  }, [shown, load])

  const kind = load ? (hostPageParts(load) ? 'host' : 'web') : null
  useEffect(() => {
    const el = frame.current
    if (!el || !load) return
    const moved = () => {
      try {
        setMoves({ back: el.canGoBack(), forward: el.canGoForward() })
      } catch {
        // Not attached yet.
      }
    }
    const navigated = (event: Event) => {
      const { url, isMainFrame } = event as Event & { url?: string; isMainFrame?: boolean }
      if (!url || isMainFrame === false) return
      setNote(null)
      if (!editingRef.current) setTyped(shownAddress(url))
      changeRef.current({ ...latest.current, url })
      moved()
    }
    const titled = (event: Event) => {
      const title = (event as Event & { title?: string }).title
      if (title) changeRef.current({ ...latest.current, title })
    }
    const started = () => setLoading(true)
    const stopped = () => {
      setLoading(false)
      moved()
    }
    const failed = (event: Event) => {
      const { errorCode, errorDescription, isMainFrame } = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      // -3 is a load cut short by another (a redirect, a new address).
      if (isMainFrame === false || errorCode === -3) return
      setNote(`${t('This page couldn’t be opened.')}${errorDescription ? ` (${errorDescription})` : ''}`)
    }
    el.addEventListener('did-navigate', navigated)
    el.addEventListener('did-navigate-in-page', navigated)
    el.addEventListener('page-title-updated', titled)
    el.addEventListener('did-start-loading', started)
    el.addEventListener('did-stop-loading', stopped)
    el.addEventListener('did-fail-load', failed)
    return () => {
      el.removeEventListener('did-navigate', navigated)
      el.removeEventListener('did-navigate-in-page', navigated)
      el.removeEventListener('page-title-updated', titled)
      el.removeEventListener('did-start-loading', started)
      el.removeEventListener('did-stop-loading', stopped)
      el.removeEventListener('did-fail-load', failed)
    }
  }, [load, kind])
  const editingRef = useRef(editing)
  editingRef.current = editing

  const go = (e: React.FormEvent) => {
    e.preventDefault()
    const next = addressFor(typed, hostKey, hostPages)
    if ('note' in next) {
      setNote(next.note)
      return
    }
    setEditing(false)
    input.current?.blur()
    onChange({ ...page, url: next.url, title: undefined, nav: page.nav + 1 })
  }
  const act = (what: 'back' | 'forward' | 'reload' | 'stop') => {
    const el = frame.current
    if (!el) return
    try {
      if (what === 'back') el.goBack()
      else if (what === 'forward') el.goForward()
      else if (what === 'reload') el.reload()
      else el.stop()
    } catch {
      // Not attached yet.
    }
  }
  const external = page.url && !hostPageParts(page.url) ? page.url : null

  return (
    <div className="bench-browser">
      <form className="bench-browser-bar" onSubmit={go}>
        <button type="button" className="staged-remove" aria-label={t('Back')} title={t('Back')} disabled={!moves.back} onClick={() => act('back')}>
          <Icon name="back" />
        </button>
        <button type="button" className="staged-remove" aria-label={t('Forward')} title={t('Forward')} disabled={!moves.forward} onClick={() => act('forward')}>
          <Icon name="chevron" />
        </button>
        <button
          type="button"
          className="staged-remove"
          aria-label={loading ? t('Stop') : t('Reload')}
          title={loading ? t('Stop') : t('Reload')}
          disabled={!load}
          onClick={() => act(loading ? 'stop' : 'reload')}
        >
          <Icon name={loading ? 'close' : 'refresh'} />
        </button>
        <span className="bench-browser-where" title={kind === 'host' ? t('On the Hermes host') : undefined}>
          {kind === 'host' ? <Icon name="server" /> : <Icon name="globe" />}
        </span>
        <input
          ref={input}
          className="bench-browser-address"
          value={typed}
          spellCheck={false}
          aria-label={t('Address')}
          placeholder={t('Port or address, such as 5173')}
          onChange={e => setTyped(e.target.value)}
          onFocus={e => {
            setEditing(true)
            e.currentTarget.select()
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            if (e.key !== 'Escape') return
            setTyped(page.url ? shownAddress(page.url) : '')
            e.currentTarget.blur()
          }}
        />
        {external ? (
          <a className="staged-remove" href={external} target="_blank" rel="noreferrer" aria-label={t('Open in Browser')} title={t('Open in Browser')}>
            <Icon name="window" />
          </a>
        ) : null}
      </form>
      {note ? <div className="bench-note">{note}</div> : null}
      {load && kind ? (
        <webview
          key={kind}
          ref={frame as React.Ref<HTMLElement>}
          className="bench-browser-page"
          partition={kind === 'host' ? HOST_PARTITION : WEB_PARTITION}
          src={load}
        />
      ) : (
        <div className="bench-empty">
          <Icon name="globe" />
          <p>{t('Open what a dev server on the Hermes host serves: type its port, such as 5173. A localhost link in the chat opens here too.')}</p>
        </div>
      )}
    </div>
  )
}
