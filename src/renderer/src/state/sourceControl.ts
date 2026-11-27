/**
 * The workbench's Changes (issue 452): Git in the chat's folder, on the
 * Hermes host, through the Conduit plugin's `/workspace/git/*` routes
 * (capability `workspace-git`). What changed, each file's diff, and the
 * steps a person takes on them: stage, unstage, discard, commit, switch or
 * make a branch, pull, push, fetch, and start a repository. Every change
 * answers with the status after it.
 */

export const GIT = '/api/plugins/conduit_push/workspace/git'
export const GIT_CAPABILITY = 'workspace-git'

export type FileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflict'

export interface ChangedFile {
  /** Relative to the repository's top folder, with / between folders. */
  path: string
  /** A rename's old path. */
  from: string | null
  staged: FileState | null
  unstaged: FileState | null
  /** A file Conduit doesn't open (keys, passwords): listed, its diff not read. */
  secret: boolean
  added: number | null
  removed: number | null
  stagedAdded: number | null
  stagedRemoved: number | null
}

export interface Branch {
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
}

export type GitStatus =
  | { repo: false; root: string }
  | { repo: true; root: string; top: string; branch: Branch; files: ChangedFile[]; truncated: boolean }

export interface FileDiff {
  path: string
  staged: boolean
  diff: string
  binary: boolean
  truncated: boolean
}

export interface BranchRow {
  name: string
  upstream: string | null
  current: boolean
}

export interface Commit {
  hash: string
  short: string
  author: string
  /** Milliseconds. */
  time: number | null
  subject: string
  refs: string[]
  files: number | null
  added: number | null
  removed: number | null
}

export type GitAction = 'init' | 'stage' | 'unstage' | 'discard' | 'commit' | 'switch' | 'pull' | 'push' | 'fetch'

const withProfile = (path: string, profile?: string | null) =>
  profile && profile !== 'default' ? `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}` : path

const query = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

export const statusPath = (root: string, profile?: string | null) => withProfile(`${GIT}/status?${query({ root })}`, profile)
export const diffPath = (root: string, path: string, staged: boolean, profile?: string | null) =>
  withProfile(`${GIT}/diff?${query({ root, path, staged: staged ? 'true' : undefined })}`, profile)
export const branchesPath = (root: string, profile?: string | null) => withProfile(`${GIT}/branches?${query({ root })}`, profile)
export const logPath = (root: string, limit: number, profile?: string | null) => withProfile(`${GIT}/log?${query({ root, limit: String(limit) })}`, profile)
export const actionPath = (action: GitAction, profile?: string | null) => withProfile(`${GIT}/${action}`, profile)

const STATES: FileState[] = ['modified', 'added', 'deleted', 'renamed', 'copied', 'untracked', 'conflict']
const state = (value: unknown): FileState | null => (STATES.includes(value as FileState) ? (value as FileState) : null)
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

export function parseStatus(raw: unknown): GitStatus {
  const json = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const root = typeof json.root === 'string' ? json.root : ''
  if (json.repo !== true) return { repo: false, root }
  const branch = (json.branch && typeof json.branch === 'object' ? json.branch : {}) as Record<string, unknown>
  const files = (Array.isArray(json.files) ? json.files : []).flatMap((item): ChangedFile[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.path !== 'string' || !row.path) return []
    return [
      {
        path: row.path,
        from: text(row.from),
        staged: state(row.staged),
        unstaged: state(row.unstaged),
        secret: row.secret === true,
        added: count(row.added),
        removed: count(row.removed),
        stagedAdded: count(row.stagedAdded),
        stagedRemoved: count(row.stagedRemoved)
      }
    ]
  })
  return {
    repo: true,
    root,
    top: typeof json.top === 'string' ? json.top : root,
    branch: {
      head: text(branch.head),
      upstream: text(branch.upstream),
      ahead: count(branch.ahead) ?? 0,
      behind: count(branch.behind) ?? 0,
      detached: branch.detached === true
    },
    files,
    truncated: json.truncated === true
  }
}

export function parseDiff(raw: unknown): FileDiff {
  const json = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    path: typeof json.path === 'string' ? json.path : '',
    staged: json.staged === true,
    diff: typeof json.diff === 'string' ? json.diff : '',
    binary: json.binary === true,
    truncated: json.truncated === true
  }
}

export function parseBranches(raw: unknown): { local: BranchRow[]; remote: BranchRow[] } {
  const json = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rows = (value: unknown): BranchRow[] =>
    (Array.isArray(value) ? value : []).flatMap(item => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return typeof row.name === 'string' && row.name ? [{ name: row.name, upstream: text(row.upstream), current: row.current === true }] : []
    })
  return { local: rows(json.local), remote: rows(json.remote) }
}

export function parseLog(raw: unknown): Commit[] {
  const json = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return (Array.isArray(json.commits) ? json.commits : []).flatMap((item): Commit[] => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    if (typeof row.hash !== 'string' || !row.hash) return []
    return [
      {
        hash: row.hash,
        short: typeof row.short === 'string' ? row.short : row.hash.slice(0, 7),
        author: typeof row.author === 'string' ? row.author : '',
        time: count(row.time) === null ? null : count(row.time)! * 1000,
        subject: typeof row.subject === 'string' ? row.subject : '',
        refs: Array.isArray(row.refs) ? row.refs.filter((r): r is string => typeof r === 'string') : [],
        files: count(row.files),
        added: count(row.added),
        removed: count(row.removed)
      }
    ]
  })
}

/** The files in each list: what's staged for the next commit, and what isn't. */
export function lists(files: ChangedFile[]): { staged: ChangedFile[]; unstaged: ChangedFile[] } {
  return { staged: files.filter(file => file.staged !== null), unstaged: files.filter(file => file.unstaged !== null) }
}

/** The letter a row shows, as Git's own short status does. */
export function letter(state: FileState | null): string {
  switch (state) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return 'U'
    case 'conflict':
      return '!'
    case 'modified':
      return 'M'
    default:
      return ''
  }
}

/** A path's name and the folder it's in, for a row: `src/pages/index.astro` → `index.astro`, `src/pages`. */
export function splitPath(path: string): { name: string; folder: string } {
  const at = path.lastIndexOf('/')
  return at < 0 ? { name: path, folder: '' } : { name: path.slice(at + 1), folder: path.slice(0, at) }
}

/** The host path of a repository path, for the Folder: the top folder joined with it. */
export function hostPath(top: string, path: string): string {
  const sep = top.includes('\\') && !top.includes('/') ? '\\' : '/'
  return `${top.replace(/[\\/]+$/, '')}${sep}${sep === '\\' ? path.replace(/\//g, '\\') : path}`
}

export type DiffLine =
  | { kind: 'hunk'; text: string }
  | { kind: 'context' | 'add' | 'remove'; text: string; old: number | null; new: number | null }
  | { kind: 'note'; text: string }

/** Whether two reads found the folder the same: its branch, every file row and the cut. */
export function sameStatus(a: GitStatus, b: GitStatus): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** Whether two reads of a file's diff found it the same. */
export function sameDiff(a: FileDiff, b: FileDiff): boolean {
  return a.path === b.path && a.staged === b.staged && a.diff === b.diff && a.binary === b.binary && a.truncated === b.truncated
}

/** A unified diff as rows to draw: hunks, and each line with its old and new numbers. Git's file header is left out. */
export function diffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldAt = 0
  let newAt = 0
  let inHunk = false
  for (const raw of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (hunk) {
      oldAt = Number(hunk[1])
      newAt = Number(hunk[2])
      inHunk = true
      lines.push({ kind: 'hunk', text: raw })
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith('+')) lines.push({ kind: 'add', text: raw.slice(1), old: null, new: newAt++ })
    else if (raw.startsWith('-')) lines.push({ kind: 'remove', text: raw.slice(1), old: oldAt++, new: null })
    else if (raw.startsWith(' ')) lines.push({ kind: 'context', text: raw.slice(1), old: oldAt++, new: newAt++ })
    else if (raw.startsWith('\\')) lines.push({ kind: 'note', text: raw.slice(2) })
    else if (raw.startsWith('diff --git')) inHunk = false
  }
  return lines
}

/** What a commit button does with nothing staged: everything, as the person sees it listed. */
export function commitsAll(status: GitStatus): boolean {
  return status.repo && !status.files.some(file => file.staged !== null) && status.files.some(file => file.unstaged !== null)
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
export { message as gitError }
