/**
 * The Folder's open files, one tab each, after the phone's (WorkspaceExplorer
 * openFiles and closeTab; issue 454): each keeps its own text and draft, a
 * file opened again goes back to its tab, and past `FOLDER_TAB_LIMIT` the
 * oldest tab without changes goes. `active` is the tab shown, or null while
 * the tree shows; going back to the tree keeps every tab.
 */
export interface FolderTabs<T extends FolderTab> {
  files: T[]
  active: string | null
}

export interface FolderTab {
  entry: { path: string }
  draft?: string
  saving?: boolean
  /** Read again when it's next picked. */
  stale?: boolean
}

export const FOLDER_TAB_LIMIT = 12

export const NO_TABS = { files: [], active: null }

/**
 * Shows `file`: in its own tab when one is open for its path, else in a new
 * tab after the others. `inPlace` puts it in the shown tab's place instead,
 * for a folder a reply named and the files and folders opened from it, where
 * Back walks back through them.
 */
export function showTab<T extends FolderTab>(tabs: FolderTabs<T>, file: T, inPlace = false): FolderTabs<T> {
  const path = file.entry.path
  const at = inPlace && tabs.active !== null ? tabs.files.findIndex(f => f.entry.path === tabs.active) : -1
  let files: T[]
  // A tab with changes for this file is never dropped: it's shown instead.
  const withChanges = tabs.files.find(f => f.entry.path === path && f.draft !== undefined)
  if (withChanges && withChanges !== file) return { files: tabs.files, active: path }
  if (at >= 0) {
    files = tabs.files.map((f, i) => (i === at ? file : f)).filter((f, i) => i === at || f.entry.path !== path)
  } else {
    const kept = tabs.files.findIndex(f => f.entry.path === path)
    files = kept >= 0 ? tabs.files.map((f, i) => (i === kept ? file : f)) : [...tabs.files, file]
  }
  while (files.length > FOLDER_TAB_LIMIT) {
    const oldest = files.findIndex(f => f.draft === undefined && f.entry.path !== path)
    if (oldest < 0) break
    files = files.filter((_, i) => i !== oldest)
  }
  return { files, active: path }
}

/** Changes the tab open for `path`, shown or not: a read that lands after another tab was picked still fills its own. */
export function updateTab<T extends FolderTab>(tabs: FolderTabs<T>, path: string, change: (file: T) => T): FolderTabs<T> {
  if (!tabs.files.some(f => f.entry.path === path)) return tabs
  return { ...tabs, files: tabs.files.map(f => (f.entry.path === path ? change(f) : f)) }
}

/** Closes `path`'s tab; when it was shown, the tab after it shows, else the one before, else the tree. */
export function closeTab<T extends FolderTab>(tabs: FolderTabs<T>, path: string): FolderTabs<T> {
  const at = tabs.files.findIndex(f => f.entry.path === path)
  if (at < 0) return tabs
  const files = tabs.files.filter((_, i) => i !== at)
  if (tabs.active !== path) return { files, active: tabs.active }
  return { files, active: (files[at] ?? files[at - 1])?.entry.path ?? null }
}

/** Closes the tabs of `path` and everything under it, after a delete, rename or move. */
export function closeTabsUnder<T extends FolderTab>(tabs: FolderTabs<T>, path: string): FolderTabs<T> {
  const base = path.replace(/[\\/]+$/, '')
  const under = (p: string) => p === base || p.startsWith(`${base}/`) || p.startsWith(`${base}\\`)
  let next = tabs
  for (const file of tabs.files) if (under(file.entry.path)) next = closeTab(next, file.entry.path)
  return next
}

/**
 * After a rename: the file tabs of `from` and everything under it follow it to
 * `to`, drafts kept; a folder's tab under it closes (its listing names the old
 * paths), and a walk back through renamed folders is forgotten.
 */
export function renameTabs<
  T extends FolderTab & { entry: { path: string; name: string; isDirectory?: boolean }; back?: { path: string }[]; folder?: { entries: { path: string; name: string }[] } }
>(
  tabs: FolderTabs<T>,
  from: string,
  to: string
): FolderTabs<T> {
  const base = from.replace(/[\\/]+$/, '')
  const under = (p: string) => p === base || p.startsWith(`${base}/`) || p.startsWith(`${base}\\`)
  const moved = (p: string) => (under(p) ? to + p.slice(base.length) : p)
  const name = (p: string) => p.split(/[\\/]/).pop() ?? p
  let next: FolderTabs<T> = tabs
  for (const f of tabs.files) if (f.entry.isDirectory && under(f.entry.path)) next = closeTab(next, f.entry.path)
  return {
    files: next.files.map(f => {
      const back = f.back?.some(b => under(b.path)) ? [] : f.back
      // A folder shown in a tab that lists the renamed one names it anew.
      const folder = f.folder?.entries.some(e => under(e.path))
        ? { ...f.folder, entries: f.folder.entries.map(e => (under(e.path) ? { ...e, path: moved(e.path), name: name(moved(e.path)) } : e)) }
        : f.folder
      if (!under(f.entry.path)) return back === f.back && folder === f.folder ? f : { ...f, back, folder }
      // A read or save still running answers for the old path and can't reach it: read it again when picked.
      return { ...f, back, saving: undefined, stale: true, entry: { ...f.entry, path: moved(f.entry.path), name: name(moved(f.entry.path)) } }
    }),
    active: next.active === null ? null : moved(next.active)
  }
}
