/** A chat window's Keep on Top pin before the window answered (issue 666). */
export type PinDecision = {
  on: boolean
  disabled: boolean
  next: boolean | null
}

/**
 * `state` is null until `chatWindowOnTop()` resolves. A click before then must not
 * send a setting: a window that opened kept on top is already in the state it asks for.
 */
export function pinDecision(state: boolean | null): PinDecision {
  return {
    on: state === true,
    disabled: state === null,
    next: state === null ? null : !state
  }
}
