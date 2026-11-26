import { describe, expect, it } from 'vitest'
import { notePage, pageCacheKey, prunePages, rememberedPage, type PageCache } from '../src/renderer/src/state/pagePreviewCache'

describe('page previews across dashboards (issue 589)', () => {
  it('never shows another host’s page at the same path', () => {
    const cache: PageCache = new Map()
    notePage(cache, '/a/report.html', undefined, 'A', 'conduit-page://a')
    expect(rememberedPage(cache, '/a/report.html', undefined, 'A')).toBe('conduit-page://a')
    expect(rememberedPage(cache, '/a/report.html', undefined, 'B')).toBeUndefined()
    expect(pageCacheKey('/a/report.html', 'work', 'A')).not.toBe(pageCacheKey('/a/report.html', undefined, 'A'))
  })

  it('retries a failed read instead of caching the failure forever', () => {
    const cache: PageCache = new Map()
    notePage(cache, '/a/report.html', undefined, 'A', null)
    expect(rememberedPage(cache, '/a/report.html', undefined, 'A')).toBeUndefined()
    notePage(cache, '/a/report.html', undefined, 'A', 'conduit-page://a')
    expect(rememberedPage(cache, '/a/report.html', undefined, 'A')).toBe('conduit-page://a')
  })

  it('drops other hosts’ copies on a switch', () => {
    const cache: PageCache = new Map()
    notePage(cache, '/a/report.html', undefined, 'A', 'conduit-page://a')
    notePage(cache, '/a/report.html', undefined, 'B', 'conduit-page://b')
    prunePages(cache, 'B')
    expect(rememberedPage(cache, '/a/report.html', undefined, 'A')).toBeUndefined()
    expect(rememberedPage(cache, '/a/report.html', undefined, 'B')).toBe('conduit-page://b')
  })
})
