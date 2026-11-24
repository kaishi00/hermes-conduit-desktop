/**
 * A profile's Hermes config, read and saved as the phone does: GET
 * `/api/config`, change it, PUT the whole document back. Saves wait their
 * turn, one at a time across the app, so two that overlap never read the
 * same old config and put back what the other changed (Profile config
 * saves). The rows a page shows come from Hermes' schema: a row Hermes
 * doesn't list isn't offered, so an older Hermes isn't given a setting it
 * would ignore.
 */
import { t } from '../../../shared/i18n'
import { THINKING_KEY, thinkingMode, withThinking, type ThinkingMode } from './display'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)

export type Control =
  | { kind: 'toggle'; defaultValue: boolean }
  | { kind: 'number'; defaultValue: number }
  | { kind: 'options'; options: { value: string; label: string }[]; defaultValue: string }
  | { kind: 'text'; defaultValue: string }
  /** A list of strings, one per line. */
  | { kind: 'list' }
  /** An IANA time zone name; blank is the server's local time. */
  | { kind: 'timezone' }
  /** A switch saved as one of two strings. */
  | { kind: 'textToggle'; on: string; off: string; defaultValue: boolean }

export interface Field {
  key: string
  label: string
  help: string
  control: Control
  /** Shown only when Hermes' schema lists the key. */
  requiresSchema?: boolean
}

export interface Section {
  title: string
  fields: Field[]
}

/** A list control's lines as Hermes stores them: trimmed, blanks left out. */
export const listLines = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }))

let zones: Map<string, string> | null = null
/** A typed time zone as Hermes takes it: blank is the server's local time (''), a known name in any case or with spaces for underscores its spelling, else null. */
export function resolveTimeZone(raw: string): string | null {
  const typed = raw.trim()
  if (!typed) return ''
  if (!zones) {
    const listed = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
    zones = new Map([...listed, 'UTC'].map(id => [id.toLowerCase(), id]))
  }
  const key = typed.toLowerCase()
  return zones.get(key) ?? zones.get(key.replace(/ /g, '_')) ?? null
}

const personalityChoices = (): [string, string][] => [
  ['', t('Default')],
  ['helpful', t('Helpful')],
  ['concise', t('Concise')],
  ['technical', t('Technical')],
  ['creative', t('Creative')],
  ['teacher', t('Teacher')],
  ['kawaii', t('Kawaii')],
  ['catgirl', t('Catgirl')],
  ['pirate', t('Pirate')],
  ['shakespeare', t('Shakespeare')],
  ['surfer', t('Surfer')],
  ['noir', t('Noir')],
  ['uwu', 'uwu'],
  ['philosopher', t('Philosopher')],
  ['hype', t('Hype')]
]

/** Settings > Chat's Hermes rows, after the phone's; the personalities include the profile's own (`agent.personalities`). */
export function chatSections(config: Row): Section[] {
  const own = Object.keys(object(object(config.agent)?.personalities) ?? {}).sort()
  const builtIn = personalityChoices()
  const personalities = [
    ...builtIn.map(([value, label]) => ({ value, label })),
    ...own.filter(n => !builtIn.some(([v]) => v === n)).map(n => ({ value: n, label: n }))
  ]
  return [
    {
      title: t('Hermes'),
      fields: [
        {
          key: 'display.personality',
          label: t('Personality'),
          help: t('Default response style for new conversations.'),
          control: { kind: 'options', options: personalities, defaultValue: '' }
        },
        { key: 'timezone', label: t('Timezone'), help: t('Used for dates, reminders, and scheduled work.'), control: { kind: 'timezone' } },
        {
          key: THINKING_KEY,
          label: t('Thinking'),
          help: t(
            "Show puts Hermes' thinking in every chat. On request hides it, with Show thinking in a run's menu and a reply's ⋯. Off hides it everywhere."
          ),
          control: {
            kind: 'options',
            options: opts([
              ['show', t('Show in every chat')],
              ['on_request', t('On request')],
              ['off', t('Off')]
            ]),
            defaultValue: 'show'
          }
        },
        {
          key: 'display.busy_input_mode',
          label: t('During a response'),
          help: t('Steer adds guidance to the active turn. Queue sends the message once it finishes. Interrupt stops it before handling the new message.'),
          control: {
            kind: 'options',
            options: opts([
              ['steer', t('Steer')],
              ['queue', t('Queue')],
              ['interrupt', t('Interrupt')]
            ]),
            defaultValue: 'interrupt'
          }
        },
        {
          key: 'display.tool_progress',
          label: t('Tool cards'),
          help: t('Show tool calls and expandable details in conversations.'),
          control: { kind: 'textToggle', on: 'all', off: 'off', defaultValue: true }
        },
        {
          key: 'display.expand_tools',
          label: t('Keep tool cards expanded'),
          help: t('Keep completed tool details open by default.'),
          control: { kind: 'toggle', defaultValue: false }
        },
        {
          key: 'display.memory_notifications',
          label: t('Self-improvement updates'),
          help: t('Choose whether Conduit follows Hermes, always shows, or never shows maintenance updates.'),
          control: {
            kind: 'options',
            options: opts([
              ['default', t('Use Hermes default')],
              ['on', t('Always show')],
              ['off', t('Never show')]
            ]),
            defaultValue: 'default'
          }
        },
        {
          key: 'agent.image_input_mode',
          label: t('Image attachments'),
          help: t('How Hermes supplies images to a model.'),
          control: {
            kind: 'options',
            options: opts([
              ['auto', t('Automatic')],
              ['native', t('Native images')],
              ['text', t('Text only')]
            ]),
            defaultValue: 'auto'
          }
        },
        {
          key: 'sessions.auto_archive',
          label: t('Auto-archive stale chats'),
          help: t('Archive chats nobody has touched for a while. Pinned chats stay, and nothing is deleted.'),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'sessions.auto_archive_days',
          label: t('Archive after (days)'),
          help: t('Days without activity before a chat is archived.'),
          control: { kind: 'number', defaultValue: 3 },
          requiresSchema: true
        }
      ]
    }
  ]
}

/** Settings > Workspace & safety's rows, after the phone's. */
export function workspaceSections(): Section[] {
  return [
    {
      title: t('Workspace'),
      fields: [
        {
          key: 'terminal.cwd',
          label: t('Default working directory'),
          help: t('Server-side path for new workspaces.'),
          control: { kind: 'text', defaultValue: '' }
        },
        {
          key: 'code_execution.mode',
          label: t('Code execution mode'),
          help: t('Default execution boundary.'),
          control: {
            kind: 'options',
            options: opts([
              ['project', t('Project')],
              ['strict', t('Strict')]
            ]),
            defaultValue: 'project'
          }
        },
        {
          key: 'terminal.persistent_shell',
          label: t('Persistent shell'),
          help: t('SSH backend: keep exported variables between commands. The working directory always carries over.'),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'terminal.env_passthrough',
          label: t('Environment passthrough'),
          help: t('Environment variables passed into tool commands, one per line.'),
          control: { kind: 'list' },
          requiresSchema: true
        },
        {
          key: 'file_read_max_chars',
          label: t('File read limit'),
          help: t('Most characters Hermes reads from a file in one request.'),
          control: { kind: 'number', defaultValue: 100000 },
          requiresSchema: true
        }
      ]
    },
    {
      title: t('Safety'),
      fields: [
        {
          key: 'approvals.mode',
          label: t('Approval mode'),
          help: t(
            "Profile-wide default: manual asks every time; smart asks when risk warrants it; off is YOLO mode. When set to off, Hermes auto-approves everything and per-session YOLO toggles have no effect — that's a Hermes limitation, not a Conduit bug. To use per-session YOLO, set this to manual or smart."
          ),
          control: {
            kind: 'options',
            options: opts([
              ['manual', t('Manual')],
              ['smart', t('Smart')],
              ['off', t('YOLO mode')]
            ]),
            defaultValue: 'smart'
          }
        },
        {
          key: 'approvals.timeout',
          label: t('Approval timeout'),
          help: t('Seconds an approval request waits before it times out.'),
          control: { kind: 'number', defaultValue: 300 },
          requiresSchema: true
        },
        {
          key: 'approvals.mcp_reload_confirm',
          label: t('Confirm connector reloads'),
          help: t('Ask before Hermes reloads its MCP connectors.'),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'command_allowlist',
          label: t('Command allowlist'),
          help: t('Command patterns you approved permanently, one per line. Remove a line to be asked again.'),
          control: { kind: 'list' },
          requiresSchema: true
        },
        {
          key: 'security.redact_secrets',
          label: t('Redact secrets'),
          help: t('Hide detected credentials from tool output where possible.'),
          control: { kind: 'toggle', defaultValue: true }
        },
        {
          key: 'security.allow_private_urls',
          label: t('Allow private URLs'),
          help: t('Permit tool access to private-network URLs.'),
          control: { kind: 'toggle', defaultValue: false }
        },
        {
          key: 'checkpoints.enabled',
          label: t('File checkpoints'),
          help: t('Snapshot files before Hermes edits them, so changes can be rolled back.'),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        }
      ]
    },
    {
      title: t('Browser'),
      fields: [
        {
          key: 'browser.use_real_profile',
          label: t('Use my real browser profile'),
          help: t("Browse with a copy of the host's default Chromium browser profile, including its logins."),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'browser.allow_private_urls',
          label: t('Browser private URLs'),
          help: t('Let the browser open private-network addresses.'),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'browser.auto_local_for_private_urls',
          label: t('Local browser for private URLs'),
          help: t('Open private-network addresses in a local browser even when a cloud browser is set up.'),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        }
      ]
    }
  ]
}

/** Settings > Advanced's rows, after the phone's. */
export function advancedSections(): Section[] {
  const number = (key: string, label: string, help: string, defaultValue: number): Field => ({
    key,
    label,
    help,
    control: { kind: 'number', defaultValue },
    requiresSchema: true
  })
  const text = (key: string, label: string, help: string): Field => ({ key, label, help, control: { kind: 'text', defaultValue: '' }, requiresSchema: true })
  return [
    {
      title: t('Runtime'),
      fields: [
        number('agent.max_turns', t('Turn limit'), t('Most tool-calling turns before Hermes stops a run. 0 means no limit.'), 0),
        number('agent.api_max_retries', t('API retries'), t('How many times Hermes retries a failed model request.'), 3)
      ]
    },
    {
      title: t('Terminal'),
      fields: [
        number('terminal.timeout', t('Command timeout'), t('Seconds a terminal command can run.'), 180),
        text('terminal.docker_image', t('Docker image'), t('Image used when the terminal backend is Docker.')),
        text('terminal.singularity_image', t('Singularity image'), t('Image used when the terminal backend is Singularity.')),
        text('terminal.modal_image', t('Modal image'), t('Image used when the terminal backend is Modal.')),
        text('terminal.daytona_image', t('Daytona image'), t('Image used when the terminal backend is Daytona.'))
      ]
    },
    {
      title: t('Files & output'),
      fields: [
        number('tool_output.max_bytes', t('Terminal output limit'), t('Most bytes of command output Hermes reads.'), 50000),
        number('tool_output.max_lines', t('File page limit'), t('Most lines Hermes reads from a file at once.'), 2000),
        number('tool_output.max_line_length', t('Line length limit'), t('Longer lines are cut to this many characters.'), 2000),
        number('checkpoints.max_snapshots', t('Checkpoint limit'), t('Most file snapshots kept for rolling back.'), 20)
      ]
    },
    {
      title: t('Updates'),
      fields: [
        {
          key: 'updates.non_interactive_local_changes',
          label: t('Local changes on update'),
          help: t('When Hermes updates itself from an app, keep local source edits or throw them away. Terminal updates always ask.'),
          control: {
            kind: 'options',
            options: opts([
              ['stash', t('Keep them')],
              ['discard', t('Throw them away')]
            ]),
            defaultValue: 'stash'
          },
          requiresSchema: true
        }
      ]
    }
  ]
}

/** Settings > Memory & delegation's rows, after the phone's. */
export function memorySections(): Section[] {
  return [
    {
      title: t('Memory'),
      fields: [
        {
          key: 'memory.provider',
          label: t('Memory provider'),
          help: t('Provider used for long-term memory.'),
          control: { kind: 'options', options: [], defaultValue: '' }
        },
        {
          key: 'memory.memory_enabled',
          label: t('Long-term memory'),
          help: t('Allow Hermes to retain relevant working memory.'),
          control: { kind: 'toggle', defaultValue: true }
        },
        {
          key: 'memory.user_profile_enabled',
          label: t('User profile memory'),
          help: t('Allow Hermes to maintain user preferences.'),
          control: { kind: 'toggle', defaultValue: true }
        },
        {
          key: 'memory.memory_char_limit',
          label: t('Memory budget'),
          help: t('Most characters of saved memory Hermes keeps.'),
          control: { kind: 'number', defaultValue: 2200 },
          requiresSchema: true
        },
        {
          key: 'memory.user_char_limit',
          label: t('Profile budget'),
          help: t('Most characters of user profile Hermes keeps.'),
          control: { kind: 'number', defaultValue: 1375 },
          requiresSchema: true
        }
      ]
    },
    {
      title: t('Context'),
      fields: [
        {
          key: 'context.engine',
          label: t('Context engine'),
          help: t('Installed context-management engine.'),
          // Hermes' built-in engine is "compressor"; a plugin engine goes by its own name.
          control: { kind: 'options', options: [], defaultValue: 'compressor' }
        },
        {
          key: 'compression.enabled',
          label: t('Context compression'),
          help: t('Compress older context when the window becomes crowded.'),
          control: { kind: 'toggle', defaultValue: true }
        },
        {
          key: 'compression.threshold',
          label: t('Compression threshold'),
          help: t('Fraction of the context window that starts compression.'),
          control: { kind: 'number', defaultValue: 0.8 }
        },
        {
          key: 'compression.target_ratio',
          label: t('Compression target'),
          help: t('Fraction retained after compression.'),
          control: { kind: 'number', defaultValue: 0.5 }
        },
        {
          key: 'compression.protect_last_n',
          label: t('Protected recent messages'),
          help: t('Recent messages left intact by compression.'),
          control: { kind: 'number', defaultValue: 8 }
        },
        {
          key: 'compression.codex_gpt55_autoraise',
          label: t('Codex compression auto-raise'),
          help: t('Start compression at 85% for supported ChatGPT Codex sign-in models.'),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'auxiliary.compression.timeout',
          label: t('Compression timeout'),
          help: t('Seconds to wait for the compression model on each call. Raise it for slow local models.'),
          control: { kind: 'number', defaultValue: 120 },
          requiresSchema: true
        }
      ]
    },
    {
      title: t('Delegation'),
      fields: [
        {
          key: 'delegation.max_concurrent_children',
          label: t('Concurrent delegate agents'),
          help: t('Maximum child agents that can work at once.'),
          control: { kind: 'number', defaultValue: 10 }
        },
        {
          key: 'delegation.max_iterations',
          label: t('Delegate turn limit'),
          help: t('Most turns one delegate agent can take.'),
          control: { kind: 'number', defaultValue: 250 },
          requiresSchema: true
        },
        {
          key: 'delegation.child_timeout_seconds',
          label: t('Delegate timeout'),
          help: t('Seconds before a delegate agent is stopped. 0 means no limit.'),
          control: { kind: 'number', defaultValue: 0 },
          requiresSchema: true
        },
        {
          key: 'delegation.max_spawn_depth',
          label: t('Delegation depth'),
          help: t("Levels of delegate agents that can start their own. 1 means delegates can't."),
          control: { kind: 'number', defaultValue: 1 },
          requiresSchema: true
        },
        {
          key: 'delegation.orchestrator_enabled',
          label: t('Coordinating delegates'),
          help: t('Let a delegate agent start and coordinate its own delegates, up to the depth above.'),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'delegation.subagent_auto_approve',
          label: t('Delegates approve commands'),
          help: t("Delegate agents can't ask you. On, they approve a command once; off, they decline it."),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'delegation.independent_completions',
          label: t('Results as each finishes'),
          help: t('Background delegate agents report one by one, not all together at the end.'),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'delegation.gateway_mode',
          label: t('Delegation in chats'),
          help: t('Inline waits for delegates inside the reply; Background lets the reply finish first. Auto is inline when progress messages are off.'),
          control: {
            kind: 'options',
            options: [
              { value: 'auto', label: t('Auto') },
              { value: 'inline', label: t('Inline') },
              { value: 'background', label: t('Background') }
            ],
            defaultValue: 'auto'
          },
          requiresSchema: true
        },
        {
          key: 'delegation.inherit_mcp_toolsets',
          label: t('Delegates keep connectors'),
          help: t("A delegate given fewer tools still keeps your connectors' tools."),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'delegation.max_summary_chars',
          label: t('Delegate result limit'),
          help: t("Most characters of one delegate's result; the rest is saved to a file. 0 means no limit."),
          control: { kind: 'number', defaultValue: 24000 },
          requiresSchema: true
        },
        {
          key: 'delegation.compression_threshold_tokens',
          label: t('Delegate compression cap'),
          help: t('Tokens at which a delegate compresses its context, 16000 or more. 0 follows the main setting.'),
          control: { kind: 'number', defaultValue: 0 },
          requiresSchema: true
        },
        {
          key: 'delegation.surface_child_process_notifications',
          label: t('Delegate command alerts'),
          help: t("Tell the chat when a delegate's background command finishes or matches what it watches for."),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'delegation.prefix_stagger_seconds',
          label: t('Delegate start wait'),
          help: t('Seconds delegates started together wait for the first to begin answering, so they share its cached prompt. 0 means off.'),
          control: { kind: 'number', defaultValue: 0 },
          requiresSchema: true
        }
      ]
    }
  ]
}

/** The keys Hermes' `/api/config/schema` lists; null when it can't say, which shows every row. */
export function schemaKeys(answer: unknown): Set<string> | null {
  const fields = object(object(answer)?.fields)
  return fields ? new Set(Object.keys(fields)) : null
}

/** The keys whose choices come from what this Hermes has installed (its plugin hub), not a fixed list. */
export const PLUGIN_CHOICE_KEYS = ['memory.provider', 'context.engine'] as const

/** Memory providers that are ready and the context engines installed, from `/api/dashboard/plugins/hub`, as the phone lists them. */
export function pluginChoices(hub: unknown): Record<string, string[]> {
  const providers = object(object(hub)?.providers) ?? {}
  const names = (list: unknown, ready: boolean) =>
    (Array.isArray(list) ? list : [])
      .map(object)
      .filter((o): o is Row => !!o && (!ready || o.status === 'ready'))
      .map(o => o.name)
      .filter((n): n is string => typeof n === 'string' && !!n)
  return {
    'memory.provider': names(providers.memory_options, true).sort(),
    'context.engine': [
      'compressor',
      ...names(providers.context_options, false)
        .filter(n => n !== 'compressor')
        .sort()
    ]
  }
}

/** A plugin-choice field with its choices: the built-in memory first, and the value set now kept even when it's not listed. */
export function withChoices(field: Field, choices: Record<string, string[]>, current: string): Field {
  if (field.control.kind !== 'options' || !(field.key in choices)) return field
  const values = [...(field.key === 'memory.provider' ? [''] : []), ...choices[field.key]]
  if (!values.includes(current)) values.push(current)
  const label = (v: string) => (v ? v : t('Default'))
  return { ...field, control: { ...field.control, options: values.map(value => ({ value, label: label(value) })) } }
}

export const shownFields = (section: Section, schema: Set<string> | null) =>
  section.fields.filter(field => !field.requiresSchema || !schema || schema.has(field.key))

export function valueAt(config: unknown, key: string): unknown {
  let node: unknown = config
  for (const part of key.split('.')) {
    const row = object(node)
    if (!row || !(part in row)) return undefined
    node = row[part]
  }
  return node
}

/** The row's value in the config, or its default when the config has none (or one of the wrong type). */
export function fieldValue(config: unknown, field: Field): boolean | number | string {
  const raw = valueAt(config, field.key)
  if (field.key === THINKING_KEY) return thinkingMode(config)
  switch (field.control.kind) {
    case 'toggle':
      return typeof raw === 'boolean' ? raw : field.control.defaultValue
    case 'textToggle':
      return typeof raw === 'string' ? raw !== field.control.off : field.control.defaultValue
    case 'number':
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw
      if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw)
      return field.control.defaultValue
    case 'list':
      return Array.isArray(raw) ? raw.filter(v => typeof v === 'string' || typeof v === 'number').join('\n') : typeof raw === 'string' ? raw : ''
    case 'timezone':
    case 'text':
      if (field.control.kind === 'timezone') return typeof raw === 'string' ? raw : ''
      return typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : field.control.defaultValue
    default: {
      const value = typeof raw === 'string' && raw ? raw : field.control.defaultValue
      // No engine goes by "default" or "custom" (an older Conduit saved them): Hermes runs its compressor.
      return field.key === 'context.engine' && (value === 'default' || value === 'custom') ? 'compressor' : value
    }
  }
}

/** The config with `key` set, its parents made where missing; the original isn't changed. Thinking writes its two `display` keys. */
export function withValue(config: Row, key: string, value: unknown): Row {
  if (key === THINKING_KEY) return withThinking(config, value as ThinkingMode)
  const parts = key.split('.')
  const out: Row = { ...config }
  let node = out
  for (const part of parts.slice(0, -1)) {
    const child = object(node[part])
    node[part] = child ? { ...child } : {}
    node = node[part] as Row
  }
  node[parts[parts.length - 1]] = value
  return out
}

export type Http = (method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<unknown>
export const configPath = (profile: string) => (profile && profile !== 'default' ? `/api/config?profile=${encodeURIComponent(profile)}` : '/api/config')

let queue: Promise<unknown> = Promise.resolve()

/** Reads the profile's config, changes it and saves it, in turn with every other save. Returns what was saved. */
export function updateConfig(http: Http, profile: string, change: (config: Row) => Row): Promise<Row> {
  const run = queue.then(async () => {
    const config = object(await http('GET', configPath(profile))) ?? {}
    const next = change(config)
    await http('PUT', configPath(profile), { config: next, profile })
    return next
  })
  queue = run.catch(() => undefined)
  return run
}

/** Runs a write that changes the config another way (Hermes' own route), in turn with every config save. */
export function inTurn<T>(write: () => Promise<T>): Promise<T> {
  const run = queue.then(write)
  queue = run.catch(() => undefined)
  return run
}

/** The main profile's memory provider and context engine go through Hermes' own route, which sets them up; other profiles write their config. */
export const pluginRouteBody = (profile: string, key: string, value: unknown): Record<string, unknown> | null =>
  (profile || 'default') === 'default' && (key === 'memory.provider' || key === 'context.engine')
    ? { [key === 'memory.provider' ? 'memory_provider' : 'context_engine']: String(value ?? '') }
    : null

export async function readConfig(http: Http, profile: string): Promise<Row> {
  return object(await http('GET', configPath(profile))) ?? {}
}
