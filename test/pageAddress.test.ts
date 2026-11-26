// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setPictureHost } from '../src/renderer/src/state/gatewayPictures'

/** A page preview's reads over a stubbed gateway and main process (desktop#591). */
let pageAddress: (path: string, profile?: string) => Promise<string | null>
beforeAll(async () => {
  // A .tsx module: imported by a path the node type check doesn't follow, as the other component tests do.
  const path = '../src/renderer/src/components/PagePreview'
  ;({ pageAddress } = (await import(/* @vite-ignore */ path)) as { pageAddress: typeof pageAddress })
})

let reads: string[] = []
let answers: Record<string, { ok: true; result: unknown } | { ok: false; error: string; code?: number }> = {}
let served = new Set<string>()
let made = 0
let host = 0

beforeEach(() => {
  reads = []
  answers = {}
  served = new Set()
  // Each case on a dashboard of its own, so nothing an earlier case kept is drawn here.
  setPictureHost(`https://host-${++host}`)
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: async (_method: string, path: string) => {
      reads.push(path)
      const file = decodeURIComponent(/path=([^&]+)/.exec(path)?.[1] ?? '')
      return answers[file] ?? { ok: true, result: { text: '<p>hi</p>' } }
    },
    pageUrl: async () => {
      const url = `conduit-page://page-${++made}/`
      served.add(url)
      return url
    },
    pageServed: async (url: string) => served.has(url)
  }
})

describe('page previews (desktop#591)', () => {
  it('shares one read between blocks of the same page drawn together', async () => {
    const [a, b] = await Promise.all([pageAddress('/r/report.html'), pageAddress('/r/report.html')])
    expect(a).toBe(b)
    expect(reads.length).toBe(1)
  })

  it('keeps a refusal, and reads a page that failed for now again', async () => {
    answers['/r/gone.html'] = { ok: false, error: 'HTTP 404', code: 404 }
    answers['/r/big.bin'] = { ok: true, result: { binary: true } }
    answers['/r/slow.html'] = { ok: false, error: 'timed out', code: 408 }
    for (const path of ['/r/gone.html', '/r/big.bin', '/r/slow.html']) expect(await pageAddress(path)).toBeNull()
    for (const path of ['/r/gone.html', '/r/big.bin', '/r/slow.html']) await pageAddress(path)
    expect(reads.filter(p => p.includes('gone')).length).toBe(1)
    expect(reads.filter(p => p.includes('big')).length).toBe(1)
    expect(reads.filter(p => p.includes('slow')).length).toBe(2)
  })

  it('reads a page again once the main process has forgotten its address', async () => {
    const first = await pageAddress('/r/report.html')
    expect(await pageAddress('/r/report.html')).toBe(first)
    expect(reads.length).toBe(1)
    served.delete(first!)
    const again = await pageAddress('/r/report.html')
    expect(again).not.toBe(first)
    expect(reads.length).toBe(2)
  })

  it('drops another dashboard’s copies once this window follows a new host', async () => {
    await pageAddress('/r/report.html')
    setPictureHost('https://elsewhere')
    await pageAddress('/r/report.html')
    expect(reads.length).toBe(2)
  })
})
