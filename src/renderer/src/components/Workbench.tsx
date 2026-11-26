import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { hostPageParts, hostPageUrl, localLink, shownAddress } from '@shared/browserAddress'
import { gateway } from '../gateway'
import { STATUS_PATH, askAgainMs, askPluginStatus, serves } from '../state/plugin'
import { GIT_CAPABILITY, lists, type GitStatus } from '../state/sourceControl'
import { TERMINALS_CAPABILITY } from '../state/terminals'

/** The plugin's /workspace/preview route: a Browser tab's pages from the host. */
const PREVIEW_CAPABILITY = 'workspace-preview'
import { commandAt, stepPath } from '../state/benchTimeline'
import type { TranscriptStore } from '../state/transcriptStore'
import { BENCH_VIEWS, MAX_PAGES, pageKey, shownView, readDrawer, readPages, writeDrawer, writePages, type BenchPage, type BenchView, type DrawerState } from '../state/workbench'
import { baseName } from '../state/workspace'
import { BenchTimeline, useBenchSteps } from './BenchTimeline'
import { BrowserView } from './BrowserView'
import { ChangesView } from './ChangesView'
import { FilesPanel } from './FilesPanel'
import { TabStrip } from './TabStrip'
import { TerminalDrawer } from './TerminalDrawer'
import { Icon } from './icons'

/**
 * The workbench beside a chat with a folder (Eric, 2026-11-26, "B · Project
 * mode"; desktop issues 450 to 453): the chat's folder as a project, its
 * views on the same tab strip the chat tabs use (Changes, Files, then its
 * Browser tabs), and its terminals in a drawer below. Everything here is on
 * the Hermes host: Git and the shells run there, in the chat's folder, and a
 * Browser tab's localhost is the host's.
 */
export function Workbench({
  root,
  profile,
  refreshKey,
  reveal,
  transcript,
  onShowStep,
  onInsertPath,
  onClose
}: {
  root: string
  profile?: string
  refreshKey: number
  /** A file a reply named: the bench shows it in Files. */
  reveal?: { path: string; id: number } | null
  /** The chat's transcript, which the timeline reads its steps from. */
  transcript: TranscriptStore
  /** The timeline landed on a step: the chat shows it. */
  onShowStep: (key: string) => void
  onInsertPath: (path: string) => void
  onClose: () => void
}) {
  // 'changes', 'files', or a Browser tab's key (pageKey).
  const [view, setView] = useState<string>('changes')
  const [git, setGit] = useState<GitStatus | null>(null)
  const [plugin, setPlugin] = useState<{ git: boolean; terminals: boolean; preview: boolean } | null>(null)
  const [pages, setPages] = useState<BenchPage[]>(() => readPages(root))
  const [hostKey, setHostKey] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerState>(readDrawer)
  const [opened, setOpened] = useState<{ path: string; id: number } | null>(null)
  // The timeline's step (issue 453), or null while it follows the chat.
  const steps = useBenchSteps(transcript)
  const [at, setAt] = useState<string | null>(null)
  const [botTurn, setBotTurn] = useState(0)
  const showTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(showTimer.current), [])
  const stepAt = at === null ? null : (steps.find(step => step.key === at) ?? null)
  const pickStep = (key: string | null) => {
    setAt(key)
    const step = key === null ? null : steps.find(s => s.key === key)
    if (!step) return
    // Every view moves to the step: the chat, the bot's commands, and Files to the step's file.
    // A drag passes many steps: the chat scrolls to the one it stops on.
    window.clearTimeout(showTimer.current)
    showTimer.current = window.setTimeout(() => onShowStep(step.key), 160)
    if (commandAt(steps, step.key)) setBotTurn(turn => turn + 1)
    if (step.path) setOpened({ path: stepPath(step.path, root), id: (opens.current += 1) })
  }
  const bench = useRef<HTMLElement>(null)
  // Each open has an id of its own, so the same file opened twice opens twice.
  const opens = useRef(0)

  // What the plugin serves; an ask that couldn't tell (a timeout, a restart) is asked again rather than read as an old plugin.
  useEffect(() => {
    let live = true
    let timer = 0
    const ask = (attempt: number) =>
      void askPluginStatus(() => gateway.http('GET', STATUS_PATH, undefined, 8_000)).then(status => {
        if (!live) return
        if (status === null) {
          timer = window.setTimeout(() => ask(attempt + 1), askAgainMs(attempt))
          return
        }
        setPlugin({ git: serves(status, [GIT_CAPABILITY]), terminals: serves(status, [TERMINALS_CAPABILITY]), preview: serves(status, [PREVIEW_CAPABILITY]) })
      })
    setPlugin(null)
    ask(0)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [root, profile])
  useEffect(() => setGit(null), [root, profile])
  // Another folder's Browser tabs (the first render read this one's).
  const pagesRoot = useRef(root)
  useEffect(() => {
    if (pagesRoot.current === root) return
    pagesRoot.current = root
    setPages(readPages(root))
    setView(current => (current.startsWith('page:') ? 'changes' : current))
  }, [root])
  useEffect(() => {
    if (pagesRoot.current === root) writePages(root, pages)
  }, [root, pages])
  // The key host pages name the dashboard on screen by.
  useEffect(() => {
    let live = true
    // Another folder may be on another dashboard: its tabs wait for that one's key.
    setHostKey(null)
    void window.conduit
      .hostPageKey()
      .then(key => live && setHostKey(key))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [root, profile])
  const newPage = (url: string | null = null) => {
    if (pagesNow.current.length >= MAX_PAGES) return
    const page: BenchPage = { id: crypto.randomUUID(), url, nav: url ? 1 : 0 }
    // Counted at once, so two opened before a render can't pass eight.
    pagesNow.current = [...pagesNow.current, page]
    setPages(current => (current.length >= MAX_PAGES ? current : [...current, page]))
    setView(pageKey(page))
  }
  const shown = shownView(view, pages)
  const changePage = useCallback((next: BenchPage) => setPages(current => current.map(p => (p.id === next.id ? next : p))), [])
  const closePage = (page: BenchPage) => {
    const at = pages.findIndex(p => p.id === page.id)
    const left = pages.filter(p => p.id !== page.id)
    setPages(left)
    if (view === pageKey(page)) setView(left.length ? pageKey(left[Math.min(at, left.length - 1)]!) : 'changes')
  }
  // A localhost link in the chat (the bot's "running on http://localhost:5173") is the host's: it opens here.
  const pagesNow = useRef(pages)
  pagesNow.current = pages
  const opensHere = useRef({ preview: false, hostKey: null as string | null })
  opensHere.current = { preview: plugin?.preview === true, hostKey }
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      const local = anchor ? localLink(anchor.href) : null
      const { preview, hostKey: key } = opensHere.current
      if (!local || !preview || !key) return
      e.preventDefault()
      e.stopPropagation()
      const url = hostPageUrl(key, local.port, local.path)
      const same = pagesNow.current.find(p => p.url && hostPageParts(p.url)?.port === local.port)
      // With every tab taken, the last one opens it: no tab is closed for it.
      const into = same ?? (pagesNow.current.length >= MAX_PAGES ? pagesNow.current[pagesNow.current.length - 1] : undefined)
      if (into) {
        setPages(current => current.map(p => (p.id === into.id ? { ...p, url, title: undefined, nav: p.nav + 1 } : p)))
        setView(pageKey(into))
      } else newPage(url)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  // A file a reply named goes to Files (one named before the bench opened stays with the Folder).
  const seenReveal = useRef(reveal?.id)
  useEffect(() => {
    if (!reveal || reveal.id === seenReveal.current) return
    seenReveal.current = reveal.id
    setView('files')
    setOpened({ path: reveal.path, id: (opens.current += 1) })
  }, [reveal])
  const changeDrawer = (next: DrawerState) => {
    setDrawer(next)
    writeDrawer(next)
  }
  const onStatus = useCallback((status: GitStatus | null) => setGit(status), [])
  const openFile = (path: string) => {
    setView('files')
    setOpened({ path, id: (opens.current += 1) })
  }

  // Ctrl+` (⌘` on a Mac) shows or folds the terminals, as an editor's does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '`') {
        e.preventDefault()
        keep.current = true
        setDrawer(current => ({ ...current, folded: !current.folded }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The drawer's height, dragged by the line above it, and kept once the drag ends.
  const dragEnd = useRef<(() => void) | null>(null)
  useEffect(() => () => dragEnd.current?.(), [])
  const keep = useRef(false)
  useEffect(() => {
    if (!keep.current) return
    keep.current = false
    writeDrawer(drawer)
  }, [drawer])
  const startDrag = (e: React.PointerEvent) => {
    const panel = bench.current
    if (!panel) return
    e.preventDefault()
    const startY = e.clientY
    const startHeight = drawer.height
    const most = panel.clientHeight - 160
    const move = (ev: PointerEvent) => setDrawer(current => ({ ...current, folded: false, height: Math.round(Math.max(120, Math.min(most, startHeight + startY - ev.clientY))) }))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragEnd.current = null
    }
    const up = () => {
      stop()
      keep.current = true
      setDrawer(current => ({ ...current }))
    }
    dragEnd.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const repo = git && git.repo ? git : null
  const changed = repo ? new Set([...lists(repo.files).staged, ...lists(repo.files).unstaged].map(f => f.path)).size : 0

  return (
    <aside className="bench" aria-label={t('Workbench')} ref={bench}>
      <div className="bench-head">
        <Icon name="folder" />
        <span className="bench-title" title={root}>
          {baseName(root) || root}
        </span>
        {repo?.branch.head ? (
          <span className="bench-branch" title={repo.branch.upstream ?? undefined}>
            <Icon name="branch" />
            {repo.branch.head}
            {repo.branch.ahead ? <span className="meta">↑{repo.branch.ahead}</span> : null}
          </span>
        ) : null}
        <span className="spacer" />
        <button className="staged-remove" aria-label={t('Close Workbench')} title={`${t('Close Workbench')} (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}B)`} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <TabStrip<BenchView | BenchPage>
        tabs={[...BENCH_VIEWS, ...pages]}
        keyOf={tab => (typeof tab === 'string' ? tab : pageKey(tab))}
        active={shown}
        label={tab =>
          tab === 'changes'
            ? { title: t('Changes'), icon: <Icon name="branch" />, count: changed || undefined, fixed: true }
            : tab === 'files'
              ? { title: t('Files'), icon: <Icon name="folder" />, fixed: true }
              : {
                  title: tab.title || (tab.url ? shownAddress(tab.url) : t('New Tab')),
                  icon: <Icon name={tab.url && hostPageParts(tab.url) ? 'server' : 'globe'} />,
                  hint: tab.url ? shownAddress(tab.url) : undefined
                }
        }
        onPick={tab => setView(typeof tab === 'string' ? tab : pageKey(tab))}
        onClose={tab => {
          if (typeof tab !== 'string') closePage(tab)
        }}
        onNewTab={pages.length < MAX_PAGES ? () => newPage() : undefined}
        newTabLabel={t('New Browser Tab')}
        ariaLabel={t('Workbench')}
        className="bench-tabs"
      />
      <BenchTimeline steps={steps} at={stepAt ? stepAt.key : null} onPick={pickStep} />
      <div className="bench-body">
        <div className="bench-view" hidden={shown !== 'changes'}>
          {plugin === null ? (
            <div className="bench-note">{t('Loading…')}</div>
          ) : plugin.git ? (
            <ChangesView key={`${profile ?? ''}\t${root}`} root={root} profile={profile} refreshKey={refreshKey} shown={shown === 'changes'} onStatus={onStatus} onOpenFile={openFile} />
          ) : (
            <div className="bench-note">{t('Update the Conduit plugin on this host to see what changed here.')}</div>
          )}
        </div>
        <div className="bench-view" hidden={shown !== 'files'}>
          <FilesPanel root={root} profile={profile} refreshKey={refreshKey} reveal={opened} onInsertPath={onInsertPath} onClose={onClose} embedded />
        </div>
        {pages.map(page => (
          <div key={page.id} className="bench-view" hidden={shown !== pageKey(page)}>
            <BrowserView page={page} hostKey={hostKey} hostPages={plugin?.preview === true} shown={shown === pageKey(page)} onChange={changePage} />
          </div>
        ))}
      </div>
      {plugin ? (
        <>
          {drawer.folded ? null : <div className="bench-drawer-line" role="separator" aria-orientation="horizontal" aria-label={t('Terminal height')} onPointerDown={startDrag} />}
          <div className="bench-drawer-frame" style={drawer.folded ? undefined : { height: drawer.height }}>
            <TerminalDrawer
              key={`${profile ?? ''}\t${root}`}
              root={root}
              profile={profile}
              folded={drawer.folded}
              onFold={() => changeDrawer({ ...drawer, folded: !drawer.folded })}
              shells={plugin.terminals}
              steps={steps}
              at={stepAt ? commandAt(steps, stepAt.key) : null}
              botTurn={botTurn}
            />
          </div>
        </>
      ) : null}
    </aside>
  )
}
