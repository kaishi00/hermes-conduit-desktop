import { useEffect, useRef, useState } from 'react'
import type { QuickAskShortcut } from '@shared/ipc'
import { DEFAULT_QUICK_ASK_ACCELERATOR, acceleratorFromEvent, acceleratorLabel } from '@shared/accelerator'
import { t } from '@shared/i18n'

/**
 * Settings > Quick Ask: the keys that open it from anywhere (desktop issue
 * 406). Change listens for the next key press, Esc or Cancel keeps the keys
 * as they were, Turn Off leaves Quick Ask to the tray's menu, and keys
 * another app already has are refused with a line saying so.
 */
export function QuickAskShortcutSetting() {
  const [shortcut, setShortcut] = useState<QuickAskShortcut | null>(null)
  const [recording, setRecording] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const platform = window.conduit.platform
  // Settings left mid-pick: the read made as listening ends lands after the row is gone.
  const mounted = useRef(true)
  useEffect(() => {
    let live = true
<<<<<<< HEAD
    mounted.current = true
=======
>>>>>>> 83b9be676b5312367bf7b937e7adfc3d9175c6fd
    const read = () => void window.conduit.quickAskShortcut().then(next => live && setShortcut(next))
    read()
    // Back from another app, which may have let go of the keys it held: the line about them is
    // read again rather than kept until the next Change (desktop#520).
    const onFocus = () => {
      setRefused(null)
      read()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
<<<<<<< HEAD
      mounted.current = false
=======
>>>>>>> 83b9be676b5312367bf7b937e7adfc3d9175c6fd
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  const choose = async (accelerator: string | null) => {
    setRecording(false)
    const { changed, ...next } = await window.conduit.setQuickAskShortcut(accelerator)
    setShortcut(next)
    setRefused(changed || !accelerator ? null : accelerator)
  }
  useEffect(() => {
    if (!recording) return
    // Before the window's own shortcuts, so Ctrl+N here is keys to pick, not a new chat.
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      const accelerator = acceleratorFromEvent(event, platform === 'darwin')
      if (accelerator) void choose(accelerator)
    }
    // The window hidden, minimized or left for another app stops listening, so Quick Ask's keys and the Mac's menu don't stay aside behind it.
    const onBlur = () => setRecording(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    window.conduit.setQuickAskRecording(true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      window.conduit.setQuickAskRecording(false)
      // The keys were asked for again as listening ended: another app may have let go of them since, or taken them.
      void window.conduit.quickAskShortcut().then(next => mounted.current && setShortcut(next))
    }
  }, [recording, platform])
  if (!shortcut) return null
  const { accelerator, registered } = shortcut
  // The keys just refused, or the saved ones another app had first at launch.
  const taken = refused ?? (accelerator && !registered ? accelerator : null)
  return (
    <>
      <dt>{t('Quick Ask')}</dt>
      <dd className="quick-ask-shortcut">
        {recording ? (
          <>
            <span className="meta" role="status">
              {t('Press a shortcut…')}
            </span>
            <button className="link" onClick={() => setRecording(false)}>
              {t('Cancel')}
            </button>
            {accelerator ? (
              <button className="link" onClick={() => void choose(null)}>
                {t('Turn Off')}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {accelerator ? <kbd>{acceleratorLabel(accelerator, platform)}</kbd> : <span>{t('Off')}</span>}
            <button
              className="link"
              onClick={() => {
                setRefused(null)
                setRecording(true)
              }}
            >
              {t('Change')}
            </button>
            {/* Also with the default keys another app had first: Reset asks for them again. */}
            {accelerator !== DEFAULT_QUICK_ASK_ACCELERATOR || !registered ? (
              <button className="link" onClick={() => void choose(DEFAULT_QUICK_ASK_ACCELERATOR)}>
                {t('Reset')}
              </button>
            ) : null}
          </>
        )}
        <p className="meta">{t('Opens a small window to ask Hermes from anywhere.')}</p>
        {taken ? (
          <p className="meta quick-ask-taken" role="alert">
            {t('Another app is using {shortcut}. Pick a different one.', { shortcut: acceleratorLabel(taken, platform) })}
          </p>
        ) : null}
      </dd>
    </>
  )
}
