import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { keptPicture, pictureHost, readGatewayPicture } from '../state/gatewayPictures'
import { t } from '@shared/i18n'
import { pictureFileName, saveFromUrl } from '../state/saveMedia'

/** The profile whose files a transcript's pictures are read from. */
export const PictureProfile = createContext<string | undefined>(undefined)

/** Opens a picture over the window; Esc or a click closes it. */
const ViewerContext = createContext<(src: string, name: string) => void>(() => undefined)

export function PictureViewerHost({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ src: string; name: string } | null>(null)
  useEffect(() => {
    if (!shown) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setShown(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shown])
  return (
    <ViewerContext.Provider value={(src, name) => setShown({ src, name })}>
      {children}
      {shown ? (
        <div className="picture-viewer" role="dialog" aria-label={shown.name} onClick={() => setShown(null)}>
          <img src={shown.src} alt={shown.name} />
          <button
            className="picture-viewer-save"
            onClick={event => {
              event.stopPropagation()
              void saveFromUrl(shown.src, pictureFileName(shown.name, shown.src))
            }}
          >
            {t('Download')}
          </button>
          <button className="picture-viewer-close" aria-label={t('Close')} onClick={() => setShown(null)}>
            ×
          </button>
        </div>
      ) : null}
    </ViewerContext.Provider>
  )
}

/** A picture drawn in place that opens larger when clicked. */
export function PictureImage({ src, name, className = 'sent-picture' }: { src: string; name: string; className?: string }) {
  const open = useContext(ViewerContext)
  return (
    <button className={`picture-button ${className}`} title={name} onClick={() => open(src, name)}>
      <img src={src} alt={name} />
    </button>
  )
}

/** A picture on the Hermes host, read through the dashboard; `fallback` while it loads or if it won't. */
export function GatewayPicture({ path, name, fallback, className }: { path: string; name: string; fallback: ReactNode; className?: string }) {
  const profile = useContext(PictureProfile)
  const host = pictureHost()
  const [src, setSrc] = useState<string | null | undefined>(() => keptPicture(path, profile))
  useEffect(() => {
    let live = true
    const known = keptPicture(path, profile)
    if (known !== undefined) {
      setSrc(known)
      return
    }
    setSrc(undefined)
    void readGatewayPicture(path, profile).then(url => {
      if (live) setSrc(url)
    })
    return () => {
      live = false
    }
  }, [path, profile, host])
  return src ? <PictureImage src={src} name={name} className={className} /> : <>{fallback}</>
}
