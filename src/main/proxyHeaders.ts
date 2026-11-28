/**
 * Headers for a proxy in front of the dashboard: a Cloudflare Access
 * service token, or whatever a Pangolin, Traefik or nginx check asks for. As
 * on the phone, they go only to the address they were entered for (its
 * scheme, host and port), only over HTTPS and WSS, and never replace a header
 * Conduit sets itself.
 */
import { t } from '../shared/i18n'
import type { Fetch } from './auth'

export type ProxyHeaders = Record<string, string>

/** Headers the transport or Conduit owns; setting them would break the request, not pass a proxy. */
const RESERVED = new Set([
  'host', 'cookie', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'upgrade',
  'keep-alive', 'proxy-connection', 'te', 'trailer', 'expect', 'origin',
  'x-conduit-client', 'x-conduit-platform', 'x-hermes-session-token'
])
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export const CF_ACCESS_ID = 'CF-Access-Client-Id'
export const CF_ACCESS_SECRET = 'CF-Access-Client-Secret'

/** One header's problem, or null when it can be sent. */
export function headerIssue(name: string, value: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return t('Enter a header name.')
  if (!TOKEN.test(trimmed)) return `${trimmed}: ${t('This isn’t a valid header name. Use letters, digits, and dashes.')}`
  if (RESERVED.has(trimmed.toLowerCase())) return `${trimmed}: ${t("Conduit manages this header itself, so it can't be set here.")}`
  if (/[\r\n\0]/.test(value)) return t("Header values can't contain line breaks.")
  return null
}

/**
 * The headers to save from what the sign-in screen sent, or the first
 * problem. Empty names and values are dropped; a Cloudflare ID needs its secret.
 */
export function cleanHeaders(input: ProxyHeaders | undefined): { ok: true; headers?: ProxyHeaders } | { ok: false; error: string } {
  const headers: ProxyHeaders = {}
  for (const [name, value] of Object.entries(input ?? {})) {
    if (!name.trim() && !value.trim()) continue
    const issue = headerIssue(name, value)
    if (issue) return { ok: false, error: issue }
    // Header names don't care about case; the last one wins.
    for (const existing of Object.keys(headers)) if (existing.toLowerCase() === name.trim().toLowerCase()) delete headers[existing]
    headers[name.trim()] = value.trim()
  }
  const has = (name: string) => Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase())
  if (has(CF_ACCESS_ID) !== has(CF_ACCESS_SECRET)) return { ok: false, error: t('A Cloudflare Access service token needs both its client ID and its secret.') }
  return { ok: true, headers: Object.keys(headers).length ? headers : undefined }
}

/** The error for headers entered for an address that isn't https, where they'd never be sent. */
export function httpsIssue(baseUrl: string, headers: ProxyHeaders | undefined): string | null {
  if (!headers || baseUrl.toLowerCase().startsWith('https://')) return null
  return t('Extra headers are only sent over HTTPS. Enter an https:// server address first.')
}

/** Whether `url` may carry the headers entered for `baseUrl`: the same origin, over HTTPS or WSS. */
export function carriesHeaders(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url)
    const base = new URL(baseUrl)
    const secure = target.protocol === 'https:' || target.protocol === 'wss:'
    const scheme = (p: string) => (p === 'wss:' ? 'https:' : p === 'ws:' ? 'http:' : p)
    return secure && base.protocol === 'https:' && scheme(target.protocol) === base.protocol && target.host === base.host
  } catch {
    return false
  }
}

/** Adds the headers that aren't already set, when `url` may carry them. */
export function withProxyHeaders(existing: Record<string, string>, url: string, baseUrl: string, headers: ProxyHeaders | undefined): Record<string, string> {
  if (!headers || !carriesHeaders(url, baseUrl)) return existing
  const merged = { ...existing }
  const taken = new Set(Object.keys(merged).map(k => k.toLowerCase()))
  for (const [name, value] of Object.entries(headers)) if (!taken.has(name.toLowerCase())) merged[name] = value
  return merged
}

/** A fetch that sends the proxy's headers on each request to the dashboard, redirects within it included. */
export function proxyFetch(fetchImpl: Fetch, baseUrl: string, headers: ProxyHeaders | undefined): Fetch {
  if (!headers) return fetchImpl
  return ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!carriesHeaders(url, baseUrl)) return fetchImpl(input, init)
    const current = new Headers(init.headers)
    for (const [name, value] of Object.entries(headers)) if (!current.has(name)) current.set(name, value)
    return fetchImpl(input, { ...init, headers: current })
  }) as Fetch
}
