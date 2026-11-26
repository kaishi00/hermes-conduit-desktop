import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'

/**
 * Settings › Menu Bar, on the Mac (desktop#586): closing the window already
 * leaves Conduit in the menu bar, with Quick Ask and notifications. This
 * takes its Dock icon and ⌘-Tab entry away too while no window is open; they
 * come back with the window. Windows and Linux get nothing: their tray icon
 * is all that's left once the window closes.
 */
export function HideDockSetting() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void window.conduit.hideDock().then(next => live && setOn(next), () => undefined)
    return () => {
      live = false
    }
  }, [])
  if (on === null) return null
  return (
    <>
      <dt>{t('Menu Bar')}</dt>
      <dd>
        <label className="toggle">
          <input type="checkbox" checked={on} onChange={e => void window.conduit.setHideDock(e.target.checked).then(next => next !== null && setOn(next), () => undefined)} />
          {t('Hide from the Dock when the window is closed')}
        </label>
        <p className="meta">{t('Conduit stays in the menu bar, with Quick Ask and notifications. The Dock icon comes back when a window opens.')}</p>
      </dd>
    </>
  )
}
