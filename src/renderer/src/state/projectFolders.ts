/**
 * Choosing a project's folder and a new chat's project (desktop#605).
 * A project's folder is a path on the Hermes host (desktop#393): Browse
 * shows the host's own folders, through Hermes' listing, and Finder or
 * Explorer only while the dashboard runs on this computer, keeping a
 * picked folder only once Hermes lists it.
 */
import type { Project } from './projects'

/** Where the host's folders open: the chat's folder, else Home's, else wherever Hermes lists by default. */
export function folderStart(cwd: string | undefined, projects: readonly Project[] | null | undefined): string {
  return cwd?.trim() || projects?.find(p => p.isHome)?.path?.trim() || ''
}

/**
 * The first spelling of a folder picked on this computer that Hermes lists,
 * or null when it lists none (a Hermes in Docker, or one that can't read it).
 */
export async function firstListed(spellings: readonly string[], lists: (path: string) => Promise<unknown>): Promise<string | null> {
  for (const path of spellings) {
    try {
      await lists(path)
      return path
    } catch {
      // Not this spelling: the next one, if any.
    }
  }
  return null
}

/** The projects a new chat can start in: the profile's, each with a folder; Home is "No project". */
export function newChatProjects(projects: readonly Project[]): Project[] {
  return projects.filter(p => !p.isHome && !!p.path?.trim())
}

/** The new chat's project as its chip names it: the one whose folder it starts in, else the folder's name. */
export function projectFor(folder: string | undefined, projects: readonly Project[] | null): Project | null {
  const key = folderKey(folder)
  if (!folder || !key || !projects) return null
  const made = projects.filter(p => !p.isHome)
  // The exact spelling first: a Linux host may hold two folders that differ only by case.
  const exact = folder.trim().replace(/[\\/]+$/, '')
  return made.find(p => p.path?.trim().replace(/[\\/]+$/, '') === exact) ?? made.find(p => folderKey(p.path) === key) ?? null
}

// Case aside: a Mac's and a Windows host's folders are, and Finder or Explorer may spell one otherwise.
const folderKey = (path: string | undefined) => path?.trim().replace(/[\\/]+$/, '').toLowerCase() || ''
