import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import {
  baseName,
  changePath,
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
  const [open, setOpen] = useState<OpenFile | null>(null)
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
    setOpen(null)
    setQuery('')
    setSearch(null)
    void list(root)
  }, [root, profile, list])

  const refresh = useCallback(() => {
    for (const path of expanded) void list(path)
  }, [expanded, list])

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
  const openFolder = async (entry: WorkspaceEntry, back: WorkspaceEntry[] = []) => {
    const folder = { ...entry, isDirectory: true }
    setOpen({ entry: folder, preview: null, back })
    try {
      const listing = parseListing(await gateway.http('GET', fsListPath(folder.path, profile)))
      setOpen(current => (current?.entry.path === folder.path ? { ...current, folder: listing } : current))
    } catch (e) {
      setOpen(current => (current?.entry.path === folder.path ? { ...current, error: message(e) } : current))
    }
  }

  const openFile = async (entry: WorkspaceEntry, back: WorkspaceEntry[] = []) => {
    if (entry.isDirectory) return openFolder(entry, back)
    setOpen({ entry, preview: null, back })
    try {
      if (isImage(entry.name)) {
        const raw = (await gateway.http('GET', dataUrlPath(entry.path, profile))) as { data_url?: unknown; dataUrl?: unknown } | null
        const url = typeof raw?.data_url === 'string' ? raw.data_url : typeof raw?.dataUrl === 'string' ? raw.dataUrl : undefined
        setOpen(current => (current?.entry.path === entry.path ? { ...current, image: url, error: url ? undefined : t("Couldn't open this file") } : current))
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
      setOpen(current => (current?.entry.path === entry.path ? { ...current, entry: dated, preview } : current))
    } catch (e) {
      // A path a reply named that turns out to be a folder (Hermes: "Path points to a directory") shows its entries.
      if (/director/i.test(message(e))) return openFolder(entry, back)
      setOpen(current => (current?.entry.path === entry.path ? { ...current, error: message(e) } : current))
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
      return null
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
      const entry = { name, path: `${folder.replace(/[\\/]+$/, '')}/${name}`, isDirectory: false }
      void openFile(entry)
    }
  }

  const save = async (replace = false) => {
    if (!open || open.draft === undefined) return
    const { entry, draft } = open
    setOpen({ ...open, saving: true })
    setNote(null)
    try {
      const answer = (await gateway.http('POST', changePath('save', profile), {
        root,
        path: entry.path,
        content: draft,
        ...(replace || entry.mtime === undefined ? {} : { expected_mtime: entry.mtime / 1000 })
      })) as { entry?: { mtime?: unknown } } | null
      const mtime = typeof answer?.entry?.mtime === 'number' ? answer.entry.mtime * 1000 : undefined
      setOpen(current =>
        current?.entry.path === entry.path ? { ...current, entry: { ...entry, mtime }, preview: current.preview && { ...current.preview, text: draft }, draft: undefined, saving: false } : current
      )
      void list(parentPath(entry.path))
    } catch (e) {
      setOpen(current => (current ? { ...current, saving: false } : current))
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

  const closeViewer = async () => {
    if (open?.draft !== undefined && !(await ask(t('Discard unsaved changes?')))) return
    // Back to the folder this was opened from, if any.
    const back = open?.back ?? []
    const previous = back.at(-1)
    if (previous) void openFolder(previous, back.slice(0, -1))
    else setOpen(null)
  }
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
            <button className="secondary" disabled={open.saving} onClick={() => setOpen({ ...open, draft: undefined })}>
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
              <button className="secondary" onClick={() => setOpen({ ...open, draft: open.preview!.text })}>
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
              onClick={() => void openFile(entry, [...(open.back ?? []), open.entry])}
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
          onChange={e => setOpen({ ...open, draft: e.target.value })}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault()
              void save()
            } else if (e.key === 'Tab') {
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart, selectionEnd } = el
              const next = `${open.draft!.slice(0, selectionStart)}  ${open.draft!.slice(selectionEnd)}`
              setOpen({ ...open, draft: next })
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
                  if (name && name !== entry.name) void change('move', { path: entry.path, to: parentPath(entry.path), name }, [parentPath(entry.path)])
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
                  if (await ask(t('Delete “{name}”? This can’t be undone.', { name: entry.name }), { confirm: t('Delete'), destructive: true })) void change('delete', { path: entry.path }, [parentPath(entry.path)])
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
