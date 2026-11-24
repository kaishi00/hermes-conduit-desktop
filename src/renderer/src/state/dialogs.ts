/**
 * Conduit's own dialogs in place of the system's confirm, alert and prompt
 * boxes, which draw in the operating system's style (Eric, 2026-11-20):
 * `ask` for OK or Cancel, `tell` for a notice and `askText` for a name.
 * Each returns a promise; `DialogHost` (components/Dialogs.tsx) draws the
 * one in front, and the rest wait their turn.
 *
 * The text keeps the shape the system boxes took: its first paragraph is the
 * heading and the rest, after a blank line, the body.
 */
import { useSyncExternalStore } from 'react'

export interface DialogOptions {
  /** The confirm button's label; OK when left out. */
  confirm?: string
  /** The confirm button's label for a step that removes or ends something, in the warning color. */
  destructive?: boolean
  /** askText's longest answer. */
  maxLength?: number
  /**
   * Cancels the dialog when it aborts, as Esc would: for a question whose
   * asker can leave the screen while it's up, so no dialog outlives the
   * thing it asks about.
   */
  signal?: AbortSignal
}

export type Dialog =
  | { id: number; kind: 'ask'; title: string; body: string[]; options: DialogOptions; settle: (ok: boolean) => void }
  | { id: number; kind: 'tell'; title: string; body: string[]; options: DialogOptions; settle: () => void }
  | { id: number; kind: 'text'; title: string; body: string[]; initial: string; options: DialogOptions; settle: (text: string | null) => void }

let queue: Dialog[] = []
let ids = 0
const listeners = new Set<() => void>()

function publish(next: Dialog[]) {
  queue = next
  for (const listener of listeners) listener()
}

/** Splits "Heading\n\nBody\n\nMore" into its heading and body paragraphs. */
export function dialogText(message: string): { title: string; body: string[] } {
  const parts = message
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)
  return { title: parts[0] ?? '', body: parts.slice(1) }
}

function open<T>(cancelled: T, signal: AbortSignal | undefined, make: (id: number, settle: (value: T) => void) => Dialog): Promise<T> {
  return new Promise<T>(resolve => {
    // Its asker has already gone: nothing is drawn.
    if (signal?.aborted) return resolve(cancelled)
    const id = ++ids
    const onAbort = () => settle(cancelled)
    const settle = (value: T) => {
      signal?.removeEventListener('abort', onAbort)
      publish(queue.filter(dialog => dialog.id !== id))
      resolve(value)
    }
    signal?.addEventListener('abort', onAbort)
    publish([...queue, make(id, settle)])
  })
}

/** OK or Cancel: true for OK. */
export const ask = (message: string, options: DialogOptions = {}) =>
  open<boolean>(false, options.signal, (id, settle) => ({ id, kind: 'ask', ...dialogText(message), options, settle }))

/** A notice with OK. */
export const tell = (message: string, options: DialogOptions = {}) =>
  open<void>(undefined, options.signal, (id, settle) => ({ id, kind: 'tell', ...dialogText(message), options, settle: () => settle(undefined) }))

/** A line of text, or null when cancelled. */
export const askText = (message: string, initial = '', options: DialogOptions = {}) =>
  open<string | null>(null, options.signal, (id, settle) => ({ id, kind: 'text', ...dialogText(message), initial, options, settle }))

/** The dialog in front, if any. */
export function useFrontDialog(): Dialog | null {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => queue[0] ?? null
  )
}

/** Cancels the dialog in front, as Esc does; false when none is open. */
export function cancelFrontDialog(): boolean {
  const dialog = queue[0]
  if (!dialog) return false
  if (dialog.kind === 'ask') dialog.settle(false)
  else if (dialog.kind === 'text') dialog.settle(null)
  else dialog.settle()
  return true
}

/** Cancels every open dialog (tests, a window that's closing). */
export function dismissAllDialogs() {
  for (const dialog of [...queue]) {
    if (dialog.kind === 'ask') dialog.settle(false)
    else if (dialog.kind === 'text') dialog.settle(null)
    else dialog.settle()
  }
}
