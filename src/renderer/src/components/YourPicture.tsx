import { useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { LookFace } from './BotsHome'
import { lookPicture } from '../state/lookPictures'
import type { PersonPicture } from '../state/useRoomLooks'

/**
 * Your picture on this Hermes: Multiplayer's You in rooms, and Settings >
 * Appearance's You, where the rail's brand draws it (Eric, 2026-11-26). Both
 * set the same one, kept on Hermes for all your devices.
 */
export function YourPicture({ picture, title, caption }: { picture: PersonPicture; title: string; caption: string }) {
  const [failure, setFailure] = useState<'unusable' | 'notSaved' | null>(null)
  const [making, setMaking] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const busy = picture.saving || making
  const change = async (next: string | null) => {
    setFailure(null)
    const outcome = await picture.set(next)
    if (outcome !== 'saved') setFailure(outcome)
  }
  const choose = async (file: File | undefined) => {
    if (!file) return
    setMaking(true)
    setFailure(null)
    try {
      // Read as a data URL: the window's policy loads no blob: images.
      const url = await new Promise<string | null>(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })
      const made = url ? await lookPicture(url) : null
      if (!made) return setFailure('unusable')
      await change(made)
    } finally {
      setMaking(false)
    }
  }
  return (
    <section className="pset-section">
      <h2>{title}</h2>
      <div className="you-in-rooms">
        <LookFace look={picture.picture ? { picture: picture.picture } : undefined} name={t('You')} size={52} />
        <div className="link-row-text">
          <strong>{t('Your picture')}</strong>
          <span className="meta">{caption}</span>
        </div>
      </div>
      <div className="links-actions">
        <button className="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {picture.picture ? t('Change Picture') : t('Choose Picture')}
        </button>
        {picture.picture ? (
          <button className="link danger" disabled={busy} onClick={() => void change(null)}>
            {t('Remove')}
          </button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            void choose(file)
          }}
        />
      </div>
      {failure ? <p className="error-text">{failure === 'unusable' ? t('That picture could not be used.') : t("Couldn't save")}</p> : null}
    </section>
  )
}
