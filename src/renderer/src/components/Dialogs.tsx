import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { useFrontDialog, type Dialog } from '../state/dialogs'

/** Draws the dialog in front (state/dialogs.ts) as a Conduit sheet: Enter confirms, Esc or a click outside cancels. */
export function DialogHost() {
  const dialog = useFrontDialog()
  return dialog ? <DialogSheet key={dialog.id} dialog={dialog} /> : null
}

function cancel(dialog: Dialog) {
  if (dialog.kind === 'ask') dialog.settle(false)
  else if (dialog.kind === 'text') dialog.settle(null)
  else dialog.settle()
}

function DialogSheet({ dialog }: { dialog: Dialog }) {
  const [text, setText] = useState(dialog.kind === 'text' ? dialog.initial : '')
  const confirmButton = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const confirm = () => {
    if (dialog.kind === 'ask') dialog.settle(true)
    else if (dialog.kind === 'text') dialog.settle(text)
    else dialog.settle()
  }

  useEffect(() => {
    if (field.current) {
      field.current.focus()
      field.current.select()
    } else confirmButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancel(dialog)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog])

  const label = dialog.options.confirm ?? t('OK')
  return (
    // Its presses stay its own, so a popover under it (the Model picker) doesn't take one as a click outside.
    <div className="shortcuts-backdrop dialog-backdrop" onMouseDown={e => e.stopPropagation()} onClick={() => cancel(dialog)}>
      <div
        className="shortcuts-sheet consent-sheet conduit-dialog"
        role={dialog.kind === 'tell' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`dialog-${dialog.id}`}
        onClick={e => e.stopPropagation()}
      >
        <h2 id={`dialog-${dialog.id}`}>{dialog.title}</h2>
        {dialog.body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        {dialog.kind === 'text' ? (
          <input
            ref={field}
            className="conduit-dialog-field"
            value={text}
            maxLength={dialog.options.maxLength}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirm()
              }
            }}
          />
        ) : null}
        <div className="consent-actions">
          {dialog.kind !== 'tell' ? (
            <button className="secondary" onClick={() => cancel(dialog)}>
              {t('Cancel')}
            </button>
          ) : null}
          <button ref={confirmButton} className={dialog.options.destructive ? 'primary destructive' : 'primary'} onClick={confirm}>
            {label}
          </button>
        </div>
      </div>
    </div>
  )
}
