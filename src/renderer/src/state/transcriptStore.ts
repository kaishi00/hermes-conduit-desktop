/**
 * The open chat's transcript, held outside React state (desktop#212). A
 * streaming reply changes it once a frame; a component that draws the whole
 * transcript subscribes to all of it (`useTranscript`), while App and the
 * chat window read only what they show (`useTranscriptValue`: whether a turn
 * runs, its plan, a count), so they don't run once a frame while a reply
 * streams. Reads in a callback take `get()`, the transcript as it is now.
 */
import { useSyncExternalStore } from 'react'
import type { TranscriptState } from './transcript'

export class TranscriptStore {
  private state: TranscriptState
  private readonly listeners = new Set<() => void>()

  constructor(initial: TranscriptState) {
    this.state = initial
  }

  get = (): TranscriptState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(next: TranscriptState): void {
    if (next === this.state) return
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }
}

/** The whole transcript: the component runs on every change. */
export function useTranscript(store: TranscriptStore): TranscriptState {
  return useSyncExternalStore(store.subscribe, store.get)
}

/**
 * A value read from the transcript: the component runs only when it
 * changes. `read` must answer a primitive, or a part of the state as it is
 * (its items, its plan), never a new object or list made on each call.
 */
export function useTranscriptValue<T>(store: TranscriptStore, read: (state: TranscriptState) => T): T {
  return useSyncExternalStore(store.subscribe, () => {
    const value = read(store.get())
    // A read that makes a new object each time would draw over and over: say so while developing.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV && !Object.is(value, read(store.get()))) console.error('useTranscriptValue: the read must answer a primitive or a part of the state, not a new object.')
    return value
  })
}
