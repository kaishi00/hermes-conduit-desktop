import { t } from '@shared/i18n'
import { setReplySpeedInComposer, setReplySpeedShown } from '../state/replySpeeds'
import { useReplySpeedInComposer, useReplySpeedShown } from '../state/useReplySpeeds'

/**
 * Settings > Chat > Reply speed, after the phone's: kept on this computer and off by default. The composer's
 * chip is its own switch (desktop#718, Eric 2026-11-27); either one can be on without the other.
 */
export function ReplySpeedSetting() {
  const shown = useReplySpeedShown()
  const inComposer = useReplySpeedInComposer()
  return (
    <section className="pset-section">
      <h2>{t('Reply speed')}</h2>
      <p className="meta">
        {t(
          "Shows how fast each reply was written, in tokens per second, beside its time. The Conduit plugin measures it from your provider's token counts and the time the model spent writing, so replies from before plugin 0.204.0 show none."
        )}
      </p>
      <div className="pset-row">
        <span>{t('Show reply speed')}</span>
        <label className="switch-inline">
          <input type="checkbox" checked={shown} aria-label={t('Show reply speed')} onChange={e => setReplySpeedShown(e.target.checked)} />
        </label>
      </div>
      <div className="pset-row">
        <span>{t('Show reply speed in the composer')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={inComposer}
            aria-label={t('Show reply speed in the composer')}
            onChange={e => setReplySpeedInComposer(e.target.checked)}
          />
        </label>
      </div>
      <p className="meta">{t("The newest reply's speed, beside the context ring. It dims while the next reply is written.")}</p>
    </section>
  )
}
