/**
 * All profiles in Chats, grouped by profile, after the phone's
 * AllProfilesChats (issue 1560, #1571): a section per profile, in the
 * profile strip's order, listing its pinned chats and its five newest
 * until "Show N more"; "Show fewer" puts it back. The open chat stays
 * listed past the five. A search or a status or Starred filter lists every
 * match; a source filter is still a browse and keeps the cap. Show more is
 * remembered per profile until the app closes; a closed section stays
 * closed across launches.
 */
import type { ChatRow } from './chats'

export const GROUP_PREVIEW_COUNT = 5

export interface ProfileGroup {
  profile: string
  rows: ChatRow[]
  /** What Show more brings. */
  hidden: number
  /** Shown past the cap by Show more, so Show fewer puts them back. */
  extra: number
}

const key = (profile?: string) => (profile || 'default').toLowerCase()

/** The rows split by profile, in `profiles` order, then any profile not listed, each its pinned rows first. */
export function profileGroups(
  rows: ChatRow[],
  profiles: string[],
  options: { showsAll: (profile: string) => boolean; capped: boolean; openId: string | null; pinnedOrder?: (pinned: ChatRow[]) => ChatRow[] }
): ProfileGroup[] {
  const byProfile = new Map<string, ChatRow[]>()
  for (const row of rows) {
    const k = key(row.profile)
    byProfile.set(k, [...(byProfile.get(k) ?? []), row])
  }
  const order = [...profiles.map(key), ...[...byProfile.keys()].filter(k => !profiles.map(key).includes(k))]
  const groups: ProfileGroup[] = []
  for (const profile of [...new Set(order)]) {
    const items = byProfile.get(profile)
    if (!items?.length) continue
    const pinned = items.filter(r => r.pinned)
    const others = items.filter(r => !r.pinned).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))
    const ordered = [...(options.pinnedOrder ? options.pinnedOrder(pinned) : pinned), ...others]
    if (!options.capped) {
      groups.push({ profile, rows: ordered, hidden: 0, extra: 0 })
      continue
    }
    const kept = new Set(others.slice(0, GROUP_PREVIEW_COUNT).map(r => r.id))
    const shown = ordered.filter(r => r.pinned || kept.has(r.id) || r.id === options.openId)
    const capHides = ordered.length - shown.length
    if (options.showsAll(profile)) groups.push({ profile, rows: ordered, hidden: 0, extra: capHides })
    else groups.push({ profile, rows: shown, hidden: capHides, extra: 0 })
  }
  return groups
}

const GROUP_KEY = 'conduit.allProfiles.groupByProfile'
const CLOSED_KEY = 'conduit.allProfiles.closedSections'

export function readGroupByProfile(): boolean {
  try {
    return localStorage.getItem(GROUP_KEY) === '1'
  } catch {
    return false
  }
}

export function writeGroupByProfile(on: boolean): void {
  try {
    localStorage.setItem(GROUP_KEY, on ? '1' : '0')
  } catch {
    // Kept for this window only.
  }
}

const DATE_DEFAULTS_KEY = 'conduit.chatList.dateSectionDefaults'
/** The date sections closed until they're opened, as on the phone: Previous 7 days and Older. */
export const DATE_SECTIONS_CLOSED_AT_FIRST = ['date:week', 'date:older']

/**
 * The closed sections: profiles by name, hosts as `host:<url>`, date
 * sections as `date:<bucket>`. The first read closes the two oldest date
 * sections, as the phone's first launch does; after that the list is the
 * user's own.
 */
export function readClosedSections(): string[] {
  let closed: string[] = []
  try {
    const list = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]')
    closed = Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch {
    closed = []
  }
  try {
    if (localStorage.getItem(DATE_DEFAULTS_KEY) === '1') return closed
    closed = [...closed, ...DATE_SECTIONS_CLOSED_AT_FIRST.filter(key => !closed.includes(key))]
    localStorage.setItem(DATE_DEFAULTS_KEY, '1')
    localStorage.setItem(CLOSED_KEY, JSON.stringify(closed))
    return closed
  } catch {
    // Storage is off: the defaults, for this window only.
    return [...closed, ...DATE_SECTIONS_CLOSED_AT_FIRST.filter(key => !closed.includes(key))]
  }
}

export function writeClosedSections(profiles: string[]): void {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify(profiles))
  } catch {
    // Kept for this window only.
  }
}

const LEFT_OUT_KEY = 'conduit.allProfiles.leftOut'

/**
 * The profiles All lists, after the phone's Show in All: every profile but
 * the ones left out, kept by name so a profile added later is in. Leaving
 * every one out lists them all, so All never lists nothing.
 */
export function includedInAll(profiles: string[], leftOut: string[]): string[] {
  const out = new Set(leftOut.map(p => p.toLowerCase()))
  const kept = profiles.filter(p => !out.has(p.toLowerCase()))
  return kept.length ? kept : profiles
}

/** Whether a row of `profile` shows in All: only a profile left out (while another is still in) is hidden. */
export function shownInAll(profile: string | undefined, profiles: string[], leftOut: string[]): boolean {
  const name = (profile || 'default').toLowerCase()
  if (!leftOut.some(p => p.toLowerCase() === name)) return true
  return includedInAll(profiles, leftOut).some(p => p.toLowerCase() === name)
}

export function readLeftOut(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(LEFT_OUT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function writeLeftOut(profiles: string[]): void {
  try {
    if (profiles.length) localStorage.setItem(LEFT_OUT_KEY, JSON.stringify(profiles))
    else localStorage.removeItem(LEFT_OUT_KEY)
  } catch {
    // Kept for this window only.
  }
}
