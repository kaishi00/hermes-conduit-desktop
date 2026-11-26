/**
 * Pages already read for a preview, kept per dashboard and profile. A host switch
 * keeps the renderer alive, so the host is part of the key. A page Hermes refused
 * (gone, not allowed, binary, cut short, too big to serve) is kept as refused, so
 * it isn't read again each time its block draws; a read that failed for now (a
 * timeout, no connection) isn't kept, so it is tried again (issue 589, desktop#591,
 * as #222/#223 for pictures).
 */
export interface PageCacheEntry {
  host: string
  /** The page's address on the page scheme; null for a page Hermes refused. */
  url: string | null
}

export type PageCache = Map<string, PageCacheEntry>

export const pageCacheKey = (path: string, profile: string | undefined, host: string): string =>
  `${host}\0${profile ?? ''}\0${path}`

/** The page's address, null when it was refused, undefined when it hasn't been read. */
export function rememberedPage(cache: PageCache, path: string, profile: string | undefined, host: string): string | null | undefined {
  return cache.get(pageCacheKey(path, profile, host))?.url
}

/** Notes a read: an address, a refusal (`url` null, `refused`), or a failure for now, which forgets the page. */
export function notePage(cache: PageCache, path: string, profile: string | undefined, host: string, url: string | null, refused = false): void {
  const key = pageCacheKey(path, profile, host)
  if (url === null && !refused) cache.delete(key)
  else cache.set(key, { host, url })
}

export function prunePages(cache: PageCache, host: string): void {
  for (const [key, entry] of [...cache]) if (entry.host !== host) cache.delete(key)
}
