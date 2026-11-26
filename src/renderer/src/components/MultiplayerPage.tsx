import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { locale, t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  MAX_NAME_LENGTH,
  NAME_KEY,
  findInvite,
  linksMessage,
  previewStop,
  roomLinksClient,
  shownWords,
  type InviteMade,
  type InvitePreview,
  type RoomIdentity,
  type RoomLink,
  type RoomLinkInvite,
  type RoomLinksList
} from '../state/roomLinks'
import { Icon } from './icons'
import { RoomSetupSection } from './RoomSetupSection'
import { LinkAsksSection } from './LinkAsksSection'
import { LINK_ASKS_CAPABILITY } from '../state/linkAsks'
import { YourPicture } from './YourPicture'
import type { PersonPicture } from '../state/useRoomLooks'
import { ROOM_DASHBOARD_PROFILES_CAPABILITY, ROOM_SETUP_CAPABILITY } from '../state/roomSetup'
import { useMouseBack } from '../state/mouseBack'
import { ask } from '../state/dialogs'
import { inSelectMenu, Select } from './Select'

const client = roomLinksClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))

const keptName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
const keepName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Kept for this run only.
  }
}

const until = (seconds: number) => new Date(seconds * 1000).toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/** A Link's status, or null for one a newer plugin added. */
export function linkStatus(link: RoomLink): string | null {
  switch (link.status) {
    case 'linked':
      return t('Linked')
    case 'waiting':
      return t("Waiting for {name}'s Hermes to confirm", { name: link.name })
    case 'unanswered':
      return t("{name}'s Hermes never confirmed. Ask them for a new invite.", { name: link.name })
    default:
      return null
  }
}

/** Whose Conduit plugin to update so a Link carries everything, or null. */
export function linkUpdate(link: RoomLink): string | null {
  if (link.status !== 'linked') return null
  if (link.behind === 'theirs')
    return t("{name}'s Conduit plugin is older than yours, so some of what your rooms share won't reach them. Ask them to update it.", { name: link.name })
  if (link.behind === 'yours')
    return t("{name}'s Conduit plugin is newer than yours, so some of what they share isn't reaching you. Update your Conduit plugin.", { name: link.name })
  return null
}

const ABOUT = 'A Link lets you and someone else bring your agents into rooms together. It grants nothing by itself: in each room, you choose what your agents may do.'

/**
 * Settings > Multiplayer, after the phone's PeopleSettingsPage: the people
 * this Hermes is linked with and the invites still waiting. Link with
 * someone makes an invite; an invite someone sent is pasted here. Shown
 * while the host's plugin keeps Links (`room-links`).
 */
export function MultiplayerPage({
  host,
  capabilities,
  bots,
  profile: initialProfile,
  invite,
  personPicture,
  onBack
}: {
  host: string
  capabilities: string[]
  bots: { name: string; title: string }[]
  profile: string
  /** A Link invite opened from another app (`conduit://link/…`), to open here. */
  invite?: { url: string; at: number } | null
  /** The picture you show in rooms over Links. */
  personPicture?: PersonPicture
  onBack: () => void
}) {
  useMouseBack(onBack)
  const [profile, setProfile] = useState(initialProfile)
  const profileName = bots.find(b => b.name === profile)?.title ?? profile
  const [list, setList] = useState<RoomLinksList | null>(null)
  const [identity, setIdentity] = useState<RoomIdentity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [changing, setChanging] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const reads = useRef(0)
  // An invite opened from another app opens as a pasted one does.
  useEffect(() => {
    const found = invite ? findInvite(invite.url) : null
    if (found) setOpened(found)
  }, [invite])

  const load = useCallback(
    async (keepIdentity = false) => {
      const read = ++reads.current
      setLoadError(null)
      try {
        const next = await client.list()
        const words = keepIdentity && identity ? identity : await client.identity()
        if (read !== reads.current) return
        setList(next)
        setIdentity(words)
      } catch (error) {
        if (read !== reads.current) return
        setLoadError(t('Could not read your Links: {error}', { error: linksMessage(error) }))
      }
    },
    [identity]
  )

  useEffect(() => {
    setList(null)
    setIdentity(null)
    void load()
    // Another dashboard's Links are read again; load itself only changes with the words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host])

  // While a Link waits for the other side's Hermes: every 5 s, for up to 3 minutes, while the window shows.
  const waiting = list?.links.filter(l => l.status === 'waiting').map(l => l.id).sort().join(',') ?? ''
  useEffect(() => {
    if (!waiting) return
    let ticks = 0
    const timer = setInterval(() => {
      if (++ticks > 36) return clearInterval(timer)
      if (document.visibilityState === 'visible' && !changing) void load(true)
    }, 5000)
    return () => clearInterval(timer)
  }, [waiting, changing, load])

  const unlink = async (link: RoomLink) => {
    if (changing) return
    if (!(await ask(`${t('Unlink {name}?', { name: link.name })}\n\n${t("This unlinks {name}'s Hermes from yours, on both sides. Linking again takes a new invite.", { name: link.name })}`))) return
    setChanging(link.id)
    setActionError(null)
    try {
      await client.unlink(link.id)
    } catch (error) {
      setActionError(t('Could not unlink {name}: {error}', { name: link.name, error: linksMessage(error) }))
    }
    await load(true)
    setChanging(null)
  }

  const cancel = async (invite: RoomLinkInvite) => {
    if (changing) return
    setChanging(invite.id)
    setActionError(null)
    try {
      await client.cancel(invite.id)
    } catch (error) {
      setActionError(t('Could not cancel the invite: {error}', { error: linksMessage(error) }))
    }
    await load(true)
    setChanging(null)
  }

  const linkedIds = list?.links.filter(l => l.status === 'linked').map(l => l.id) ?? []

  const openPasted = (text: string) => {
    const found = findInvite(text)
    if (!found) return setPasteError(t('The clipboard has no Link invite.'))
    setPasteError(null)
    setPasted('')
    setOpened(found)
  }

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Multiplayer')}</h1>
        <span className="spacer" />
        {bots.length > 1 && capabilities.includes(ROOM_SETUP_CAPABILITY) ? (
          <Select className="language-select" value={profile} aria-label={t('Bot')} onChange={picked => setProfile(picked)}>
            {bots.map(bot => (
              <option key={bot.name} value={bot.name}>
                {bot.title}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {capabilities.includes(ROOM_SETUP_CAPABILITY) ? (
        <RoomSetupSection
          host={host}
          profile={profile}
          profileName={profileName}
          conduitProfile={capabilities.includes(ROOM_DASHBOARD_PROFILES_CAPABILITY)}
        />
      ) : (
        <section className="pset-section">
          <h2>{t('This Hermes')}</h2>
          <p className="meta">{t('Update the Conduit plugin on your Hermes host to set it up for rooms from here.')}</p>
        </section>
      )}

      <section className="pset-section">
        <h2>{t('Linked with')}</h2>
        <p className="meta">{t(ABOUT)}</p>
        {list && identity ? (
          <>
            <button className="primary links-make" disabled={!identity.crypto} onClick={() => setLinking(true)}>
              {t('Link with someone')}
            </button>
            <form
              className="links-paste"
              onSubmit={e => {
                e.preventDefault()
                openPasted(pasted)
              }}
            >
              <span className="meta">{t('Have an invite?')}</span>
              <input
                className="input-ask-field"
                value={pasted}
                disabled={!identity.crypto}
                placeholder="conduit://link/…"
                aria-label={t('Link invite')}
                onChange={e => setPasted(e.target.value)}
                onPaste={e => {
                  const text = e.clipboardData.getData('text')
                  if (findInvite(text)) {
                    e.preventDefault()
                    openPasted(text)
                  }
                }}
              />
              <button type="submit" className="secondary" disabled={!identity.crypto || !pasted.trim()}>
                {t('Open')}
              </button>
            </form>
            {pasteError ? <p className="error-text">{pasteError}</p> : null}
            <YourWords identity={identity} />
            {!list.mailboxReading && (list.links.length || list.invites.length) ? (
              <>
                <p className="warning-text">
                  {t('Nothing on your Hermes reads its rooms mailbox right now, so what the other side sends waits there, for up to 7 days.')}
                </p>
                <button className="secondary" disabled={!!changing} onClick={() => void load(true)}>
                  {t('Check again')}
                </button>
              </>
            ) : null}
            {list.links.length ? (
              list.links.map(link => (
                <div key={link.id} className="link-row">
                  <div className="link-row-text">
                    <strong>{link.name}</strong>
                    {linkStatus(link) ? <span className={link.status === 'unanswered' ? 'warning-text' : 'meta'}>{linkStatus(link)}</span> : null}
                    {linkUpdate(link) ? <span className="warning-text">{linkUpdate(link)}</span> : null}
                    <span className="meta">{t('Words: {words}', { words: shownWords(link.words) })}</span>
                  </div>
                  <button className="link danger" disabled={!!changing} aria-label={`${t('Unlink')} ${link.name}`} onClick={() => void unlink(link)}>
                    {changing === link.id ? t('Working…') : t('Unlink')}
                  </button>
                </div>
              ))
            ) : (
              <p className="meta">{t('No Links yet.')}</p>
            )}
          </>
        ) : loadError ? null : (
          <p className="meta">{t('Loading…')}</p>
        )}
        {loadError ? (
          <>
            <p className="error-text">{loadError}</p>
            <button className="secondary" disabled={!!changing} onClick={() => void load()}>
              {t('Try again')}
            </button>
          </>
        ) : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}
      </section>

      {personPicture?.served ? <YouInRooms picture={personPicture} /> : null}

      {/* What each linked person's Hermes may ask yours, on a plugin that answers asks. */}
      {capabilities.includes(LINK_ASKS_CAPABILITY) && linkedIds.length ? <LinkAsksSection host={host} linkIds={linkedIds} bots={bots} /> : null}

      {list?.invites.length ? (
        <section className="pset-section">
          <h2>{t('Invites waiting')}</h2>
          <p className="meta">{t('Each invite works once, for whoever opens it first, until it runs out.')}</p>
          {list.invites.map(invite => (
            <div key={invite.id} className="link-row">
              <div className="link-row-text">
                <strong>{t('Shows you as {name}', { name: invite.name })}</strong>
                <span className="meta">{t('Works until {until}', { until: until(invite.expiresAt) })}</span>
              </div>
              <button className="link danger" disabled={!!changing} onClick={() => void cancel(invite)}>
                {changing === invite.id ? t('Working…') : t('Cancel invite')}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {linking ? (
        <InviteSheet
          onClose={() => {
            setLinking(false)
            void load()
          }}
        />
      ) : null}
      {opened ? (
        <OpenedSheet
          invite={opened}
          onClose={() => {
            setOpened(null)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

/** Your picture in rooms over Links, shown beside your messages on the other people's screens (RoomPersonPictureSection). */
function YouInRooms({ picture }: { picture: PersonPicture }) {
  return (
    <YourPicture
      picture={picture}
      title={t('You in rooms')}
      caption={t("The people in your rooms see it beside your messages, and beside your agents' names. Their pictures and glow colors for their bots show for you the same way.")}
    />
  )
}

function YourWords({ identity }: { identity: RoomIdentity }) {
  if (!identity.crypto)
    return (
      <p className="warning-text">
        {t(
          "This Hermes can't make Links: Linked Rooms needs Python's cryptography package, which it doesn't have. Install it where Hermes runs, then restart Hermes' dashboard."
        )}
      </p>
    )
  if (!identity.words) return <p className="meta">{t('Your Hermes gets its four words when it first makes or accepts an invite.')}</p>
  return (
    <WordsCard
      title={t("Your Hermes' words")}
      words={identity.words}
      caption={t('Someone opening your invite sees these four words. Read them to each other: if theirs match, the invite is yours.')}
    />
  )
}

function WordsCard({ title, words, caption }: { title: string; words: string[]; caption: string }) {
  return (
    <div className="link-words">
      <span className="meta">{title}</span>
      <strong className="selectable">{shownWords(words)}</strong>
      <span className="meta">{caption}</span>
    </div>
  )
}

function NameField({ name, setName, caption }: { name: string; setName: (name: string) => void; caption: string }) {
  return (
    <label className="link-name">
      <span>{t('Your name')}</span>
      <input
        className="input-ask-field"
        value={name}
        autoFocus
        maxLength={MAX_NAME_LENGTH}
        placeholder={t('Your name')}
        onChange={e => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
      />
      <span className="meta">{caption}</span>
    </label>
  )
}

/** A sheet over the page, closed by Esc or its button unless a request is out. */
function Sheet({ title, working, done, onClose, children }: { title: string; working: boolean; done: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event) && !working) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, working])
  return (
    <div className="shortcuts-backdrop" onClick={() => !working && onClose()}>
      <div className="shortcuts-sheet link-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <header>
          <button type="button" className="link" onClick={onClose} disabled={working}>
            {done ? t('Done') : t('Cancel')}
          </button>
          <h2>{title}</h2>
          <span />
        </header>
        {children}
      </div>
    </div>
  )
}

/**
 * Link with someone: the name the other person sees, then the invite's QR
 * code, its link to copy, this Hermes' words and until when it works. While
 * it shows, it reads the Links every 3 s for up to 3 minutes and says when
 * they've linked.
 */
function InviteSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(keptName)
  const [made, setMade] = useState<{ invite: InviteMade; before: Set<string> | null } | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkedWith, setLinkedWith] = useState<RoomLink | null>(null)
  const [copied, setCopied] = useState(false)

  const make = async () => {
    const trimmed = name.trim()
    if (!trimmed || working) return
    setWorking(true)
    setError(null)
    const before = await client.list().catch(() => null)
    try {
      const invite = await client.invite(trimmed)
      keepName(trimmed)
      setMade({ invite, before: before ? new Set(before.links.map(l => l.id)) : null })
    } catch (e) {
      setError(t('Could not make the invite: {error}', { error: linksMessage(e) }))
    }
    setWorking(false)
  }

  useEffect(() => {
    if (!made) return
    let live = true
    void QRCode.toDataURL(made.invite.url, { errorCorrectionLevel: 'M', margin: 1, width: 560, color: { dark: '#000000', light: '#ffffff' } }).then(url => live && setQr(url))
    return () => {
      live = false
    }
  }, [made])

  useEffect(() => {
    const before = made?.before
    if (!before || linkedWith) return
    let ticks = 0
    const timer = setInterval(() => {
      if (++ticks > 60) return clearInterval(timer)
      if (document.visibilityState !== 'visible') return
      void client
        .list()
        .then(list => {
          const link = list.links.find(l => !before.has(l.id) && l.status === 'linked')
          if (link) setLinkedWith(link)
        })
        .catch(() => undefined)
    }, 3000)
    return () => clearInterval(timer)
  }, [made, linkedWith])

  return (
    <Sheet title={t('Link with someone')} working={working} done={!!made} onClose={onClose}>
      {made ? (
        <>
          {linkedWith ? <p className="success-text">{t('Linked with {name}', { name: linkedWith.name })}</p> : null}
          <h3>{t('Invite')}</h3>
          {qr ? <img className="link-qr" src={qr} alt={t("The invite's QR code")} /> : <div className="link-qr" />}
          <p className="meta">{t("Ask them to scan this with their iPhone's camera, or send them the invite. It opens in Conduit.")}</p>
          <div className="link-invite-text">
            <code className="selectable">{made.invite.url}</code>
            <button
              className="secondary"
              onClick={() => {
                window.conduit.copyText(`${t('Open this in Conduit to link your Hermes with mine.')}\n${made.invite.url}`)
                setCopied(true)
              }}
            >
              {copied ? t('Copied') : t('Send the invite')}
            </button>
          </div>
          <p className="meta">{t('Works until {until}, for one person.', { until: until(made.invite.invite.expiresAt) })}</p>
          <WordsCard
            title={t("Your Hermes' words")}
            words={made.invite.words}
            caption={t('When they open the invite, their Conduit shows these four words. Check together that the words match before they link.')}
          />
        </>
      ) : (
        <form
          onSubmit={e => {
            e.preventDefault()
            void make()
          }}
        >
          <h3>{t('Invite')}</h3>
          <p className="meta">{t("Make an invite for the person you're linking with. They open it in Conduit to link your Hermes with theirs.")}</p>
          <NameField name={name} setName={setName} caption={t("The invite says it's from this name.")} />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="link-actions">
            <button type="submit" className="primary" disabled={working || !name.trim()}>
              {working ? t('Working…') : t('Make invite')}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  )
}

/**
 * An invite someone sent: who it's from, their Hermes' words and the mailbox
 * it names, and Link with the name they'll see you by. It stops before that
 * for an invite that ran out, this Hermes' own, or someone already linked.
 * Once linked, it follows the Link until their Hermes confirms it.
 */
function OpenedSheet({ invite, onClose }: { invite: string; onClose: () => void }) {
  const [read, setRead] = useState<{ preview: InvitePreview; existing: RoomLink | null } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [name, setName] = useState(keptName)
  const [working, setWorking] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [link, setLink] = useState<RoomLink | null>(null)
  const [stillWaiting, setStillWaiting] = useState(false)
  const [gone, setGone] = useState(false)

  const load = useCallback(async () => {
    setReadError(null)
    try {
      const preview = await client.preview(invite)
      const existing = preview.linkedAs ? ((await client.list().catch(() => null))?.links.find(l => l.id === preview.linkedAs) ?? null) : null
      setRead({ preview, existing })
      if (existing?.status === 'waiting') setLink(current => current ?? existing)
    } catch (e) {
      setReadError(t('Could not read this invite: {error}', { error: linksMessage(e) }))
    }
  }, [invite])
  useEffect(() => void load(), [load])

  // Every 3 s for up to 3 minutes while it waits for their Hermes to confirm.
  const following = link?.status === 'waiting' ? link.id : null
  useEffect(() => {
    if (!following) return
    let ticks = 0
    const timer = setInterval(() => {
      if (++ticks > 60) {
        clearInterval(timer)
        setStillWaiting(true)
        return
      }
      if (document.visibilityState !== 'visible') return
      void client
        .list()
        .then(list => {
          const now = list.links.find(l => l.id === following)
          if (!now) {
            setGone(true)
            clearInterval(timer)
          } else if (now.status !== 'waiting') {
            setLink(now)
          }
        })
        .catch(() => undefined)
    }, 3000)
    return () => clearInterval(timer)
  }, [following])

  const accept = async () => {
    const trimmed = name.trim()
    if (!trimmed || working) return
    setWorking(true)
    setAcceptError(null)
    try {
      const made = await client.accept(invite, trimmed)
      keepName(trimmed)
      setLink(made)
    } catch (e) {
      setAcceptError(t('Could not link: {error}', { error: linksMessage(e) }))
    }
    setWorking(false)
  }

  const stopText = (preview: InvitePreview, existing: RoomLink | null): string | null => {
    const stop = previewStop(preview)
    if (!stop) return null
    if (stop.kind === 'own') return t("This invite is from your own Hermes. Send it to the person you're linking with.")
    if (stop.kind === 'expired') return t('This invite has run out. Ask {name} for a new one.', { name: preview.name })
    return t('Your Hermes is already linked with {name}.', { name: existing?.name ?? preview.name })
  }

  return (
    <Sheet title={t('Link invite')} working={working} done={!!link} onClose={onClose}>
      {read ? (
        <>
          <h3 className="link-ask">{t('Link with {name}?', { name: read.preview.name })}</h3>
          <p className="meta">{t(ABOUT)}</p>
          <WordsCard
            title={t("{name}'s Hermes", { name: read.preview.name })}
            words={read.preview.words}
            caption={t("Check that these are the four words {name}'s Conduit shows for their Hermes. If they don't match, the invite isn't from them: don't link.", {
              name: read.preview.name
            })}
          />
          <dl className="link-details">
            <dt>{t('From')}</dt>
            <dd>{read.preview.name}</dd>
            <dt>{t('Mailbox')}</dt>
            <dd>{read.preview.mailbox}</dd>
            <dt>{t('Works until')}</dt>
            <dd>{until(read.preview.expiresAt)}</dd>
          </dl>
          {link ? (
            <>
              {acceptError ? <p className="error-text">{acceptError}</p> : null}
              {gone ? (
                <p className="warning-text">{t('This Link is gone from your Hermes. Ask {name} for a new invite.', { name: link.name })}</p>
              ) : link.status === 'linked' ? (
                <>
                  <p className="success-text">{t('Linked with {name}', { name: link.name })}</p>
                  <p className="meta">{t('Your agents and theirs can now join rooms together. Settings › Multiplayer lists your Links.')}</p>
                </>
              ) : stillWaiting ? (
                <p className="meta">
                  {t("{name}'s Hermes hasn't confirmed yet. It does once it reads its mailbox, and Settings › Multiplayer shows when it has.", { name: link.name })}
                </p>
              ) : (
                <p className="meta">{linkStatus(link)}</p>
              )}
            </>
          ) : stopText(read.preview, read.existing) ? (
            <p className="meta">{stopText(read.preview, read.existing)}</p>
          ) : (
            <form
              onSubmit={e => {
                e.preventDefault()
                void accept()
              }}
            >
              <NameField name={name} setName={setName} caption={t('{name} sees you by this name.', { name: read.preview.name })} />
              {acceptError ? <p className="error-text">{acceptError}</p> : null}
              <div className="link-actions">
                <button type="submit" className="primary" disabled={working || !name.trim()}>
                  {working ? t('Working…') : t('Link with {name}', { name: read.preview.name })}
                </button>
              </div>
            </form>
          )}
        </>
      ) : readError ? (
        <>
          <p className="error-text">{readError}</p>
          <button className="secondary" onClick={() => void load()}>
            {t('Try again')}
          </button>
        </>
      ) : (
        <p className="meta">{t('Loading…')}</p>
      )}
    </Sheet>
  )
}
