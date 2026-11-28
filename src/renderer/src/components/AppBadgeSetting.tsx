import { useState } from 'react'
import { t } from '@shared/i18n'
import { Select } from './Select'
import { BADGE_MODES, badgeModeCaption, badgeModeTitle, loadBadgeMode, saveBadgeMode, type BadgeMode } from '../state/appBadge'

/**
 * Settings › App icon badge (hermes-conduit issue 3458, as the phone's
 * Settings › Notifications › Badge): what the number on Conduit's icon
 * counts. Kept on this computer.
 */
export function AppBadgeSetting() {
  const [mode, setMode] = useState<BadgeMode>(loadBadgeMode)
  return (
    <>
      <dt>{t('App icon badge')}</dt>
      <dd>
        <Select
          value={mode}
          onChange={picked => {
            const next = picked as BadgeMode
            setMode(next)
            saveBadgeMode(next)
          }}
          aria-label={t('App icon badge')}
        >
          {BADGE_MODES.map(choice => (
            <option key={choice} value={choice}>
              {badgeModeTitle(choice)}
            </option>
          ))}
        </Select>
        <p className="meta">{badgeModeCaption(mode)}</p>
      </dd>
    </>
  )
}
