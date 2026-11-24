import { useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import { shortcutGroups, type GoTo } from '../state/shortcuts'
import { inSelectMenu } from './Select'

/** ⌘/ (Ctrl+/) and Settings > Keyboard: every shortcut, grouped as the phone's sheet is. Esc, Done or ⌘/ again closes it. */
export function ShortcutsSheet({ sections, onClose }: { sections?: readonly GoTo[]; onClose: () => void }) {
  const done = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    done.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event)) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const groups = shortcutGroups(window.conduit.platform === 'darwin', sections)
  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-sheet" role="dialog" aria-modal="true" aria-label={t('Keyboard Shortcuts')} onClick={e => e.stopPropagation()}>
        <header>
          <h2>{t('Keyboard Shortcuts')}</h2>
          <span className="spacer" />
          <button ref={done} className="link" onClick={onClose}>
            {t('Done')}
          </button>
        </header>
        {groups.map((group, i) => (
          <section key={i}>
            {group.title ? <h3 className="meta">{group.title}</h3> : null}
            <ul>
              {group.rows.map(row => (
                <li key={row.title}>
                  <span>{row.title}</span>
                  <span className="spacer" />
                  {row.keys.map(key => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
