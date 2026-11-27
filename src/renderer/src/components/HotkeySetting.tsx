import { useEffect, useRef, useState } from 'react'
import type { HotkeyName, HotkeyState } from '@shared/ipc'
import { DEFAULT_HOTKEYS, acceleratorFromEvent, acceleratorLabel } from '@shared/accelerator'
import { t } from '@shared/i18n'

/** Each global shortcut's row: its name and what its keys do. */
const ROWS: Record<HotkeyName, { label: () => string; caption: () => string }> = {
  quickAsk: { label: () => t('Quick Ask'), caption: () => t('Opens a small window to ask Hermes from anywhere.') },
  liveCall: {
    label: () => t('Live Call'),
    caption: () => t('Starts a live call with the bot open in Conduit, in a small window over other apps. The tray menu has it too.')
  }
}

/** The row listening for keys: one at a time, so a press picks only its keys and only it ends the listening. */
let listening: HotkeyName | null = null
const LISTEN_EVENT = 'conduit:hotkey-listening'

/**
 * A global shortcut's row in Settings: the keys that open Quick Ask from
 * anywhere (desktop issue 406), or that start a Live call in a small window
 * (Eric, 2026-11-27). Change listens for the next key press, Esc or Cancel
 * keeps the keys as they were, Turn Off leaves it to the tray's menu, and
 * keys another app (or the other shortcut) already has are refused with a
 * line saying so.
 */
export function HotkeySetting({ which }: { which: HotkeyName }) {
  const fallback = DEFAULT_HOTKEYS[which]
  const row = ROWS[which]
  const [shortcut, setShortcut] = useState<HotkeyState | null>(null)
  const [recording, setRecording] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  // The other shortcut, when it's the one that has the keys just refused.
  const [refusedBy, setRefusedBy] = useState<HotkeyName | null>(null)
  const platform = window.conduit.platform
  // Settings left mid-pick: the read made as listening ends lands after the row is gone.
  const mounted = useRef(true)
  useEffect(() => {
    let live = true
    mounted.current = true
    const read = () => void window.conduit.hotkey(which).then(next => live && setShortcut(next))
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
      mounted.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [which])
  const choose = async (accelerator: string | null) => {
    setRecording(false)
    const { changed, takenBy, ...next } = await window.conduit.setHotkey(which, accelerator)
    setShortcut(next)
    setRefused(changed || !accelerator ? null : accelerator)
    setRefusedBy(changed ? null : (takenBy ?? null))
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
    // The window hidden, minimized or left for another app stops listening, so the shortcuts' keys and the Mac's menu don't stay aside behind it.
    const onBlur = () => setRecording(false)
    // Another row's Change: this one stops, leaving the listening to it.
    const onOther = (event: Event) => {
      if ((event as CustomEvent<HotkeyName>).detail !== which) setRecording(false)
    }
    listening = which
    window.dispatchEvent(new CustomEvent<HotkeyName>(LISTEN_EVENT, { detail: which }))
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener(LISTEN_EVENT, onOther)
    window.conduit.setHotkeyRecording(true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener(LISTEN_EVENT, onOther)
      // Another row's Change took the listening: both shortcuts stay aside for it, so asking now would read this
      // row's keys as another app's. It's asked again when the window comes back.
      if (listening !== which) return
      listening = null
      window.conduit.setHotkeyRecording(false)
      // The keys were asked for again as listening ended: another app may have let go of them since, or taken them.
      void window.conduit.hotkey(which).then(next => mounted.current && setShortcut(next))
    }
  }, [recording, platform, which])
  if (!shortcut) return null
  const { accelerator, registered } = shortcut
  // The keys just refused, or the saved ones another app had first at launch.
  const taken = refused ?? (accelerator && !registered ? accelerator : null)
  return (
    <>
      <dt>{row.label()}</dt>
      <dd className="hotkey-setting">
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
            {/* Also with the default keys another app had first: Reset asks for them again. A shortcut off
                by default has Turn Off instead. */}
            {fallback && (accelerator !== fallback || !registered) ? (
              <button className="link" onClick={() => void choose(fallback)}>
                {t('Reset')}
              </button>
            ) : !fallback && accelerator ? (
              <button className="link" onClick={() => void choose(null)}>
                {t('Turn Off')}
              </button>
            ) : null}
          </>
        )}
        <p className="meta">{row.caption()}</p>
        {taken ? (
          <p className="meta hotkey-taken" role="alert">
            {refused && refusedBy
              ? t('{name} already uses {shortcut}. Pick a different one.', { name: ROWS[refusedBy].label(), shortcut: acceleratorLabel(taken, platform) })
              : t('Another app is using {shortcut}. Pick a different one.', { shortcut: acceleratorLabel(taken, platform) })}
          </p>
        ) : null}
      </dd>
    </>
  )
}
