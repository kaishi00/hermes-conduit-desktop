import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import {
  baseName,
  changePath,
  childPath,
  dataUrlPath,
  fsListPath,
  isImage,
  listPath,
  parentPath,
  parseListing,
  parsePreview,
  parseSearch,
  readTextPath,
  relativePath,
  searchPath,
  sizeText,
  validName,
  type FilePreview,
  type WorkspaceEntry,
  type WorkspaceListing,
  type WorkspaceSearch
} from '../state/workspace'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'
import { saveHostFile, sayIfFailed } from '../state/saveMedia'
import { ask, askText } from '../state/dialogs'
import { useFittedMenu } from '../state/menuFit'
import { NO_TABS, closeTab, closeTabsUnder, renameTabs, showTab, updateTab, type FolderTabs } from '../state/folderTabs'

interface Props {
  /** The chat's working folder: the tree never goes above it. */
  root: string
  profile?: string
  /** Changes when a reply ends: the agent may have changed files. */
  refreshKey: number
  /** A file a reply named, opened on each new id. */
  reveal?: { path: string; id: number } | null
  /** Puts a path in the chat's draft. */
  onInsertPath: (path: string) => void
  onClose: () => void
  /** The side panel's tabs, atop it. */
  tabs?: ReactNode
}

type Listed = WorkspaceListing | { error: string } | 'loading'

type OpenFile = {
  entry: WorkspaceEntry
  preview: FilePreview | null
  image?: string
  error?: string
  /** The text being edited; undefined while reading. */
  draft?: string
  saving?: boolean
  /** A folder's entries, for a folder a reply named (or one opened from it). */
  folder?: WorkspaceListing
  /** The folders opened before this one in the viewer, newest last: Back returns to them. */
  back?: WorkspaceEntry[]
  /** A reply ended since its text was read: going back to the tab reads it again. */
  stale?: boolean
}

type Menu = { entry: WorkspaceEntry; x: number; y: number }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The Folder beside the chat, after the phone's: the chat's working folder
 * as a tree, search, a file's text or picture, editing, and the changes a
 * row's menu makes. Without the plugin's routes it browses and reads through
 * Hermes' own, and offers no search or changes.
 */
export function FilesPanel({ root, profile, refreshKey, reveal, onInsertPath, onClose, tabs }: Props) {
  const [plugin, setPlugin] = useState<boolean | null>(null)
  const [listings, setListings] = useState<Record<string, Listed>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root]))
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<WorkspaceSearch | 'loading' | { error: string } | null>(null)
  // The open files, a tab each (issue 454); `open` is the one shown, none while the tree shows.
  const [files, setFiles] = useState<FolderTabs<OpenFile>>(NO_TABS)
  const open = files.files.find(f => f.entry.path === files.active) ?? null
  const filesRef = useRef(files)
  filesRef.current = files
  const setTab = (path: string, change: (file: OpenFile) => OpenFile) => setFiles(current => updateTab(current, path, change))
  const [menu, setMenu] = useState<Menu | null>(null)
  const menuFit = useFittedMenu(menu)
  const [note, setNote] = useState<string | null>(null)
  const generation = useRef(0)
  const pluginRef = useRef<boolean | null>(null)
  pluginRef.current = plugin

  /** A folder's listing: the plugin's, else Hermes' own once the plugin said it doesn't serve it. */
  const list = useCallback(
    async (path: string) => {
      const mine = generation.current
      // The workspace's top folder opens on what it listed last time, then reads Hermes again (keptAnswers.ts).
      const keptPath = path === root ? `files:${profile ?? 'default'}:${root}` : null
      const keep = keptPath ? answerKeeper(keptPath) : null
      const kept = keptPath ? keptAnswer(keptPath) : undefined
      setListings(current =>
        current[path] && current[path] !== 'loading' ? current : { ...current, [path]: kept !== undefined ? parseListing(kept) : 'loading' }
      )
      let listed: Listed
      try {
        let raw: unknown
        if (pluginRef.current !== false) {
          try {
            raw = await gateway.http('GET', listPath(root, path, profile))
            if (pluginRef.current === null) setPlugin(true)
          } catch (e) {
            if ((e as { code?: unknown }).code !== 404) throw e
            setPlugin(false)
            pluginRef.current = false
            raw = await gateway.http('GET', fsListPath(path, profile))
          }
        } else {
          raw = await gateway.http('GET', fsListPath(path, profile))
        }
        listed = parseListing(raw)
        if (!('error' in listed)) keep?.(raw)
      } catch (e) {
        listed = { error: message(e) }
      }
      if (mine === generation.current) setListings(current => ({ ...current, [path]: listed }))
    },
    [root, profile]
  )

  // A new root starts over.
  useEffect(() => {
    generation.current++
    setPlugin(null)
    pluginRef.current = null
    setListings({})
    setExpanded(new Set([root]))
    setFiles(NO_TABS)
    setQuery('')
    setSearch(null)
    void list(root)
  }, [root, profile, list])

  const refresh = useCallback(() => {
    for (const path of expanded) void list(path)
    // A folder shown in a tab (one a reply named) lists again too.
    for (const tab of filesRef.current.files) {
      if (!tab.folder) continue
      const path = tab.entry.path
      gateway
        .http('GET', fsListPath(path, profile))
        .then(raw => parseListing(raw))
        .then(listing => setTab(path, current => ({ ...current, folder: listing, error: undefined })))
        .catch(e => setTab(path, current => ({ ...current, error: message(e) })))
    }
    // The agent may have changed an open file: a tab without changes reads it again when it's next picked.
    setFiles(current => ({ ...current, files: current.files.map(f => (f.draft === undefined && !f.entry.isDirectory ? { ...f, stale: true } : f)) }))
  }, [expanded, list, profile])

  // After a reply: the open folders again.
  const firstRefresh = useRef(true)
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false
      return
    }
    refresh()
    // Only the reply's end reads again, not each folder opened.
  }, [refreshKey])

  // Search as the words settle.
  useEffect(() => {
    const words = query.trim()
    if (!words || !plugin) {
      setSearch(null)
      return
    }
    setSearch('loading')
    let live = true
    const timer = setTimeout(() => {
      gateway
        .http('GET', searchPath(root, words, profile))
        .then(raw => live && setSearch(parseSearch(raw)))
        .catch(e => live && setSearch({ error: message(e) }))
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, plugin, root, profile])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const toggle = (entry: WorkspaceEntry) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(entry.path)) next.delete(entry.path)
      else {
        next.add(entry.path)
        void list(entry.path)
      }
      return next
    })
  }

  // A folder over the tree, wherever it is on the host: its entries, each opening in turn.
  // `inPlace`: in the shown tab's place, walking a folder a reply named (Back returns); else a tab of its own.
  const openFolder = async (entry: WorkspaceEntry, back: WorkspaceEntry[] = [], inPlace = false) => {
    const folder = { ...entry, isDirectory: true }
    setFiles(current => showTab(current, { entry: folder, preview: null, back }, inPlace))
    try {
      const listing = parseListing(await gateway.http('GET', fsListPath(folder.path, profile)))
      setTab(folder.path, current => ({ ...current, folder: listing }))
    } catch (e) {
      setTab(folder.path, current => ({ ...current, error: message(e) }))
    }
  }

  const openFile = async (entry: WorkspaceEntry, back: WorkspaceEntry[] = [], inPlace = false) => {
    if (entry.isDirectory) return openFolder(entry, back, inPlace)
    // A file already open goes back to its tab and the text read for it, unless a reply ended since.
    // Opened from a reply's folder too: a tab with changes is never read over (#549 review).
    const kept = files.files.find(f => f.entry.path === entry.path && !f.entry.isDirectory)
    if (kept && (!kept.stale || kept.draft !== undefined) && !kept.error) return setFiles(current => ({ ...current, active: entry.path }))
    // A stale tab read again keeps the folders it was walked through.
    setFiles(current => showTab(current, { entry, preview: null, back: kept && !inPlace ? (kept.back ?? []) : back }, inPlace && !kept))
    try {
      if (isImage(entry.name)) {
        const raw = (await gateway.http('GET', dataUrlPath(entry.path, profile))) as { data_url?: unknown; dataUrl?: unknown } | null
        const url = typeof raw?.data_url === 'string' ? raw.data_url : typeof raw?.dataUrl === 'string' ? raw.dataUrl : undefined
        setTab(entry.path, current => ({ ...current, image: url, error: url ? undefined : t("Couldn't open this file") }))
        return
      }
      const preview = parsePreview(await gateway.http('GET', readTextPath(entry.path, profile)))
      // A save checks the date the folder listed; one opened from search finds it in its folder.
      let dated = entry
      if (dated.mtime === undefined && pluginRef.current) {
        try {
          const folder = parseListing(await gateway.http('GET', listPath(root, parentPath(entry.path), profile)))
          dated = folder.entries.find(row => row.path === entry.path) ?? entry
        } catch {
          // Read only, then.
        }
      }
      setTab(entry.path, current => ({ ...current, entry: dated, preview }))
    } catch (e) {
      // A path a reply named that turns out to be a folder (Hermes: "Path points to a directory") shows its entries.
      if (/director/i.test(message(e))) return openFolder(entry, back, true)
      setTab(entry.path, current => ({ ...current, error: message(e) }))
    }
  }

  // A file a reply named: opened over the tree, wherever it is on the host.
  const revealed = useRef<number | null>(null)
  useEffect(() => {
    if (!reveal || reveal.id === revealed.current) return
    revealed.current = reveal.id
    const path = reveal.path.replace(/[\\/]+$/, '') || reveal.path
    void openFile({ name: baseName(path), path, isDirectory: /[\\/]$/.test(reveal.path) })
  })

  const change = async (action: Parameters<typeof changePath>[0], body: Record<string, unknown>, folders: string[]) => {
    setNote(null)
    try {
      return (await gateway.http('POST', changePath(action, profile), { root, ...body })) as { entry?: unknown } | null
    } catch (e) {
      setNote(message(e))
      // Refused: false, told apart from a change that answers with no body.
      return false as const
    } finally {
      for (const folder of folders) void list(folder)
    }
  }

  const askName = async (title: string, initial = '') => {
    const name = await askText(title, initial)
    if (name === null) return null
    if (!validName(name)) {
      setNote(t('That name can’t be used.'))
      return null
    }
    return name.trim()
  }

  const create = async (folder: string, kind: 'file' | 'folder') => {
    const name = await askName(kind === 'file' ? t('New file name') : t('New folder name'))
    if (!name) return
    setExpanded(current => new Set(current).add(folder))
    const made = await change(kind === 'file' ? 'new-file' : 'mkdir', { path: folder, name }, [folder])
    if (made && kind === 'file') {
      const entry = { name, path: childPath(folder, name), isDirectory: false }
      void openFile(entry)
    }
  }

  const save = async (replace = false) => {
    if (!open || open.draft === undefined) return
    const { entry, draft } = open
    setTab(entry.path, current => ({ ...current, saving: true }))
    setNote(null)
    try {
      const answer = (await gateway.http('POST', changePath('save', profile), {
        root,
        path: entry.path,
        content: draft,
        ...(replace || entry.mtime === undefined ? {} : { expected_mtime: entry.mtime / 1000 })
      })) as { entry?: { mtime?: unknown } } | null
      const mtime = typeof answer?.entry?.mtime === 'number' ? answer.entry.mtime * 1000 : undefined
      // Text typed while the save ran stays as changes on the saved file, as on the phone.
      setTab(entry.path, current => ({
        ...current,
        entry: { ...entry, mtime },
        preview: current.preview && { ...current.preview, text: draft },
        draft: current.draft === draft ? undefined : current.draft,
        saving: false
      }))
      void list(parentPath(entry.path))
    } catch (e) {
      setTab(entry.path, current => ({ ...current, saving: false }))
      if ((e as { code?: unknown }).code === 409 && await ask(`${message(e)}\n\n${t('Replace it with your changes?')}`)) void save(true)
      else setNote(message(e))
    }
  }

  const row = (entry: WorkspaceEntry, depth: number) => (
    <div key={entry.path}>
      <button
        className="ws-row"
        style={{ paddingLeft: 10 + depth * 14 }}
        title={entry.path}
        draggable
        onDragStart={e => e.dataTransfer.setData('text/plain', entry.path)}
        onClick={() => (entry.isDirectory ? toggle(entry) : void openFile(entry))}
        onContextMenu={e => {
          e.preventDefault()
          setMenu({ entry, x: e.clientX, y: e.clientY })
        }}
      >
        <span className="ws-twisty">{entry.isDirectory ? (expanded.has(entry.path) ? '▾' : '▸') : ''}</span>
        <Icon name={entry.isDirectory ? 'folder' : isImage(entry.name) ? 'image' : 'file'} />
        <span className="ws-name">{entry.name}</span>
      </button>
      {entry.isDirectory && expanded.has(entry.path) ? folderRows(entry.path, depth + 1) : null}
    </div>
  )

  const folderRows = (path: string, depth: number) => {
    const listed = listings[path]
    if (!listed || listed === 'loading') return <div className="ws-note" style={{ paddingLeft: 24 + depth * 14 }}>{t('Loading…')}</div>
    if ('error' in listed) return <div className="ws-note error-text" style={{ paddingLeft: 24 + depth * 14 }}>{listed.error}</div>
    if (!listed.entries.length) return <div className="ws-note" style={{ paddingLeft: 24 + depth * 14 }}>{t('Empty Folder')}</div>
    return listed.entries.map(entry => row(entry, depth))
  }

  // Back: to the folder this was opened from, in the same tab; else to the tree, every tab kept with its changes.
  const closeViewer = async () => {
    const back = open?.back ?? []
    const previous = back.at(-1)
    if (!previous) return setFiles(current => ({ ...current, active: null }))
    if (open?.draft !== undefined && !(await ask(t('Discard unsaved changes?')))) return
    void openFolder(previous, back.slice(0, -1), true)
  }
  const closeFile = async (file: OpenFile) => {
    if (file.draft !== undefined && !(await ask(t('Discard unsaved changes?')))) return
    setFiles(current => closeTab(current, file.entry.path))
  }
  const tabStrip =
    files.files.length > 1 || (!open && files.files.length) ? (
      <div className="ws-tabs" role="tablist">
        {files.files.map(file => (
          <div key={file.entry.path} className={`ws-tab${file.entry.path === files.active ? ' on' : ''}`}>
            <button
              role="tab"
              aria-selected={file.entry.path === files.active}
              title={file.entry.path}
              onClick={() =>
                file.entry.isDirectory && !file.error
                  ? setFiles(current => ({ ...current, active: file.entry.path }))
                  : file.entry.isDirectory
                    ? void openFolder(file.entry, file.back ?? [])
                    : void openFile(file.entry)
              }
              onAuxClick={e => e.button === 1 && void closeFile(file)}
            >
              {file.draft !== undefined ? <span className="ws-tab-dot" aria-hidden="true" /> : null}
              {file.entry.name}
            </button>
            <button className="ws-tab-close" aria-label={t('Close Tab')} title={t('Close Tab')} onClick={() => void closeFile(file)}>
              ×
            </button>
          </div>
        ))}
      </div>
    ) : null
  useMouseBack(open ? closeViewer : null)

  const viewer = open ? (
    <div className="ws-viewer">
      <div className="ws-viewer-head">
        <button className="staged-remove" data-back aria-label={t('Back')} title={t('Back')} onClick={closeViewer}>
          ‹
        </button>
        <span className="ws-viewer-name" title={open.entry.path}>
          {open.entry.name}
        </span>
        {open.preview?.size !== undefined ? <span className="meta">{sizeText(open.preview.size)}</span> : null}
        <span className="spacer" />
        {open.draft !== undefined ? (
          <>
            <button className="secondary" disabled={open.saving} onClick={() => setTab(open.entry.path, current => ({ ...current, draft: undefined }))}>
              {t('Cancel')}
            </button>
            <button className="primary" disabled={open.saving} onClick={() => void save()}>
              {open.saving ? t('Saving…') : t('Save')}
            </button>
          </>
        ) : open.entry.isDirectory ? null : (
          <>
            <button className="secondary" onClick={() => void saveHostFile(open.entry.path, profile).then(sayIfFailed)}>
              {t('Download')}
            </button>
            {plugin && open.preview && !open.preview.binary && !open.preview.truncated ? (
              <button className="secondary" onClick={() => setTab(open.entry.path, current => ({ ...current, draft: current.preview?.text ?? '' }))}>
                {t('Edit')}
              </button>
            ) : null}
          </>
        )}
      </div>
      {open.error ? <p className="error-text">{open.error}</p> : null}
      {open.folder ? (
        <div className="ws-folder">
          {open.folder.entries.length ? null : <p className="meta">{t('Empty Folder')}</p>}
          {open.folder.entries.map(entry => (
            <button
              key={entry.path}
              className="ws-row"
              title={entry.path}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/plain', entry.path)}
              onClick={() => void openFile(entry, [...(open.back ?? []), open.entry], true)}
            >
              <span className="ws-twisty" />
              <Icon name={entry.isDirectory ? 'folder' : isImage(entry.name) ? 'image' : 'file'} />
              <span className="ws-name">{entry.name}</span>
              {!entry.isDirectory && entry.size !== undefined ? <span className="meta">{sizeText(entry.size)}</span> : null}
            </button>
          ))}
        </div>
      ) : open.image ? (
        <div className="ws-image">
          <img src={open.image} alt={open.entry.name} />
        </div>
      ) : open.draft !== undefined ? (
        <textarea
          className="ws-editor"
          value={open.draft}
          spellCheck={false}
          autoFocus
          onChange={e => {
            const draft = e.target.value
            setTab(open.entry.path, current => ({ ...current, draft }))
          }}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault()
              void save()
            } else if (e.key === 'Tab') {
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart, selectionEnd } = el
              const next = `${open.draft!.slice(0, selectionStart)}  ${open.draft!.slice(selectionEnd)}`
              setTab(open.entry.path, current => ({ ...current, draft: next }))
              requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2))
            }
          }}
        />
      ) : open.preview ? (
        open.preview.binary ? (
          <p className="meta">{t("This file isn't text, so it can't be shown here.")}</p>
        ) : (
          <pre className="ws-code">
            {open.preview.text.split('\n').map((line, index) => (
              <div key={index} className="ws-line">
                <span className="ws-num">{index + 1}</span>
                <span>{line || ' '}</span>
              </div>
            ))}
            {open.preview.truncated ? <div className="meta">{t('Only the start of this file is shown.')}</div> : null}
          </pre>
        )
      ) : !open.error ? (
        <p className="meta">{t('Loading…')}</p>
      ) : null}
    </div>
  ) : null

  const searchResults =
    search === 'loading' ? (
      <div className="ws-note">{t('Searching…')}</div>
    ) : search && 'error' in search ? (
      <div className="ws-note error-text">{search.error}</div>
    ) : search ? (
      search.names.length || search.matches.length ? (
        <>
          {search.names.map(entry => (
            <button key={`n:${entry.path}`} className="ws-row" title={entry.path} onClick={() => (entry.isDirectory ? undefined : void openFile(entry))}>
              <Icon name={entry.isDirectory ? 'folder' : 'file'} />
              <span className="ws-name">{relativePath(root, entry.path)}</span>
            </button>
          ))}
          {search.matches.map((hit, index) => (
            <button key={`m:${hit.path}:${hit.line ?? index}`} className="ws-row ws-hit" title={hit.path} onClick={() => void openFile({ name: baseName(hit.path), path: hit.path, isDirectory: false })}>
              <span className="ws-name">
                {relativePath(root, hit.path)}
                {hit.line ? `:${hit.line}` : ''}
              </span>
              <span className="ws-snippet">{hit.text}</span>
            </button>
          ))}
        </>
      ) : (
        <div className="ws-note">{t('No Results')}</div>
      )
    ) : null

  return (
    <aside className="ws-panel" aria-label={t('Files')}>
      {tabs}
      <div className="ws-head">
        <Icon name="folder" />
        <span className="ws-title" title={root}>
          {baseName(root) || root}
        </span>
        <span className="spacer" />
        {plugin ? (
          <>
            <button className="staged-remove" aria-label={t('New File')} title={t('New File')} onClick={() => void create(root, 'file')}>
              <Icon name="plus" />
            </button>
          </>
        ) : null}
        <button className="staged-remove" aria-label={t('Refresh')} title={t('Refresh')} onClick={refresh}>
          ↻
        </button>
        <button className="staged-remove" aria-label={t('Close')} title={t('Close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {note ? (
        <div className="model-note" role="status">
          {note}
          <button className="staged-remove" aria-label={t('Close')} onClick={() => setNote(null)}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}
      {tabStrip}
      {viewer ?? (
        <>
          {plugin ? (
            <label className="chatlist-search ws-search">
              <Icon name="search" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search files')} spellCheck={false} />
            </label>
          ) : plugin === false ? (
            <p className="meta ws-plugin-note">{t('Update the Conduit plugin on this host to search and change files here.')}</p>
          ) : null}
          <div className="ws-tree">{query.trim() && plugin ? searchResults : folderRows(root, 0)}</div>
        </>
      )}
      {menu ? (
        <div ref={menuFit.ref} className="host-menu row-menu" role="menu" style={menuFit.style} onMouseDown={e => e.stopPropagation()}>
          <button
            role="menuitem"
            onClick={() => {
              onInsertPath(menu.entry.path)
              setMenu(null)
            }}
          >
            {t('Add to message')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(menu.entry.path)
              setMenu(null)
            }}
          >
            {t('Copy Path')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(relativePath(root, menu.entry.path))
              setMenu(null)
            }}
          >
            {t('Copy Relative Path')}
          </button>
          {plugin ? (
            <>
              {menu.entry.isDirectory ? (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const folder = menu.entry.path
                      setMenu(null)
                      void create(folder, 'file')
                    }}
                  >
                    {t('New File')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const folder = menu.entry.path
                      setMenu(null)
                      void create(folder, 'folder')
                    }}
                  >
                    {t('New Folder')}
                  </button>
                </>
              ) : null}
              <button
                role="menuitem"
                onClick={async () => {
                  const entry = menu.entry
                  setMenu(null)
                  const name = await askName(t('Rename'), entry.name)
                  if (!name || name === entry.name) return
                  const moved = await change('move', { path: entry.path, to: parentPath(entry.path), name }, [parentPath(entry.path)])
                  if (moved !== false) setFiles(current => renameTabs(current, entry.path, childPath(parentPath(entry.path), name)))
                }}
              >
                {t('Rename')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  const entry = menu.entry
                  setMenu(null)
                  void change('duplicate', { path: entry.path }, [parentPath(entry.path)])
                }}
              >
                {t('Duplicate')}
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={async () => {
                  const entry = menu.entry
                  setMenu(null)
                  if (!(await ask(t('Delete “{name}”? This can’t be undone.', { name: entry.name }), { confirm: t('Delete'), destructive: true }))) return
                  if ((await change('delete', { path: entry.path }, [parentPath(entry.path)])) !== false) setFiles(current => closeTabsUnder(current, entry.path))
                }}
              >
                {t('Delete')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
