/**
 * Read pictures kept as data URLs, bounded by their total size: the least
 * recently shown go first, so a long stay on one dashboard doesn't hold every
 * picture it ever showed (desktop#294). The newest picture always stays, and
 * a look at a kept one counts as showing it. Pictures that won't load (null)
 * are kept apart and never pushed out by real ones, so evicting a picture
 * never asks again for one Hermes already refused.
 */
export const PICTURE_CACHE_BUDGET = 64 * 1024 * 1024

export class PictureCache {
  private readonly pictures = new Map<string, string>()
  private readonly missing = new Set<string>()
  private size = 0

  constructor(private readonly budget = PICTURE_CACHE_BUDGET) {}

  has(key: string): boolean {
    return this.pictures.has(key) || this.missing.has(key)
  }

  /** The picture, null when it won't load, undefined when not kept. A picture read moves to the newest. */
  get(key: string): string | null | undefined {
    const url = this.pictures.get(key)
    if (url !== undefined) {
      this.pictures.delete(key)
      this.pictures.set(key, url)
      return url
    }
    return this.missing.has(key) ? null : undefined
  }

  set(key: string, url: string | null): void {
    this.delete(key)
    if (url === null) {
      this.missing.add(key)
      return
    }
    this.pictures.set(key, url)
    this.size += url.length
    for (const [oldest, old] of this.pictures) {
      if (this.size <= this.budget || oldest === key) break
      this.pictures.delete(oldest)
      this.size -= old.length
    }
  }

  delete(key: string): void {
    const url = this.pictures.get(key)
    if (url !== undefined) this.size -= url.length
    this.pictures.delete(key)
    this.missing.delete(key)
  }

  clear(): void {
    this.pictures.clear()
    this.missing.clear()
    this.size = 0
  }
}
