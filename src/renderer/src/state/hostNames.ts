/**
 * Each saved host's name as the main process last listed it
 * (shared/hostNames.ts: the person's, else its Hermes' for an address that
 * names nothing, else its address), so every place that labels a host by its
 * address says the same name.
 */
import type { HostSummary } from '@shared/ipc'
import { addressName } from '@shared/hostNames'

const names = new Map<string, string>()

/** Takes the names of a new host list (every status carries one). */
export function rememberHostNames(hosts: readonly HostSummary[] | undefined): void {
  if (!hosts) return
  names.clear()
  for (const host of hosts) if (host.name) names.set(host.url, host.name)
}

/** A saved host's name; its address for one not saved. */
export function hostName(url: string): string {
  return names.get(url) ?? addressName(url)
}
