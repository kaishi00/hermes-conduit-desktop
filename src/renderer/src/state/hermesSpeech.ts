/**
 * Hermes' own speech settings for a profile, after the phone's Assistant
 * speech and Speech to text (HermesVoiceConfigurationService): which
 * provider Hermes transcribes Classic voice with (`stt.provider`) and which
 * speaks Read Aloud and Classic's replies (`tts.provider`), with each
 * provider's model, voice and language, and the keys it needs.
 *
 * The providers come from Hermes' toolset rows (`/api/tools/toolsets/<kind>/config`),
 * the schema's choices and the provider set now. A pick goes through
 * Hermes' own provider route, which writes the config (a managed Nous row
 * becomes what that Hermes understands); only a provider Hermes lists
 * without a row is written into the config directly, and Nous never is.
 *
 * Hermes' PUT /api/config merges what it's sent over the file, so a key a
 * save leaves out keeps its old value: a blanked field and a pick's stale
 * gateway routing are taken out by the plugin's /config/unset (plugin
 * 0.195.8, hermes-conduit issue 3155), in the same turn as the save.
 */
import { t } from '../../../shared/i18n'
import { withProfile } from './callSettings'
import { configPath, inTurn, readConfig, withValue, valueAt, type Http } from './profileConfig'
import { isMissingRoute } from './providers'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export type SpeechKind = 'stt' | 'tts'

export const toolsetPath = (kind: SpeechKind) => `/api/tools/toolsets/${kind}/config`
export const providerPath = (kind: SpeechKind) => `/api/tools/toolsets/${kind}/provider`
/** The plugin's route that takes keys under stt and tts out of a profile's config. */
export const CONFIG_UNSET_PATH = '/api/plugins/conduit_push/config/unset'

export interface SpeechKey {
  key: string
  isSet: boolean
  prompt: string
}

export interface SpeechProvider {
  id: string
  name: string
  /** Hermes' readiness code ("ready", "needs_keys"…), null with no row. */
  status: string | null
  /** The row's own label, which a pick sends; null for a provider Hermes lists only in its schema. */
  row: string | null
  keys: SpeechKey[]
}

export interface SpeechField {
  key: string
  label: string
  help: string
  /** Suggestions; any value can be typed. */
  suggestions?: string[]
  /** A number Hermes clamps to this range; Conduit refuses one outside it. */
  range?: [number, number]
}

const NAMES: Record<string, string> = {
  local: 'Local',
  openai: 'OpenAI',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  deepinfra: 'DeepInfra',
  gemini: 'Gemini',
  edge: 'Edge TTS',
  stepfun: 'StepFun'
}

/** A provider's name as the phone shows it. */
export function providerName(id: string, kind: SpeechKind): string {
  if (id === 'nous') return t('Nous Subscription')
  if (id === 'elevenlabs') return kind === 'stt' ? 'ElevenLabs Scribe' : 'ElevenLabs'
  if (id === 'xiaomi_mimo') return t('Xiaomi MiMo')
  if (id === 'local') return t('Local')
  return (
    NAMES[id] ??
    id
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  )
}

/** The provider Hermes uses when none is set: Local Whisper, and Edge's free voices. */
export const selectedProvider = (kind: SpeechKind, config: unknown): string => text(valueAt(config, `${kind}.provider`)) || (kind === 'stt' ? 'local' : 'edge')

/** A toolset row's provider id, as Hermes writes it into the config (the phone's providerID). */
export function rowProviderId(row: Row, kind: SpeechKind): string | null {
  const name = text(row.name)
  if (row.managed_nous_feature === kind || name.toLowerCase() === 'nous subscription') return 'nous'
  const named = text(row[`${kind}_provider`])
  if (named) return named
  if (!name) return null
  const known: Record<string, string> = {
    'local whisper': 'local',
    openai: 'openai',
    'openai tts': 'openai',
    'elevenlabs scribe': 'elevenlabs',
    'microsoft edge tts': 'edge',
    'xai tts': 'xai',
    'mistral (voxtral tts)': 'mistral',
    'google gemini tts': 'gemini'
  }
  return (
    known[name.toLowerCase()] ??
    name
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .join('_')
      .toLowerCase()
  )
}

function rowStatus(row: Row, keys: SpeechKey[]): string {
  if (typeof row.status === 'string') return row.status
  const status = object(row.status)
  if (status) return text(status.state) || text(status.label) || 'unknown'
  // Hermes before 0.19 sends no status: a row is ready once its keys are set.
  return keys.every(k => k.isSet) ? 'ready' : 'needs_keys'
}

function schemaChoices(schema: unknown, kind: SpeechKind): string[] {
  const fields = object(schema)?.fields
  const field = Array.isArray(fields)
    ? fields.map(object).find(f => text(f?.key ?? f?.name).toLowerCase() === `${kind}.provider`)
    : object(object(fields)?.[`${kind}.provider`])
  const options = field?.options ?? field?.choices
  if (!Array.isArray(options)) return []
  return options.map(o => (typeof o === 'string' ? o : text(object(o)?.value ?? object(o)?.id ?? object(o)?.name))).filter(Boolean)
}

/** The providers to offer: Hermes' schema choices, its rows and the one set now, each once. */
export function speechProviders(kind: SpeechKind, toolset: unknown, config: unknown, schema: unknown): SpeechProvider[] {
  const rows = (Array.isArray(object(toolset)?.providers) ? (object(toolset)!.providers as unknown[]) : []).map(object).filter((r): r is Row => !!r)
  const byId = new Map<string, SpeechProvider & { active: boolean }>()
  for (const row of rows) {
    const id = rowProviderId(row, kind)
    if (!id) continue
    const keys = (Array.isArray(row.env_vars) ? row.env_vars : [])
      .map(object)
      .filter((k): k is Row => !!k && !!text(k.key))
      .map(k => ({ key: text(k.key), isSet: k.is_set === true, prompt: text(k.prompt) || text(k.key) }))
    const active = row.is_active === true
    // Two rows can name one provider (a plugin's beside a built-in one): the active one speaks for it.
    if (byId.has(id) && (byId.get(id)!.active || !active)) continue
    byId.set(id, { id, name: providerName(id, kind), status: rowStatus(row, keys), row: text(row.name) || id, keys, active })
  }
  const ids = [...schemaChoices(schema, kind), ...byId.keys(), selectedProvider(kind, config)]
  return [...new Set(ids)].map(id => {
    const found = byId.get(id)
    return found ? { id, name: found.name, status: found.status, row: found.row, keys: found.keys } : { id, name: providerName(id, kind), status: null, row: null, keys: [] }
  })
}

/** A readiness code as words. */
export function statusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'ready':
      return t('Ready')
    case 'needs_keys':
      return t('Needs an API key')
    case 'needs_auth':
      return t('Needs sign-in')
    case 'needs_install':
      return t('Not installed')
    default:
      return status.replace(/_/g, ' ')
  }
}

const STT_MODELS: Record<string, string[]> = {
  local: ['base', 'tiny', 'small', 'medium', 'large-v3', 'turbo'],
  openai: ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'gpt-transcribe'],
  groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
  mistral: ['voxtral-mini-latest', 'voxtral-mini-2602'],
  xai: ['grok-voice-transcribe-2.0', 'grok-voice-transcribe-1.0'],
  elevenlabs: ['scribe_v2', 'scribe_v1'],
  stepfun: ['stepaudio-2.5-asr', 'step-asr'],
  xiaomi_mimo: ['mimo-v2.5-asr']
}
STT_MODELS.nous = STT_MODELS.openai!
const TTS_MODELS: Record<string, string[]> = { stepfun: ['stepaudio-2.5-tts'], xiaomi_mimo: ['mimo-v2.5-tts'] }
const TTS_VOICES: Record<string, string[]> = {
  openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'],
  xiaomi_mimo: ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean']
}
TTS_VOICES.nous = TTS_VOICES.openai!

const endpointHelp = (provider: string) =>
  t('Optional {provider}-compatible speech endpoint Hermes should call (for example https://your-host/v1). Leave blank for the provider default. This does not change the server Conduit connects to.', { provider })

/**
 * A provider's settings, with the keys Hermes reads (the phone's typedFields):
 * the managed Nous route shares OpenAI's section, and ElevenLabs' voice is
 * keyed by its id. A blank value takes the key out, so Hermes' default applies.
 */
export function speechFields(id: string, kind: SpeechKind): SpeechField[] {
  const root = `${kind}.${id === 'nous' ? 'openai' : id}`
  const model = (key: string, suggestions?: string[]): SpeechField => ({ key, label: t('Model'), help: t('You can enter any installed model identifier.'), suggestions })
  if (kind === 'tts' && id === 'elevenlabs')
    return [
      { key: 'tts.elevenlabs.voice_id', label: t('Voice ID'), help: t('Voice ID from your ElevenLabs-compatible endpoint. Leave blank for the provider default.') },
      model('tts.elevenlabs.model_id'),
      { key: 'tts.elevenlabs.base_url', label: t('Base URL'), help: endpointHelp('ElevenLabs') }
    ]
  if (kind === 'tts' && id === 'edge')
    return [
      {
        key: 'tts.edge.voice',
        label: t('Voice ID'),
        help: t('Built-in voices are suggestions; custom voice IDs remain supported.'),
        suggestions: ['en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural', 'en-GB-RyanNeural', 'en-AU-NatashaNeural']
      }
    ]
  const fields: SpeechField[] = [
    model(`${root}.${kind === 'stt' && id === 'elevenlabs' ? 'model_id' : 'model'}`, kind === 'stt' ? STT_MODELS[id] : TTS_MODELS[id]),
    { key: `${root}.language`, label: t('Language'), help: t('Leave blank for automatic language detection.') }
  ]
  if (kind === 'tts') {
    fields.push({ key: `${root}.voice`, label: t('Voice ID'), help: t('Built-in voices are suggestions; custom voice IDs remain supported.'), suggestions: TTS_VOICES[id] })
    if (id === 'openai' || id === 'nous')
      fields.push(
        { key: `${root}.base_url`, label: t('Base URL'), help: endpointHelp('OpenAI') },
        { key: `${root}.speed`, label: t('Speed'), help: t('Speech rate, from 0.25 to 4. Leave blank for normal speed.'), range: [0.25, 4] }
      )
    else
      fields.push({
        key: `${root}.${id === 'xiaomi_mimo' ? 'delivery_instructions' : 'instruction'}`,
        label: t('Delivery instruction'),
        help: t('Optional speaking style guidance sent to the provider.')
      })
  }
  return fields
}

/** A field's value in the config, as text. */
export function fieldText(config: unknown, key: string): string {
  const raw = valueAt(config, key)
  return typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : ''
}

/** Why a value can't be saved, or null. */
export function fieldProblem(field: SpeechField, value: string): string | null {
  if (!field.range || !value.trim()) return null
  const n = Number(value.trim().replace(',', '.'))
  const [low, high] = field.range
  return Number.isFinite(n) && n >= low && n <= high ? null : t('{label} must be a number from {low} to {high}.', { label: field.label, low, high })
}

function without(config: Row, key: string): Row {
  const parts = key.split('.')
  const leaf = parts.pop()!
  const parents: Row[] = [config]
  for (const part of parts) {
    const child = object(parents[parents.length - 1]![part])
    if (!child) return config
    parents.push(child)
  }
  // Copy down the path, take the leaf, and drop parents left empty.
  const copies = parents.map(p => ({ ...p }))
  delete copies[copies.length - 1]![leaf]
  for (let i = copies.length - 1; i > 0; i--) {
    if (Object.keys(copies[i]!).length) copies[i - 1]![parts[i - 1]!] = copies[i]
    else delete copies[i - 1]![parts[i - 1]!]
  }
  return copies[0]!
}

/** The config with the typed values saved: trimmed, a range's comma as a point, a blank one taken out. */
export function withFields(config: Row, fields: SpeechField[], values: Record<string, string>): Row {
  let next = config
  for (const field of fields) {
    if (!(field.key in values)) continue
    const typed = values[field.key]!.trim()
    const stored = field.range ? typed.replace(',', '.') : typed
    next = stored ? withValue(next, field.key, field.range ? Number(stored) : stored) : without(next, field.key)
  }
  return next
}

/** A provider Hermes lists without a row, written as its section's provider, with any stale gateway routing taken out. */
export function withProvider(config: Row, kind: SpeechKind, id: string): Row {
  return without(withValue(config, `${kind}.provider`, id), `${kind}.use_gateway`)
}

/** The fields a save blanks: their keys leave Hermes' config, so its defaults apply. */
export const clearedKeys = (fields: SpeechField[], values: Record<string, string>): string[] =>
  fields.filter(f => f.key in values && !values[f.key]!.trim()).map(f => f.key)

/**
 * Saves the typed fields, in turn with every config save: the blanked ones
 * are taken out by the plugin, then the rest are PUT. A plugin without the
 * route can't clear one (Hermes' own save would keep it), and says so.
 */
export function saveFields(http: Http, profile: string, fields: SpeechField[], values: Record<string, string>): Promise<void> {
  return inTurn(async () => {
    const config = await readConfig(http, profile)
    const cleared = clearedKeys(fields, values)
    if (cleared.length) {
      try {
        await http('POST', withProfile(CONFIG_UNSET_PATH, profile), { keys: cleared })
      } catch (e) {
        throw isMissingRoute(e) ? new Error(t('Update the Conduit plugin on your Hermes host to clear this setting.')) : e
      }
    }
    if (fields.some(f => f.key in values && values[f.key]!.trim())) await http('PUT', configPath(profile), { config: withFields(config, fields, values), profile })
  })
}

/** Saves a provider Hermes lists without a row, in turn with every config save; stale gateway routing is taken out where the plugin can. */
export function saveProvider(http: Http, profile: string, kind: SpeechKind, id: string): Promise<void> {
  return inTurn(async () => {
    const config = await readConfig(http, profile)
    // A plugin without the route leaves it, as before; any other failure fails the pick.
    if (valueAt(config, `${kind}.use_gateway`) !== undefined)
      await http('POST', withProfile(CONFIG_UNSET_PATH, profile), { keys: [`${kind}.use_gateway`] }).catch(e => {
        if (!isMissingRoute(e)) throw e
      })
    await http('PUT', configPath(profile), { config: withProvider(config, kind, id), profile })
  })
}
