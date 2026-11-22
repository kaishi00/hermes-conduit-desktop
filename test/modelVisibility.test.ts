// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  editorMatches,
  loadVisibility,
  modelKey as modelKeyOf,
  modelHidden,
  NOTHING_HIDDEN,
  saveVisibility,
  setAllModels,
  shownCount,
  toggleModel,
  toggleProvider,
  visibilityFor,
  visibleProviders
} from '../src/renderer/src/state/modelVisibility'
import type { ModelProviderRow } from '../src/renderer/src/state/models'

const providers: ModelProviderRow[] = [
  { slug: 'openrouter', name: 'OpenRouter', models: ['a', 'b', 'c'] },
  { slug: 'nous', name: 'Nous Portal', models: ['a', 'h'] }
]

describe('model visibility (Edit)', () => {
  afterEach(() => localStorage.clear())

  it('hides a model under one provider only, and a whole provider', () => {
    let v = toggleModel(NOTHING_HIDDEN, 'openrouter', 'a')
    expect(modelHidden(v, 'openrouter', 'a')).toBe(true)
    expect(modelHidden(v, 'nous', 'a')).toBe(false)
    expect(visibleProviders(v, providers).map(p => [p.slug, p.models])).toEqual([
      ['openrouter', ['b', 'c']],
      ['nous', ['a', 'h']]
    ])
    v = toggleProvider(v, 'nous')
    expect(modelHidden(v, 'nous', 'h')).toBe(true)
    expect(visibleProviders(v, providers).map(p => p.slug)).toEqual(['openrouter'])
  })

  it("keeps a hidden provider's own model choices for when it's shown again", () => {
    let v = toggleModel(NOTHING_HIDDEN, 'nous', 'h')
    v = toggleProvider(v, 'nous')
    v = toggleProvider(v, 'nous')
    expect(visibleProviders(v, providers)[1]!.models).toEqual(['a'])
  })

  it('shows or hides all of a provider, leaving the others', () => {
    let v = toggleModel(NOTHING_HIDDEN, 'nous', 'a')
    v = setAllModels(v, providers[0]!, false)
    expect(shownCount(v, providers[0]!)).toBe(0)
    expect(shownCount(v, providers[1]!)).toBe(1)
    v = setAllModels(v, providers[0]!, true)
    expect(shownCount(v, providers[0]!)).toBe(3)
    expect(modelHidden(v, 'nous', 'a')).toBe(true)
  })

  it("finds a provider by its name with all its models, or models by id", () => {
    expect(editorMatches(providers, 'portal').map(m => [m.provider.slug, m.models])).toEqual([['nous', ['a', 'h']]])
    expect(editorMatches(providers, 'H').map(m => [m.provider.slug, m.models])).toEqual([
      ['nous', ['h']]
    ])
    expect(editorMatches(providers, 'b').map(m => m.provider.slug)).toEqual(['openrouter'])
  })

  it('is kept per host on this computer, each once and sorted', () => {
    saveVisibility('host-a', { hiddenProviders: ['nous', 'nous', ''], hiddenModels: ['x', 'a'] })
    expect(visibilityFor('host-a')).toEqual({ hiddenProviders: ['nous'], hiddenModels: ['a', 'x'] })
    expect(loadVisibility('host-a')).toEqual({ hiddenProviders: ['nous'], hiddenModels: ['a', 'x'] })
    expect(loadVisibility('host-b')).toEqual(NOTHING_HIDDEN)
  })
})

describe('Edit draws', () => {
  it('every provider with how many models it shows, a hidden one marked, and the one holding the pick open', async () => {
    const path = '../src/renderer/src/components/ModelVisibilityEditor.tsx'
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { ModelVisibilityEditor } = (await import(/* @vite-ignore */ path)) as { ModelVisibilityEditor: unknown }
    // The default host, as a component outside a host's window reads it.
    saveVisibility('', { hiddenProviders: ['nous'], hiddenModels: [modelKeyOf('openrouter', 'b'), modelKeyOf('openrouter', 'c')] })
    const html = renderToStaticMarkup(createElement(ModelVisibilityEditor as never, { providers, openProvider: 'openrouter', onDone: () => {} } as never))
    expect(html).toContain('Model visibility')
    expect(html).toContain('1 of 3 shown')
    expect(html).toContain('2 of 2 shown')
    expect(html).toMatch(/visibility-provider hidden.*Nous Portal/)
    expect(html).toMatch(/aria-pressed="false" aria-label="b, Hidden"/)
    expect(html).not.toContain('h, Visible')
  })
})

describe('Edit and models Hermes says cannot run', () => {
  it('leaves them out, as every list does', () => {
    const row: ModelProviderRow = { slug: 'p', name: 'P', models: ['a', 'b'], unavailable_models: ['b'] }
    expect(shownCount(NOTHING_HIDDEN, row)).toBe(1)
    expect(editorMatches([row], '')[0]!.models).toEqual(['a'])
  })
})

describe('a provider with nothing it can run (desktop#307)', () => {
  const empty: ModelProviderRow = { slug: 'gone', name: 'Gone', models: ['x'], unavailable_models: ['x'] }

  it("isn't in Edit, as it isn't in any other list", () => {
    expect(editorMatches([empty, { slug: 'p', name: 'P', models: ['a'] }], '').map(m => m.provider.slug)).toEqual(['p'])
    expect(editorMatches([empty], 'gone')).toEqual([])
  })

  it('shows "Nothing matches" only while searching', async () => {
    const path = '../src/renderer/src/components/ModelVisibilityEditor.tsx'
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { ModelVisibilityEditor } = (await import(/* @vite-ignore */ path)) as { ModelVisibilityEditor: unknown }
    const html = renderToStaticMarkup(createElement(ModelVisibilityEditor as never, { providers: [empty], onDone: () => {} } as never))
    expect(html).not.toContain('Nothing matches')
    expect(html).not.toContain('Gone')
  })
})
