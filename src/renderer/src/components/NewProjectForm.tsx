import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { createParams, parseProjects, type Project } from '../state/projects'
import { changePath, childPath, fsListPath, parentPath, parseListing, validName, type WorkspaceEntry } from '../state/workspace'
import { firstListed } from '../state/projectFolders'
import { askText } from '../state/dialogs'
import { Icon } from './icons'

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * New Project: a name and a folder on the Hermes host (desktop#40), from the
 * Projects page and from a new chat's Project chip (desktop#605). Browse
 * opens Finder or Explorer while the dashboard runs on this computer, and
 * the host's own folders otherwise, or when Hermes can't see the folder
 * picked (a Hermes in Docker).
 */
export function ProjectForm({
  withProfile,
  profile,
  start,
  onDone
}: {
  withProfile: (p: Record<string, unknown>) => Record<string, unknown>
  /** The profile the project goes to, for Hermes' listings. */
  profile?: string | null
  /** Where the host's folders open. */
  start: string
  onDone: (project: Project | null) => void
}) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [local, setLocal] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void window.conduit
      .hostIsThisComputer()
      .then(on => alive.current && setLocal(on))
      .catch(() => {})
    return () => {
      alive.current = false
    }
  }, [])
  const ready = !!name.trim() && !!folder.trim() && !busy
  async function create() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const response = (await gateway.rpc('projects.create', withProfile(createParams(name, folder)))) as { project?: Record<string, unknown> }
      const made = parseProjects(response?.project ? [response.project] : [])[0]
      onDone(made ?? null)
    } catch (e) {
      if (!alive.current) return
      setError(reason(e))
      setBusy(false)
    }
  }
  async function browse() {
    setError(null)
    if (!local) return setBrowsing(open => !open)
    const spellings = await window.conduit.pickLocalFolder().catch(() => null)
    if (!spellings || !alive.current) return
    const seen = await firstListed(spellings, path => gateway.http('GET', fsListPath(path, profile)).then(parseListing))
    if (!alive.current) return
    if (seen) {
      setFolder(seen)
      setBrowsing(false)
      return
    }
    setError(t('Hermes can’t see that folder. Choose it from the host’s folders instead.'))
    setBrowsing(true)
  }
  return (
    <form
      className="project-form"
      onSubmit={e => {
        e.preventDefault()
        void create()
      }}
    >
      <input autoFocus aria-label={t('Project name')} placeholder={t('Project name')} value={name} onChange={e => setName(e.target.value)} />
      <div className="project-folder-row">
        <input
          aria-label={t('Folder on the Hermes host')}
          placeholder={t('Folder on the Hermes host')}
          value={folder}
          onChange={e => setFolder(e.target.value)}
        />
        <button type="button" className="secondary" aria-expanded={local ? undefined : browsing} onClick={() => void browse()}>
          {t('Browse…')}
        </button>
      </div>
      {browsing ? (
        <HostFolders
          profile={profile}
          start={folder.trim() || start}
          onPick={path => {
            setFolder(path)
            setError(null)
            setBrowsing(false)
          }}
        />
      ) : null}
      {error ? <div className="meta project-error">{error}</div> : null}
      <div className="project-form-actions">
        <button type="button" className="secondary" onClick={() => onDone(null)}>
          {t('Cancel')}
        </button>
        <button type="submit" className="primary" disabled={!ready}>
          {busy ? t('Creating…') : t('Create')}
        </button>
      </div>
    </form>
  )
}

/**
 * The Hermes host's folders, through Hermes' own listing, as the phone's
 * New Project picker shows them: into a folder, out to the one holding it,
 * a New Folder made through the plugin's workspace route, and Use This
 * Folder. A listing that answers after a later one was asked for is dropped.
 */
export function HostFolders({ profile, start, onPick }: { profile?: string | null; start: string; onPick: (path: string) => void }) {
  const [path, setPath] = useState(start)
  const [folders, setFolders] = useState<WorkspaceEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef(0)
  const list = async (at: string) => {
    const ticket = ++asked.current
    setFolders(null)
    setError(null)
    try {
      const listing = parseListing(await gateway.http('GET', fsListPath(at, profile)))
      if (ticket !== asked.current) return
      setFolders(listing.entries.filter(entry => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name)))
      // Hermes names the folder it listed when it was asked for its default one.
      if (!at && listing.entries[0]) setPath(parentPath(listing.entries[0].path))
    } catch (e) {
      if (ticket !== asked.current) return
      setFolders([])
      setError(reason(e))
    }
  }
  useEffect(() => {
    void list(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the folder shown as it changes
  }, [path])
  const up = parentPath(path)
  const makeFolder = async () => {
    const name = (await askText(t('New folder name')))?.trim()
    if (!name || !path) return
    if (!validName(name)) return setError(t('That name can’t be used.'))
    try {
      await gateway.http('POST', changePath('mkdir', profile), { root: path, path, name })
      setPath(childPath(path, name))
    } catch (e) {
      setError(reason(e))
      void list(path)
    }
  }
  return (
    <div className="host-folders" role="group" aria-label={t('Folder on the Hermes host')}>
      <div className="host-folders-path" title={path}>
        {path || '…'}
      </div>
      <div className="host-folders-list">
        {up && up !== path ? (
          <button type="button" className="host-folder" onClick={() => setPath(up)}>
            <Icon name="back" /> {t('Back')}
          </button>
        ) : null}
        {folders === null ? <div className="meta">{t('Loading…')}</div> : null}
        {folders?.map(entry => (
          <button type="button" key={entry.path} className="host-folder" onClick={() => setPath(entry.path)}>
            <Icon name="folder" /> {entry.name}
          </button>
        ))}
      </div>
      {error ? <div className="meta project-error">{error}</div> : null}
      <div className="project-form-actions">
        <button type="button" className="secondary" disabled={!path} onClick={() => void makeFolder()}>
          {t('New Folder')}
        </button>
        <button type="button" className="primary" disabled={!path} onClick={() => onPick(path)}>
          {t('Use This Folder')}
        </button>
      </div>
    </div>
  )
}
