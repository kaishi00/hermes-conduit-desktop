/**
 * A path a reply names, opened (desktop issue 686): looked up for the chat as the phone looks it up, shown in the
 * Folder, or in Finder or Explorer while the dashboard runs on this computer (Eric, 2026-11-27). A name the host
 * doesn't have says so in the chat rather than opening the Folder on "That folder isn't on the server".
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { gateway } from '../gateway'
import { t } from '../../../shared/i18n'
import { STATUS_PATH, askPluginStatus, serves } from './plugin'
import { scoped } from './capabilities'
import { RESOLVE_FOLDERS_CAPABILITY, absolutePath, baseName, lookUpLink, type LinkLookup } from './workspace'

export interface LinkOpenerOptions {
  /** The chat's folder; without one there's no Folder to open a link in. */
  cwd: string | null | undefined
  /** The dashboard's address, so a plugin's answer is asked again on another. */
  dashboard: string | null | undefined
  profile: string | null | undefined
  /** Each id the chat goes by. */
  sessionIds: (string | null | undefined)[]
  /** Opens the path in the Folder (a folder's ends in its separator). */
  reveal: (path: string) => void
  /** A line in the chat. */
  notice: (text: string) => void
}

export interface FileLinkActions {
  open: (path: string) => void
  /** The link's right-click menu; `at`, the link's corner, for one opened from the keyboard. */
  menu: (path: string, at?: { x: number; y: number }) => void
}

/**
 * Whether a plugin's answer about the folder lookup still holds: a yes for the window's life, a no for a minute, so a
 * plugin updated meanwhile is asked again (an ask that couldn't tell is asked again at once).
 */
export const servedAnswerHolds = (answer: boolean, askedAt: number, now: number) => answer || now - askedAt < 60_000

/** A plugin's answer about the folder lookup, asked or being asked. */
export interface ServedAsk {
  key: string
  askedAt: number
  answer: Promise<boolean | null>
  /** The answer once it came: null when the ask couldn't tell. */
  settled?: boolean | null
}

/**
 * Whether an ask still answers for this dashboard and profile: one still running does, and a settled one as long as
 * servedAnswerHolds says; one that couldn't tell is asked again at once. Checked before a click uses it, so the first
 * click after a no expires asks the plugin again.
 */
export const servedAskHolds = (ask: ServedAsk | null, key: string, now: number) =>
  !!ask && ask.key === key && (ask.settled === undefined || (ask.settled !== null && servedAnswerHolds(ask.settled, ask.askedAt, now)))

export const missingNotice = (name: string) => t('{name} isn’t on the server. It may have been deleted, or it’s on another computer.', { name })

export function useLinkOpener({ cwd, dashboard, profile, sessionIds, reveal, notice }: LinkOpenerOptions): FileLinkActions | null {
  const ids = sessionIds.filter((id): id is string => !!id)
  const idsKey = [...new Set(ids)].join('\n')
  // Whether the profile's plugin finds folders, asked per profile and dashboard and kept as servedAnswerHolds says.
  const served = useRef<ServedAsk | null>(null)
  const servedKey = `${dashboard ?? ''}\n${profile ?? 'default'}`
  const servesFolders = useCallback(async () => {
    if (!servedAskHolds(served.current, servedKey, Date.now())) {
      const ask: ServedAsk = {
        key: servedKey,
        askedAt: Date.now(),
        answer: askPluginStatus(() => gateway.http('GET', scoped(STATUS_PATH, profile ?? 'default'), undefined, 8_000)).then(status =>
          status ? serves(status, [RESOLVE_FOLDERS_CAPABILITY]) : null
        )
      }
      void ask.answer.then(answer => (ask.settled = answer))
      served.current = ask
    }
    return (await served.current!.answer) === true
  }, [servedKey, profile])
  // A later click wins over a lookup still running for an earlier one.
  const clicks = useRef(0)
  useEffect(() => {
    clicks.current += 1
  }, [cwd, idsKey, servedKey])
  const live = useRef({ reveal, notice })
  live.current = { reveal, notice }

  const look = useCallback(
    async (path: string): Promise<LinkLookup | null> => {
      const mine = (clicks.current += 1)
      const found = await lookUpLink(path, { sessionIds: idsKey ? idsKey.split('\n') : [], profile, serves: servesFolders, get: route => gateway.http('GET', route) })
      return mine === clicks.current ? found : null
    },
    [idsKey, profile, servesFolders]
  )

  return useMemo(() => {
    if (!cwd) return null
    const where = (found: LinkLookup, path: string) => ('path' in found ? found.path : 'missing' in found ? null : absolutePath(path, cwd))
    const open = (path: string) =>
      void look(path).then(found => {
        if (!found) return
        const at = where(found, path)
        if (at) live.current.reveal(at)
        else if ('missing' in found) live.current.notice(missingNotice(found.missing))
      })
    const showOnComputer = (path: string) =>
      void look(path).then(async found => {
        if (!found) return
        const at = where(found, path)
        if (!at) return 'missing' in found && live.current.notice(missingNotice(found.missing))
        const shown = await window.conduit.showOnComputer(at).catch(() => false)
        if (!shown) live.current.notice(t('{name} isn’t on this computer.', { name: baseName(at) || at }))
      })
    const menu = (path: string, at?: { x: number; y: number }) =>
      void window.conduit
        .pathLinkMenu(at)
        .catch(() => null)
        .then(choice => {
          if (choice === 'folder') open(path)
          else if (choice === 'computer') showOnComputer(path)
          else if (choice === 'copy') void navigator.clipboard.writeText(path).catch(() => undefined)
        })
    return { open, menu }
  }, [cwd, look])
}
