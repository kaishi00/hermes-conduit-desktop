/**
 * The Folder, after the phone's (WorkspaceFiles.swift): a chat's working
 * folder, browsed, searched, previewed and edited. The Conduit plugin's
 * `/workspace/*` routes list, search and change files inside the root they
 * are given; without them (an older plugin, or one turned off for the
 * profile) Hermes' own `/api/fs/list` still browses, and `/api/fs/read-text`
 * reads a file either way.
 */
import { t } from '../../../shared/i18n'

export const WORKSPACE = '/api/plugins/conduit_push/workspace'

export interface WorkspaceEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  /** Milliseconds. */
  mtime?: number
}

export interface WorkspaceListing {
  entries: WorkspaceEntry[]
  truncated: boolean
}

export interface SearchMatch {
  path: string
  line?: number
  text: string
}

export interface WorkspaceSearch {
  names: WorkspaceEntry[]
  matches: SearchMatch[]
  truncated: boolean
}

export interface FilePreview {
  path: string
  text: string
  binary: boolean
  truncated: boolean
  size?: number
  language: string
}

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const withProfile = (path: string, profile?: string | null) =>
  profile && profile !== 'default' ? `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}` : path

const query = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

export const listPath = (root: string, path: string, profile?: string | null) => withProfile(`${WORKSPACE}/list?${query({ root, path })}`, profile)
export const searchPath = (root: string, q: string, profile?: string | null) => withProfile(`${WORKSPACE}/search?${query({ root, q })}`, profile)
export const recentPath = (root: string, profile?: string | null) => withProfile(`${WORKSPACE}/recent?${query({ root })}`, profile)
export const changePath = (action: 'mkdir' | 'new-file' | 'save' | 'move' | 'duplicate' | 'delete', profile?: string | null) => withProfile(`${WORKSPACE}/${action}`, profile)
export const fsListPath = (path: string, profile?: string | null) => withProfile(`/api/fs/list?${query({ path })}`, profile)
export const readTextPath = (path: string, profile?: string | null) => withProfile(`/api/fs/read-text?${query({ path })}`, profile)
export const dataUrlPath = (path: string, profile?: string | null) => withProfile(`/api/fs/read-data-url?${query({ path })}`, profile)

export function parseEntry(raw: unknown): WorkspaceEntry | null {
  const row = (raw ?? {}) as Record<string, unknown>
  if (typeof row.path !== 'string' || !row.path) return null
  const name = typeof row.name === 'string' && row.name ? row.name : baseName(row.path)
  const mtime = num(row.mtime)
  return { name, path: row.path, isDirectory: row.isDirectory === true, size: num(row.size), mtime: mtime === undefined ? undefined : mtime * 1000 }
}

export function parseListing(raw: unknown): WorkspaceListing {
  const object = (raw ?? {}) as { entries?: unknown; truncated?: unknown; error?: unknown }
  if (typeof object.error === 'string' && object.error) throw new Error(listError(object.error))
  const entries = (Array.isArray(object.entries) ? object.entries : []).map(parseEntry).filter((entry): entry is WorkspaceEntry => entry !== null)
  return { entries, truncated: object.truncated === true }
}

function listError(code: string): string {
  switch (code) {
    case 'ENOENT':
      return t("That folder isn't on the server.")
    case 'ENOTDIR':
      return t("That's not a folder.")
    case 'EACCES':
      return t("Hermes can't read this folder.")
    default:
      return code
  }
}

export function parseSearch(raw: unknown): WorkspaceSearch {
  const object = (raw ?? {}) as { names?: unknown; matches?: unknown; truncated?: unknown }
  const names = (Array.isArray(object.names) ? object.names : []).map(parseEntry).filter((entry): entry is WorkspaceEntry => entry !== null)
  // A match is a file and its matching lines, each a hit of its own here.
  const matches = (Array.isArray(object.matches) ? object.matches : []).flatMap(value => {
    const row = (value ?? {}) as Record<string, unknown>
    if (typeof row.path !== 'string') return []
    const path = row.path
    return (Array.isArray(row.lines) ? row.lines : []).map(line => {
      const hit = (line ?? {}) as Record<string, unknown>
      return { path, line: num(hit.line), text: typeof hit.text === 'string' ? hit.text : '' }
    })
  })
  return { names, matches, truncated: object.truncated === true }
}

export function parsePreview(raw: unknown): FilePreview {
  const object = (raw ?? {}) as Record<string, unknown>
  return {
    path: typeof object.path === 'string' ? object.path : '',
    text: typeof object.text === 'string' ? object.text : '',
    binary: object.binary === true,
    truncated: object.truncated === true,
    size: num(object.byteSize),
    language: typeof object.language === 'string' ? object.language : 'text'
  }
}

/** The last part of a path, POSIX or Windows. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut < 0 ? trimmed : trimmed.slice(cut + 1)
}

/** The folder a path is in. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return ''
  return cut === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, cut)
}

/** `name` inside `folder`, joined with the separator the folder's path uses (a Windows host's backslash). */
export function childPath(folder: string, name: string): string {
  const trimmed = folder.replace(/[\\/]+$/, '')
  // A drive root ("C:\\", or "C:" once trimmed) is a Windows path too.
  const sep = (trimmed.includes('\\') && !trimmed.includes('/')) || /^[A-Za-z]:$/.test(trimmed) ? '\\' : '/'
  return `${trimmed}${sep}${name}`
}

/** A path from the root's top: "src/app.ts". */
export function relativePath(root: string, path: string): string {
  const base = root.replace(/[\\/]+$/, '')
  if (path === base) return '.'
  return path.startsWith(base) && /[\\/]/.test(path.charAt(base.length)) ? path.slice(base.length + 1) : path
}

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i

export const isImage = (name: string) => IMAGE.test(name)

/** "12 KB", "3.4 MB". */
export function sizeText(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return t('{count} bytes', { count: bytes })
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A name a new file or folder can take: no slashes, not "." or "..". */
export function validName(name: string): boolean {
  const trimmed = name.trim()
  return !!trimmed && trimmed !== '.' && trimmed !== '..' && !/[\\/]/.test(trimmed)
}

/** A path as it goes into a message: in inline code, so a space doesn't split it. */
export const pathForDraft = (path: string) => (/\s/.test(path) ? `\`${path}\`` : path)

const FILE_TYPE = /\.[A-Za-z][A-Za-z0-9]{0,9}$/
const WEB_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i

/**
 * Whether inline code names a file on the host, as the phone decides: a
 * rooted path, a name with a file type, or a folder with a trailing slash or
 * three parts. Two bare parts (owner/repo, an image, a model) stay code, and
 * nothing starting with a web host is a file.
 */
export function looksLikePath(code: string): boolean {
  const text = code.trim()
  if (!text || text.length > 400 || /\s{2,}|[\n<>|"*?]/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false
  if (/^(\/|~\/|[A-Za-z]:[\\/])/.test(text)) return text.length > 1
  if (WEB_HOST.test(text) || /\s/.test(text)) return false
  const parts = text.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  if (!parts.length) return false
  if (/[\\/]$/.test(text)) return true
  if (parts.length === 2 && !/^\.{1,2}$/.test(parts[0]!)) return FILE_TYPE.test(parts[1]!) && !/^\d/.test(parts[1]!.split('.').pop()!) && parts[0] !== '@'
  if (parts.length >= 3) return true
  // One part: a file name with a type, not a version or a number.
  return FILE_TYPE.test(text) && !/^\d+(\.\d+)+$/.test(text) && !/^v?\d/.test(text)
}

/** A path from a reply as the host has it: a relative one is in the chat's folder. */
export function absolutePath(path: string, folder: string): string {
  const text = path.trim()
  if (/^(\/|[A-Za-z]:[\\/]|~\/)/.test(text)) return text
  const base = folder.replace(/[\\/]+$/, '')
  const separator = /^[A-Za-z]:\\/.test(base) ? '\\' : '/'
  return `${base}${separator}${text.replace(/^\.\//, '')}`
}

/** The plugin finds folders a reply names too, and says which it found (desktop issue 686). */
export const RESOLVE_FOLDERS_CAPABILITY = 'workspace-resolve-folders'

export const resolvePath = (path: string, sessionIds: string[], profile?: string | null) =>
  withProfile(
    `${WORKSPACE}/resolve?${[`path=${encodeURIComponent(path)}`, ...sessionIds.filter(Boolean).map(id => `session_id=${encodeURIComponent(id)}`)].join('&')}`,
    profile
  )

/** Where a path a reply named is on the host: found (a folder ends in its separator), not there, or unknown. */
export type LinkLookup = { path: string } | { missing: string } | { unknown: true }

/**
 * Where a path a reply named is, as the phone looks it up (issue 1809, desktop issue 686): a rooted path as it is;
 * a bare name or a relative path asked of the plugin for the chat (its folder, its repository's top, then where its
 * own tools put it). The plugin saying the host has none is `missing`, named for the notice; a plugin without the
 * lookup, or a failed one, is `unknown`, and the caller joins it to the chat's folder as before.
 */
export async function lookUpLink(
  path: string,
  ask: {
    sessionIds: string[]
    profile?: string | null
    /** Whether the profile's plugin serves the folder-aware lookup. */
    serves: () => Promise<boolean>
    get: (route: string) => Promise<unknown>
  }
): Promise<LinkLookup> {
  const text = path.trim()
  if (/^(\/|[A-Za-z]:[\\/]|~\/)/.test(text)) return { path: text }
  if (!ask.sessionIds.some(Boolean)) return { unknown: true }
  try {
    if (!(await ask.serves())) return { unknown: true }
    const raw = (await ask.get(resolvePath(text, ask.sessionIds, ask.profile))) as { path?: unknown; isDirectory?: unknown } | null
    const found = typeof raw?.path === 'string' && raw.path ? raw.path : null
    if (!found) return { missing: baseName(text) || text }
    if (raw?.isDirectory !== true) return { path: found }
    return { path: `${found.replace(/[\\/]+$/, '')}${/^[A-Za-z]:\\/.test(found) ? '\\' : '/'}` }
  } catch {
    return { unknown: true }
  }
}
