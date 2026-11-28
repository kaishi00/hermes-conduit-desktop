import { useEffect, useRef } from 'react'
import { cancelFrontDialog } from './dialogs'

/**
 * The mouse's back button, or Alt+Left, goes back one step, as the Back on
 * screen does (Eric, 2026-11-20: every submenu, all at once).
 *
 * A press answers in this order:
 * 1. A dialog or sheet in front closes, as Esc does.
 * 2. The Back button on screen nearest the pointer is pressed: any button
 *    drawing the back icon, or marked `data-back`. So a new page with a Back
 *    gets this with nothing more.
 * 3. Otherwise the newest Back a page registered with `useMouseBack`.
 *
 * Mouse software can send the Back as something else (desktop#755): Windows'
 * browser-backward command or a Mac's swipe back reach the page from the main
 * process (navigateBack.ts), and a Mac's ⌘[ is a Back as in Safari. One press
 * that arrives both ways goes back once.
 */
const backs: Array<{ current: () => void }> = []

/** The handler a page registered most recently. */
export function currentBack(): (() => void) | undefined {
  return backs.at(-1)?.current
}

/** True for the mouse's back button: button 3, as Chromium reports XButton1. */
export function isBackButton(event: { button: number }): boolean {
  return event.button === 3
}

/** What counts as a Back on screen. */
export const BACK_SELECTOR = 'button[data-back], button:has(> svg[data-icon="back"])'
/** A dialog, sheet or overlay in front of the page; each closes on Esc. */
const MODAL_SELECTOR = '[aria-modal="true"], .shortcuts-backdrop, .picture-viewer, .page-full, .model-picker'

interface Node {
  parentElement: Node | null
}

function depth(node: Node | null): number {
  let n = 0
  for (let at = node; at; at = at.parentElement) n++
  return n
}

/** How many ancestors `a` and `b` share: more means closer together on the page. */
function shared(a: Node, b: Node | null): number {
  if (!b) return 0
  const up = new Set<Node>()
  for (let at: Node | null = a; at; at = at.parentElement) up.add(at)
  for (let at: Node | null = b; at; at = at.parentElement) if (up.has(at)) return depth(at)
  return 0
}

/**
 * Of the Backs on screen, the one nearest `near` (where the pointer or focus
 * is): the one sharing the most ancestors with it, and on a tie the last in
 * the page, which is the one drawn over the others.
 */
export function nearestBack<T extends Node>(candidates: T[], near: Node | null): T | undefined {
  let best: T | undefined
  let bestScore = -1
  for (const candidate of candidates) {
    const score = shared(candidate, near)
    if (score >= bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

function shown(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false
  if (element.closest('[inert], [aria-hidden="true"]')) return false
  return element.getClientRects().length > 0
}

function backsOnScreen(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(BACK_SELECTOR)].filter(shown)
}

/** Goes back one step; false when nothing on screen answers. */
function goBack(near: EventTarget | null): boolean {
  const target = near instanceof Element ? near : null
  // A Conduit dialog cancels on its own, so a sheet under it stays open.
  if (cancelFrontDialog()) return true
  const modals = [...document.querySelectorAll<HTMLElement>(MODAL_SELECTOR)].filter(m => m.getClientRects().length > 0)
  const modal = modals.at(-1)
  if (modal) {
    const inside = nearestBack(backsOnScreen(modal), target)
    if (inside) inside.click()
    // The sheets close on Esc; send it where the focus is so the sheet's own handler sees it.
    else (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    return true
  }
  const button = nearestBack(backsOnScreen(document), target)
  if (button) {
    button.click()
    return true
  }
  const back = currentBack()
  if (!back) return false
  back()
  return true
}

/** Whether a back press now would do anything, so Chromium's own default is held back only then. */
function answers(): boolean {
  return !!(document.querySelector(MODAL_SELECTOR) || backsOnScreen(document).length || currentBack())
}

/** How close a press from another path must follow one to be the same press arriving twice. */
export const SAME_PRESS_MS = 500

/** The paths a Back press arrives by. */
export type BackSource = 'button' | 'key' | 'window'

/**
 * Whether a press is the one just answered arriving again by another path: Windows may send a mouse's Back as
 * button 3 and as the browser-backward command both. Two presses by the same path are two presses.
 */
export function samePress(last: { source: BackSource; at: number } | null, source: BackSource, at: number): boolean {
  return !!last && last.source !== source && last.source !== 'key' && source !== 'key' && at - last.at < SAME_PRESS_MS
}

/** Text the keyboard edits, where a Mac's Option+Left moves by a word. */
function editsText(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))
}

let listening = false
/** Listens for the back button and Alt+Left; main.tsx calls it once per window. */
export function installMouseBack(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  const mac = window.conduit?.platform === 'darwin'
  let last: { source: BackSource; at: number } | null = null
  const press = (source: BackSource, near: EventTarget | null): boolean => {
    const at = performance.now()
    if (samePress(last, source, at)) return true
    last = { source, at }
    return goBack(near)
  }
  // Where the pointer last was, for a press from the window, which carries no target.
  let pointer: EventTarget | null = null
  window.addEventListener('pointerover', event => (pointer = event.target), { passive: true })
  // Chromium would navigate on mousedown's default; nothing here has history to go back to.
  window.addEventListener('mousedown', event => {
    if (isBackButton(event) && answers()) event.preventDefault()
  })
  window.addEventListener('mouseup', event => {
    if (!isBackButton(event)) return
    if (press('button', event.target)) event.preventDefault()
  })
  // Alt+Left, the keyboard's Back in a browser, and a Mac's ⌘[. On a Mac, Option+Left in text moves by a word.
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.shiftKey) return
    const altLeft = event.key === 'ArrowLeft' && event.altKey && !event.ctrlKey && !event.metaKey && !(mac && editsText(event.target))
    const cmdBracket = mac && event.key === '[' && event.metaKey && !event.altKey && !event.ctrlKey
    if (!altLeft && !cmdBracket) return
    if (press('key', document.activeElement)) event.preventDefault()
  })
  // Windows' browser-backward command and a Mac's swipe back, from the main process.
  window.conduit?.onNavigateBack?.(() => {
    press('window', pointer ?? document.activeElement)
  })
}

/** While `onBack` is given, a back press with no Back on screen calls it. */
export function useMouseBack(onBack: (() => void) | null | undefined): void {
  const latest = useRef(onBack)
  latest.current = onBack
  const on = !!onBack
  useEffect(() => {
    if (!on) return
    installMouseBack()
    const entry = { current: () => latest.current?.() }
    backs.push(entry)
    return () => {
      const at = backs.lastIndexOf(entry)
      if (at >= 0) backs.splice(at, 1)
    }
  }, [on])
}
