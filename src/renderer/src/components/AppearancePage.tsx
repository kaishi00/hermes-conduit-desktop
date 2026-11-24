import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { ThemeChoice } from '@shared/ipc'
import {
  ACCENTS,
  CHAT_FONTS,
  accentTitle,
  applyAccent,
  applyChatFont,
  chatFontTitle,
  fontFamily,
  readAccent,
  readChatFont,
  swatchColor,
  markColor,
  isHex,
  type Accent,
  type ChatFontStyle
} from '../state/appearance'
import { sectionTitle } from '../state/shortcuts'
import type { RailSection } from '@shared/ipc'
import { LAUNCH_CHOICES, TABS_SYNC_KEY, keepTabs, keptTabs, launchPage, withFirstTab, type LaunchPage } from '../state/launchTab'
import { DEVICE_NAME, PREFS_PATH, installationId } from '../state/pinnedOrder'
import { gateway } from '../gateway'
import { Icon } from './icons'
import { APP_ICONS, appIconUrl, chooseAppIcon, useAppIcon } from '../state/appIcon'
import { useMouseBack } from '../state/mouseBack'

const pageTitle = (page: LaunchPage) =>
  page === 'bots' ? t('Bots') : page === 'chats' ? t('Chats') : page === 'tasks' ? t('Tasks') : page === 'pulse' ? t('Pulse') : t('Artifacts')

const THEMES: ThemeChoice[] = ['dark', 'light', 'system']
const themeTitle = (theme: ThemeChoice) => (theme === 'dark' ? t('Dark') : theme === 'light' ? t('Light') : t('System'))

function useDark(): boolean {
  const query = () => window.matchMedia('(prefers-color-scheme: dark)')
  const [dark, setDark] = useState(() => query().matches)
  useEffect(() => {
    const media = query()
    const changed = () => setDark(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  return dark
}

const LAST_CUSTOM_KEY = 'conduit.accentLastCustomColor'
/** The phone's first pick for a color of your own. */
const FIRST_PICK = '#E36140'
function readLastCustom(): string {
  try {
    const value = localStorage.getItem(LAST_CUSTOM_KEY)
    return value && isHex(value) ? value : FIRST_PICK
  } catch {
    return FIRST_PICK
  }
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

/**
 * Settings > Appearance, after the phone's: theme, accent color and chat text
 * style, all kept on this computer, and the page Conduit opens on, kept with
 * the dashboard as the first tab of the phone's layout (launchTab.ts).
 */
export function AppearancePage({
  host,
  onBack,
  onOpensOn,
  opensHere
}: {
  host: string
  onBack: () => void
  /** A page was chosen to open on: the window pins its section in the rail, where an unpinned one wouldn't open. */
  onOpensOn?: (page: LaunchPage) => void
  /** The section a launch on `page` opens instead on this computer, when the rail has `page` unpinned; null when `page` opens. */
  opensHere?: (page: LaunchPage) => RailSection | null
}) {
  useMouseBack(onBack)
  const [opensOn, setOpensOn] = useState<LaunchPage>(() => launchPage(host))
  const [openFailed, setOpenFailed] = useState(false)
  const opensInstead = opensHere?.(opensOn) ?? null
  const chooseOpensOn = (page: LaunchPage) => {
    const tabs = withFirstTab(keptTabs(host), page)
    setOpensOn(page)
    setOpenFailed(false)
    onOpensOn?.(page)
    keepTabs(host, tabs)
    gateway
      .http('PUT', PREFS_PATH, { installation_id: installationId(), device: DEVICE_NAME, changes: { [TABS_SYNC_KEY]: tabs } })
      .catch(() => setOpenFailed(true))
  }
  const [theme, setTheme] = useState<ThemeChoice>(window.conduit.theme)
  const [accent, setAccent] = useState<Accent>(readAccent)
  const [lastCustom, setLastCustom] = useState(readLastCustom)
  const [font, setFont] = useState<ChatFontStyle>(readChatFont)
  const dark = useDark()
  const icon = useAppIcon()

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Appearance')}</h1>
      </div>

      {host ? (
        <section className="pset-section">
          <h2>{t('Open on')}</h2>
          <p className="meta">{t('The page Conduit shows when it starts. It’s kept with this dashboard, so a phone signed in to it opens on the same tab.')}</p>
          <div className="segmented" role="group" aria-label={t('Open on')}>
            {LAUNCH_CHOICES.map(page => (
              <button key={page} aria-pressed={opensOn === page} onClick={() => chooseOpensOn(page)}>
                {pageTitle(page)}
              </button>
            ))}
          </div>
          {opensInstead ? (
            <p className="meta">
              {t('{page} is unpinned from the rail on this computer, so Conduit opens on {other} here.', {
                page: pageTitle(opensOn),
                other: sectionTitle(opensInstead)
              })}
            </p>
          ) : null}
          {openFailed ? <p className="meta warns">{t('Kept on this computer. Hermes didn’t take it, so other devices still open where they did.')}</p> : null}
        </section>
      ) : null}

      <section className="pset-section">
        <h2>{t('Theme')}</h2>
        <p className="meta">{t('Choose how Conduit appears across this device.')}</p>
        <div className="segmented" role="group" aria-label={t('Theme')}>
          {THEMES.map(choice => (
            <button
              key={choice}
              aria-pressed={theme === choice}
              onClick={() => {
                setTheme(choice)
                window.conduit.setTheme(choice)
              }}
            >
              {themeTitle(choice)}
            </button>
          ))}
        </div>
      </section>

      <section className="pset-section">
        <h2>{t('App icon')}</h2>
        <p className="meta">
          {window.conduit.platform === 'darwin'
            ? t('Choose the icon shown in the Dock and the title bar.')
            : t('Choose the icon shown on the taskbar, in the notification area and in the title bar.')}
        </p>
        <div className="app-icon-choices" role="group" aria-label={t('App icon')}>
          {APP_ICONS.map(choice => (
            <button key={choice} className="app-icon-choice" aria-pressed={icon === choice} onClick={() => chooseAppIcon(choice)}>
              <img src={appIconUrl(choice)} alt="" draggable={false} />
              <span>
                {choice === 'light' ? t('Light') : t('Dark')}
                {icon === choice ? <Icon name="check" /> : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="pset-section">
        <h2>{t('Accent color')}</h2>
        <p className="meta">{t('Choose the color of your own messages and Conduit’s highlights.')}</p>
        <div className="accent-swatches" role="radiogroup" aria-label={t('Accent color')}>
          {ACCENTS.map(choice => {
            const fill = swatchColor(choice, dark)
            const selected = accent === choice
            return (
              <button
                key={choice}
                role="radio"
                aria-checked={selected}
                aria-label={accentTitle(choice)}
                title={accentTitle(choice)}
                className={selected ? 'accent-swatch on' : 'accent-swatch'}
                style={{ background: fill, color: markColor(rgb(fill)) }}
                onClick={() => {
                  setAccent(choice)
                  applyAccent(choice)
                }}
              >
                {selected ? <Icon name="check" /> : null}
              </button>
            )
          })}
          <label
            className={isHex(accent) ? 'accent-swatch custom on' : 'accent-swatch custom'}
            title={t('Custom color')}
            style={isHex(accent) ? { background: accent } : undefined}
          >
            <input
              type="color"
              aria-label={t('Custom color')}
              value={(isHex(accent) ? accent : lastCustom).toLowerCase()}
              onChange={e => {
                const pick = e.target.value.toUpperCase() as Accent
                setAccent(pick)
                setLastCustom(pick)
                applyAccent(pick)
                try {
                  localStorage.setItem(LAST_CUSTOM_KEY, pick)
                } catch {
                  // The first pick next time.
                }
              }}
            />
          </label>
        </div>
        {isHex(accent) ? (
          <>
            <p className="meta">{t('Your color is adjusted where needed so text stays readable in light and dark mode.')}</p>
            <div className="accent-preview">
              <span className="accent-preview-highlight">{t('Highlights')}</span>
              <span className="accent-preview-bubble">{t('Your messages')}</span>
            </div>
          </>
        ) : null}
      </section>

      <section className="pset-section">
        <h2>{t('Chat text style')}</h2>
        <p className="meta">{t('The typeface of messages in a chat. Code stays monospaced, and the rest of the interface keeps the system font.')}</p>
        <div className="segmented" role="group" aria-label={t('Chat text style')}>
          {CHAT_FONTS.map(style => (
            <button
              key={style}
              aria-pressed={font === style}
              onClick={() => {
                setFont(style)
                applyChatFont(style)
              }}
            >
              {chatFontTitle(style)}
            </button>
          ))}
        </div>
        <p className="chat-font-preview" style={{ fontFamily: fontFamily(font) ?? undefined }}>
          {t('Hermes replies like this.')}
        </p>
      </section>
    </div>
  )
}
