/**
 * Gateway and dashboard calls from the window. They go through the
 * preload's outcome calls, because an error thrown across Electron's
 * context bridge arrives with only its message: this one carries the code
 * as well (an HTTP status, or a JSON-RPC error code), which the window reads
 * to tell a missing route from a conflict from a failure.
 */
import type { RpcOutcome } from '../../shared/ipc'

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    /** A gateway refusal's `data.reason`. */
    readonly reason?: string
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

function settled<T>(outcome: RpcOutcome<T>): T {
  if (!outcome.ok) throw new GatewayError(outcome.error, outcome.code, outcome.reason)
  return outcome.result
}

export const gateway = {
  async rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return settled(await window.conduit.rpcOutcome<T>(method, params))
  },
  async http<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return settled(await window.conduit.httpOutcome<T>(method, path, body, timeoutMs))
  }
}

/** A dashboard's calls: this one's, or (`host`) another combined dashboard's, through its kept connection. */
export type DashboardHttp = <T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<T>

/**
 * Another combined dashboard's calls, through its kept connection: any read, and changes only to
 * its scheduled jobs, task board and plugin update (main's KEPT_WRITE_PATHS).
 */
export function keptGateway(host: string) {
  return {
    async rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      return settled(await window.conduit.keptRpc<T>(host, method, params))
    },
    async http<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
      return settled(await window.conduit.keptHttp<T>(host, path, method === 'GET' ? undefined : method, body))
    }
  }
}

/** This dashboard's http (null), or a kept one's. */
export const dashboardHttp = (host: string | null): DashboardHttp => (host ? keptGateway(host).http : (method, path, body) => gateway.http(method, path, body))
