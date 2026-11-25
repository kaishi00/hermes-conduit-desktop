import { useRef, useState, type FormEvent } from 'react'
import type { HostSummary, SignInMethod, TroubleshootingTopic } from '@shared/ipc'
import { t } from '@shared/i18n'
import { ServerCertificate } from './ServerCertificate'
import { PairWithPhone } from './PairWithPhone'
import { Troubleshooting } from './Troubleshooting'
import { composerDrafts } from '../state/composerDrafts'
import { copyHostData, finishHostMove, undoHostCopy } from '../state/hostData'
import { switchEndingCall } from '../state/callSwitch'
import { hostName } from '../state/hostNames'
import { useMouseBack } from '../state/mouseBack'
import { Icon } from './icons'

/** "Name: value" lines into headers, or the first line that isn't one. */
export function parseHeaderLines(text: string): { ok: true; headers: Record<string, string> } | { ok: false; line: string } {
  const headers: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon <= 0) return { ok: false, line }
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { ok: true, headers }
}

const methodLabels = (): Record<SignInMethod, string> => ({
  password: t('User name and password'),
  oidc: t('Browser'),
  browser: t('Sign-in page'),
  token: t('Session token'),
  open: t('No sign-in')
})

/** Connect to a Hermes dashboard: its address first, then whatever sign-in it asks for. */
/** `onCancel`, when adding another host, goes back to the one that's open. */
/** `editing`: Edit Connection for the open host, its address and user name filled in; `onDone` after it signs in. */
/**
 * `repairing`, with `editing`: the phone's Repair Connection, for a host that
 * can't connect. It changes that host in its place, as Edit Connection does;
 * an address saved as another dashboard offers to switch to it instead.
 */
export function SignIn({
  notice,
  onCancel,
  editing,
  repairing,
  onDone
}: {
  notice?: string
  onCancel?: () => void
  editing?: HostSummary
  repairing?: boolean
  onDone?: () => void
}) {
  const [address, setAddress] = useState(editing?.url ?? '')
  const [url, setUrl] = useState<string | null>(null)
  const [methods, setMethods] = useState<SignInMethod[]>([])
  const [method, setMethod] = useState<SignInMethod>('password')
  const [username, setUsername] = useState(editing?.username ?? '')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const attempt = useRef(0)
  useMouseBack(busy ? undefined : onCancel)
  const [error, setError] = useState<string | null>(notice ?? null)
  /** Repair's address saved as another dashboard: Switch goes there. */
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const [proxyOpen, setProxyOpen] = useState(false)
  const [accessId, setAccessId] = useState('')
  const [accessSecret, setAccessSecret] = useState('')
  const [otherHeaders, setOtherHeaders] = useState('')
  /** An address whose certificate this computer doesn't trust: Install this server's certificate. */
  const [untrusted, setUntrusted] = useState<string | null>(null)
  /** The troubleshooting page the last failure points to, and the one open. */
  const [help, setHelp] = useState<TroubleshootingTopic | null>(null)
  const [troubleshooting, setTroubleshooting] = useState<TroubleshootingTopic | null>(null)
  /** An address a sign-in page answered for (a login proxy in front of the dashboard): Open Sign-In Page signs in there, in Conduit's window. */
  const [signInPage, setSignInPage] = useState<string | null>(null)

  /** The proxy's headers as typed, or an error to show. */
  function proxyHeaders(): { ok: true; headers?: Record<string, string> } | { ok: false; error: string } {
    const parsed = parseHeaderLines(otherHeaders)
    if (!parsed.ok) return { ok: false, error: t('Write each header on its own line as Name: value. This one isn’t: {line}', { line: parsed.line }) }
    const headers = { ...parsed.headers }
    if (accessId.trim() || accessSecret.trim()) {
      headers['CF-Access-Client-Id'] = accessId.trim()
      headers['CF-Access-Client-Secret'] = accessSecret.trim()
    }
    return { ok: true, headers: Object.keys(headers).length ? headers : undefined }
  }

  async function findHost(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setSavedAs(null)
    setUntrusted(null)
    setHelp(null)
    setSignInPage(null)
    const proxy = proxyHeaders()
    if (!proxy.ok) {
      setBusy(false)
      setError(proxy.error)
      return
    }
    const probe = await window.conduit.probe(address, proxy.headers)
    setBusy(false)
    if (!probe.ok) {
      setError(probe.error)
      setUntrusted(probe.untrusted ?? null)
      setHelp(probe.help ?? null)
      setSignInPage(probe.browser ?? null)
      return
    }
    setUrl(probe.url)
    setMethods(probe.methods)
    setMethod(editing && probe.methods.includes(editing.method) ? editing.method : (probe.methods[0] ?? 'password'))
    // An open dashboard needs nothing more.
    if (probe.methods.length === 1 && probe.methods[0] === 'open') {
      await signIn(probe.url, 'open')
    }
  }

  async function signIn(target: string, chosen: SignInMethod) {
    const currentAttempt = ++attempt.current
    setBusy(true)
    setError(null)
    setSavedAs(null)
    const proxy = proxyHeaders()
    const headers = proxy.ok ? proxy.headers : undefined
    if (editing) {
      // What this computer keeps for the host goes to its new address before that window opens.
      const copied = copyHostData(editing.url, target)
      const result = await window.conduit.editHost(editing.url, { url: target, method: chosen, username, password, token, headers })
      if (currentAttempt !== attempt.current) {
        undoHostCopy(copied)
        return
      }
      setBusy(false)
      if (!result.ok) {
        undoHostCopy(copied)
        if (repairing && result.savedAs) {
          setSavedAs(result.savedAs)
          setError(t("This address is your saved dashboard “{name}”. Repair won't change its sign-in; switch to it instead.", { name: hostName(result.savedAs) }))
        } else setError(result.error)
        return
      }
      finishHostMove(editing.url, result.url)
      composerDrafts.moveHost(editing.url, result.url)
      onDone?.()
      return
    }
    const result = await window.conduit.signIn({ url: target, method: chosen, username, password, token, headers })
    if (currentAttempt !== attempt.current) return
    setBusy(false)
    if (!result.ok) setError(result.error)
  }

  const switchToSaved = savedAs ? (
    <button className="secondary" type="button" onClick={() => void switchEndingCall(hostName(savedAs)).then(ok => ok && window.conduit.switchHost(savedAs))}>
      {t('Switch')}
    </button>
  ) : null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (url) void signIn(url, method)
  }

  if (pairing) {
    return (
      <div className="signin">
        <PairWithPhone onBack={() => setPairing(false)} />
      </div>
    )
  }

  if (troubleshooting) {
    return (
      <div className="signin">
        <Troubleshooting topic={troubleshooting} onTopic={setTroubleshooting} untrusted={untrusted} onBack={() => setTroubleshooting(null)} />
      </div>
    )
  }

  return (
    <div className="signin">
      {url === null ? (
        <form className="signin-card" onSubmit={findHost}>
          {onCancel ? (
            <button className="signin-back" type="button" onClick={onCancel}>
              <Icon name="back" />
              {t('Back')}
            </button>
          ) : null}
          <h1>{repairing ? t('Repair Connection') : editing ? t('Connection Setup') : onCancel ? t('Add another Hermes') : t('Connect to Hermes')}</h1>
          <p>
            {editing
              ? t('Change this dashboard’s address or how Conduit signs in. Conduit signs in again before it keeps the change, and leaves the connection as it was if that fails.')
              : t('Enter the address of your Hermes dashboard, the same one the Conduit app on your phone uses.')}
          </p>
          <label className="field">
            {t('Dashboard address')}
            <input
              autoFocus
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder={t('hermes.example.com or 192.168.1.20:9119')}
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
          {proxyOpen ? (
            <fieldset className="proxy-fields">
              <legend>{t('Proxy sign-in')}</legend>
              <p className="hint">{t('For a dashboard behind Cloudflare Access or another proxy that checks headers. They go only to this address, over HTTPS.')}</p>
              <label className="field">
                {t('Cloudflare Access client ID')}
                <input value={accessId} onChange={e => setAccessId(e.target.value)} spellCheck={false} autoCapitalize="off" />
              </label>
              <label className="field">
                {t('Cloudflare Access client secret')}
                <input type="password" value={accessSecret} onChange={e => setAccessSecret(e.target.value)} />
              </label>
              <label className="field">
                {t('Other headers')}
                <textarea
                  rows={2}
                  value={otherHeaders}
                  onChange={e => setOtherHeaders(e.target.value)}
                  placeholder="X-Pangolin-Token: …"
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </label>
            </fieldset>
          ) : null}
          {error ? <div className="error-text" role="alert">{error}</div> : null}
          {switchToSaved}
          {untrusted ? <ServerCertificate url={untrusted} /> : null}
          {error && signInPage ? (
            <button className="secondary" type="button" disabled={busy} onClick={() => void signIn(signInPage, 'browser')}>
              {t('Open Sign-In Page')}
            </button>
          ) : null}
          {error && help ? (
            <button className="link-button" type="button" onClick={() => setTroubleshooting(help)}>
              {t('Troubleshoot Connection')}
            </button>
          ) : null}
          <button className="primary" type="submit" disabled={busy || !address.trim()}>
            {busy ? t('Connecting…') : t('Continue')}
          </button>
          {!proxyOpen ? (
            <button className="link-button proxy-toggle" type="button" onClick={() => setProxyOpen(true)}>
              {t('Behind Cloudflare Access or another proxy?')}
            </button>
          ) : null}
          {editing ? (
            proxyOpen ? <p className="hint">{t('Leave the proxy sign-in empty to keep the one saved for this address.')}</p> : null
          ) : (
            <>
              <div className="or-line">{t('or')}</div>
              <button className="secondary pair-button" type="button" onClick={() => setPairing(true)}>
                {t('Pair with your iPhone')}
              </button>
            </>
          )}
          {onCancel ? (
            <button className="link-button" type="button" onClick={onCancel}>
              {t('Cancel')}
            </button>
          ) : null}
        </form>
      ) : (
        <form className="signin-card" onSubmit={submit}>
          <h1>{t('Sign in')}</h1>
          <p>{url}</p>
          {methods.length > 1 ? (
            <div className="segmented" role="group" aria-label={t('Sign-in method')}>
              {methods.map(m => (
                <button key={m} type="button" disabled={busy} aria-pressed={m === method} onClick={() => setMethod(m)}>
                  {methodLabels()[m]}
                </button>
              ))}
            </div>
          ) : null}
          {method === 'password' ? (
            <>
              <label className="field">
                {t('User name')}
                <input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
              </label>
              <label className="field">
                {t('Password')}
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
            </>
          ) : null}
          {method === 'token' ? (
            <label className="field">
              {t('Session token')}
              <input autoFocus value={token} onChange={e => setToken(e.target.value)} spellCheck={false} />
            </label>
          ) : null}
          {method === 'open' ? <p>{t('This dashboard doesn’t ask for a sign-in.')}</p> : null}
          {method === 'oidc' ? <p>{t('This will open your browser to sign in.')}</p> : null}
          {method === 'browser' ? <p>{t('This opens the dashboard’s sign-in page in a Conduit window.')}</p> : null}
          {error ? <div className="error-text" role="alert">{error}</div> : null}
          {switchToSaved}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t('Signing in…') : method === 'oidc' ? t('Sign in with browser') : method === 'browser' ? t('Open Sign-In Page') : t('Sign in')}
          </button>
          <button
            className="link-button"
            type="button"
            onClick={() => {
              if (busy && (method === 'oidc' || method === 'browser')) {
                attempt.current++
                void window.conduit.cancelSignIn()
                setBusy(false)
              }
              setUrl(null)
              setError(null)
              setSavedAs(null)
            }}
          >
            {t('Use a different address')}
          </button>
        </form>
      )}
    </div>
  )
}
