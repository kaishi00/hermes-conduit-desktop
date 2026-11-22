/**
 * Hermes' model catalog for a model picker, after the phone's
 * ModelCatalogState and ModelCatalogSettle ("Model lists that fail to load",
 * "Model lists Hermes is still fetching"). A picker opens on the models
 * kept from Hermes' last answer on this host, and they wait for Hermes'
 * answer before one can be picked. A read that fails keeps the models it
 * had and says "Could not load models." with Try Again; "No models are
 * available from this gateway." is only for a catalog that loaded empty.
 * Four seconds after a picker opens it reads once more, so lists Hermes
 * fetched meanwhile show. Refresh models asks Hermes to fetch every
 * provider's live list first. Only the last read asked lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway, GatewayError, keptGateway } from '../gateway'
import type { ModelProviderRow } from './models'

export const READ_AGAIN_MS = 4000

export interface CatalogOptions {
  /** A failed read again stays quiet, keeping the models this visit listed (the Model page's editors). */
  quietReadAgain?: boolean
  /** Off while the picker isn't up. */
  enabled?: boolean
  /** Another combined dashboard's models (a scheduled job there), read through its kept connection. */
  host?: string | null
}

export interface ModelCatalog {
  /** Kept or answered; null before either. */
  providers: ModelProviderRow[] | null
  /** Hermes answered on this visit, so a model can be picked. */
  answered: boolean
  failed: boolean
  loading: boolean
  refreshing: boolean
  tryAgain: () => void
  refresh: () => void
}

const kept = new Map<string, ModelProviderRow[]>()
let keptHost = ''

/** The host the kept catalogs belong to; another host's are dropped. */
export function setCatalogHost(host: string): void {
  if (host === keptHost) return
  keptHost = host
  kept.clear()
}

export const catalogKey = (params: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(params)
      .sort()
      .map(k => [k, params[k]])
  )

/** A Hermes that doesn't know `refresh` refuses the param; it answers from its cache instead. */
export function refusesRefresh(error: unknown): boolean {
  if (!(error instanceof GatewayError)) return false
  const text = error.message.toLowerCase()
  return (error.code === 4001 || error.code === 4000 || error.reason === 'invalid_params') && text.includes('refresh')
}

/** What the picker says under its models, or null for nothing. */
export function catalogNote(catalog: Pick<ModelCatalog, 'providers' | 'answered' | 'failed' | 'loading'>): 'failed' | 'empty' | 'loading' | null {
  if (catalog.failed) return 'failed'
  if (catalog.answered && catalog.providers && !catalog.providers.some(p => p.models?.length)) return 'empty'
  if (!catalog.providers && catalog.loading) return 'loading'
  return null
}

type Read = 'open' | 'again' | 'try' | 'refresh'

export function useModelCatalog(params: Record<string, unknown>, options: CatalogOptions = {}): ModelCatalog {
  const host = options.host ?? null
  const key = host ? `${host}\n${catalogKey(params)}` : catalogKey(params)
  const rpc = host ? keptGateway(host).rpc : gateway.rpc
  const enabled = options.enabled ?? true
  const quiet = !!options.quietReadAgain
  const [providers, setProviders] = useState<ModelProviderRow[] | null>(() => kept.get(key) ?? null)
  const [answered, setAnswered] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const latest = useRef(0)
  const refreshRunning = useRef(false)
  const skipped = useRef(false)
  const lastFailedRefresh = useRef(false)
  const answeredRef = useRef(false)
  const asked = useRef(params)
  asked.current = params

  const read = useCallback(
    async (kind: Read) => {
      if (kind !== 'refresh' && refreshRunning.current) {
        skipped.current = true
        return
      }
      const mine = ++latest.current
      const body = asked.current
      if (kind === 'refresh') {
        refreshRunning.current = true
        skipped.current = false
        setRefreshing(true)
      } else if (kind !== 'again') setLoading(true)
      try {
        let answer: { providers?: ModelProviderRow[] } | null
        if (kind === 'refresh') {
          try {
            answer = await rpc('model.options', { ...body, refresh: true })
          } catch (e) {
            if (!refusesRefresh(e)) throw e
            answer = await rpc('model.options', body)
          }
        } else answer = await rpc('model.options', body)
        if (!answer || typeof answer !== 'object') throw new Error('invalid response')
        if (mine !== latest.current) return
        const rows = Array.isArray(answer.providers) ? answer.providers : []
        kept.set(key, rows)
        setProviders(rows)
        setAnswered(true)
        answeredRef.current = true
        setFailed(false)
        lastFailedRefresh.current = false
      } catch {
        if (mine !== latest.current) return
        // A quiet read again leaves what this visit listed; a first read that failed still says so.
        if (!(kind === 'again' && quiet && answeredRef.current)) setFailed(true)
        lastFailedRefresh.current = kind === 'refresh'
      } finally {
        if (kind === 'refresh') {
          refreshRunning.current = false
          setRefreshing(false)
          if (skipped.current && !lastFailedRefresh.current) {
            skipped.current = false
            void read('open')
          }
          skipped.current = false
        }
        if (mine === latest.current) setLoading(false)
      }
    },
    [key, quiet]
  )

  useEffect(() => {
    if (!enabled) return
    setProviders(kept.get(key) ?? null)
    setAnswered(false)
    answeredRef.current = false
    setFailed(false)
    void read('open')
    const again = setTimeout(() => void read('again'), READ_AGAIN_MS)
    return () => {
      clearTimeout(again)
      // Leaving the picker drops whatever it asked.
      latest.current++
    }
  }, [key, enabled, read])

  const tryAgain = useCallback(() => void read(lastFailedRefresh.current ? 'refresh' : 'try'), [read])
  const refresh = useCallback(() => void read('refresh'), [read])
  return { providers, answered, failed, loading, refreshing, tryAgain, refresh }
}
