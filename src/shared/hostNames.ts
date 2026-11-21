/**
 * What a saved host is called (the phone's SavedDashboardLabel): the name
 * the person gave it in Settings, else, when its address names nothing (an
 * IP address or localhost), the name its plugin gives its Hermes (the main
 * bot's, else the host's), else its address.
 */

/** The longest name Rename keeps, as on the phone. */
export const HOST_NAME_MAX = 40

/** An IP literal or localhost: every host on a home network would start with "1". */
export function addressNamesNothing(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  if (!host || host === 'localhost' || host.includes(':') || host.startsWith('[')) return true
  return /^\d[\d.]*$/.test(host)
}

export function addressName(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A name as Rename or the plugin gives it: one line, at most HOST_NAME_MAX; '' for none. */
export function cleanHostName(name: unknown): string {
  return typeof name === 'string' ? Array.from(name.replace(/\s+/g, ' ').trim()).slice(0, HOST_NAME_MAX).join('').trim() : ''
}

export function hostDisplayName(host: { url: string; name?: string; hermesName?: string }): string {
  return cleanHostName(host.name) || (addressNamesNothing(host.url) && cleanHostName(host.hermesName)) || addressName(host.url)
}

/**
 * A badge's mark for each host of a group, in order: the first letter of its
 * name, or, where two names start alike, its place in the group (1, 2, 3).
 * Should a place number match another's letter (a name starting "2"), every
 * badge is its place, so no two read the same.
 */
export function badgeLetters(names: readonly string[]): string[] {
  const letters = names.map(name => (Array.from(name.trim())[0] ?? '?').toUpperCase())
  const marks = letters.map((letter, index) => (letters.filter(l => l === letter).length > 1 ? String(index + 1) : letter))
  return new Set(marks).size === marks.length ? marks : names.map((_, index) => String(index + 1))
}
