import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'

/**
 * The call screen's Ask before sending switch, after the phone's: a raised
 * hand while each new request waits for the user's OK. A short caption says
 * what it means whenever it switches.
 */
export function AskFirstButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const [caption, setCaption] = useState<string | null>(null)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <span className="voice-call-ask">
      <button
        className={`voice-call-round${on ? ' on' : ''}`}
        aria-label={t('Ask before sending to Hermes')}
        aria-pressed={on}
        title={t('Ask before sending to Hermes')}
        onClick={() => {
          onToggle()
          setCaption(on ? t('Sending straight to Hermes') : t('Asking before sending to Hermes'))
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCaption(null), 3000)
        }}
      >
        <Icon name={on ? 'hand' : 'handSlash'} />
      </button>
      {caption ? (
        <span className="voice-call-ask-caption" role="status">
          {caption}
        </span>
      ) : null}
    </span>
  )
}
