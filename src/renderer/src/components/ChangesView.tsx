import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  actionPath,
  branchesPath,
  commitsAll,
  diffLines,
  diffPath,
  gitError,
  hostPath,
  letter,
  lists,
  parseBranches,
  parseDiff,
  parseStatus,
  splitPath,
  statusPath,
  type BranchRow,
  type ChangedFile,
  type FileDiff,
  type GitAction,
  type GitStatus
} from '../state/sourceControl'
import { ask, askText } from '../state/dialogs'
import { Icon } from './icons'

/** How often the shown Changes reads the folder again: files change under it from the bot and the terminals. */
export const CHANGES_POLL_MS = 6_000

type Picked = { path: string; staged: boolean }
type Loaded = GitStatus | { error: string } | 'loading'

/**
 * The workbench's Changes (issue 452): the branch, the commit box, what's
 * staged and what isn't, and the picked file's diff beside them. Bot edits
 * and the person's land in the same lists, since both are files in the
 * folder.
 */
export function ChangesView({
  root,
  profile,
  refreshKey,
  shown,
  onStatus,
  onOpenFile
}: {
  root: string
  profile?: string
  /** Changes when a reply ends: the bot may have changed files. */
  refreshKey: number
  /** Whether the tab is on screen: it reads the folder again only then. */
  shown: boolean
  /** The status as read, for the bench's header and its tab's count. */
  onStatus: (status: GitStatus | null) => void
  /** Opens a file in the bench's Files. */
  onOpenFile: (path: string) => void
}) {
  const [status, setStatus] = useState<Loaded>('loading')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [diff, setDiff] = useState<FileDiff | { error: string } | 'loading' | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<GitAction | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [branches, setBranches] = useState<{ local: BranchRow[]; remote: BranchRow[] } | 'loading' | null>(null)
  const reading = useRef(0)

  const read = useCallback(async () => {
    const asked = ++reading.current
    try {
      const next = parseStatus(await gateway.http('GET', statusPath(root, profile)))
      if (asked !== reading.current) return
      setStatus(next)
      onStatus(next)
    } catch (e) {
      if (asked !== reading.current) return
      setStatus(current => (current === 'loading' || 'error' in (current as object) ? { error: gitError(e) } : current))
      onStatus(null)
    }
  }, [root, profile, onStatus])

  useEffect(() => {
    setStatus('loading')
    setPicked(null)
    setDiff(null)
    setBranches(null)
  }, [root, profile])
  useEffect(() => {
    void read()
  }, [read, refreshKey])
  useEffect(() => {
    if (!shown) return
    void read()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && busy === null) void read()
    }, CHANGES_POLL_MS)
    const focused = () => void read()
    window.addEventListener('focus', focused)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', focused)
    }
  }, [shown, read, busy])

  const repo = status !== 'loading' && !('error' in status) && status.repo ? status : null

  // The picked file's diff, read again whenever the status does (its lines may have moved).
  const pickedKey = picked ? `${picked.staged ? 's' : 'u'}:${picked.path}` : null
  const statusStamp = repo ? JSON.stringify(repo.files.find(f => f.path === picked?.path) ?? null) : ''
  useEffect(() => {
    if (!picked || !repo) return
    const file = repo.files.find(f => f.path === picked.path)
    if (!file || (picked.staged ? file.staged === null : file.unstaged === null)) {
      setPicked(null)
      setDiff(null)
      return
    }
    if (file.secret) {
      setDiff({ error: t("Conduit doesn't open files that hold keys or passwords") })
      return
    }
    let live = true
    setDiff(current => (current && current !== 'loading' && !('error' in current) && current.path === picked.path ? current : 'loading'))
    gateway
      .http('GET', diffPath(root, picked.path, picked.staged, profile))
      .then(raw => live && setDiff(parseDiff(raw)))
      .catch(e => live && setDiff({ error: gitError(e) }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, statusStamp, root, profile])

  const act = async (action: GitAction, body: Record<string, unknown> = {}): Promise<boolean> => {
    setBusy(action)
    setFailed(null)
    try {
      const answer = (await gateway.http('POST', actionPath(action, profile), { root, ...body })) as { status?: unknown }
      if (answer?.status) {
        const next = parseStatus(answer.status)
        setStatus(next)
        onStatus(next)
      } else void read()
      return true
    } catch (e) {
      setFailed(gitError(e))
      void read()
      return false
    } finally {
      setBusy(null)
    }
  }

  const stage = (files: ChangedFile[]) => act('stage', { paths: files.map(f => f.path) })
  const unstage = (files: ChangedFile[]) => act('unstage', { paths: files.map(f => f.path) })
  const discard = async (files: ChangedFile[]) => {
    const added = files.filter(f => f.unstaged === 'untracked')
    const question =
      files.length === 1
        ? added.length
          ? t('Delete {name}? It’s a new file, so it can’t be brought back.', { name: splitPath(files[0]!.path).name })
          : t('Discard your changes to {name}?', { name: splitPath(files[0]!.path).name })
        : t('Discard the changes to {count} files? New files are deleted.', { count: files.length })
    if (!(await ask(question, { confirm: t('Discard'), destructive: true }))) return
    await act('discard', { paths: files.map(f => f.path) })
  }
  const commit = async () => {
    if (!repo || !message.trim()) return
    if (await act('commit', { message: message.trim(), all: commitsAll(repo) })) setMessage('')
  }
  const openBranches = () => {
    if (branches) return setBranches(null)
    setBranches('loading')
    gateway
      .http('GET', branchesPath(root, profile))
      .then(raw => setBranches(parseBranches(raw)))
      .catch(e => {
        setBranches(null)
        setFailed(gitError(e))
      })
  }
  const switchTo = async (name: string, create = false) => {
    setBranches(null)
    await act('switch', { branch: name, create })
  }
  const newBranch = async () => {
    setBranches(null)
    const name = await askText(t('New branch name'), '', { confirm: t('Create Branch') })
    if (name?.trim()) await act('switch', { branch: name.trim(), create: true })
  }

  if (status === 'loading') return <div className="bench-note">{t('Reading what changed…')}</div>
  if ('error' in status)
    return (
      <div className="bench-note">
        <p className="error-text">{status.error}</p>
        <button className="secondary" onClick={() => void read()}>
          {t('Try Again')}
        </button>
      </div>
    )
  if (!status.repo)
    return (
      <div className="bench-empty">
        <Icon name="branch" />
        <h3>{t('This folder isn’t a Git repository')}</h3>
        <p className="meta">{t('Start one to see what changes here, commit it and push it, from Conduit or the bot.')}</p>
        <button className="primary" disabled={busy !== null} onClick={() => void act('init')}>
          {t('Start a Repository')}
        </button>
        {failed ? <p className="error-text">{failed}</p> : null}
      </div>
    )

  const { staged, unstaged } = lists(status.files)
  const all = commitsAll(status)
  const branch = status.branch
  const row = (file: ChangedFile, inStaged: boolean) => {
    const { name, folder } = splitPath(file.path)
    const state = inStaged ? file.staged : file.unstaged
    const added = inStaged ? file.stagedAdded : file.added
    const removed = inStaged ? file.stagedRemoved : file.removed
    const on = picked?.path === file.path && picked.staged === inStaged
    return (
      <div key={`${inStaged ? 's' : 'u'}:${file.path}`} className={`git-row${on ? ' on' : ''}`}>
        <button className="git-row-main" title={file.from ? `${file.from} → ${file.path}` : file.path} onClick={() => setPicked({ path: file.path, staged: inStaged })}>
          <span className={`git-letter ${state ?? ''}`}>{letter(state)}</span>
          <span className="git-name">{name}</span>
          {folder ? <span className="git-folder">{folder}</span> : null}
          <span className="git-counts">
            {added ? <span className="plus">+{added}</span> : null}
            {removed ? <span className="minus">−{removed}</span> : null}
          </span>
        </button>
        <span className="git-row-actions">
          {!inStaged && state !== 'deleted' ? (
            <button className="git-icon" title={t('Open File')} aria-label={t('Open File')} onClick={() => onOpenFile(hostPath(status.top, file.path))}>
              <Icon name="file" />
            </button>
          ) : null}
          {!inStaged ? (
            <button className="git-icon" title={t('Discard Changes')} aria-label={t('Discard Changes')} disabled={busy !== null} onClick={() => void discard([file])}>
              <Icon name="undo" />
            </button>
          ) : null}
          <button
            className="git-icon"
            title={inStaged ? t('Unstage') : t('Stage')}
            aria-label={inStaged ? t('Unstage') : t('Stage')}
            disabled={busy !== null}
            onClick={() => void (inStaged ? unstage([file]) : stage([file]))}
          >
            {inStaged ? '−' : '+'}
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className="changes">
      <div className="changes-side">
        <div className="git-branch">
          <button className="git-branch-name" onClick={openBranches} title={t('Switch Branch')} aria-expanded={!!branches}>
            <Icon name="branch" />
            <span>{branch.head ?? (branch.detached ? t('Detached') : t('No branch yet'))}</span>
            <Icon name="chevronDown" />
          </button>
          {branch.ahead ? <span className="meta" title={t('Commits to push')}>↑{branch.ahead}</span> : null}
          {branch.behind ? <span className="meta" title={t('Commits to pull')}>↓{branch.behind}</span> : null}
          <span className="spacer" />
          <button className="git-icon" title={t('Fetch')} aria-label={t('Fetch')} disabled={busy !== null || !branch.upstream} onClick={() => void act('fetch')}>
            {busy === 'fetch' ? <Icon name="spinner" /> : <Icon name="refresh" />}
          </button>
          <button className="secondary small" disabled={busy !== null || !branch.upstream || !branch.behind} onClick={() => void act('pull')}>
            {busy === 'pull' ? t('Pulling…') : t('Pull')}
          </button>
          <button className="secondary small" disabled={busy !== null || (!!branch.upstream && !branch.ahead)} onClick={() => void act('push')}>
            {busy === 'push' ? t('Pushing…') : branch.upstream ? t('Push') : t('Publish Branch')}
          </button>
        </div>
        {branches ? (
          <div className="git-branches" role="menu">
            {branches === 'loading' ? (
              <div className="bench-note">{t('Loading…')}</div>
            ) : (
              <>
                <button role="menuitem" className="git-branch-row new" onClick={() => void newBranch()}>
                  + {t('New Branch…')}
                </button>
                {branches.local.map(b => (
                  <button key={b.name} role="menuitem" className={`git-branch-row${b.current ? ' on' : ''}`} disabled={b.current} onClick={() => void switchTo(b.name)}>
                    {b.name}
                    {b.upstream ? <span className="meta">{b.upstream}</span> : null}
                  </button>
                ))}
                {branches.remote
                  .filter(r => !branches.local.some(l => r.name.endsWith(`/${l.name}`)))
                  .map(r => (
                    <button key={r.name} role="menuitem" className="git-branch-row" onClick={() => void switchTo(r.name.slice(r.name.indexOf('/') + 1))}>
                      {r.name}
                    </button>
                  ))}
              </>
            )}
          </div>
        ) : null}
        <div className="git-commit">
          <textarea
            id="git-commit-message"
            value={message}
            placeholder={t('Commit message')}
            rows={2}
            spellCheck
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void commit()
              }
            }}
          />
          <button className="primary" disabled={busy !== null || !message.trim() || (!staged.length && !all)} onClick={() => void commit()}>
            {busy === 'commit' ? t('Committing…') : all ? t('Commit All') : staged.length ? t('Commit {count}', { count: staged.length }) : t('Commit')}
          </button>
        </div>
        {failed ? <p className="error-text git-failed">{failed}</p> : null}
        <div className="git-lists">
          {!status.files.length ? <div className="bench-note">{t('Nothing changed since the last commit.')}</div> : null}
          {staged.length ? (
            <section>
              <div className="git-list-head">
                <span>{t('Staged')}</span>
                <span className="meta">{staged.length}</span>
                <span className="spacer" />
                <button className="git-icon" title={t('Unstage All')} aria-label={t('Unstage All')} disabled={busy !== null} onClick={() => void act('unstage', { all: true })}>
                  −
                </button>
              </div>
              {staged.map(file => row(file, true))}
            </section>
          ) : null}
          {unstaged.length ? (
            <section>
              <div className="git-list-head">
                <span>{t('Changes')}</span>
                <span className="meta">{unstaged.length}</span>
                <span className="spacer" />
                <button className="git-icon" title={t('Discard All Changes')} aria-label={t('Discard All Changes')} disabled={busy !== null} onClick={() => void discard(unstaged)}>
                  <Icon name="undo" />
                </button>
                <button className="git-icon" title={t('Stage All')} aria-label={t('Stage All')} disabled={busy !== null} onClick={() => void act('stage', { all: true })}>
                  +
                </button>
              </div>
              {unstaged.map(file => row(file, false))}
            </section>
          ) : null}
          {status.truncated ? <div className="bench-note">{t('Only the first 2,000 changed files are listed.')}</div> : null}
        </div>
      </div>
      <div className="changes-diff">
        {!picked ? (
          <div className="bench-note">{status.files.length ? t('Pick a file to see what changed in it.') : null}</div>
        ) : diff === 'loading' || diff === null ? (
          <div className="bench-note">{t('Loading…')}</div>
        ) : 'error' in diff ? (
          <div className="bench-note error-text">{diff.error}</div>
        ) : (
          <DiffView diff={diff} onOpen={() => onOpenFile(hostPath(status.top, diff.path))} />
        )}
      </div>
    </div>
  )
}

function DiffView({ diff, onOpen }: { diff: FileDiff; onOpen: () => void }) {
  const lines = diffLines(diff.diff)
  return (
    <div className="diff-view">
      <div className="diff-head">
        <span className="diff-path" title={diff.path}>
          {diff.path}
        </span>
        <span className="meta">{diff.staged ? t('Staged') : t('Changes')}</span>
        <span className="spacer" />
        <button className="secondary small" onClick={onOpen}>
          {t('Open File')}
        </button>
      </div>
      {diff.binary ? (
        <p className="bench-note">{t("This file isn't text, so its changes can't be shown here.")}</p>
      ) : !lines.length ? (
        <p className="bench-note">{t('No changes to show.')}</p>
      ) : (
        <pre className="diff-lines">
          {lines.map((line, at) =>
            line.kind === 'hunk' ? (
              <div key={at} className="diff-hunk">
                {line.text}
              </div>
            ) : line.kind === 'note' ? (
              <div key={at} className="diff-note">
                {line.text}
              </div>
            ) : (
              <div key={at} className={`diff-line ${line.kind}`}>
                <span className="diff-num">{line.old ?? ''}</span>
                <span className="diff-num">{line.new ?? ''}</span>
                <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
                <span className="diff-text">{line.text || ' '}</span>
              </div>
            )
          )}
          {diff.truncated ? <div className="diff-note">{t('Only the start of this diff is shown.')}</div> : null}
        </pre>
      )}
    </div>
  )
}
