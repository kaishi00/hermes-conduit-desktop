import { describe, expect, it, vi } from 'vitest'
import { choosingBackend, parseBackends, parseModels, pickModel, readModels, settingKey } from '../src/renderer/src/state/toolsetPage'

const missing = Object.assign(new Error('Not Found'), { code: 404 })

describe('a toolset page', () => {
  const config = {
    has_category: true,
    providers: [
      { name: 'FAL', is_active: true, status: 'ready', env_vars: [{ key: 'FAL_KEY', prompt: 'FAL key', is_set: true }] },
      { name: 'xAI', badge: 'paid', is_active: false, status: 'needs_keys', env_vars: [{ key: 'XAI_API_KEY', is_set: false }] },
      { name: '' }
    ]
  }

  it('reads the backends with their keys, and shows a change as Hermes holds it', () => {
    const shown = parseBackends(config)
    expect(shown.hasCategory).toBe(true)
    expect(shown.backends.map(b => [b.name, b.active, b.status])).toEqual([
      ['FAL', true, 'ready'],
      ['xAI', false, 'needs_keys']
    ])
    expect(shown.backends[1]!.keys).toEqual([{ key: 'XAI_API_KEY', prompt: '', isSet: false }])
    const chosen = settingKey(choosingBackend(shown, 'xAI'), 'XAI_API_KEY')
    expect(chosen.backends.map(b => b.active)).toEqual([false, true])
    expect(chosen.backends[1]!.keys[0]!.isSet).toBe(true)
  })

  it('reads the models, the one in use, the default and an env var overriding the pick', () => {
    const models = parseModels({
      has_models: true,
      models: [
        { id: 'grok-imagine-image', display: 'Grok Imagine', speed: '~5s', price: '$0.02' },
        { id: 'grok-imagine-image-pro', display: '', strengths: 'Higher fidelity' }
      ],
      current: 'grok-imagine-image-pro',
      default: 'grok-imagine-image',
      override: { env: 'XAI_IMAGE_MODEL', model: 'grok-imagine-image' }
    })
    expect(models?.models).toEqual([
      { id: 'grok-imagine-image', display: 'Grok Imagine', facts: '~5s · $0.02', strengths: '' },
      { id: 'grok-imagine-image-pro', display: 'grok-imagine-image-pro', facts: '', strengths: 'Higher fidelity' }
    ])
    expect(models?.current).toBe('grok-imagine-image-pro')
    expect(models?.override).toEqual({ env: 'XAI_IMAGE_MODEL', model: 'grok-imagine-image' })
    expect(parseModels({ has_models: false, models: [] })).toBeNull()
  })

  it('asks the plugin for the models and a pick, and Hermes when the plugin has no route', async () => {
    const http = vi.fn(async (_method: string, path: string) => {
      if (path.startsWith('/api/plugins/')) throw missing
      return { has_models: true, models: [{ id: 'm' }] }
    })
    await readModels(http, 'image_gen', 'second')
    expect(http.mock.calls.map(c => c[1])).toEqual([
      '/api/plugins/conduit_push/media-models/image_gen?profile=second',
      '/api/tools/toolsets/image_gen/models?profile=second'
    ])
    http.mockClear()
    await pickModel(http, 'image_gen', 'second', 'm')
    expect(http.mock.calls).toEqual([
      ['PUT', '/api/plugins/conduit_push/media-models/image_gen?profile=second', { model: 'm' }],
      ['PUT', '/api/tools/toolsets/image_gen/model?profile=second', { model: 'm', profile: 'second' }]
    ])
  })

  it('keeps any other refusal its own', async () => {
    const refused = Object.assign(new Error('xai has no model'), { code: 400 })
    const http = vi.fn(async () => {
      throw refused
    })
    await expect(pickModel(http, 'image_gen', 'default', 'x')).rejects.toBe(refused)
    expect(http).toHaveBeenCalledTimes(1)
  })
})
