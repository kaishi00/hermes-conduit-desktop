/**
 * A toolset's page in Capabilities > Tools, after the phone's
 * CapabilityToolsetDetailPage: its backends from Hermes'
 * `/api/tools/toolsets/<name>/config` (each with its readiness and the keys
 * it needs) and, for image and video generation, the active backend's
 * models.
 *
 * The models come from the plugin's `/media-models/<name>` (plugin 0.198.0),
 * which reads them the way the backend does and saves a pick where the
 * backend reads it (xAI's and DeepInfra's image backends read only a key of
 * their own, which Hermes' own pick never writes), and names an env var on
 * the host that overrides the pick. Before that plugin, Hermes' own
 * `/api/tools/toolsets/<name>/models` and `/model` answer.
 */
import { scoped } from './capabilities'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(object).filter((r): r is Row => !!r) : [])

/** The toolsets whose backends have a model to pick. */
export const MODEL_TOOLSETS = new Set(['image_gen', 'video_gen'])

export interface BackendKey {
  key: string
  prompt: string
  isSet: boolean
}

export interface Backend {
  name: string
  badge: string
  tag: string
  keys: BackendKey[]
  active: boolean
  /** ready, needs_setup, needs_auth or needs_keys. */
  status: string
}

export interface ToolsetBackends {
  hasCategory: boolean
  backends: Backend[]
}

export const configPath = (name: string, profile: string) => scoped(`/api/tools/toolsets/${encodeURIComponent(name)}/config`, profile)
export const providerPath = (name: string, profile: string) => scoped(`/api/tools/toolsets/${encodeURIComponent(name)}/provider`, profile)
export const hermesModelsPath = (name: string, profile: string) => scoped(`/api/tools/toolsets/${encodeURIComponent(name)}/models`, profile)
export const hermesModelPath = (name: string, profile: string) => scoped(`/api/tools/toolsets/${encodeURIComponent(name)}/model`, profile)
export const pluginModelsPath = (name: string, profile: string) =>
  scoped(`/api/plugins/conduit_push/media-models/${encodeURIComponent(name)}`, profile)

export function parseBackends(raw: unknown): ToolsetBackends {
  const answer = object(raw) ?? {}
  return {
    hasCategory: answer.has_category === true,
    backends: rows(answer.providers)
      .map(row => ({
        name: text(row.name),
        badge: text(row.badge),
        tag: text(row.tag),
        keys: rows(row.env_vars)
          .map(env => ({ key: text(env.key), prompt: text(env.prompt), isSet: env.is_set === true }))
          .filter(k => k.key),
        active: row.is_active === true,
        status: text(row.status)
      }))
      .filter(b => b.name)
  }
}

/** The answer as Hermes holds it once `name` is the backend. */
export const choosingBackend = (shown: ToolsetBackends, name: string): ToolsetBackends => ({
  ...shown,
  backends: shown.backends.map(b => ({ ...b, active: b.name === name }))
})

/** The answer as Hermes holds it once `key` is set. */
export const settingKey = (shown: ToolsetBackends, key: string): ToolsetBackends => ({
  ...shown,
  backends: shown.backends.map(b => ({ ...b, keys: b.keys.map(k => (k.key === key ? { ...k, isSet: true } : k)) }))
})

export interface BackendModel {
  id: string
  display: string
  /** Speed and price, whichever the backend gives. */
  facts: string
  strengths: string
}

export interface ToolsetModels {
  models: BackendModel[]
  current: string | null
  default: string | null
  /** The env var on the host that the backend takes over the pick. */
  override: { env: string; model: string } | null
}

/** Null when the backend has no models to pick. */
export function parseModels(raw: unknown): ToolsetModels | null {
  const answer = object(raw)
  if (!answer || answer.has_models !== true) return null
  const models = rows(answer.models)
    .map(row => {
      const id = text(row.id)
      return {
        id,
        display: text(row.display) || id,
        facts: [text(row.speed), text(row.price)].filter(Boolean).join(' · '),
        strengths: text(row.strengths)
      }
    })
    .filter(m => m.id)
  if (!models.length) return null
  const override = object(answer.override)
  return {
    models,
    current: text(answer.current) || null,
    default: text(answer.default) || null,
    override: override && text(override.env) && text(override.model) ? { env: text(override.env), model: text(override.model) } : null
  }
}

type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>

/** A plugin without the route (before 0.198.0, or off), or a Hermes it can't read the catalog on. */
export const pluginModelsMissing = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code
  return code === 404 || code === 405 || code === 501
}

/** The backend's models: the plugin's answer, else Hermes'. The caller keeps either under Hermes' models path. */
export async function readModels(http: Http, name: string, profile: string): Promise<unknown> {
  try {
    return await http('GET', pluginModelsPath(name, profile))
  } catch (e) {
    if (!pluginModelsMissing(e)) throw e
    return http('GET', hermesModelsPath(name, profile))
  }
}

export async function pickModel(http: Http, name: string, profile: string, model: string): Promise<void> {
  try {
    await http('PUT', pluginModelsPath(name, profile), { model })
  } catch (e) {
    if (!pluginModelsMissing(e)) throw e
    await http('PUT', hermesModelPath(name, profile), profile && profile !== 'default' ? { model, profile } : { model })
  }
}
