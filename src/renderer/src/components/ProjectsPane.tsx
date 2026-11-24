import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KeptScroll } from '../state/keptScroll'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { timeLabel } from '../state/chats'
import { createParams, gatherProjects, parseProjectChats, parseProjects, type Project, type ProjectChat, type ProjectDetail } from '../state/projects'
import { HideListButton } from './HideListButton'
import { Icon } from './icons'
import { ask, tell } from '../state/dialogs'
import { includedInAll, readLeftOut } from '../state/profileGroups'

interface Props {
  /** The chat list's profile; null reads the active one. */
  profile: string | null
  /** This dashboard's profiles: under All the page lists each one's projects, named by its profile. */
  profiles?: readonly { name: string; title: string }[]
  connected: boolean
  selectedId: string | null
  onSelect: (chat: ProjectChat) => void
  /** A new chat working in the project's folder. */
  onNewChat: (folder: string | undefined, project: Project) => void
  onClose: () => void
  /** Whether a chat has a reply the user hasn't seen, read as its chat row reads it. */
  isUnread?: (chat: ProjectChat) => boolean
  /** Chats with a turn running. */
  runningIds?: Set<string>
  /** Hides the list: the « at its top. */
  onHide?: () => void
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The phone's Chats › Projects: Hermes' projects, then one project's chats by folder. */
export function ProjectsPane({ profile, profiles, connected, selectedId, onSelect, onNewChat, onClose, isUnread, runningIds, onHide }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)
  // The open project's own profile under All, the list's otherwise.
  const scope = open?.profile ?? profile
  const withProfile = useCallback((params: Record<string, unknown>) => (scope ? { ...params, profile: scope } : params), [scope])
  // Under All, the profiles All shows (Show in All), when there is more than one.
  const names = (profiles ?? []).map(p => `${p.name}\u0000${p.title}`).join('\u0001')
  const gathered = useMemo(() => {
    if (profile !== null || !profiles || profiles.length < 2) return null
    const shown = new Set(includedInAll(profiles.map(p => p.name), readLeftOut()).map(name => name.toLowerCase()))
    const list = profiles.filter(p => shown.has(p.name.toLowerCase()))
    return list.length > 1 ? list : null
  }, [profile, names])
  // Back from a project lands where the list was: the list draws afresh, so it restores its kept spot.
  const listScroll = useRef<KeptScroll | null>(null)
  listScroll.current ??= new KeptScroll()
  const listScroller = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    const kept = listScroll.current
    if (!kept) return
    if (open) {
      wasOpen.current = true
      return
    }
    if (wasOpen.current) kept.opened()
    wasOpen.current = false
    if (listScroller.current) kept.drew(listScroller.current)
  })

  useEffect(() => {
    if (!connected) return
    let live = true
    if (gathered) {
      void Promise.allSettled(gathered.map(p => gateway.rpc('projects.tree', { preview_limit: 3, profile: p.name }))).then(answers => {
        if (!live) return
        const read = answers.flatMap((answer, i) =>
          answer.status === 'fulfilled' ? [{ profile: gathered[i]!.name, title: gathered[i]!.title, projects: parseProjects(answer.value, gathered[i]!.name) }] : []
        )
        const failed = answers.find(answer => answer.status === 'rejected')
        if (!read.length && failed?.status === 'rejected') return setError(reason(failed.reason))
        setProjects(gatherProjects(read))
        setError(null)
      })
      return () => {
        live = false
      }
    }
    gateway
      .rpc('projects.tree', profile ? { preview_limit: 3, profile } : { preview_limit: 3 })
      .then(response => {
        if (!live) return
        // Home, the chats in no project, leads the list as on the phone, with its own dot.
        const list = parseProjects(response, profile ?? undefined)
        setProjects([...list.filter(p => p.isHome), ...list.filter(p => !p.isHome)])
        setError(null)
      })
      .catch(e => live && setError(reason(e)))
    return () => {
      live = false
    }
  }, [connected, profile, gathered, reload])

  // Another profile's projects are its own.
  useEffect(() => setOpen(null), [profile])

  if (open) {
    return (
      <ProjectPage
        project={open}
        connected={connected}
        selectedId={selectedId}
        withProfile={withProfile}
        isUnread={isUnread}
        runningIds={runningIds}
        onSelect={onSelect}
        onNewChat={() => onNewChat(open.path, open)}
        onBack={() => setOpen(null)}
        onHide={onHide}
        onChanged={project => {
          setOpen(project)
          setReload(n => n + 1)
        }}
      />
    )
  }
  return (
    <section className="chatlist projects" aria-label={t('Projects')}>
      <div className="chatlist-head">
        <button className="round" aria-label={t('Chats')} title={t('Chats')} onClick={onClose}>
          <Icon name="back" />
        </button>
        <h1>{t('Projects')}</h1>
        <button className="round" aria-label={t('New Project')} title={t('New Project')} onClick={() => setCreating(true)}>
          <Icon name="plus" />
        </button>
        {onHide ? <HideListButton onHide={onHide} /> : null}
      </div>
      {creating ? (
        <ProjectForm
          withProfile={withProfile}
          onDone={project => {
            setCreating(false)
            if (project) {
              setReload(n => n + 1)
              setOpen(project)
            }
          }}
        />
      ) : null}
      <div
        ref={listScroller}
        className="chatlist-scroll"
        onScroll={e => listScroll.current?.scrolled(e.currentTarget)}
        onWheel={() => listScroll.current?.touched()}
        onPointerDown={() => listScroll.current?.touched()}
        onKeyDown={() => listScroll.current?.touched()}
      >
        {projects === null && !error ? <div className="empty">{t('Loading projects…')}</div> : null}
        {error ? <div className="empty">{`${t('Couldn’t Load Projects')} ${error}`}</div> : null}
        {projects && !projects.some(p => !p.isHome) && !creating ? <div className="empty">{t('Projects you make here or in Hermes Desktop show here.')}</div> : null}
        {projects?.map(project => {
          // The dot while any chat the tree lists for it is unread, and the Running line beside it (issue 1496).
          const unread = !!isUnread && project.previews.some(chat => chat.id !== selectedId && isUnread(chat))
          const running = !!runningIds && project.previews.some(chat => runningIds.has(chat.id))
          return (
            <button key={project.profile ? `${project.profile}:${project.id}` : project.id} className="row project-row" onClick={() => setOpen(project)}>
              <span className="row-top">
                <span className="row-title">
                  <span className="project-icon">
                    <Icon name={project.isHome ? 'house' : 'folder'} className="row-pin" />
                    {unread ? <span className="unread-dot project-dot" role="img" aria-label={t('Unread')} /> : null}
                  </span>
                  {project.title}
                  {project.profileTitle ? <span className="meta project-profile">{project.profileTitle}</span> : null}
                </span>
                <span className="meta row-time">{project.count}</span>
              </span>
              {running ? <span className="running">{t('Running')}</span> : null}
              {project.path ? <span className="meta project-path">{project.path}</span> : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ProjectForm({
  withProfile,
  onDone
}: {
  withProfile: (p: Record<string, unknown>) => Record<string, unknown>
  onDone: (project: Project | null) => void
}) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError(reason(e))
      setBusy(false)
    }
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
      <input
        aria-label={t('Folder on the Hermes host')}
        placeholder={t('Folder on the Hermes host')}
        value={folder}
        onChange={e => setFolder(e.target.value)}
      />
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

function ProjectPage({
  project,
  connected,
  selectedId,
  withProfile,
  isUnread,
  runningIds,
  onSelect,
  onNewChat,
  onBack,
  onChanged,
  onHide
}: {
  project: Project
  connected: boolean
  selectedId: string | null
  withProfile: (p: Record<string, unknown>) => Record<string, unknown>
  isUnread?: (chat: ProjectChat) => boolean
  runningIds?: Set<string>
  onSelect: (chat: ProjectChat) => void
  onNewChat: () => void
  onBack: () => void
  onChanged: (project: Project | null) => void
  onHide?: () => void
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    if (!connected) return
    let live = true
    setDetail(null)
    gateway
      .rpc('projects.project_sessions', withProfile({ project_id: project.id }))
      .then(response => {
        if (!live) return
        setDetail(parseProjectChats(response, project.profile ?? project.previews[0]?.profile))
        setError(null)
      })
      .catch(e => live && setError(reason(e)))
    return () => {
      live = false
    }
  }, [connected, project.id, project.previews, withProfile])

  async function rename(name: string) {
    setRenaming(null)
    const title = name.trim()
    if (!title || title === project.title) return
    try {
      await gateway.rpc('projects.update', withProfile({ id: project.id, name: title }))
      onChanged({ ...project, title })
    } catch (e) {
      void tell(t('Couldn’t rename the project: {reason}', { reason: reason(e) }))
    }
  }
  async function remove() {
    if (!(await ask(`${t('Delete project?')}\n\n${project.title}\n${t('Its folders, files and chats stay where they are.')}`, { confirm: t('Delete'), destructive: true }))) return
    try {
      await gateway.rpc('projects.delete', withProfile({ id: project.id }))
      onChanged(null)
    } catch (e) {
      void tell(t('Couldn’t delete the project: {reason}', { reason: reason(e) }))
    }
  }

  const toggle = (id: string) =>
    setClosed(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const lanes = detail?.lanes ?? []
  return (
    <section className="chatlist projects" aria-label={project.title}>
      <div className="chatlist-head">
        <button className="round" aria-label={t('Projects')} title={t('Projects')} onClick={onBack}>
          <Icon name="back" />
        </button>
        {renaming !== null ? (
          <input
            className="row-rename project-rename"
            aria-label={t('Rename')}
            autoFocus
            value={renaming}
            onChange={e => setRenaming(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void rename(renaming)
              else if (e.key === 'Escape') setRenaming(null)
            }}
            onBlur={() => void rename(renaming)}
          />
        ) : (
          <h1 className="project-title" title={project.path}>
            {project.title}
          </h1>
        )}
        <button
          className="round"
          aria-label={t('New chat in this project')}
          title={t('New chat in this project')}
          disabled={!project.path && !project.isHome}
          onClick={onNewChat}
        >
          <Icon name="plus" />
        </button>
        {onHide ? <HideListButton onHide={onHide} /> : null}
      </div>
      <div className="project-meta">
        {project.profileTitle ? <span className="meta project-profile">{project.profileTitle}</span> : null}
        {project.path ? <span className="meta project-path">{project.path}</span> : null}
        {!project.isAuto && !project.isHome ? (
          <span className="project-actions">
            <button className="link" onClick={() => setRenaming(project.title)}>
              {t('Rename')}
            </button>
            <button className="link danger" onClick={() => void remove()}>
              {t('Delete')}
            </button>
          </span>
        ) : null}
      </div>
      <div className="chatlist-scroll">
        {!detail && !error ? <div className="empty">{t('Loading chats…')}</div> : null}
        {error ? <div className="empty">{t('Couldn’t load your chats: {error}', { error })}</div> : null}
        {detail && !lanes.length ? <div className="empty">{t('This project does not have any conversations yet.')}</div> : null}
        {lanes.map(lane => {
          const shut = closed.has(lane.id)
          return (
            <div key={lane.id} role="group" aria-label={lane.title}>
              <button className="sect project-lane" aria-expanded={!shut} title={lane.path} onClick={() => toggle(lane.id)}>
                <Icon name={shut ? 'chevron' : 'chevronDown'} />
                <span>{lane.title}</span>
                <span className="meta">{lane.chats.length}</span>
              </button>
              {shut
                ? null
                : lane.chats.map(chat => (
                    <button key={chat.id} className="row" aria-current={chat.id === selectedId ? 'true' : undefined} onClick={() => onSelect(chat)}>
                      <span className="row-top">
                        <span className="row-title">
                          {isUnread && chat.id !== selectedId && isUnread(chat) ? <span className="unread-dot" role="img" aria-label={t('Unread')} /> : null}
                          {chat.title}
                        </span>
                        {chat.lastActive ? <span className="meta row-time">{timeLabel(chat.lastActive)}</span> : null}
                      </span>
                      {runningIds?.has(chat.id) ? (
                        <span className="running">{t('Running')}</span>
                      ) : chat.preview && chat.preview !== chat.title ? (
                        <span className="meta">{chat.preview}</span>
                      ) : null}
                    </button>
                  ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
