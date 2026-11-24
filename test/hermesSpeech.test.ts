import { describe, expect, it } from 'vitest'
import {
  CONFIG_UNSET_PATH,
  fieldProblem,
  rowProviderId,
  saveFields,
  saveProvider,
  selectedProvider,
  speechFields,
  speechProviders,
  withFields,
  withProvider
} from '../src/renderer/src/state/hermesSpeech'
import type { Http } from '../src/renderer/src/state/profileConfig'

const toolset = {
  providers: [
    { name: 'Microsoft Edge TTS', tts_provider: 'edge', status: 'ready', env_vars: [] },
    { name: 'OpenAI TTS', tts_provider: 'openai', status: 'needs_keys', env_vars: [{ key: 'VOICE_TOOLS_OPENAI_KEY', is_set: false, prompt: 'OpenAI API key' }] },
    { name: 'Nous Subscription', managed_nous_feature: 'tts', status: 'needs_auth', env_vars: [] },
    { name: 'ElevenLabs', status: { state: 'ready' }, env_vars: [{ key: 'ELEVENLABS_API_KEY', is_set: true }] }
  ]
}

describe("Hermes' speech providers", () => {
  it('names each row by the id Hermes writes, the managed Nous route apart from OpenAI', () => {
    expect(rowProviderId({ name: 'Nous Subscription', tts_provider: 'openai' }, 'tts')).toBe('nous')
    expect(rowProviderId({ name: 'Local Whisper' }, 'stt')).toBe('local')
    expect(rowProviderId({ name: 'xAI TTS' }, 'tts')).toBe('xai')
    expect(rowProviderId({ name: 'My Plugin Voice' }, 'tts')).toBe('my_plugin_voice')
  })

  it("lists the schema's choices, the rows and the one set now, each once, with its status and keys", () => {
    const providers = speechProviders('tts', toolset, { tts: { provider: 'kokoro' } }, { fields: { 'tts.provider': { options: ['edge', 'openai'] } } })
    expect(providers.map(p => p.id)).toEqual(['edge', 'openai', 'nous', 'elevenlabs', 'kokoro'])
    expect(providers[1]).toMatchObject({ status: 'needs_keys', row: 'OpenAI TTS', keys: [{ key: 'VOICE_TOOLS_OPENAI_KEY', isSet: false, prompt: 'OpenAI API key' }] })
    expect(providers[3]).toMatchObject({ name: 'ElevenLabs', status: 'ready' })
    expect(providers[4]).toMatchObject({ name: 'Kokoro', status: null, row: null })
  })

  it("judges an older Hermes' rows by their keys", () => {
    const [row] = speechProviders('stt', { providers: [{ name: 'Groq', stt_provider: 'groq', env_vars: [{ key: 'GROQ_API_KEY', is_set: false }] }] }, {}, null)
    expect(row).toMatchObject({ id: 'groq', status: 'needs_keys' })
  })

  it("takes Hermes' defaults when none is set", () => {
    expect(selectedProvider('stt', {})).toBe('local')
    expect(selectedProvider('tts', { tts: { provider: ' ' } })).toBe('edge')
  })

  it('edits the keys Hermes reads: Nous through OpenAI, ElevenLabs by id', () => {
    expect(speechFields('nous', 'tts').map(f => f.key)).toEqual(['tts.openai.model', 'tts.openai.language', 'tts.openai.voice', 'tts.openai.base_url', 'tts.openai.speed'])
    expect(speechFields('elevenlabs', 'tts').map(f => f.key)).toEqual(['tts.elevenlabs.voice_id', 'tts.elevenlabs.model_id', 'tts.elevenlabs.base_url'])
    expect(speechFields('elevenlabs', 'stt').map(f => f.key)).toEqual(['stt.elevenlabs.model_id', 'stt.elevenlabs.language'])
    expect(speechFields('xiaomi_mimo', 'tts').map(f => f.key)).toContain('tts.xiaomi_mimo.delivery_instructions')
    expect(speechFields('local', 'stt')[0]!.suggestions).toContain('large-v3')
  })

  it("saves typed values trimmed, a speed as a number, and a blank one taken out so Hermes' default applies", () => {
    const fields = speechFields('openai', 'tts')
    const config = { tts: { provider: 'openai', openai: { voice: 'nova', model: 'gpt-4o-mini-tts' } }, other: 1 }
    const next = withFields(config, fields, { 'tts.openai.voice': ' alloy ', 'tts.openai.model': '', 'tts.openai.speed': '1,5' })
    expect(next).toEqual({ tts: { provider: 'openai', openai: { voice: 'alloy', speed: 1.5 } }, other: 1 })
    expect(config.tts.openai.model).toBe('gpt-4o-mini-tts')
    const emptied = withFields({ stt: { groq: { model: 'x' } } }, speechFields('groq', 'stt'), { 'stt.groq.model': '' })
    expect(emptied).toEqual({})
  })

  it('refuses a speed outside what Hermes takes', () => {
    const speed = speechFields('openai', 'tts').find(f => f.key.endsWith('speed'))!
    expect(fieldProblem(speed, '5')).not.toBeNull()
    expect(fieldProblem(speed, 'fast')).not.toBeNull()
    expect(fieldProblem(speed, '0,5')).toBeNull()
    expect(fieldProblem(speed, '')).toBeNull()
  })

  it('writes a provider with no row as its section, leaving no gateway routing behind', () => {
    expect(withProvider({ stt: { provider: 'local', use_gateway: true, local: { model: 'base' } } }, 'stt', 'groq')).toEqual({ stt: { provider: 'groq', local: { model: 'base' } } })
  })
})

/** A Hermes whose PUT merges what it's sent over the file, and a plugin that takes keys out (or has no such route). */
function hermes(file: Record<string, any>, plugin = true) {
  const calls: string[] = []
  const merge = (onto: Record<string, any>, from: Record<string, any>) => {
    for (const [key, value] of Object.entries(from)) {
      if (value && typeof value === 'object' && onto[key] && typeof onto[key] === 'object') merge(onto[key], value)
      else onto[key] = structuredClone(value)
    }
  }
  const http: Http = async (method, path, body) => {
    calls.push(`${method} ${path}`)
    if (method === 'GET') return structuredClone(file)
    if (method === 'PUT') return void merge(file, (body as { config: Record<string, any> }).config)
    if (!plugin) throw Object.assign(new Error('Not Found'), { code: 404 })
    for (const key of (body as { keys: string[] }).keys) {
      const [section, ...rest] = key.split('.')
      const leaf = rest.pop()!
      const parent = rest.reduce((at, part) => at?.[part], file[section!])
      if (parent) delete parent[leaf]
    }
    return { ok: true }
  }
  return { http, calls, file }
}

describe('clearing a Hermes speech setting', () => {
  const fields = speechFields('openai', 'tts')

  it("takes a blanked field out through the plugin, since Hermes' save keeps a key left out", async () => {
    const host = hermes({ tts: { provider: 'openai', openai: { voice: 'nova', model: 'tts-1' } } })
    await saveFields(host.http, 'default', fields, { 'tts.openai.voice': '', 'tts.openai.model': ' tts-1-hd ' })
    expect(host.file).toEqual({ tts: { provider: 'openai', openai: { model: 'tts-1-hd' } } })
    expect(host.calls).toEqual(['GET /api/config', `POST ${CONFIG_UNSET_PATH}`, 'PUT /api/config'])
  })

  it('only asks the plugin when nothing else changed, for the profile named', async () => {
    const host = hermes({ tts: { openai: { voice: 'nova' } } })
    await saveFields(host.http, 'furina', fields, { 'tts.openai.voice': ' ' })
    expect(host.file).toEqual({ tts: { openai: {} } })
    expect(host.calls).toEqual(['GET /api/config?profile=furina', `POST ${CONFIG_UNSET_PATH}?profile=furina`])
  })

  it('says to update a plugin without the route, and saves nothing', async () => {
    const host = hermes({ tts: { openai: { voice: 'nova', model: 'tts-1' } } }, false)
    await expect(saveFields(host.http, 'default', fields, { 'tts.openai.voice': '', 'tts.openai.model': 'tts-1-hd' })).rejects.toThrow(/Update the Conduit plugin/)
    expect(host.file).toEqual({ tts: { openai: { voice: 'nova', model: 'tts-1' } } })
  })

  it("takes a pick's stale gateway routing out, and still saves the pick on a plugin without the route", async () => {
    const host = hermes({ stt: { provider: 'local', use_gateway: true } })
    await saveProvider(host.http, 'default', 'stt', 'groq')
    expect(host.file).toEqual({ stt: { provider: 'groq' } })
    const old = hermes({ stt: { provider: 'local', use_gateway: true } }, false)
    await saveProvider(old.http, 'default', 'stt', 'groq')
    expect(old.file).toEqual({ stt: { provider: 'groq', use_gateway: true } })
    const failing = hermes({ stt: { provider: 'local', use_gateway: true } })
    const refuse: Http = (method, path, body) => (method === 'POST' ? Promise.reject(Object.assign(new Error('boom'), { code: 500 })) : failing.http(method, path, body))
    await expect(saveProvider(refuse, 'default', 'stt', 'groq')).rejects.toThrow('boom')
    expect(failing.file).toEqual({ stt: { provider: 'local', use_gateway: true } })
    const none = hermes({ stt: { provider: 'local' } })
    await saveProvider(none.http, 'default', 'stt', 'groq')
    expect(none.calls).toEqual(['GET /api/config', 'PUT /api/config'])
  })
})
