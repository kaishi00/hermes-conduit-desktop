import { hostname as osHostname, networkInterfaces } from 'node:os'
import { isLoopbackHost } from '../shared/browserAddress'

/**
 * Whether the dashboard at `url` runs on this computer (desktop#605): its
 * address is loopback, this computer's own name (with or without `.local`),
 * or one of this computer's network addresses. Only then is a folder picked
 * in Finder or Explorer a folder Hermes can open; a project's folder is a
 * path on the Hermes host (desktop#393), so any other host gets the host's
 * own folders instead.
 */
export function isThisComputer(
  url: string | undefined,
  deps: { hostname?: () => string; addresses?: () => string[] } = {}
): boolean {
  if (!url) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  if (!host) return false
  if (isLoopbackHost(host)) return true
  const own = (deps.hostname ?? osHostname)().toLowerCase().replace(/\.local$/, '')
  if (own && (host === own || host === `${own}.local`)) return true
  return (deps.addresses ?? ownAddresses)().some(address => address.toLowerCase() === host)
}

function ownAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap(list => (list ?? []).map(info => info.address.replace(/%.*$/, '')))
}

/**
 * The spellings Hermes may know a folder picked here by: the path itself,
 * and for a Windows path, its /mnt/<drive>/… form, for a Hermes in WSL
 * reached at localhost. The renderer keeps the first one Hermes lists.
 */
export function hostSpellings(path: string): string[] {
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(path)
  if (!drive) return [path]
  const rest = drive[2]!.replace(/\\/g, '/').replace(/\/+$/, '')
  return [path, `/mnt/${drive[1]!.toLowerCase()}${rest ? `/${rest}` : ''}`]
}

/**
 * A path on the Hermes host as this computer has it, for Show in Finder or Explorer on a dashboard that runs here
 * (desktop issue 686), or null when it can't be told: `~` is this computer's home on a Mac or Linux; on Windows a WSL
 * Hermes' /mnt/<drive>/… is that drive's path, and any other POSIX path (a WSL home, `~` there) isn't one this
 * computer can show. A `\\server\share` path isn't either: showing it would have Windows reach, and sign in to,
 * a host a reply named. The caller checks it's there before showing it.
 */
export function localSpelling(path: string, deps: { home: string; windows: boolean }): string | null {
  let local = path.trim()
  if (deps.windows) {
    const wsl = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(local)
    if (wsl) local = `${wsl[1]!.toUpperCase()}:\\${(wsl[2] ?? '').replace(/\//g, '\\')}`
    else if (/^[A-Za-z]:[\\/]/.test(local)) local = local.replace(/\//g, '\\')
    else return null
  } else if (local === '~' || local.startsWith('~/')) {
    local = `${deps.home.replace(/\/+$/, '')}${local.slice(1)}`
  }
  // A folder's trailing separator: Finder and Explorer show the folder itself.
  return local.length > 1 && !/^[A-Za-z]:[\\/]$/.test(local) ? local.replace(/[\\/]+$/, '') : local
}

/** The path-link menu's item that shows the path on this computer, named as each system names its file browser. */
export function showOnComputerLabel(platform: NodeJS.Platform, t: (key: string) => string): string {
  return platform === 'darwin' ? t('Show in Finder') : platform === 'win32' ? t('Show in Explorer') : t('Show in File Manager')
}
