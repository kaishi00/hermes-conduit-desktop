import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { STATUS_PATH, askAgainMs, askPluginStatus, serves } from '../state/plugin'
import { GIT_CAPABILITY, lists, type GitStatus } from '../state/sourceControl'
import { TERMINALS_CAPABILITY } from '../state/terminals'
import { BENCH_VIEWS, readDrawer, writeDrawer, type BenchView, type DrawerState } from '../state/workbench'
import { baseName } from '../state/workspace'
import { ChangesView } from './ChangesView'
import { FilesPanel } from './FilesPanel'
import { TabStrip } from './TabStrip'
import { TerminalDrawer } from './TerminalDrawer'
import { Icon } from './icons'

/**
 * The workbench beside a chat with a folder (Eric, 2026-11-26, "B · Project
 * mode"; desktop issues 450 to 453): the chat's folder as a project, its
 * views on the same tab strip the chat tabs use (Changes, Files), and its
 * terminals in a drawer below. Everything here is on the Hermes host: Git
 * and the shells run there, in the chat's folder.
 */
export function Workbench({
  root,
  profile,
  refreshKey,
  reveal,
  onInsertPath,
  onClose
}: {
  root: string
  profile?: string
  refreshKey: number
  /** A file a reply named: the bench shows it in Files. */
  reveal?: { path: string; id: number } | null
  onInsertPath: (path: string) => void
  onClose: () => void
}) {
  const [view, setView] = useState<BenchView>('changes')
  const [git, setGit] = useState<GitStatus | null>(null)
  const [plugin, setPlugin] = useState<{ git: boolean; terminals: boolean } | null>(null)
  const [drawer, setDrawer] = useState<DrawerState>(readDrawer)
  const [opened, setOpened] = useState<{ path: string; id: number } | null>(null)
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
        setPlugin({ git: serves(status, [GIT_CAPABILITY]), terminals: serves(status, [TERMINALS_CAPABILITY]) })
      })
    setPlugin(null)
    ask(0)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [root, profile])
  useEffect(() => setGit(null), [root, profile])
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
      <TabStrip
        tabs={BENCH_VIEWS}
        keyOf={v => v}
        active={view}
        label={v =>
          v === 'changes'
            ? { title: t('Changes'), icon: <Icon name="branch" />, count: changed || undefined, fixed: true }
            : { title: t('Files'), icon: <Icon name="folder" />, fixed: true }
        }
        onPick={setView}
        ariaLabel={t('Workbench')}
        className="bench-tabs"
      />
      <div className="bench-body">
        <div className="bench-view" hidden={view !== 'changes'}>
          {plugin === null ? (
            <div className="bench-note">{t('Loading…')}</div>
          ) : plugin.git ? (
            <ChangesView key={`${profile ?? ''}\t${root}`} root={root} profile={profile} refreshKey={refreshKey} shown={view === 'changes'} onStatus={onStatus} onOpenFile={openFile} />
          ) : (
            <div className="bench-note">{t('Update the Conduit plugin on this host to see what changed here.')}</div>
          )}
        </div>
        <div className="bench-view" hidden={view !== 'files'}>
          <FilesPanel root={root} profile={profile} refreshKey={refreshKey} reveal={opened} onInsertPath={onInsertPath} onClose={onClose} embedded />
        </div>
      </div>
      {plugin?.terminals ? (
        <>
          {drawer.folded ? null : <div className="bench-drawer-line" role="separator" aria-orientation="horizontal" aria-label={t('Terminal height')} onPointerDown={startDrag} />}
          <div className="bench-drawer-frame" style={drawer.folded ? undefined : { height: drawer.height }}>
            <TerminalDrawer key={`${profile ?? ''}\t${root}`} root={root} profile={profile} folded={drawer.folded} onFold={() => changeDrawer({ ...drawer, folded: !drawer.folded })} />
          </div>
        </>
      ) : null}
    </aside>
  )
}
