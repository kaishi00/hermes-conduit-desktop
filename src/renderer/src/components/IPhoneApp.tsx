import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { PhoneSignInEvent, PhoneSignInHost } from '@shared/ipc'
import { t } from '@shared/i18n'
import { APP_STORE_URL, retireIphoneCard } from '../state/otherApp'

/** The App Store's code for Conduit on iPhone, drawn once. */
function useAppStoreCode(): string | null {
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    QRCode.toDataURL(APP_STORE_URL, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then(url => {
        if (live) setQr(url)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return qr
}

/**
 * Conduit on iPhone: the App Store code to scan with the phone's camera, and
 * the link for a click. Settings › Conduit on iPhone and the sign-in screen
 * show it.
 */
export function IPhoneAppPanel() {
  const qr = useAppStoreCode()
  return (
    <div className="iphone-app">
      {qr ? <img className="pair-qr iphone-app-qr" src={qr} alt={t('App Store code for Conduit on iPhone')} /> : <div className="pair-qr iphone-app-qr" />}
      <div className="iphone-app-text">
        <p>
          {t('Scan this with your iPhone’s camera to get Conduit from the App Store. It signs in to the same Hermes, and adds notifications, calls from Hermes, the Apple Watch and CarPlay.')}
        </p>
        <p>
          <a className="link" href={APP_STORE_URL} target="_blank" rel="noreferrer">
            {t('Open in the App Store')}
          </a>
        </p>
        <p className="meta">{t('Already have it? Conduit on your iPhone can add more Hermes dashboards to this computer: on the phone, open Settings, then Connection, then Pair a Computer.')}</p>
      </div>
    </div>
  )
}

/**
 * The one-time card under the chat list, shown only where no iPhone has used
 * this host (state/otherApp.ts decides). Get it on iPhone shows the App Store
 * code in the card; that and its × both retire it for good.
 */
export function IPhoneAppCard({ onDone }: { onDone: () => void }) {
  const [showing, setShowing] = useState(false)
  const qr = useAppStoreCode()
  return (
    <aside className="other-app-card" aria-label={t('Conduit on iPhone')}>
      <button
        className="other-app-close"
        aria-label={t('Dismiss')}
        title={t('Dismiss')}
        onClick={() => {
          retireIphoneCard()
          onDone()
        }}
      >
        ×
      </button>
      <strong>{t('Take Conduit with you')}</strong>
      {showing ? (
        <>
          {qr ? <img className="other-app-qr" src={qr} alt={t('App Store code for Conduit on iPhone')} /> : <div className="other-app-qr" />}
          <p>{t('Scan with your iPhone’s camera.')}</p>
          <a className="link" href={APP_STORE_URL} target="_blank" rel="noreferrer">
            {t('Open in the App Store')}
          </a>
        </>
      ) : (
        <>
          <p>{t('Conduit on iPhone has the same chats and bots, with notifications, the Apple Watch and CarPlay.')}</p>
          <button
            className="secondary"
            onClick={() => {
              retireIphoneCard()
              setShowing(true)
            }}
          >
            {t('Get it on iPhone')}
          </button>
        </>
      )}
    </aside>
  )
}

type SignInStage =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'showing'; qr: string; expires: number }
  | { kind: 'received'; words: string[]; hosts: PhoneSignInHost[] }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'ended'; message: string; tone?: 'error' }

/**
 * Sign in your iPhone, under Settings › Conduit on iPhone: a code for the
 * phone's camera, then the four words both screens show, the hosts to send
 * and They match (main/phoneSignIn.ts seals them to the phone).
 */
export function SignInYourIphone() {
  const [stage, setStage] = useState<SignInStage>({ kind: 'idle' })
  const [round, setRound] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (round === 0) return
    let live = true
    setStage({ kind: 'starting' })
    setPicked(new Set())
    void window.conduit
      .phoneSignInStart()
      .then(async result => {
        if (!live) return
        if (!result.ok) return setStage({ kind: 'ended', message: result.error, tone: 'error' })
        const qr = await QRCode.toDataURL(result.link, { margin: 1, width: 520, errorCorrectionLevel: 'M' })
        if (live) setStage({ kind: 'showing', qr, expires: result.expires })
      })
      .catch((error: Error) => {
        if (live) setStage({ kind: 'ended', message: error.message || t('Pairing didn’t work.'), tone: 'error' })
      })
    const off = window.conduit.onPhoneSignIn((event: PhoneSignInEvent) => {
      if (event.phase === 'received') {
        const hosts = event.hosts ?? []
        const sendable = hosts.filter(h => h.sendable).map(h => h.url)
        // A list shown again keeps what was unchecked; the first one checks every host.
        setPicked(prev => (prev.size ? new Set(sendable.filter(url => prev.has(url))) : new Set(sendable)))
        setStage({ kind: 'received', words: event.words ?? [], hosts })
      } else if (event.phase === 'sending') setStage({ kind: 'sending' })
      else if (event.phase === 'done') setStage({ kind: 'done' })
      else if (event.phase === 'expired') setStage({ kind: 'ended', message: t('The code ran out. Make a new one to try again.') })
      else if (event.phase === 'failed') setStage({ kind: 'ended', message: event.error ?? t('Pairing didn’t work.'), tone: 'error' })
    })
    return () => {
      live = false
      off()
      void window.conduit.phoneSignInCancel()
    }
  }, [round])

  useEffect(() => {
    if (stage.kind !== 'showing') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [stage.kind])

  const left = stage.kind === 'showing' ? Math.max(0, Math.round((stage.expires - now) / 1000)) : 0
  const again = () => setRound(r => r + 1)
  return (
    <div className="iphone-sign-in">
      <strong>{t('Sign in your iPhone')}</strong>
      {stage.kind === 'idle' ? (
        <>
          <p className="meta">{t('Once Conduit is on your iPhone, this computer can sign it in to your Hermes dashboards, without typing anything there.')}</p>
          <button className="secondary" onClick={again}>
            {t('Show a Sign-in Code')}
          </button>
        </>
      ) : null}
      {stage.kind === 'starting' ? <p>{t('Making a code…')}</p> : null}
      {stage.kind === 'showing' ? (
        <>
          <p>{t('Scan this with your iPhone’s camera, or with Scan Code on Conduit’s sign-in screen.')}</p>
          <img className="pair-qr" src={stage.qr} alt={t('Sign-in code')} />
          <p className="pair-note">
            {t('Your sign-ins are sealed to your phone before they leave. Nobody in between can read them. The code works for {time} more.', {
              time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
            })}
          </p>
        </>
      ) : null}
      {stage.kind === 'received' ? (
        <>
          <p>{t('Check that your iPhone shows these same four words.')}</p>
          <div className="pair-words" aria-label={t('Words to compare')}>
            {stage.words.map((word, i) => (
              <span key={i}>{word}</span>
            ))}
          </div>
          <p>{t('Sign-ins to send:')}</p>
          {stage.hosts.map(host => (
            <label key={host.url} className="iphone-sign-in-host">
              <input
                type="checkbox"
                disabled={!host.sendable}
                checked={picked.has(host.url)}
                onChange={e => {
                  const next = new Set(picked)
                  if (e.target.checked) next.add(host.url)
                  else next.delete(host.url)
                  setPicked(next)
                }}
              />
              <span>{host.name}</span>
              {host.sendable ? null : <span className="meta">{t('Sign in on the phone')}</span>}
            </label>
          ))}
          <button className="primary" disabled={!picked.size} onClick={() => void window.conduit.phoneSignInSend([...picked]).catch((error: Error) => setStage({ kind: 'ended', message: t('Couldn’t send to your iPhone: {reason}', { reason: error.message }), tone: 'error' }))}>
            {t('They match, send')}
          </button>
          <button className="link-button" onClick={again}>
            {t('They don’t match')}
          </button>
        </>
      ) : null}
      {stage.kind === 'sending' ? <p>{t('Sending…')}</p> : null}
      {stage.kind === 'done' ? <p>{t('Sent. Your iPhone shows each dashboard to sign in to.')}</p> : null}
      {stage.kind === 'ended' ? (
        <>
          <p className={stage.tone === 'error' ? 'error-text' : undefined} style={{ whiteSpace: 'pre-line' }}>
            {stage.message}
          </p>
          <button className="secondary" onClick={again}>
            {t('Make a new code')}
          </button>
        </>
      ) : null}
    </div>
  )
}
