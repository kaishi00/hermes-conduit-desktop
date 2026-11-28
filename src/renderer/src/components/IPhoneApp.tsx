import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
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
          {qr ? <img className="other-app-qr" src={qr} alt={t('App Store code for Conduit on iPhone')} /> : null}
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
