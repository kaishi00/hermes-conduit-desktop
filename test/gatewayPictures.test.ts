import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Outcome = { ok: true; result: unknown } | { ok: false; error: string; code?: number }
let answers: Outcome[] = []
let asked: string[] = []

beforeEach(() => {
  vi.resetModules()
  answers = []
  asked = []
  ;(globalThis as { window?: unknown }).window = {
    conduit: {
      httpOutcome: async (_method: string, path: string) => {
        asked.push(path)
        return answers.shift() ?? { ok: false, error: 'no answer' }
      }
    }
  }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const picture = (bytes: string): Outcome => ({ ok: true, result: { dataUrl: `data:image/png;base64,${bytes}` } })
const status = (code: number): Outcome => ({ ok: false, error: `HTTP ${code}`, code })
const load = () => import('../src/renderer/src/state/gatewayPictures')

describe('pictures on the Hermes host, per dashboard (desktop#222)', () => {
  it("never draws one dashboard's picture on another", async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    answers.push(picture('QUFB'))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBe('data:image/png;base64,QUFB')
    pictures.setPictureHost('https://b')
    expect(pictures.keptPicture('/tmp/chart.png')).toBeUndefined()
    answers.push(picture('QkJC'))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBe('data:image/png;base64,QkJC')
    expect(asked).toHaveLength(2)
  })

  it("doesn't keep one dashboard's refusal for another", async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    answers.push(status(404))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBeNull()
    expect(pictures.keptPicture('/tmp/chart.png')).toBeNull()
    pictures.setPictureHost('https://b')
    answers.push(picture('QkJC'))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBe('data:image/png;base64,QkJC')
  })

  it("drops an answer that lands after the switch", async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    answers.push(picture('QUFB'))
    const late = pictures.readGatewayPicture('/tmp/chart.png')
    pictures.setPictureHost('https://b')
    await late
    expect(pictures.keptPicture('/tmp/chart.png')).toBeUndefined()
    pictures.setPictureHost('https://a')
    expect(pictures.keptPicture('/tmp/chart.png')).toBeUndefined()
  })
})

describe('a failure to ask is asked again (desktop#223)', () => {
  it.each([401, 408, 429, 502])('after a %i', async code => {
    const pictures = await load()
    answers.push(status(code), picture('QUFB'))
    expect(await pictures.readGatewayPicture('/h/a.png')).toBeNull()
    expect(pictures.keptPicture('/h/a.png')).toBeUndefined()
    expect(await pictures.readGatewayPicture('/h/a.png')).toBe('data:image/png;base64,QUFB')
  })

  it("keeps a refusal Hermes means", async () => {
    const pictures = await load()
    for (const code of [400, 403, 404, 410, 413, 415]) expect(pictures.refused({ code })).toBe(true)
    answers.push(status(404))
    await pictures.readGatewayPicture('/h/gone.png')
    expect(await pictures.readGatewayPicture('/h/gone.png')).toBeNull()
    expect(asked).toHaveLength(1)
  })
})
