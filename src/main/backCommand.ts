/**
 * Whether a window event is a Back: Windows' browser-backward app command (a
 * mouse's Back button, as mouse software sends it), or a Mac's swipe left,
 * which Electron names for the swipe back that Safari and Chrome go back on.
 */
export function isBackCommand(event: 'app-command' | 'swipe', value: string): boolean {
  return event === 'app-command' ? value === 'browser-backward' : value === 'left'
}
