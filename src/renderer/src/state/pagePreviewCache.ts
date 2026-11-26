/**
 * Pages already read for a preview, kept per dashboard and profile. A host switch
 * keeps the renderer alive, so the host must be part of the key; a read that failed
 * is not kept, so it is tried again after a reconnect (issue 589, as #222/#236 for pictures).
 */
export interface PageCacheEntry {
  host: string
  url: string | null
}

export type PageCache = Map<string, PageCacheEntry>

export const pageCacheKey = (path: string, profile: string | undefined, host: string): string =>
  `${host}\0${profile ?? ''}\0${path}`

export function rememberedPage(cache: PageCache, path: string, profile: string | undefined, host: string): string | null | undefined {
  const hit = cache.get(pageCacheKey(path, profile, host))
  return hit && hit.host === host ? hit.url : undefined
}

export function notePage(cache: PageCache, path: string, profile: string | undefined, host: string, url: string | null): void {
  const key = pageCacheKey(path, profile, host)
  // A failed read is a retry next time, not a permanent fallback.
  if (url === null) cache.delete(key)
  else cache.set(key, { host, url })
}

export function prunePages(cache: PageCache, host: string): void {
  for (const [key, entry] of [...cache]) if (entry.host !== host) cache.delete(key)
}
