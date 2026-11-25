import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackScroll } from '../state/keptScroll'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  filterServers,
  filterSkills,
  filterToolsets,
  flipped,
  parseServers,
  parseSkills,
  parseTest,
  parseToolsets,
  provenanceLabel,
  scoped,
  skillGroups,
  type CapabilityTab,
  type Server,
  type ServerTest,
  type Skill,
  type Toolset
} from '../state/capabilities'
import { Markdown } from './Markdown'
import { SkillHub } from './SkillHub'
import { PluginsTab } from './PluginsTab'
import { HostedAppPage, HostedAppsDirectory, HostedAppsSection } from './HostedApps'
import { useHostedApps } from '../state/useHostedApps'
import type { AppsRequest } from '../state/appsDirectory'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'
import { Select } from './Select'
import { ToolsetPage } from './ToolsetPage'

interface Props {
  bots: { name: string; title: string }[]
  profile: string
  /** The host's address, for the restart a plugin change asks for. */
  host?: string
  /** A chat's apps card asked for Browse Apps, with Hermes' picks first. */
  apps?: AppsRequest | null
  onBack: () => void
}

const TAB_KEY = 'conduit.capabilities.tab'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function storedTab(): CapabilityTab {
  try {
    const tab = localStorage.getItem(TAB_KEY)
    if (tab === 'tools' || tab === 'connectors' || tab === 'plugins') return tab
  } catch {
    // Opens on Skills.
  }
  return 'skills'
}


/** Each list's route (Plugins has its own page and reads; it never loads here). */
const LIST_ROUTES: Record<CapabilityTab, string> = {
  skills: '/api/skills',
  tools: '/api/tools/toolsets',
  connectors: '/api/mcp/servers',
  plugins: '/api/mcp/servers'
}

/** SKILL.md without its front matter, which the page shows as the title and description. */
const skillBody = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

/**
 * Settings > Capabilities, after the phone's: Skills, Tools and Connectors
 * for a bot's profile, each with its switch. A skill opens its SKILL.md; a
 * connector that's on is tested as the tab opens, and on Test Connection.
 * Switches reach Hermes one after another, in the order flipped. Connectors
 * opens on the apps signed in through Nous Portal, above the MCP servers.
 */
export function CapabilitiesPage({ bots, profile: initialProfile, host, apps, onBack }: Props) {
  useMouseBack(onBack)
  const [profile, setProfile] = useState(initialProfile)
  const [tab, setTabState] = useState<CapabilityTab>(storedTab)
  const [query, setQuery] = useState('')
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const [toolsets, setToolsets] = useState<Toolset[] | null>(null)
  const [servers, setServers] = useState<Server[] | null>(null)
  const [tests, setTests] = useState<Record<string, ServerTest>>({})
  const [errors, setErrors] = useState<Partial<Record<CapabilityTab, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<{ skill: Skill; text: string | null; error?: string } | null>(null)
  useMouseBack(open ? () => setOpen(null) : null)
  const [openServer, setOpenServer] = useState<string | null>(null)
  const [hubOpen, setHubOpen] = useState(false)
  /** A toolset's page (its backends, and an image or video backend's model), over the tab. */
  const [openToolset, setOpenToolset] = useState<Toolset | null>(null)
  // Connectors' Apps, through Nous Portal: the directory or an app's page over the tab.
  const hostedApps = useHostedApps(profile)
  const [appsPage, setAppsPage] = useState<{ slug: string | null; fromDirectory: boolean; suggested?: string[] } | null>(null)
  /** The apps card's ask, waiting for its bot's profile to be the one shown. */
  const appsAsk = useRef<AppsRequest | null>(null)
  // Back from a page drawn over the tab lands where the tab was.
  useBackScroll(
    appsPage?.slug ? `app:${appsPage.slug}` : appsPage ? 'apps' : hubOpen ? 'hub' : openToolset ? `toolset:${openToolset.name}` : open ? `skill:${open.skill.name}` : 'list'
  )
  const generation = useRef(0)
  const writes = useRef<Promise<unknown>>(Promise.resolve())

  const setTab = (next: CapabilityTab) => {
    setTabState(next)
    setOpen(null)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // Not remembered.
    }
  }

  const test = useCallback(
    async (name: string, mine: number) => {
      setTests(all => ({ ...all, [name]: { kind: 'testing' } }))
      let outcome: ServerTest
      try {
        outcome = parseTest(await gateway.http('POST', scoped(`/api/mcp/servers/${encodeURIComponent(name)}/test`, profile), {}, 60_000))
      } catch (e) {
        outcome = { kind: 'failed', error: message(e) }
      }
      if (generation.current === mine) setTests(all => ({ ...all, [name]: outcome }))
    },
    [profile]
  )

  const load = useCallback(
    async (which: CapabilityTab) => {
      const mine = generation.current
      setErrors(all => ({ ...all, [which]: undefined }))
      try {
        const path = scoped(LIST_ROUTES[which], profile)
        const keep = answerKeeper(path)
        const raw = await gateway.http('GET', path)
        if (which === 'skills') {
          const list = parseSkills(raw)
          if (generation.current !== mine) return
          setSkills(list)
          keep(raw)
        } else if (which === 'tools') {
          const list = parseToolsets(raw)
          if (generation.current !== mine) return
          setToolsets(list)
          // A Hermes still loading its plugins lists no toolsets; that isn't kept.
          if (list.length) keep(raw)
        } else {
          const list = parseServers(raw)
          if (generation.current !== mine) return
          setServers(list)
          keep(raw)
          // Each server that's on is tested as the tab opens, a few at a time.
          const on = list.filter(server => server.enabled)
          for (let i = 0; i < on.length; i += 3) {
            if (generation.current !== mine) return
            await Promise.all(on.slice(i, i + 3).map(server => test(server.name, mine)))
          }
        }
      } catch (e) {
        if (generation.current === mine) setErrors(all => ({ ...all, [which]: message(e) }))
      }
    },
    [profile, test]
  )

  // Another profile drops everything read for the last one, opening on what its tabs showed last time.
  const asked = useRef(new Set<CapabilityTab>())
  useEffect(() => {
    generation.current++
    asked.current = new Set()
    const kept = (which: CapabilityTab) => keptAnswer(scoped(LIST_ROUTES[which], profile))
    const skillsKept = kept('skills')
    const toolsKept = kept('tools')
    const serversKept = kept('connectors')
    setSkills(skillsKept ? parseSkills(skillsKept) : null)
    setToolsets(toolsKept ? parseToolsets(toolsKept) : null)
    setServers(serversKept ? parseServers(serversKept) : null)
    setTests({})
    setOpen(null)
    setOpenServer(null)
    setHubOpen(false)
    setOpenToolset(null)
    const ask = appsAsk.current
    appsAsk.current = null
    setAppsPage(ask && (ask.profile ?? profile) === profile ? { slug: null, fromDirectory: true, suggested: ask.suggested } : null)
    setProblem(null)
  }, [profile])

  // The apps card's Browse Apps: Connectors, on the card's bot, with its picks first.
  useEffect(() => {
    if (!apps) return
    setTab('connectors')
    const target = apps.profile && bots.some(bot => bot.name === apps.profile) ? apps.profile : profile
    if (target !== profile) {
      appsAsk.current = apps
      setProfile(target)
    } else setAppsPage({ slug: null, fromDirectory: true, suggested: apps.suggested })
    // Each ask once.
  }, [apps?.n])

  // Each tab asks Hermes once a visit as it shows, over what it kept.
  useEffect(() => {
    if (tab !== 'skills' && tab !== 'tools' && tab !== 'connectors') return
    if (asked.current.has(tab)) return
    asked.current.add(tab)
    void load(tab)
  }, [tab, load])

  /** A switch: shown at once, sent after any flip before it; a refusal reads the list again. */
  const flip = (which: CapabilityTab, name: string, enabled: boolean) => {
    const mine = generation.current
    setProblem(null)
    if (which === 'skills') setSkills(list => list && flipped(list, name, enabled))
    if (which === 'tools') setToolsets(list => list && flipped(list, name, enabled))
    if (which === 'connectors') setServers(list => list && flipped(list, name, enabled))
    const body: Record<string, unknown> = { enabled }
    if (profile !== 'default') body.profile = profile
    const send = () =>
      which === 'skills'
        ? gateway.http('PUT', scoped('/api/skills/toggle', profile), { ...body, name })
        : which === 'tools'
          ? gateway.http('PUT', scoped(`/api/tools/toolsets/${encodeURIComponent(name)}`, profile), body)
          : gateway.http('PUT', scoped(`/api/mcp/servers/${encodeURIComponent(name)}/enabled`, profile), body)
    writes.current = writes.current.then(async () => {
      if (generation.current !== mine) return
      try {
        await send()
        if (which === 'connectors' && enabled && generation.current === mine) void test(name, mine)
      } catch (e) {
        if (generation.current !== mine) return
        setProblem(t('Couldn’t save that change: {error}', { error: message(e) }))
        void load(which)
      }
    })
  }

  const openSkill = async (skill: Skill) => {
    const mine = generation.current
    setOpen({ skill, text: null })
    try {
      const answer = (await gateway.http('GET', scoped(`/api/skills/content?name=${encodeURIComponent(skill.name)}`, profile))) as { content?: unknown }
      if (generation.current === mine)
        setOpen(now => (now?.skill.name === skill.name ? { skill, text: typeof answer?.content === 'string' ? answer.content : '' } : now))
    } catch (e) {
      if (generation.current === mine) setOpen(now => (now?.skill.name === skill.name ? { skill, text: null, error: message(e) } : now))
    }
  }

  const loadingOrError = (which: CapabilityTab) =>
    errors[which] ? (
      <div className="pset-row">
        <span className="error-text">{errors[which]}</span>
        <button className="secondary" onClick={() => void load(which)}>
          {t('Try Again')}
        </button>
      </div>
    ) : (
      <p className="meta">{t('Loading…')}</p>
    )

  const hubEntry = (
    <section className="pset-section">
      <h2>{t('Skill Hub')}</h2>
      <button className="pset-link" onClick={() => setHubOpen(true)}>
        <span>{t('Browse Skill Hub')}</span>
        <Icon name="chevron" />
      </button>
    </section>
  )

  const skillsTab = () => {
    if (!skills) return loadingOrError('skills')
    if (!skills.length)
      return (
        <>
          {hubEntry}
          <p className="meta">{t('No skills yet')}</p>
        </>
      )
    const groups = skillGroups(filterSkills(skills, query))
    if (!groups.length) return <p className="meta">{t('No matching skills')}</p>
    return [
      query.trim() ? null : <div key="hub">{hubEntry}</div>,
      ...groups.map(group => (
        <section key={group.category} className="pset-section">
          <h2>{group.title}</h2>
          {group.skills.map(skill => {
            const badge = provenanceLabel(skill.provenance)
            return (
              <div key={skill.name} className={`cap-row${skill.enabled ? '' : ' off'}`}>
                <button className="cap-row-text" onClick={() => void openSkill(skill)}>
                  <strong>{skill.name}</strong>
                  {badge ? <span className="cap-badge">{badge}</span> : null}
                  {skill.description ? <span className="meta">{skill.description}</span> : null}
                </button>
                <Switch label={skill.name} checked={skill.enabled} onChange={on => flip('skills', skill.name, on)} />
              </div>
            )
          })}
        </section>
      ))
    ]
  }

  const toolsTab = () => {
    if (!toolsets) return loadingOrError('tools')
    if (!toolsets.length) return <p className="meta">{t('No tools yet')}</p>
    const shown = filterToolsets(toolsets, query)
    if (!shown.length) return <p className="meta">{t('No matching tools')}</p>
    const on = toolsets.filter(s => s.enabled).length
    return (
      <section className="pset-section">
        <h2>{t('Toolsets')}</h2>
        {shown.map(set => (
          <div key={set.name} className={`cap-row${set.enabled ? '' : ' off'}`}>
            <button className="cap-row-text" onClick={() => setOpenToolset(set)}>
              <strong>{set.label}</strong>
              {!set.configured ? <span className="cap-badge warn">{t('Needs keys')}</span> : null}
              {set.description ? <span className="meta">{set.description}</span> : null}
            </button>
            {/* The last toolset that's on stays on: a chat with none can't do anything. */}
            <Switch label={set.label} checked={set.enabled} disabled={set.enabled && on <= 1} onChange={next => flip('tools', set.name, next)} />
          </div>
        ))}
      </section>
    )
  }

  const testLine = (server: Server) => {
    if (!server.enabled) return <span className="meta">{t('Turned off')}</span>
    const result = tests[server.name]
    if (!result) return null
    if (result.kind === 'testing') return <span className="meta">{t('Testing…')}</span>
    if (result.kind === 'ok') return <span className="meta cap-ok">{`${t('Connected')} · ${t('Tools')}: ${result.tools.length}`}</span>
    return <span className="error-text">{result.error}</span>
  }

  const appsSection = (
    <HostedAppsSection
      key="apps"
      apps={hostedApps}
      query={query}
      onOpenApp={slug => setAppsPage({ slug, fromDirectory: false })}
      onBrowse={() => setAppsPage({ slug: null, fromDirectory: true })}
    />
  )

  const connectorsTab = () => [appsSection, <div key="servers">{serversList()}</div>]

  const serversList = () => {
    if (!servers) return loadingOrError('connectors')
    if (!servers.length) return <p className="meta">{t('No connectors yet')}</p>
    const shown = filterServers(servers, query)
    if (!shown.length) return <p className="meta">{t('No matching connectors')}</p>
    return (
      <section className="pset-section">
        <h2>{t('Connectors')}</h2>
        <p className="meta">{t('Each server is tested when this page opens. Changes apply to new sessions.')}</p>
        {shown.map(server => {
          const result = tests[server.name]
          const expanded = openServer === server.name
          return (
            <div key={server.name} className={`cap-row-block${server.enabled ? '' : ' off'}`}>
              <div className="cap-row">
                <button className="cap-row-text" aria-expanded={expanded} onClick={() => setOpenServer(expanded ? null : server.name)}>
                  <strong>{server.name}</strong>
                  <span className="cap-badge">{server.plugin ? t('MCP · Plugin {plugin}', { plugin: server.plugin }) : t('MCP · Custom')}</span>
                  {testLine(server)}
                </button>
                <Switch label={server.name} checked={server.enabled} disabled={!!server.plugin} onChange={on => flip('connectors', server.name, on)} />
              </div>
              {expanded ? (
                <div className="cap-detail">
                  {server.runs ? (
                    <div className="meta">
                      {t('Runs')}: <code>{server.runs}</code>
                    </div>
                  ) : null}
                  {server.plugin ? (
                    <div className="meta">{t('The {plugin} plugin provides this server. Change it from Plugins.', { plugin: server.plugin })}</div>
                  ) : null}
                  {result?.kind === 'ok' && result.tools.length ? (
                    <ul className="cap-tool-list">
                      {result.tools.map(tool => (
                        <li key={tool.name}>
                          <code>{tool.name}</code>
                          {tool.description ? <span className="meta"> {tool.description}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!server.enabled ? <div className="meta">{t('{name} is off. Turn it on to read the tools it brings.', { name: server.name })}</div> : null}
                  <div className="pset-actions">
                    <button
                      className="secondary"
                      disabled={!server.enabled || result?.kind === 'testing'}
                      onClick={() => void test(server.name, generation.current)}
                    >
                      {result?.kind === 'testing' ? t('Testing…') : t('Test Connection')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </section>
    )
  }

  if (appsPage?.slug)
    return (
      <HostedAppPage
        key={appsPage.slug}
        apps={hostedApps}
        slug={appsPage.slug}
        onBack={() => setAppsPage(appsPage.fromDirectory ? { slug: null, fromDirectory: true, suggested: appsPage.suggested } : null)}
      />
    )
  if (appsPage)
    return (
      <HostedAppsDirectory
        apps={hostedApps}
        suggested={appsPage.suggested}
        onOpenApp={slug => setAppsPage({ slug, fromDirectory: true, suggested: appsPage.suggested })}
        onBack={() => setAppsPage(null)}
      />
    )

  if (openToolset)
    return <ToolsetPage name={openToolset.name} label={openToolset.label} profile={profile} onBack={() => setOpenToolset(null)} />

  if (hubOpen)
    return (
      <SkillHub
        profile={profile}
        onBack={() => setHubOpen(false)}
        onChanged={() => {
          setSkills(null)
        }}
      />
    )

  if (open)
    return (
      <div className="pset">
        <div className="pulse-head">
          <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={() => setOpen(null)}>
            <Icon name="back" />
          </button>
          <h1>{open.skill.name}</h1>
        </div>
        {open.skill.description ? <p className="meta">{open.skill.description}</p> : null}
        <div className="pset-row cap-skill-switch">
          <span>{open.skill.enabled ? t('On') : t('Off')}</span>
          <Switch
            label={open.skill.name}
            checked={open.skill.enabled}
            onChange={on => {
              flip('skills', open.skill.name, on)
              setOpen(now => now && { ...now, skill: { ...now.skill, enabled: on } })
            }}
          />
        </div>
        <section className="pset-section cap-skill-body">
          <h2>{t('Instructions')}</h2>
          {open.error ? (
            <p className="error-text">{open.error}</p>
          ) : open.text === null ? (
            <p className="meta">{t('Loading…')}</p>
          ) : (
            <Markdown text={skillBody(open.text)} />
          )}
        </section>
      </div>
    )

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Capabilities')}</h1>
        <span className="spacer" />
        {bots.length > 1 ? (
          <Select className="language-select" value={profile} aria-label={t('Bot')} onChange={picked => setProfile(picked)}>
            {bots.map(bot => (
              <option key={bot.name} value={bot.name}>
                {bot.title}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <div className="cap-bar">
        <div className="segmented" role="tablist" aria-label={t('Capabilities')}>
          {(['skills', 'tools', 'connectors', 'plugins'] as CapabilityTab[]).map(id => (
            <button key={id} role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
              {id === 'skills' ? t('Skills') : id === 'tools' ? t('Tools') : id === 'connectors' ? t('Connectors') : t('Plugins')}
            </button>
          ))}
        </div>
        <input
          className="cap-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={
            tab === 'skills' ? t('Search skills') : tab === 'tools' ? t('Search tools') : tab === 'connectors' ? t('Search connectors') : t('Search plugins')
          }
          aria-label={
            tab === 'skills' ? t('Search skills') : tab === 'tools' ? t('Search tools') : tab === 'connectors' ? t('Search connectors') : t('Search plugins')
          }
        />
      </div>
      {tab === 'skills' || tab === 'tools' ? <p className="meta">{t('Changes apply to new sessions.')}</p> : null}
      {problem ? <p className="error-text">{problem}</p> : null}
      {tab === 'skills' ? (
        skillsTab()
      ) : tab === 'tools' ? (
        toolsTab()
      ) : tab === 'connectors' ? (
        connectorsTab()
      ) : (
        <PluginsTab profile={profile} query={query} host={host} />
      )}
    </div>
  )
}
