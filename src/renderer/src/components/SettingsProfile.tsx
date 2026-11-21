import { t } from '@shared/i18n'
import type { MixedTile } from '../state/botOrder'
import type { HostBadge } from '../state/keptHosts'
import { BotAvatar } from './BotsHome'
import { HostBadgeMark } from './CombinedDashboards'
import { Select } from './Select'

/** The tile Settings is editing: this dashboard's profile named `profile`, else its main one. */
export function settingsProfileTile(tiles: readonly MixedTile[], profile: string): MixedTile | null {
  const name = profile.toLowerCase()
  return tiles.find(tile => tile.own && tile.bot.name.toLowerCase() === name) ?? tiles.find(tile => tile.own && tile.bot.isDefault) ?? null
}

/**
 * Settings home's first card, as the phone's Settings opens on the selected
 * profile's group: which profile the Hermes and Voice pages below edit, its
 * face and, in a combined group, its dashboard's badge, in a dropdown that
 * switches to another profile, every combined dashboard's included (another
 * dashboard's switches there and comes back to Settings), as the Chats
 * list's faces do. Edit profile opens Edit Bot for it.
 */
export function SettingsProfileCard({
  tiles,
  profile,
  badgeFor,
  onPick,
  onEditProfile
}: {
  tiles: readonly MixedTile[]
  /** The profile Settings edits (the open chat's); named once the profiles are read, never by its id. */
  profile: string
  badgeFor: (tile: MixedTile) => HostBadge | null
  /** Another profile picked: this dashboard's switches here, another dashboard's switches there. */
  onPick: (tile: MixedTile) => void
  onEditProfile?: () => void
}) {
  const current = settingsProfileTile(tiles, profile)
  const label = (tile: MixedTile) => {
    const badge = badgeFor(tile)
    return (
      <span className="settings-profile-option">
        <BotAvatar bot={tile.bot} size={22} host={tile.own ? undefined : tile.host} />
        <span className="settings-profile-name">{tile.bot.title}</span>
        {badge ? <HostBadgeMark badge={badge} /> : null}
      </span>
    )
  }
  return (
    <section className="settings-group">
      <h2>{current?.bot.title ?? t('Profile')}</h2>
      <dl className="settings-card">
        <dt>{t('Profile')}</dt>
        <dd>
          <div className="settings-profile-row">
            {tiles.length > 1 ? (
              <Select
                className="settings-profile-select"
                value={current?.key ?? ''}
                aria-label={t('Profile')}
                onChange={key => {
                  const tile = tiles.find(each => each.key === key)
                  if (tile && tile !== current) onPick(tile)
                }}
              >
                {tiles.map(tile => (
                  <option key={tile.key} value={tile.key}>
                    {label(tile)}
                  </option>
                ))}
              </Select>
            ) : current ? (
              label(current)
            ) : null}
            <button className="link" disabled={!onEditProfile} onClick={onEditProfile}>
              {t('Edit profile')}
            </button>
          </div>
          <p className="meta settings-caption">
            {t('The Hermes and Voice settings below are this profile’s. Picking another profile switches to it.')}
          </p>
        </dd>
      </dl>
    </section>
  )
}
