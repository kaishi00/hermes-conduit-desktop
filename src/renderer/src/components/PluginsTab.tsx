import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { startRestart } from '../state/hostActions'
import {
  CATALOG_PATH,
  HUB_PATH,
  INSTALL_PATH,
  filterCatalog,
  filterInstalled,
  installBody,
  parseCatalog,
  parseInstall,
  parseInstalled,
  parseUpdate,
  pluginPath,
  sourceEntry,
  type CatalogPlugin,
  type InstalledPlugin
} from '../state/plugins'
import { scoped } from '../state/capabilities'
import { useSlowWait } from '../state/slowWait'
import { settingsRow } from '../state/pluginSettings'
import { PluginSettingsForm } from './PluginSettingsForm'
import { ask, tell } from '../state/dialogs'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const restartRequest = (method: 'GET' | 'POST', path: string) => gateway.http(method, path, method === 'POST' ? {} : undefined, 30_000)

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

const tierTitle = (tier: CatalogPlugin['tier']) => (tier === 'official' ? t('Official') : tier === 'verified' ? t('Verified') : t('Community'))

/**
 * The Plugins tab, after the phone's: installed plugins with their switch,
 * Update and Remove, then the catalog's plugins not installed yet, each
 * with what it adds and Install. Only the default profile changes them.
 */
/** A kept answer read the way Hermes' is, or null when there's none or it no longer parses. */
function keptList<T>(path: string, parse: (raw: unknown) => T): T | null {
  const kept = keptAnswer(path)
  if (kept === undefined) return null
  try {
    return parse(kept)
  } catch {
    return null
  }
}

export function PluginsTab({ profile, query, host }: { profile: string; query: string; host?: string }) {
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null)
  const [catalog, setCatalog] = useState<CatalogPlugin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [restart, setRestart] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Hermes' own plugin list, for each plugin's settings form; none on a Hermes without it.
  const [manage, setManage] = useState<unknown>(null)
  const canManage = profile === 'default'
  // The hub route takes ten seconds or more on a host with a large library, and a bare
  // "Loading…" for that long reads as a frozen tab (desktop#444).
  const slow = useSlowWait(!installed && !error)

  const load = useCallback(async () => {
    setError(null)
    const keepHub = answerKeeper(scoped(HUB_PATH, profile))
    // The catalog is the same for every profile: kept once per dashboard.
    const keepCatalog = answerKeeper(CATALOG_PATH)
    const [hub, list, rows] = await Promise.allSettled([
      gateway.http('GET', scoped(HUB_PATH, profile)),
      gateway.http('GET', CATALOG_PATH, undefined, 30_000),
      gateway.rpc('plugins.manage', { action: 'list', profile })
    ])
    setManage(rows.status === 'fulfilled' ? rows.value : null)
    if (hub.status === 'fulfilled') {
      try {
        setInstalled(parseInstalled(hub.value))
        keepHub(hub.value)
      } catch {
        setError(t("Couldn't load agent plugins"))
      }
    } else setError(`${t("Couldn't load agent plugins")} ${message(hub.reason)}`)
    if (list.status === 'fulfilled') {
      try {
        setCatalog(parseCatalog(list.value))
        setCatalogFailed(false)
        keepCatalog(list.value)
      } catch {
        setCatalogFailed(true)
      }
    } else setCatalogFailed(true)
  }, [profile])

  useEffect(() => {
    // What the tab listed last time on this dashboard and profile, until Hermes answers again.
    setInstalled(keptList(scoped(HUB_PATH, profile), parseInstalled))
    setCatalog(current => current ?? keptList(CATALOG_PATH, parseCatalog))
    void load()
  }, [load])

  async function act(name: string, run: () => Promise<void>) {
    setBusy(name)
    setNote(null)
    try {
      await run()
    } catch (e) {
      void tell(message(e))
    } finally {
      setBusy(null)
      void load()
    }
  }

  const flip = (plugin: InstalledPlugin, on: boolean) =>
    act(plugin.name, async () => {
      setInstalled(list => list && list.map(p => (p.name === plugin.name ? { ...p, status: on ? 'enabled' : 'disabled' } : p)))
      await gateway.http('POST', `${pluginPath(plugin.name)}/${on ? 'enable' : 'disable'}`, {}, 60_000)
      // Turning one off waits for a restart; on loads it live when the gateway can.
      if (!on) setRestart(true)
    })

  const update = (plugin: InstalledPlugin, accept = false) =>
    act(plugin.name, async () => {
      const outcome = parseUpdate(await gateway.http('POST', `${pluginPath(plugin.folder)}/update`, accept ? { accept_capabilities: true } : {}, 180_000))
      if (outcome.kind === 'consent') {
        if (await ask(`${t('Plugin requires approval for {name}', { name: plugin.name })}\n\n${outcome.lines.join('\n')}`)) {
          setBusy(null)
          await update(plugin, true)
        }
        return
      }
      if (outcome.kind === 'upToDate') setNote(t('{name} is up to date.', { name: plugin.name }))
      else if (outcome.restart) setRestart(true)
    })

  const remove = async (plugin: InstalledPlugin) => {
    if (!(await ask(t('Remove {name}?', { name: plugin.name }), { confirm: t('Remove'), destructive: true }))) return
    void act(plugin.name, async () => {
      await gateway.http('DELETE', pluginPath(plugin.folder), undefined, 60_000)
      setRestart(true)
    })
  }

  const install = async (entry: CatalogPlugin) => {
    if (!(await ask(t('Install {name}?', { name: entry.title })))) return
    void act(entry.name, async () => {
      const outcome = parseInstall(await gateway.http('POST', INSTALL_PATH, installBody(entry), 180_000), entry)
      if (outcome.restart) setRestart(true)
      setNote(
        outcome.missingEnv.length
          ? t('{name} is installed. It needs {keys} set before it works.', { name: outcome.name, keys: outcome.missingEnv.join(', ') })
          : t('{name} is installed.', { name: outcome.name })
      )
    })
  }

  if (!installed && !error)
    return <p className="meta">{slow ? t('This is taking longer than usual.') : t('Loading…')}</p>
  const shown = filterInstalled(installed ?? [], query)
  const available = filterCatalog(catalog ?? [], query)
  return (
    <>
      {!canManage ? <p className="meta">{t("Hermes installs plugins for the host's default profile. Switch to it to change them.")}</p> : null}
      {restart ? (
        <div className="cap-restart">
          <span>{t('Restart the gateway to apply plugin changes.')}</span>
          {host ? (
            <button
              className="secondary"
              onClick={() => {
                setRestart(false)
                void startRestart(host, restartRequest)
              }}
            >
              {t('Restart Hermes')}
            </button>
          ) : null}
        </div>
      ) : null}
      {note ? <p className="meta cap-note">{note}</p> : null}
      <section className="pset-section">
        <h2>{t('Plugins')}</h2>
        <p className="meta">{t('Plugins extend the agent with tools, hooks and providers.')}</p>
        {error ? <p className="error-text">{error}</p> : null}
        {installed && !installed.length ? <p className="meta">{t('No agent plugins installed for this profile.')}</p> : null}
        {installed?.length && !shown.length ? <p className="meta">{t('No matching plugins')}</p> : null}
        {shown.map(plugin => {
          const expanded = open === `i:${plugin.name}`
          const entry = catalog ? sourceEntry(plugin, catalog) : undefined
          return (
            <div key={plugin.name} className={`cap-row-block${plugin.status === 'enabled' ? '' : ' off'}`}>
              <div className="cap-row">
                <button className="cap-row-text" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : `i:${plugin.name}`)}>
                  <strong>{plugin.name}</strong>
                  <span className="cap-badge">
                    {[
                      plugin.version ? `v${plugin.version}` : '',
                      plugin.source,
                      plugin.status === 'inactive' ? t('Installed but not running') : '',
                      entry?.updateAvailable ? t('Update available') : ''
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {plugin.description && !expanded ? <span className="meta cap-clamp">{plugin.description}</span> : null}
                </button>
                <Switch
                  label={plugin.name}
                  checked={plugin.status === 'enabled'}
                  disabled={!canManage || busy === plugin.name}
                  onChange={on => void flip(plugin, on)}
                />
              </div>
              {expanded ? (
                <div className="cap-detail">
                  {plugin.description ? <p className="meta">{plugin.description}</p> : null}
                  {plugin.authCommand ? (
                    <div className="meta">
                      {t('Sign in on the host with')} <code>{plugin.authCommand}</code>
                    </div>
                  ) : null}
                  {entry ? <CatalogFacts entry={entry} /> : null}
                  {(() => {
                    const row = settingsRow(manage, plugin.name, plugin.folder)
                    return row ? (
                      <PluginSettingsForm
                        pluginKey={typeof row.key === 'string' && row.key ? row.key : plugin.name}
                        row={row}
                        profile={profile}
                        canManage={canManage}
                        onSaved={() => void load()}
                      />
                    ) : null
                  })()}
                  {canManage && (plugin.canUpdate || plugin.canRemove) ? (
                    <div className="pset-actions">
                      {plugin.canUpdate ? (
                        <button className="secondary" disabled={busy === plugin.name} onClick={() => void update(plugin)}>
                          {busy === plugin.name ? t('Working…') : t('Update')}
                        </button>
                      ) : null}
                      {plugin.canRemove ? (
                        <button className="secondary danger" disabled={busy === plugin.name} onClick={() => remove(plugin)}>
                          {t('Remove')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </section>
      <section className="pset-section">
        <h2>{t('Plugin catalog')}</h2>
        <p className="meta">{t("Reviewed plugins from Hermes' catalog.")}</p>
        {catalogFailed && !catalog ? <p className="meta">{t("Couldn't load the catalog.")}</p> : null}
        {catalog && !available.length ? <p className="meta">{t('No matching plugins')}</p> : null}
        {available.map(entry => {
          const expanded = open === `c:${entry.name}`
          return (
            <div key={entry.name} className="cap-row-block">
              <div className="cap-row">
                {entry.image ? <img className="plugin-picture" src={entry.image} alt="" /> : null}
                <button className="cap-row-text" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : `c:${entry.name}`)}>
                  <strong>{entry.title}</strong>
                  <span className="cap-badge">{[tierTitle(entry.tier), entry.maintainer, entry.category].filter(Boolean).join(' · ')}</span>
                  {entry.description && !expanded ? <span className="meta cap-clamp">{entry.description}</span> : null}
                </button>
                <button className="secondary" disabled={!canManage || busy === entry.name} onClick={() => install(entry)}>
                  {busy === entry.name ? t('Installing…') : t('Install')}
                </button>
              </div>
              {expanded ? (
                <div className="cap-detail">
                  {entry.description ? <p className="meta">{entry.description}</p> : null}
                  <CatalogFacts entry={entry} />
                  {entry.screenshots.length ? (
                    <div className="plugin-shots">
                      {entry.screenshots.map(src => (
                        <img key={src} src={src} alt="" />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </section>
    </>
  )
}

/** What a catalog plugin adds and needs, and where to read about it. */
function CatalogFacts({ entry }: { entry: CatalogPlugin }) {
  const facts: [string, string[]][] = [
    [t('Tools'), entry.tools],
    [t('Hooks'), entry.hooks],
    [t('Middleware'), entry.middleware],
    [t('Keys it needs'), entry.requiresEnv],
    [t('Known issues'), entry.knownIssues]
  ]
  return (
    <>
      {entry.version ? (
        <div className="meta">
          {t('Version')} {entry.version}
        </div>
      ) : null}
      {facts.map(([title, list]) =>
        list.length ? (
          <div key={title} className="meta">
            {title}: {list.join(', ')}
          </div>
        ) : null
      )}
      {entry.docs || entry.repo ? (
        <div className="pset-actions">
          {entry.docs ? (
            <a className="link" href={entry.docs} target="_blank" rel="noreferrer">
              {t('Documentation')}
            </a>
          ) : null}
          {entry.repo ? (
            <a className="link" href={entry.repo} target="_blank" rel="noreferrer">
              {t('Source')}
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
