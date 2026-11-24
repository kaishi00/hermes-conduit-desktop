/**
 * Projects, after the phone's Chats › Projects (HermesClient.projects,
 * MessageNormalizer.normalizeProjects): Hermes' server-side project tree,
 * so every Hermes client sees the same organization. A project holds
 * folders; its chats are the ones working in them, grouped in lanes by the
 * folder Hermes sorts them under. Home holds the chats in no project.
 */
import { t } from '../../../shared/i18n'

export interface ProjectChat {
  id: string
  title: string
  lastActive?: number
  profile?: string
  preview?: string
}

export interface Project {
  id: string
  title: string
  /** Where a new chat in the project starts. */
  path?: string
  isHome: boolean
  /** Made by Hermes from a folder, with no projects.db row: it can't be renamed or deleted. */
  isAuto: boolean
  count: number
  previews: ProjectChat[]
  /** Under All, the profile whose project it is: Hermes keeps each profile's projects in its own projects.db. */
  profile?: string
  /** That profile's name as its face shows it. */
  profileTitle?: string
}

/**
 * Every profile's projects in one list, each naming its profile (desktop#393):
 * the Homes first, then the rest, in the profiles' order. A profile whose
 * read failed leaves the others' standing.
 */
export function gatherProjects(read: { profile: string; title: string; projects: Project[] }[]): Project[] {
  const all = read.flatMap(({ profile, title, projects }) => projects.map(project => ({ ...project, profile, profileTitle: title })))
  return [...all.filter(p => p.isHome), ...all.filter(p => !p.isHome)]
}

export interface ProjectLane {
  id: string
  title: string
  path?: string
  chats: ProjectChat[]
}

export interface ProjectDetail {
  id: string
  title: string
  lanes: ProjectLane[]
}

type Row = Record<string, unknown>
const text = (...values: unknown[]) => {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim()
  return undefined
}
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter(x => x && typeof x === 'object') as Row[]) : [])

export function parseChat(raw: Row, profile?: string): ProjectChat | null {
  const id = text(raw.id, raw.session_id)
  if (!id) return null
  const lastActive = num(raw.last_active) ?? num(raw.started_at)
  return {
    id,
    title: text(raw.title) ?? text(raw.preview) ?? t('New chat'),
    lastActive: lastActive === undefined ? undefined : lastActive * 1000,
    profile: text(raw.profile) ?? profile,
    preview: text(raw.preview)
  }
}

const chats = (v: unknown, profile?: string) => rows(v).flatMap(r => parseChat(r, profile) ?? [])

export function parseProject(raw: Row, profile?: string): Project | null {
  const id = text(raw.id)
  if (!id) return null
  const isHome = raw.isNoProject === true || raw.is_no_project === true
  // Only projects made in Hermes have a projects.db row (ids `p_…`): rename and delete fail closed on the rest.
  const isAuto = typeof raw.isAuto === 'boolean' ? raw.isAuto : typeof raw.is_auto === 'boolean' ? raw.is_auto : !isHome && !id.startsWith('p_')
  const folder = text(...rows(raw.folders).map(f => f.path))
  // A project with no primary path anchors new chats at its first repo, as Hermes Desktop does; Home never does.
  const repo = isHome ? undefined : text(...rows(raw.repos).map(r => r.path))
  const previews = chats(raw.preview_sessions ?? raw.previewSessions, profile)
  return {
    id,
    title: text(raw.label, raw.name, raw.title) ?? t('Untitled project'),
    path: text(raw.path, raw.primary_path, raw.primaryPath) ?? folder ?? repo,
    isHome,
    isAuto,
    count: num(raw.session_count) ?? num(raw.sessionCount) ?? previews.length,
    previews
  }
}

export function parseProjects(response: unknown, profile?: string): Project[] {
  const r = (response ?? {}) as Row
  const list = Array.isArray(response) ? (response as Row[]) : rows(r.projects)
  return list.flatMap(p => parseProject(p, profile) ?? [])
}

/** A project's chats in lanes: each repo's groups, named with their repo when there are several. */
export function parseProjectChats(response: unknown, profile?: string): ProjectDetail | null {
  const project = ((response ?? {}) as Row).project as Row | undefined
  const id = text(project?.id)
  if (!project || !id) return null
  const title = text(project.label, project.name, project.title) ?? t('Project')
  const repos = rows(project.repos)
  const lanes: ProjectLane[] = []
  for (const repo of repos) {
    const repoLabel = text(repo.label, repo.path) ?? t('Workspace')
    for (const group of rows(repo.groups)) {
      const groupLabel = text(group.label, group.path) ?? t('Sessions')
      const groupPath = text(group.path, group.cwd)
      const list = chats(group.sessions, profile)
      if (!list.length) continue
      lanes.push({
        id: text(group.id) ?? `${repoLabel}|${groupLabel}`,
        title: repos.length > 1 ? `${repoLabel} · ${groupLabel}` : groupLabel,
        path: groupPath === groupLabel ? undefined : groupPath,
        chats: list
      })
    }
  }
  if (!lanes.length) {
    const recent = chats(project.preview_sessions ?? project.previewSessions, profile)
    if (recent.length) lanes.push({ id: `${id}-recent`, title: t('Recent'), chats: recent })
  }
  return { id, title, lanes }
}

/** `projects.create`'s params: the name and its folder, used at once, as the phone sends them. */
export const createParams = (name: string, folder: string) => ({ name: name.trim(), folders: [folder.trim()], primary_path: folder.trim(), use: true })
