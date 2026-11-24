/**
 * A socket option the system refused, thrown where nothing can catch it.
 * Node's HTTP client sets a socket's type of service as it writes a
 * request, and on some connections (seen on a Mac, desktop#397) the system
 * answers EINVAL. That throws inside the socket's own callback, so it
 * reaches the process as an uncaught exception and Electron puts up its
 * "A JavaScript error occurred in the main process" dialog, though only a
 * packet-priority hint was refused and the request's own timeout or error
 * path still ends it. Such an error is logged and the app carries on; any
 * other uncaught exception gets the dialog it always got.
 */

/** The socket options Node sets on its own, whose refusal the app can live with. */
const SOCKET_OPTION_CALLS = /\b(setTypeOfService|setNoDelay|setKeepAlive)\b/

export function isRefusedSocketOption(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const { code, syscall } = error as { code?: unknown; syscall?: unknown }
  const named = (typeof syscall === 'string' && SOCKET_OPTION_CALLS.test(syscall)) || SOCKET_OPTION_CALLS.test(error.message)
  return named && (code === undefined || code === 'EINVAL' || code === 'ENOPROTOOPT' || code === 'EOPNOTSUPP')
}

export interface UncaughtDeps {
  log: (message: string) => void
  /** Electron's own dialog for an error in the main process. */
  showError: (title: string, body: string) => void
}

/** What the main process does with an exception nothing caught. */
export function handleUncaught(error: unknown, deps: UncaughtDeps): 'ignored' | 'shown' {
  if (isRefusedSocketOption(error)) {
    deps.log(`A socket option was refused, and the app carried on: ${(error as Error).message}`)
    return 'ignored'
  }
  const body = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
  deps.showError('A JavaScript error occurred in the main process', `Uncaught Exception:\n${body}`)
  return 'shown'
}
