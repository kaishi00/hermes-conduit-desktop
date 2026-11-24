/**
 * A chat row's Pin, Rename and Delete, through the dashboard's
 * `/api/sessions/{id}` as the phone sends them: a PATCH (`pinned`, `title`)
 * or a DELETE, carrying the row's revision from its mutation snapshot so a
 * chat that moved on in between is refused rather than overwritten, with
 * one retry on a fresh snapshot.
 */
type Http = <T = unknown>(method: 'GET' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<T>

const UNRESERVED = /^[A-Za-z0-9\-._~]*$/
/** A chat being started, resumed, streamed, answered or waiting for input must not be archived or deleted. */
export function sessionIsBusy(response: unknown, id: string): boolean {
  if (!response || typeof response !== 'object' || !('sessions' in response) || !Array.isArray(response.sessions)) return false
  return response.sessions.some(row =>
    row && typeof row === 'object' &&
    (('id' in row && row.id === id) || ('session_key' in row && row.session_key === id)) &&
    'status' in row && typeof row.status === 'string' && row.status !== '' && row.status !== 'idle'
  )
}

/**
 * Whether the gateway says the chat is busy, before an Archive or a Delete.
 * A gateway that doesn't serve `session.active_list` (Hermes before 0.22.2,
 * or one that refuses the method) can't say, so the caller's own busy signs
 * (its Running badges, its open requests) decide alone, as they do for the
 * list's badges; the change itself works on those hosts (desktop#438). Any
 * other failure is thrown: an unreachable gateway mustn't let a delete past.
 */
export async function busyOnGateway(
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  id: string,
  profile?: string
): Promise<boolean> {
  try {
    return sessionIsBusy(await rpc('session.active_list', profile && profile !== 'default' ? { profile } : undefined), id)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if ((error as { code?: unknown } | null)?.code === -32601 || /method not found|unknown method|-32601/i.test(text)) return false
    throw error
  }
}

export function sessionPath(id: string, profile?: string, suffix = ''): string {
  const path = `/api/sessions/${encodeURIComponent(id)}${suffix}`
  return profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path
}

/** The revision fields for a write, from a snapshot; null when the host gave none (older, or the read failed). */
export function identityFields(snapshot: unknown, requestId: string): Record<string, string | number> | null {
  const row = (snapshot ?? {}) as { runtime_revision?: unknown; runtime_generation?: unknown }
  const revision = row.runtime_revision
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null
  const fields: Record<string, string | number> = { request_id: requestId, expected_revision: revision }
  const generation = row.runtime_generation
  if (typeof generation === 'number' && Number.isInteger(generation) && generation >= 0) fields.expected_generation = generation
  return fields
}

/** A DELETE carries the identity in its query. */
export function withQuery(path: string, fields: Record<string, string | number>): string {
  const query = Object.keys(fields)
    .sort()
    .map(key => [key, String(fields[key])] as const)
    .filter(([, value]) => UNRESERVED.test(value))
    .map(([key, value]) => `${key}=${value}`)
  return query.length ? `${path}${path.includes('?') ? '&' : '?'}${query.join('&')}` : path
}

/** A conflict worth one retry on a fresh snapshot: the chat moved on, or the write went without its identity. */
export function warrantsRetry(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const text = error instanceof Error ? error.message : String(error)
  return (code === 409 || /\b409\b/.test(text)) && /revision_conflict|stale_generation|mutation_identity_required/i.test(text)
}

/** PATCHes `body` onto the chat, or deletes it when `body` is null. */
export async function mutateSession(http: Http, id: string, profile: string | undefined, body: Record<string, unknown> | null): Promise<void> {
  const attempt = async () => {
    let snapshot: unknown = null
    try {
      snapshot = await http('GET', sessionPath(id, profile, '/mutation-snapshot'))
    } catch {
      // A host without the snapshot, or a failed read: the bare write, which a refusal retries.
    }
    const identity = identityFields(snapshot, crypto.randomUUID().toLowerCase())
    if (body) {
      const sent: Record<string, unknown> = { ...body, ...(identity ?? {}) }
      if (profile && profile !== 'default') sent.profile = profile
      await http('PATCH', sessionPath(id, profile), sent)
    } else {
      const path = sessionPath(id, profile)
      await http('DELETE', identity ? withQuery(path, identity) : path)
    }
  }
  try {
    await attempt()
  } catch (e) {
    if (!warrantsRetry(e)) throw e
    await attempt()
  }
}

type Rpc = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

/**
 * Move to Project, as the phone's moveSessionWorkspace: a chat belongs to the
 * project its folder is in, so moving the folder moves the chat. The session
 * authority has no `session.workspace.move`; there it's a `workspace`
 * mutation carrying the row's revision and generation.
 */
export async function moveChat(rpc: Rpc, http: Http, id: string, profile: string | undefined, cwd: string, authority: boolean): Promise<void> {
  if (!authority) {
    const params: Record<string, unknown> = { session_key: id, cwd }
    if (profile && profile !== 'default') params.profile = profile
    await rpc('session.workspace.move', params)
    return
  }
  await authorityMutation(rpc, http, id, profile, 'workspace', { cwd })
}

/**
 * A `session.mutate` on the session authority (Move to project, a model
 * pick), fenced by the chat's revision and turn generation from its
 * mutation snapshot; a `revision_conflict` or `stale_generation` goes again
 * once on a fresh snapshot. The answer is the mutation's result.
 */
export async function authorityMutation<T = Record<string, unknown>>(
  rpc: Rpc,
  http: Http,
  id: string,
  profile: string | undefined,
  operation: string,
  payload: Record<string, unknown>
): Promise<T> {
  const attempt = async () => {
    let snapshot: unknown = null
    try {
      snapshot = await http('GET', sessionPath(id, profile, '/mutation-snapshot'))
    } catch {
      // No snapshot: revision 0, which a moved-on chat refuses and the retry reads again.
    }
    const identity = identityFields(snapshot, crypto.randomUUID().toLowerCase())
    const params: Record<string, unknown> = {
      session_id: id,
      request_id: identity?.request_id ?? crypto.randomUUID().toLowerCase(),
      operation,
      payload,
      expected_revision: identity?.expected_revision ?? 0,
      expected_generation: identity?.expected_generation ?? 0
    }
    if (profile && profile !== 'default') params.profile = profile
    return rpc<T>('session.mutate', params)
  }
  try {
    return await attempt()
  } catch (e) {
    if (!/revision_conflict|stale_generation/i.test(e instanceof Error ? e.message : String(e))) throw e
    return await attempt()
  }
}

/** The authority's `confirm` token for a guarded model, by chat, model and provider: only that exact token applies it. */
const modelConfirmTokens = new Map<string, string>()

export interface AuthorityModelPick {
  model: string
  confirmRequired: boolean
  confirmMessage: string
  deferred: boolean
}

/**
 * The authority's model pick, as the phone's authorityModelPick: there
 * `config.set model` is refused (`use_session_mutation_model`), so it's a
 * `model` mutation. A model Hermes guards answers with a `confirm` token
 * instead of switching, and the confirmed pick sends that token back.
 */
export async function authorityModelPick(rpc: Rpc, http: Http, id: string, profile: string | undefined, model: string, provider: string, confirmed: boolean): Promise<AuthorityModelPick> {
  const key = `${id}\n${model}\n${provider}`
  const payload: Record<string, unknown> = { model, provider }
  const token = modelConfirmTokens.get(key)
  if (confirmed && token) payload.confirm = token
  const result = (await authorityMutation(rpc, http, id, profile, 'model', payload)) ?? {}
  const confirmRequired = result.confirm_required === true
  if (confirmRequired && typeof result.confirm === 'string') modelConfirmTokens.set(key, result.confirm)
  else modelConfirmTokens.delete(key)
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  return {
    // A pick waiting on confirmation names its resolved target as `target_model`, and has no `model` until it applies.
    model: text(result.model) ?? text(result.target_model) ?? model,
    confirmRequired,
    confirmMessage: text(result.confirm_message) ?? '',
    deferred: result.deferred === true
  }
}
