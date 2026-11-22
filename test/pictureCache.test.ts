import { describe, expect, it } from 'vitest'
import { PictureCache } from '../src/renderer/src/state/pictureCache'

describe('kept pictures within a size budget (desktop#294)', () => {
  it('lets the least recently shown go first, and always keeps the newest', () => {
    const cache = new PictureCache(10)
    cache.set('a', 'aaaa')
    cache.set('b', 'bbbb')
    expect(cache.get('a')).toBe('aaaa')
    cache.set('c', 'cccc')
    expect(cache.has('b')).toBe(false)
    expect(cache.get('a')).toBe('aaaa')
    expect(cache.get('c')).toBe('cccc')
    cache.set('big', 'x'.repeat(20))
    expect(cache.get('big')).toBe('x'.repeat(20))
    expect(cache.has('a') || cache.has('c')).toBe(false)
  })

  it('keeps pictures that will not load apart, so evictions never ask for them again', () => {
    const cache = new PictureCache(4)
    cache.set('gone', null)
    cache.set('a', 'aaaa')
    cache.set('b', 'bbbb')
    expect(cache.get('gone')).toBeNull()
    expect(cache.has('gone')).toBe(true)
    expect(cache.get('nope')).toBeUndefined()
    cache.clear()
    expect(cache.has('gone')).toBe(false)
  })
})
