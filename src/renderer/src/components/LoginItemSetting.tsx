import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { LoginItemState } from '@shared/ipc'

/**
 * Settings › Open at Sign-In (issue 442): Conduit tells of a question, a
 * finished turn or a call only while it runs, so this has the computer start
 * it at sign-in, with no window. The switch is the system's own startup
 * entry, read again whenever the window comes back, so turning it off in
 * Task Manager or System Settings shows here. The Microsoft Store's copy is
 * turned on in Windows' Startup apps, so it gets the way there instead; a
 * run from source and Linux get nothing.
 */
export function LoginItemSetting() {
  const [state, setState] = useState<LoginItemState | null>(null)
  useEffect(() => {
    let live = true
    const read = () => void window.conduit.loginItem.state().then(next => live && setState(next), () => undefined)
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [])
  if (!state || state.kind === 'none') return null
  return (
    <>
      <dt>{t('Open at Sign-In')}</dt>
      <dd className="login-item-setting">
        {state.kind === 'switch' ? (
          <>
            <label className="toggle">
              <input type="checkbox" checked={state.on} onChange={e => void window.conduit.loginItem.set(e.target.checked).then(setState, () => undefined)} />
              {t('Open Conduit when I sign in to this computer')}
            </label>
            <p className="meta">{t('It starts in the background, without a window.')}</p>
          </>
        ) : (
          <>
            <p className="meta">{t('Windows opens this copy at sign-in when Conduit is turned on under Startup apps.')}</p>
            <button onClick={() => window.conduit.loginItem.openSystemSettings()}>{t('Open Startup Apps')}</button>
          </>
        )}
      </dd>
    </>
  )
}
