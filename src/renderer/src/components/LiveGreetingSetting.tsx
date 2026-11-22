import { useState } from 'react'
import { t } from '@shared/i18n'
import { MAX_GREETING_CHARACTERS, cleanedGreeting, liveGreeting, setLiveGreeting } from '../state/liveGreeting'

/**
 * Settings > Voice's "Greet me when a call connects", after the phone's Live
 * call style: every live mode opens with the greeting, or one in the model's
 * own words when the field is empty. Kept on this computer.
 */
export function LiveGreetingSetting() {
  const [greeting, setGreeting] = useState<string | null>(liveGreeting)
  return (
    <>
      <label className="toggle">
        <input
          type="checkbox"
          checked={greeting !== null}
          onChange={e => {
            const next = e.target.checked ? '' : null
            setGreeting(next)
            setLiveGreeting(next)
          }}
        />
        {t('Greet me when a call connects')}
      </label>
      {greeting !== null ? (
        <label className="local-live-field">
          <span className="meta">{t('Greeting')}</span>
          <input
            value={greeting}
            maxLength={MAX_GREETING_CHARACTERS}
            placeholder={t('A short greeting of its own')}
            onChange={e => {
              setGreeting(e.target.value)
              setLiveGreeting(e.target.value)
            }}
            // Shows what is saved and sent (one line, no double quotes).
            onBlur={e => setGreeting(cleanedGreeting(e.target.value))}
            onKeyDown={e => {
              if (e.key === 'Enter') setGreeting(cleanedGreeting(e.currentTarget.value))
            }}
          />
        </label>
      ) : null}
      <p className="meta settings-caption">
        {t(
          "The voice model greets you as soon as a call connects, so you know it's live. Leave the greeting empty for one in its own words. GPT-Live needs an up-to-date Hermes notifier plugin for this. Applies to the next call."
        )}
      </p>
    </>
  )
}
