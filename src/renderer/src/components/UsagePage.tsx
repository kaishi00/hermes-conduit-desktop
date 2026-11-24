import { answerKeeper, keptAnswer, keptAt } from '../state/keptAnswers'
import { useCallback, useEffect, useRef, useState } from 'react'
import { locale, t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  PERIODS,
  accountStateText,
  absoluteLabel,
  allTokens,
  countLabel,
  isEmptyReport,
  moneyLabel,
  parseQuotas,
  parseUsage,
  periodDays,
  percentLabel,
  periodLabel,
  relativeLabel,
  reportCost,
  reportCostIsEstimate,
  tokensCost,
  tokensLabel,
  totalTokens,
  usageFailure,
  usageFailureText,
  windowFraction,
  type ProviderQuota,
  type QuotaWindow,
  type UsageFailure,
  type UsageReport
} from '../state/usage'
import { ProviderLogo } from './ProviderLogo'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'
import { useSlowWait } from '../state/slowWait'
import { Select } from './Select'

interface Props {
  /** The profiles to choose from, when there's more than one. */
  bots: { name: string; title: string }[]
  profile: string
  onBack: () => void
}

const withProfile = (path: string, profile: string) => (profile && profile !== 'default' ? `${path}&profile=${encodeURIComponent(profile)}` : path)

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="pset-row usage-metric">
      <span>{label}</span>
      <span className="usage-value">{value}</span>
    </div>
  )
}

function WindowBar({ window: w, language }: { window: QuotaWindow; language?: string }) {
  const fraction = windowFraction(w)
  return (
    <div className="usage-window">
      <div className="pset-row">
        <span>{w.label}</span>
        <span className="meta usage-value">{t('{percent} used', { percent: percentLabel(w.usedPercent / 100, language) })}</span>
      </div>
      <div
        className={`usage-meter${fraction >= 1 ? ' full' : fraction >= 0.8 ? ' high' : ''}`}
        role="progressbar"
        aria-label={w.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <span style={{ width: `${fraction * 100}%` }} />
      </div>
      {w.resetsAt ? <div className="meta">{t('Resets {time}', { time: relativeLabel(w.resetsAt, Date.now(), language) })}</div> : null}
    </div>
  )
}

function Quota({ quota, language }: { quota: ProviderQuota; language?: string }) {
  return (
    <div className="usage-quota">
      <strong className="usage-quota-title">
        <ProviderLogo slug={quota.slug} title={quota.title} />
        {quota.title}
      </strong>
      {quota.limit?.scope === 'account' ? (
        <div className="usage-limit">
          {quota.limit.resetsAt ? t('Rate limited until {time}', { time: absoluteLabel(quota.limit.resetsAt, language) }) : t('Rate limited')}
        </div>
      ) : quota.limit?.scope === 'models' ? (
        quota.limit.models.map(entry => (
          <div key={entry.model} className="usage-limit">
            {entry.resetsAt
              ? t('{model} limited until {time}', { model: entry.model, time: absoluteLabel(entry.resetsAt, language) })
              : t('{model} limited', { model: entry.model })}
          </div>
        ))
      ) : null}
      {quota.windows.map(w => (
        <WindowBar key={w.label} window={w} language={language} />
      ))}
      {quota.accounts.map((account, index) => {
        const state = accountStateText(account, language)
        return (
          <div key={account.id} className="usage-account">
            <div className="pset-row">
              <span>{account.label || t('Account {number}', { number: index + 1 })}</span>
              {state ? <span className={account.state === 'limited' ? 'usage-limit' : 'meta'}>{state}</span> : null}
            </div>
            {account.windows.map(w => (
              <WindowBar key={w.label} window={w} language={language} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function DailyBars({ report, language }: { report: UsageReport; language?: string }) {
  const days = periodDays(report)
  const peak = Math.max(1, ...days.map(day => totalTokens(day.usage)))
  const busiest = days.reduce((best, day) => (totalTokens(day.usage) > totalTokens(best.usage) ? day : best), days[0]!)
  const dayName = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(language, { month: 'short', day: 'numeric' })
  return (
    <div
      className="usage-chart"
      role="img"
      aria-label={`${t('Tokens per day')}: ${t('Busiest day {day}, {amount} tokens', { day: dayName(busiest.day), amount: tokensLabel(totalTokens(busiest.usage), language) })}`}
    >
      <div className="usage-peak meta">{tokensLabel(peak, language)}</div>
      <div className="usage-bars">
        {days.map(day => {
          const total = totalTokens(day.usage)
          return (
            <span key={day.day} className="usage-bar" title={`${dayName(day.day)} · ${tokensLabel(total, language)}`}>
              <span style={{ height: `${total > 0 ? Math.max(2, (total / peak) * 100) : 0}%` }} />
            </span>
          )
        })}
      </div>
      <div className="usage-axis meta">
        <span>{dayName(days[0]!.day)}</span>
        <span>{dayName(days[days.length - 1]!.day)}</span>
      </div>
    </div>
  )
}

/**
 * Settings > Usage, after the phone's: a profile's tokens and cost over 7,
 * 30 or 90 days, a bar per day, a row per model, and each provider's quota.
 * Read only, from what Hermes already keeps; refreshed by hand, never
 * polled, since a provider's quota check can be rate-limited on the host.
 */
/** Where the quotas' `model.options` answer is kept: an RPC, so a name of its own. */
const quotasKey = (profile?: string) => `rpc:model.options:quotas:${profile || 'default'}`

/**
 * How long a usage answer counts as current. The route takes ten seconds or more on a
 * host with a large library (desktop#444), so a pane reopened within half a minute on
 * the same period draws what it has and asks nothing. No longer than that: a turn that
 * just ran should show in the totals the next time the pane opens. Refresh reads anyway.
 */
const FRESH_MS = 30_000

export function UsagePage({ bots, profile: initialProfile, onBack }: Props) {
  useMouseBack(onBack)
  const language = locale()
  const [days, setDays] = useState(30)
  const [profile, setProfile] = useState(initialProfile)
  const [report, setReport] = useState<UsageReport | null>(null)
  const [quotas, setQuotas] = useState<ProviderQuota[] | null>(null)
  const [failure, setFailure] = useState<UsageFailure | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  // "Loading…" for ten seconds reads as a frozen screen when the host's usage route is slow (desktop#444).
  const slow = useSlowWait(loading)

  const load = useCallback(async () => {
    const mine = ++generation.current
    setLoading(true)
    const path = withProfile(`/api/analytics/usage?days=${days}`, profile)
    const keep = answerKeeper(path)
    const params: Record<string, unknown> = { explicit_only: true }
    if (profile && profile !== 'default') params.profile = profile
    const keepQuotas = answerKeeper(quotasKey(profile))
    // All three go out together: the usage route alone takes ten seconds or more on a
    // host with a large library (desktop#444), and the models and quota reads never
    // depended on it. The page draws as soon as the totals are in — the quota read is
    // its own section and never holds them (it used to be the last of three waits).
    const quotas = gateway
      .rpc('model.options', params)
      .then(answer => ({ answer }))
      .catch(() => ({ answer: null as unknown }))
    // The totals stand without the per-model route, so they are drawn the moment they
    // arrive and the per-model rows merge in when theirs does (desktop#444).
    const modelsRead = gateway
      .http('GET', withProfile(`/api/analytics/models?days=${days}`, profile))
      .catch(() => null)
    const usageRead = await gateway.http('GET', path).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error })
    )
    if (generation.current !== mine) return
    setLoading(false)
    if (usageRead.ok) {
      setReport(parseUsage(usageRead.value, null, days))
      keep({ usage: usageRead.value, models: null })
      setFailure(null)
    } else setFailure(usageFailure(usageRead.error))
    const perModel = await modelsRead
    if (generation.current === mine && usageRead.ok && perModel) {
      setReport(parseUsage(usageRead.value, perModel, days))
      keep({ usage: usageRead.value, models: perModel })
    }
    const { answer } = await quotas
    if (generation.current !== mine) return
    // A quota that couldn't be read goes rather than stay up as current.
    setQuotas(answer ? parseQuotas(answer) : null)
    if (answer) keepQuotas(answer)
  }, [days, profile])

  useEffect(() => {
    // Another period or profile: never the old one's numbers under it, but its own from last time while Hermes answers.
    const path = withProfile(`/api/analytics/usage?days=${days}`, profile)
    const kept = keptAnswer(path) as { usage?: unknown; models?: unknown } | undefined
    setReport(kept?.usage ? parseUsage(kept.usage, kept.models ?? null, days) : null)
    const keptOptions = keptAnswer(quotasKey(profile))
    setQuotas(keptOptions ? parseQuotas(keptOptions) : null)
    setFailure(null)
    // An answer read a moment ago is still what the slow route would answer: draw it, ask nothing (desktop#444).
    const at = keptAt(path)
    if (kept?.usage && at !== null && Date.now() - at < FRESH_MS) return
    void load()
  }, [load])

  const cost = report ? reportCost(report) : 0
  const estimate = report ? reportCostIsEstimate(report) : false

  return (
    <div className="pset usage">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Usage')}</h1>
        <span className="spacer" />
        <button className="secondary" disabled={loading} onClick={() => void load()}>
          {t('Refresh')}
        </button>
      </div>

      <div className="usage-controls">
        <div className="segmented" role="radiogroup" aria-label={t('Period')}>
          {PERIODS.map(period => (
            <button key={period} role="radio" aria-checked={days === period} className={days === period ? 'on' : undefined} onClick={() => setDays(period)}>
              {periodLabel(period)}
            </button>
          ))}
        </div>
        {bots.length > 1 ? (
          <Select className="language-select" value={profile} aria-label={t('Bot')} onChange={picked => setProfile(picked)}>
            {bots.map(bot => (
              <option key={bot.name} value={bot.name}>
                {bot.title}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {report && failure ? <p className="error-text">{usageFailureText(failure)}</p> : null}

      {report ? (
        <>
          <section className="pset-section">
            <h2>{t('Totals')}</h2>
            {isEmptyReport(report) ? (
              <p className="meta">{t('No usage in this period.')}</p>
            ) : (
              <>
                <Metric label={estimate ? t('Estimated cost') : t('Cost')} value={moneyLabel(cost, language)} />
                <Metric label={t('Total tokens')} value={tokensLabel(allTokens(report.totals), language)} />
                <Metric label={t('Input')} value={tokensLabel(report.totals.input, language)} />
                <Metric label={t('Output')} value={tokensLabel(report.totals.output, language)} />
                {report.totals.cacheRead > 0 ? <Metric label={t('Cache reads')} value={tokensLabel(report.totals.cacheRead, language)} /> : null}
                {report.totals.reasoning > 0 ? <Metric label={t('Reasoning')} value={tokensLabel(report.totals.reasoning, language)} /> : null}
                <Metric label={t('Chats')} value={countLabel(report.totals.sessions, language)} />
                <Metric label={t('API calls')} value={countLabel(report.totals.apiCalls, language)} />
                {estimate ? (
                  <p className="meta">{t("Costs are Hermes' estimates from each model's prices, unless the provider reports what it billed.")}</p>
                ) : null}
              </>
            )}
          </section>

          {report.daily.some(day => totalTokens(day.usage) > 0) ? (
            <section className="pset-section">
              <h2>{t('Tokens per day')}</h2>
              <DailyBars report={report} language={language} />
            </section>
          ) : null}

          {report.models.length ? (
            <section className="pset-section">
              <h2>{t('By model')}</h2>
              {report.models.map(entry => {
                const flow = t('{input} in · {output} out', {
                  input: tokensLabel(entry.usage.input, language),
                  output: tokensLabel(entry.usage.output, language)
                })
                const entryCost = tokensCost(entry.usage)
                return (
                  <div key={`${entry.provider}/${entry.model}`} className="pset-row usage-model">
                    <div>
                      <div className="usage-model-name">{entry.model}</div>
                      <div className="meta">{entry.provider ? `${entry.provider} · ${flow}` : flow}</div>
                    </div>
                    {entryCost > 0 ? <span className="meta usage-value">{moneyLabel(entryCost, language)}</span> : null}
                  </div>
                )
              })}
            </section>
          ) : null}
        </>
      ) : failure ? (
        <section className="pset-section">
          <p className="meta">{usageFailureText(failure)}</p>
        </section>
      ) : (
        <p className="meta">{slow ? t('This is taking longer than usual.') : t('Loading…')}</p>
      )}

      {quotas ? (
        <section className="pset-section">
          <h2>{t('Provider quota')}</h2>
          {quotas.map(quota => (
            <Quota key={quota.slug} quota={quota} language={language} />
          ))}
          <p className="meta">
            {t('Shown for providers that report a quota, such as subscription sign-ins. Hermes checks it in the background, so refresh if one is missing.')}
          </p>
        </section>
      ) : null}
    </div>
  )
}
