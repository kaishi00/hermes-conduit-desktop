import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, {
      conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }),
      addEventListener() {},
      removeEventListener() {}
    }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

const summaries = {
  summary: () => null,
  lookingBack: () => false,
  explain: () => undefined
}

describe('a jumped-to step is findable in the drawn window', () => {
  it('carries every step key on its run, and on a lone step', async () => {
    const path = '../src/renderer/src/components/Transcript.tsx'
    const { StepRun, LoneStep } = (await import(/* @vite-ignore */ path)) as { StepRun: unknown; LoneStep: unknown }
    const step = (key: string) => ({ kind: 'tool', key, toolId: key, name: 'run', status: 'done', at: 0 })
    const run = createElement(StepRun as never, {
      row: { type: 'steps', id: 'k1', items: [step('k1'), step('k2')], trailing: true },
      live: false,
      expandTools: true,
      summaries,
      children: null
    } as never)
    expect(renderToStaticMarkup(run)).toContain('data-step-keys="k1 k2"')

    const lone = createElement(LoneStep as never, { step: step('lone'), live: false, summaries, children: null } as never)
    expect(renderToStaticMarkup(lone)).toContain('data-key="lone"')
  })
})
