import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dashboardHttp } from '../gateway'
import { t } from '../../../shared/i18n'
import { cronPath, parseDeliveryTargets, parseJob, parseJobs, parseRuns, type CronJob, type CronRun, type DeliveryTarget } from './cron'

export type CronAction = 'pause' | 'resume' | 'trigger'

/**
 * Where the list's jobs come from: this dashboard (host null) or another combined one, read and
 * changed through its kept connection, and its profile (null: every profile's).
 */
export interface CronSource {
  host: string | null
  profile: string | null
}

/** Another dashboard's jobs are read again this often, since its "jobs changed" events don't reach this window. */
export const KEPT_CRON_POLL_MS = 60_000

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const sourcesKey = (sources: readonly CronSource[]) => sources.map(s => `${s.host ?? ''}\t${s.profile ?? ''}`).join('\n')

/**
 * The scheduled jobs of each source, every profile's naming its own, read again when Hermes says
 * its jobs changed (another dashboard's on a poll). An action goes to the job's own dashboard and
 * names its own profile, as the phone does. A source whose read fails leaves the rest listed, and keeps its own last jobs read.
 */
export function useCron(sources: readonly CronSource[], connected: boolean) {
  const key = sourcesKey(sources)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => sources, [key])
  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Each source's last jobs read: a source whose read fails keeps them, as Board keeps a far
  // dashboard's board list, so a dashboard that blips doesn't drop out of All.
  const lastRead = useRef(new Map<string, CronJob[]>())

  const load = useCallback(async () => {
    const mine = ++generation.current
    const reads = await Promise.allSettled(
      shown.map(async source => {
        const raw = await dashboardHttp(source.host)('GET', cronPath('/api/cron/jobs', source.profile ?? 'all'))
        return source.host ? parseJobs(raw).map(job => ({ ...job, host: source.host! })) : parseJobs(raw)
      })
    )
    if (mine !== generation.current) return
    const read = reads.flatMap((r, i) => {
      const at = sourcesKey([shown[i]])
      if (r.status === 'fulfilled') {
        lastRead.current.set(at, r.value)
        return r.value
      }
      return lastRead.current.get(at) ?? []
    })
    const failed = reads.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed && read.length === 0 && reads.every(r => r.status === 'rejected')) {
      setError(t('Could not load scheduled jobs: {reason}', { reason: message(failed.reason) }))
      return
    }
    setJobs(read)
    setError(null)
  }, [shown])

  const far = shown.some(s => s.host)
  const near = shown.some(s => !s.host)
  useEffect(() => {
    setJobs(null)
    setError(null)
    lastRead.current = new Map()
    if (!connected) return
    void load()
    const off = near
      ? window.conduit.onEvent(event => {
          if (event.type !== 'cron.changed') return
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => void load(), 400)
        })
      : () => undefined
    const poll = far ? setInterval(() => !document.hidden && void load(), KEPT_CRON_POLL_MS) : null
    return () => {
      off()
      if (poll) clearInterval(poll)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [connected, load, near, far])

  /** The job's own profile, else the one its source lists. */
  const ownerOf = useCallback(
    (job: CronJob) => job.profile ?? shown.find(s => (s.host ?? undefined) === job.host)?.profile ?? undefined,
    [shown]
  )
  const http = (job: CronJob) => dashboardHttp(job.host ?? null)
  const same = (a: CronJob, b: CronJob) => a.id === b.id && a.profile === b.profile && a.host === b.host
  /** What a write changed, in the list and in each source's last read, so a refresh that fails can't bring the old rows back. */
  const patch = (change: (list: CronJob[]) => CronJob[]) => {
    for (const [at, list] of lastRead.current) lastRead.current.set(at, change(list))
    setJobs(list => (list ? change(list) : list))
  }

  /** Pause, Resume or Run now; null when it worked, else what to tell the user. */
  const act = useCallback(
    async (action: CronAction, job: CronJob): Promise<string | null> => {
      setBusy(job.id)
      const owner = ownerOf(job)
      try {
        await http(job)('POST', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}/${action}`, owner), owner ? { profile: owner } : {})
        if (action !== 'trigger') {
          patch(list => list.map(row => (same(row, job) ? { ...row, enabled: action === 'resume' } : row)))
        }
        void load()
        return null
      } catch (e) {
        const reason = message(e)
        return action === 'pause'
          ? t('Could not pause scheduled job: {reason}', { reason })
          : action === 'resume'
            ? t('Could not resume scheduled job: {reason}', { reason })
            : t('Could not run scheduled job: {reason}', { reason })
      } finally {
        setBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, ownerOf]
  )

  const remove = useCallback(
    async (job: CronJob): Promise<string | null> => {
      setBusy(job.id)
      try {
        await http(job)('DELETE', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}`, ownerOf(job)))
        patch(list => list.filter(row => !same(row, job)))
        void load()
        return null
      } catch (e) {
        return t('Could not delete scheduled job: {reason}', { reason: message(e) })
      } finally {
        setBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, ownerOf]
  )

  /**
   * A new job in `owner` on `host` (null: this dashboard); the job Hermes made, when it says. It joins
   * its source's list and last read at once, so a refresh after it that fails still lists it (desktop#348).
   */
  const create = useCallback(
    async (body: Record<string, unknown>, owner: string | undefined, host: string | null = null): Promise<CronJob | null> => {
      const raw = (await dashboardHttp(host)('POST', cronPath('/api/cron/jobs', owner), body)) as Record<string, unknown> | null
      const parsed = parseJob(raw?.job ?? raw)
      const job = parsed ? { ...parsed, profile: parsed.profile ?? owner, ...(host ? { host } : {}) } : null
      if (job) {
        // The source that lists it: this host's, for its profile or every profile's.
        const source = shown.find(s => s.host === host && (s.profile === null || s.profile === (job.profile ?? 'default')))
        if (source) {
          const at = sourcesKey([source])
          const kept = lastRead.current.get(at)
          if (kept && !kept.some(row => same(row, job))) lastRead.current.set(at, [...kept, job])
          setJobs(list => (list && !list.some(row => same(row, job)) ? [...list, job] : list))
        }
      }
      void load()
      return job
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, shown]
  )

  /** Changes only `updates`; the job Hermes answers with takes its row at once, so a refresh that fails can't bring the old one back (desktop#348). */
  const update = useCallback(
    async (job: CronJob, updates: Record<string, unknown>): Promise<void> => {
      if (!Object.keys(updates).length) return
      const raw = (await http(job)('PUT', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}`, ownerOf(job)), { updates })) as Record<string, unknown> | null
      const parsed = parseJob(raw?.job ?? raw)
      if (parsed && parsed.id === job.id) {
        const updated: CronJob = { ...parsed, profile: parsed.profile ?? job.profile, ...(job.host ? { host: job.host } : {}) }
        patch(list => list.map(row => (same(row, job) ? updated : row)))
      }
      void load()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, ownerOf]
  )

  const runs = useCallback(
    async (job: CronJob): Promise<CronRun[]> => {
      const raw = await http(job)('GET', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}/runs?limit=20`, ownerOf(job)))
      return parseRuns(raw).map(run => (job.host ? { ...run, host: job.host } : run))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownerOf]
  )

  const deliveryTargets = useCallback(async (owner: string | undefined, host: string | null = null): Promise<DeliveryTarget[]> => {
    try {
      return parseDeliveryTargets(await dashboardHttp(host)('GET', cronPath('/api/cron/delivery-targets', owner)))
    } catch {
      return []
    }
  }, [])

  return { jobs, error, busy, reload: load, act, remove, create, update, runs, deliveryTargets, jobProfile: ownerOf }
}
