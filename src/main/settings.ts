/**
 * The app's own settings, in the data folder beside connection.json. For
 * now that's the language ("system" follows the computer's, or one of
 * Conduit's languages), the theme ("system", dark or light) and the lock.
 */
import { app, nativeTheme } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from './atomicWrite'
import { join } from 'node:path'
import { LANGUAGES, pickLanguage, setLanguage, type Language } from '../shared/i18n'
import type { AppIconChoice, LanguageChoice, ThemeChoice } from '../shared/ipc'
import { DEFAULT_QUICK_ASK_ACCELERATOR, validAccelerator } from '../shared/accelerator'

const path = () => join(app.getPath('userData'), 'settings.json')

function read(): { language?: unknown; theme?: unknown; lock?: unknown; askHost?: unknown; appIcon?: unknown; quickAsk?: unknown } {
  try {
    return JSON.parse(readFileSync(path(), 'utf8')) as { language?: unknown; theme?: unknown; lock?: unknown; askHost?: unknown }
  } catch {
    return {}
  }
}

export function languageChoice(): LanguageChoice {
  const stored = read().language
  return typeof stored === 'string' && (LANGUAGES as readonly string[]).includes(stored) ? (stored as Language) : 'system'
}

/** The language Conduit speaks: the chosen one, else the computer's. */
export function resolvedLanguage(choice = languageChoice()): Language {
  return choice === 'system' ? pickLanguage(app.getPreferredSystemLanguages()[0] ?? app.getLocale()) : choice
}

/** Saves the choice and switches the main process (tray, menus, errors) to it. */
export function chooseLanguage(choice: LanguageChoice): Language {
  const valid: LanguageChoice = choice === 'system' || (LANGUAGES as readonly string[]).includes(choice) ? choice : 'system'
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), language: valid }, null, 2))
  } catch {
    // Not saved: it still applies until Conduit quits.
  }
  const language = resolvedLanguage(valid)
  setLanguage(language)
  return language
}

const THEMES: readonly ThemeChoice[] = ['system', 'dark', 'light']

/** Settings > Appearance > App icon, as on the phone: the dark icon (the default) or the light one. */
export function appIconChoice(): AppIconChoice {
  return read().appIcon === 'light' ? 'light' : 'dark'
}

export function chooseAppIcon(choice: AppIconChoice): AppIconChoice {
  const valid: AppIconChoice = choice === 'light' ? 'light' : 'dark'
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), appIcon: valid }, null, 2))
  } catch {
    // Not saved: it still applies until Conduit quits.
  }
  return valid
}

export function themeChoice(): ThemeChoice {
  const stored = read().theme
  return THEMES.includes(stored as ThemeChoice) ? (stored as ThemeChoice) : 'system'
}

/** Saves the choice and gives it to Chromium, so the window's `prefers-color-scheme` and Electron's own UI follow it. */
export function chooseTheme(choice: ThemeChoice = themeChoice(), save = true): ThemeChoice {
  const valid: ThemeChoice = THEMES.includes(choice) ? choice : 'system'
  if (save) {
    try {
      writeFileAtomic(path(), JSON.stringify({ ...read(), theme: valid }, null, 2))
    } catch {
      // Not saved: it still applies until Conduit quits.
    }
  }
  nativeTheme.themeSource = valid
  return valid
}

/** Whether Conduit asks for Touch ID or Windows Hello before it opens the saved hosts. */
export const lockOnLaunch = (): boolean => read().lock === true

export function chooseLock(on: boolean): boolean {
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), lock: on }, null, 2))
    return true
  } catch {
    return false
  }
}

/** Ask Which Dashboard at Launch: with two or more hosts saved, a launch lists them instead of opening the last one. */
export const askHostAtLaunch = (): boolean => read().askHost === true

export function chooseAskHost(on: boolean): boolean {
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), askHost: on }, null, 2))
    return true
  } catch {
    return false
  }
}

/** Quick Ask's global shortcut: the one picked in Settings, null when it's turned off, Alt+Space until either. */
export function quickAskAccelerator(): string | null {
  const stored = read().quickAsk
  if (stored === false) return null
  return validAccelerator(stored) ? stored : DEFAULT_QUICK_ASK_ACCELERATOR
}

export function chooseQuickAskAccelerator(accelerator: string | null): boolean {
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), quickAsk: accelerator ?? false }, null, 2))
    return true
  } catch {
    return false
  }
}
