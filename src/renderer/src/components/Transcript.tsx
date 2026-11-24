import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import { mediaKind, splitReply } from '../state/media'
import { PagePreview } from './PagePreview'
import { baseName, type Attachment } from '../state/text'
import { displayName } from '../state/attachments'
import type { PendingRequest } from '@shared/ipc'
import { TAPBACKS, type Reaction, type ToolItem, type TranscriptItem, type TranscriptState } from '../state/transcript'
import { useTranscript, type TranscriptStore } from '../state/transcriptStore'
import type { DelegationEntry } from '../state/timeline'
import { ExpiredClarifyCard, RequestCard } from './RequestCard'
import type { ExpiredQuestion } from '../state/expiredQuestions'
import { Icon, type IconName } from './icons'
import { JumpToLatest } from './JumpToLatest'
import { atEnd } from '../state/scrollEnd'
import { heldStart, nearTop, olderStart, registerRowOpener, rowElement, rowIndex, rowKey, rowWindow, startAt } from '../state/rowWindow'
import { WorkLinkCard, WorkLinks } from './WorkLinkCard'
import { linkNamedRefs, linkSessionRefs, splitWorkLinks } from '../state/workLinks'
import { Markdown, StreamingMarkdown } from './Markdown'
import { GatewayPicture, PictureImage, PictureProfile } from './Picture'
import { gateway } from '../gateway'
import { readDataUrlPath } from '../state/gatewayPictures'
import { saveHostFile, sayIfFailed } from '../state/saveMedia'
import { formatDate, locale, t } from '@shared/i18n'
import { blockquote, copyableReply, excerpt, parseReplyEnvelope, sameQuotedText, type QuoteRequest } from '../state/quote'
import { BoardView } from './BoardView'
import { DEFAULT_DISPLAY, type ChatDisplay } from '../state/display'
import { readAloud, stopReading, useReadingKey } from '../state/readAloud'
import { VOICE_FILE_PREFIX, parseVoiceMessage } from '../state/voice'
import { foldRuns, isStep, span, spanText, type Row } from '../state/runs'
import { useStepSummaries, type StepSummaries } from '../state/useStepSummaries'
import { callLength, withCalls, type ChatCall } from '../state/voiceCalls'
import { followedUpKeys } from '../state/predictive'
import { ConnectionCardView } from './ConnectionCardView'
import { PinnedReplyBar, type PinControls } from './PinnedReplies'
import { barOrder, pinFor, pinForPassage, pinnedWhole, refreshed, resolved } from '../state/pinnedReplies'
import { delivery, inbound, teammateName, teammateReplies } from '../state/teammateMessages'
import { ask } from '../state/dialogs'

export interface MessageMenuItem {
  label: string
  onSelect: () => void
}

/** Read aloud's button in a reply's row: playing turns it into Stop. */
export interface ReadControls {
  reading: boolean
  onToggle: () => void
}

/** React, Copy, Read aloud, and ⋯ with the rest (Quote, Retry…), under a message on hover: the phone's reply row. */
export function MessageActions({ copy, menu = [], react, read }: { copy: string; menu?: MessageMenuItem[]; react?: ReactControls; read?: ReadControls }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => {
    if (!picking) return
    const close = () => setPicking(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [picking])
  const mine = react?.reactions.find(r => r.author === 'user')?.emoji
  return (
    <div className={`message-actions${open || picking || read?.reading ? ' open' : ''}`}>
      {react ? (
        <span className="message-more">
          <button
            className="message-action"
            aria-label={mine ? t('Change your reaction') : t('React to this response')}
            title={mine ? t('Change your reaction') : t('React to this response')}
            aria-haspopup="menu"
            aria-expanded={picking}
            onClick={e => {
              e.stopPropagation()
              setOpen(false)
              setPicking(p => !p)
            }}
          >
            <Icon name="smile" />
          </button>
          {picking ? (
            <div className="host-menu reaction-picker" role="menu">
              {TAPBACKS.map(emoji => (
                <button
                  key={emoji}
                  role="menuitemradio"
                  aria-checked={mine === emoji}
                  className={mine === emoji ? 'chosen' : undefined}
                  aria-label={mine === emoji ? t('Remove reaction {emoji}', { emoji }) : t('React with {emoji}', { emoji })}
                  title={mine === emoji ? t('Remove reaction {emoji}', { emoji }) : t('React with {emoji}', { emoji })}
                  onClick={() => {
                    setPicking(false)
                    react.onPick(mine === emoji ? null : emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </span>
      ) : null}
      <button
        className="message-action"
        aria-label={copied ? t('Copied') : t('Copy')}
        title={copied ? t('Copied') : t('Copy')}
        onClick={() => {
          window.conduit.copyText(copy)
          setCopied(true)
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
      {read ? (
        <button
          className={`message-action${read.reading ? ' active' : ''}`}
          aria-label={read.reading ? t('Stop reading response') : t('Read Aloud')}
          title={read.reading ? t('Stop reading response') : t('Read Aloud')}
          aria-pressed={read.reading}
          onClick={read.onToggle}
        >
          <Icon name={read.reading ? 'stop' : 'speaker'} />
        </button>
      ) : null}
      {menu.length ? (
        <span className="message-more">
          <button
            className="message-action"
            aria-label={t('More')}
            title={t('More')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={e => {
              e.stopPropagation()
              setPicking(false)
              setOpen(o => !o)
            }}
          >
            <Icon name="more" />
          </button>
          {open ? (
            <div className="host-menu message-menu" role="menu">
              {menu.map(item => (
                <button
                  key={item.label}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

/** A reply's reactions and the pick that changes yours (null takes it back). */
export interface ReactControls {
  reactions: Reaction[]
  onPick: (emoji: string | null) => void
}

/** The reactions under a reply, one chip per emoji with its count; yours is outlined, and a click on it takes it back. */
export function ReactionChips({ reactions, author, onPick }: { reactions: Reaction[]; author: string; onPick?: (emoji: string | null) => void }) {
  if (!reactions.length) return null
  const groups: { emoji: string; authors: string[] }[] = []
  for (const r of reactions) {
    const group = groups.find(g => g.emoji === r.emoji)
    if (group) group.authors.push(r.author)
    else groups.push({ emoji: r.emoji, authors: [r.author] })
  }
  return (
    <div className="reaction-chips">
      {groups.map(({ emoji, authors }) => {
        const mine = authors.includes('user')
        const others = authors.filter(a => a !== 'user').length > 0
        const label =
          mine && others
            ? t('You and {name} reacted {emoji}', { name: author, emoji })
            : mine
              ? t('You reacted {emoji}', { emoji })
              : t('{name} reacted {emoji}', { name: author, emoji })
        const click = mine && onPick ? () => onPick(null) : undefined
        return (
          <button
            key={emoji}
            className={`reaction-chip${mine ? ' mine' : ''}`}
            aria-label={click ? `${label}. ${t('Remove reaction {emoji}', { emoji })}` : label}
            title={label}
            disabled={!click}
            onClick={click}
          >
            <span aria-hidden="true">{emoji}</span>
            {authors.length > 1 ? <span className="reaction-count">{authors.length}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** The "Replying to" card on a sent message: the quoted message in a line, a click away. */
export function QuotedCard({ name, quote, onJump }: { name: string; quote: string; onJump?: () => void }) {
  return (
    <button className="quoted-card" title={onJump ? t('Show the message') : quote} onClick={onJump} disabled={!onJump}>
      <span className="quoted-card-name">{t('Replying to {name}', { name })}</span>
      <span className="quoted-card-text">{excerpt(quote)}</span>
    </button>
  )
}

/** Scrolls to the message a card quoted and flashes it, drawing it first when a window left it out (rowWindow.ts). */
export function revealMessage(container: HTMLElement | null, key: string | undefined) {
  if (!container || !key) return
  const el = rowElement(container, key)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

/** What a passage search skips in a reply: its action row and notes, which aren't the reply's words. */
const NOT_REPLY_TEXT = '.message-actions, .message-menu, .read-problem, .followed-up'

/**
 * The range of `passage` in a reply's drawn text, whitespace aside (the
 * selection it was pinned from may have had line breaks between blocks
 * that the text nodes don't), or null when the reply doesn't show it.
 */
export function passageRange(root: HTMLElement, passage: string): Range | null {
  const target = passage.replace(/\s+/g, '')
  if (!target) return null
  const chars: string[] = []
  const at: { node: Text; offset: number }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest(NOT_REPLY_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  })
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.data
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i]!)) continue
      chars.push(text[i]!)
      at.push({ node, offset: i })
    }
  }
  const index = chars.join('').indexOf(target)
  if (index < 0) return null
  const start = at[index]!
  const end = at[index + target.length - 1]!
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}

const PASSAGE_HIGHLIGHT = 'pinned-passage'
let passageTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Scrolls to a pinned passage in its reply and marks it for a moment, as
 * the phone flashes it; a reply that no longer shows the passage gets the
 * whole reply's flash.
 */
export function revealPassage(container: HTMLElement | null, key: string | undefined, passage: string) {
  if (!container || !key) return
  const el = rowElement(container, key)
  const range = el ? passageRange(el, passage) : null
  if (!range) return revealMessage(container, key)
  const box = range.getBoundingClientRect()
  const frame = container.getBoundingClientRect()
  container.scrollTo({ top: container.scrollTop + box.top - frame.top - frame.height / 2 + box.height / 2, behavior: 'smooth' })
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  const Mark = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!highlights || !Mark) return
  highlights.set(PASSAGE_HIGHLIGHT, new Mark(range))
  if (passageTimer) clearTimeout(passageTimer)
  passageTimer = setTimeout(() => highlights.delete(PASSAGE_HIGHLIGHT), 2400)
}

/** A reply's selection: its text and the row it's in, when it lies within one finished reply. */
function replySelection(): { key: string; text: string } | null {
  const selection = window.getSelection()
  const text = selection?.toString() ?? ''
  if (!selection || selection.rangeCount === 0 || !text.trim()) return null
  const range = selection.getRangeAt(0)
  const replyOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.assistant[data-key]')
  const start = replyOf(range.startContainer)
  if (!start || start !== replyOf(range.endContainer) || !start.dataset.key) return null
  return { key: start.dataset.key, text }
}

/** The menu for text selected in a reply (right-click): Copy, Quote and Pin, as the phone's selection menu. */
function SelectionMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MessageMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(at)
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPlace({ x: Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - box.height - 8)) })
  }, [at])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', onClose)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onClose)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return (
    <div ref={ref} className="host-menu message-menu selection-menu" role="menu" style={{ left: place.x, top: place.y }} onMouseDown={e => e.stopPropagation()}>
      {items.map(item => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** Words /undo gave back, for the draft: a message that replied to another gets its "Replying to" chip back. */
export function prefillRequest(text: string, author: string): QuoteRequest {
  const envelope = parseReplyEnvelope(text)
  return envelope
    ? ({ id: ++quoteIds, draft: envelope.message, reply: { author, text: envelope.quote } } as QuoteRequest)
    : ({ id: ++quoteIds, draft: text } as QuoteRequest)
}

let quoteIds = 0
/** A fresh quote request. */
export function quoteRequest(content: { text: string } | { reply: { author: string; text: string } } | { draft: string } | { insert: string }): QuoteRequest {
  return { id: ++quoteIds, ...content } as QuoteRequest
}

const MEDIA_ICONS: Record<ReturnType<typeof mediaKind>, IconName> = { image: 'image', audio: 'audio', video: 'video', file: 'file' }

/** A file Hermes delivered (`MEDIA:`) or a message named (`@file:`): its name, with the full path on hover. */
function FileCard({ path, label, link }: { path: string; label?: string; link?: boolean }) {
  const profile = useContext(PictureProfile)
  const [audio, setAudio] = useState<'loading' | 'failed' | { src: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const name = label || (link ? path : baseName(path))
  const folder = path.slice(0, Math.max(0, path.length - baseName(path).length)).replace(/[\\/]+$/, '')
  const kind = mediaKind(path)
  const play = async () => {
    setAudio('loading')
    try {
      const answer = (await gateway.http('GET', readDataUrlPath(path, profile))) as { dataUrl?: unknown } | null
      const src = typeof answer?.dataUrl === 'string' && answer.dataUrl.startsWith('data:') ? answer.dataUrl : null
      setAudio(src ? { src } : 'failed')
    } catch {
      setAudio('failed')
    }
  }
  const download = async () => {
    setSaving(true)
    try {
      sayIfFailed(await saveHostFile(path, profile))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="file-card" title={path}>
      <div className="file-card-row">
        <span className="file-icon">
          <Icon name={link ? 'link' : MEDIA_ICONS[kind]} />
        </span>
        <span className="file-body">
          <span className="file-name">{name}</span>
          {!link && folder ? <span className="file-path">{folder}</span> : null}
        </span>
        {link ? null : (
          <span className="file-actions">
            {kind === 'audio' && (audio === null || audio === 'failed') ? (
              <button className="secondary" onClick={() => void play()}>
                {t('Play')}
              </button>
            ) : null}
            <button className="secondary" disabled={saving} onClick={() => void download()}>
              {t('Download')}
            </button>
          </span>
        )}
      </div>
      {audio === 'loading' ? <span className="meta">{t('Loading…')}</span> : null}
      {audio === 'failed' ? <span className="meta error-text">{t("Couldn't open this file")}</span> : null}
      {audio && typeof audio === 'object' ? <audio className="file-audio" controls autoPlay src={audio.src} /> : null}
    </div>
  )
}

function FileChip({ attachment: a }: { attachment: Attachment }) {
  return (
    <span className="chip" title={a.value}>
      <Icon name={a.kind === 'image' ? 'image' : 'file'} />
      <span>{displayName(baseName(a.value))}</span>
    </span>
  )
}

function AttachmentChips({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="attachments">
      {attachments.map((a, i) =>
        a.kind === 'url' ? (
          <a key={i} className="chip" href={a.value} target="_blank" rel="noreferrer" title={a.value}>
            <Icon name="link" />
            <span>{a.value.replace(/^https?:\/\//, '')}</span>
          </a>
        ) : a.kind === 'image' && a.preview ? (
          <PictureImage key={i} src={a.preview} name={baseName(a.value)} />
        ) : a.kind === 'image' ? (
          <GatewayPicture key={i} path={a.value} name={baseName(a.value)} fallback={<FileChip attachment={a} />} />
        ) : (
          <FileChip key={i} attachment={a} />
        )
      )}
    </div>
  )
}

/** A reply's Markdown, with each `MEDIA:` file as a card where the tag stood. */
export const Reply = memo(function Reply({ text, streaming = false }: { text: string; streaming?: boolean }) {
  // Its links to its work become cards under it, and Hermes' references to chats links to them (workLinks).
  const links = useContext(WorkLinks)
  // Only where a card can open its chat: elsewhere (a chat beside, a window, a room) the reply stays as written.
  const split = useMemo(() => (links ? splitWorkLinks(text) : null), [text, links])
  const shown = useMemo(() => {
    const words = split ? split.text : text
    if (!links) return words
    const referred = linkSessionRefs(words, links.titleOf, t('Open chat'))
    return links.chatOf ? linkNamedRefs(referred, links.chatOf) : referred
  }, [split, text, links])
  const blocks = useMemo(() => splitReply(shown), [shown])
  // While it streams, its markdown parses in blocks, only the open last one again per delta (desktop#198).
  const Text = streaming ? StreamingMarkdown : Markdown
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'markdown' ? (
          <Text key={i} text={block.text} />
        ) : block.kind === 'preview' ? (
          <PagePreview key={i} path={block.path} name={baseName(block.path)} fallback={<FileCard path={block.path} />} />
        ) : mediaKind(block.path) === 'image' ? (
          <GatewayPicture
            key={i}
            path={block.path}
            name={block.alt || baseName(block.path)}
            className="reply-picture"
            fallback={<FileCard path={block.path} label={block.alt} />}
          />
        ) : (
          <FileCard key={i} path={block.path} label={block.alt} />
        )
      )}
      {split ? (
        <div className="work-links">
          {split.links.map(link => (
            <WorkLinkCard key={link.ref} link={link} />
          ))}
        </div>
      ) : null}
    </>
  )
})

export function clock(ms?: number): string {
  return ms ? formatDate(ms, { hour: 'numeric', minute: '2-digit' }) : ''
}

/** "terminal" → "Ran a command", the way the phone names its tool steps. */
function toolTitle(name: string, done: boolean): string {
  const known: Record<string, [string, string]> = {
    terminal: [t('Running a command'), t('Ran a command')],
    execute_code: [t('Running code'), t('Ran code')],
    read_file: [t('Reading a file'), t('Read a file')],
    write_file: [t('Writing a file'), t('Wrote a file')],
    patch: [t('Editing a file'), t('Edited a file')],
    search_files: [t('Searching files'), t('Searched files')],
    web_search: [t('Searching the web'), t('Searched the web')],
    web_extract: [t('Reading a page'), t('Read a page')],
    browser_navigate: [t('Opening a page'), t('Opened a page')],
    memory: [t('Updating memory'), t('Updated memory')],
    todo: [t('Updating the plan'), t('Updated the plan')],
    delegate_task: [t('Handing off a task'), t('Handed off a task')]
  }
  const pair = known[name]
  if (pair) return done ? pair[1] : pair[0]
  const words = name.replace(/[_.-]+/g, ' ').trim()
  return done ? words.charAt(0).toUpperCase() + words.slice(1) : `${words.charAt(0).toUpperCase()}${words.slice(1)}…`
}

interface ItemProps {
  newest?: boolean
  /** This reply answers a turn Hermes took on its own (Predictive follow-ups). */
  followedUp?: boolean
  item: TranscriptItem
  /** Who answers in this chat, for "Replying to". */
  author: string
  /** The answering bot's picture, heading each reply with its name and time, as on the phone. */
  /** The bot's face on a reply, moving on the newest one. */
  face?: (moving: boolean) => React.ReactNode
  onQuote?: (request: QuoteRequest) => void
  /** The card's click for a quote, when the quoted reply is loaded. */
  jump: (quote: string) => (() => void) | undefined
  /** ⋯'s Retry, on the newest reply while it answers the last message sent. */
  onRetry?: () => void
  /** ⋯'s Edit and resend on this message of yours. */
  onEdit?: () => void
  /** A board's follow-up, sent as the user's message: on the last turn's last board. */
  onFollowUp?: (text: string) => void
  /** ⋯'s Show thinking or Hide thinking, on a reply while Thinking is On request. */
  thinkingToggle?: { label: string; onSelect: () => void }
  /** Settings > Chat > Keep tool cards expanded. */
  expandTools?: boolean
  /** A saved call's card opens its transcript. */
  onOpenCall?: (callId: string) => void
  /** ⋯'s Pin reply or Unpin reply. */
  pinToggle?: { label: string; onSelect: () => void }
  /** The bots, for a teammate's name on its messages. */
  teammates?: { name: string; title: string }[]
  /** The teammate this reply answers: folded under "Replied to Atlas", since it isn't for the user. */
  repliedTo?: string
  /** React on a reply Hermes can address now; the chips show either way. */
  onReact?: (emoji: string | null) => void
  /** ⋯'s Branch: a new chat with the turns through this reply. */
  onBranch?: () => void
}

/** A reply's Copy and ⋯, with Read Aloud (Stop reading response while it plays). */
const outcomeLabel = (outcome: DelegationEntry['outcome']) =>
  outcome === 'completed' ? t('Completed') : outcome === 'incomplete' ? t('Incomplete') : outcome === 'stopped' ? t('Interrupted') : t('Failed')
const outcomeMark = { completed: '✓', incomplete: '⚠', stopped: '■', failed: '✕' }

/** Background agents finished, after the phone's DelegationReportCard: each agent's goal and how it ended; Show all opens their results. */
function DelegationCard({ title, entries, at }: { title: string; entries: DelegationEntry[]; at?: number }) {
  const [open, setOpen] = useState(false)
  const shown = open ? entries : entries.slice(0, 6)
  return (
    <div className="delegation-card">
      <div className="delegation-head">
        <span className="review-label">{t('System')}</span>
        <span className="spacer" />
        {at ? <span className="meta">{clock(at)}</span> : null}
      </div>
      <div className="delegation-title">
        <strong>{title}</strong>
        <span className="spacer" />
        <button className="link" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? t('Show less') : t('Show all')}
        </button>
      </div>
      <ul>
        {shown.map(entry => {
          const time = entry.duration != null ? `${entry.duration < 10 ? entry.duration.toFixed(1) : Math.round(entry.duration)}s` : null
          const caption =
            entry.outcome === 'completed' ? (time ?? outcomeLabel(entry.outcome)) : [outcomeLabel(entry.outcome), time].filter(Boolean).join(' · ')
          return (
            <li key={entry.number} className={`delegation-entry ${entry.outcome}`}>
              <div className="delegation-line">
                <span className="delegation-mark" aria-hidden="true">
                  {outcomeMark[entry.outcome]}
                </span>
                <span className={open ? 'delegation-goal' : 'delegation-goal folded'}>{entry.goal || t('Delegate agent')}</span>
                <span className="meta">{caption}</span>
              </div>
              {open && entry.result ? (
                <div className="delegation-result">
                  <Markdown text={entry.result} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {!open && entries.length > 6 ? <span className="meta">{t('{count} more', { count: String(entries.length - 6) })}</span> : null}
    </div>
  )
}

/** A scheduled job's report the bot was only shown, after the phone's CronReportCard: folded to a preview, Show all opens it. */
/** A voice call saved with this chat, where it started, after the phone's VoiceCallMarkerCard. */
function CallCard({ startedAt, endedAt, onOpen }: { startedAt: number; endedAt: number; onOpen?: () => void }) {
  const length = callLength(endedAt - startedAt)
  return (
    <button
      className="call-card"
      onClick={onOpen}
      disabled={!onOpen}
      aria-label={`${t('Voice call')}, ${length}, ${t('Started {time}', { time: clock(startedAt) })}`}
    >
      <span className="call-card-icon" aria-hidden="true">
        <Icon name="phone" />
      </span>
      <span className="call-card-text">
        <strong>{t('Voice call')}</strong>
        <span className="meta">{t('{duration} · Open transcript', { duration: length })}</span>
      </span>
      <span className="call-card-time">{clock(startedAt)}</span>
      <Icon name="chevron" />
    </button>
  )
}

function CronReportCard({ job, report, at }: { job: string; report: string; at?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cron-report">
      <div className="cron-report-head">
        <Icon name="clock" />
        <strong>{job}</strong>
        <span className="spacer" />
        {report ? (
          <button className="link" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? t('Show less') : t('Show all')}
          </button>
        ) : null}
      </div>
      {report ? <div className={open ? 'cron-report-body' : 'cron-report-body folded'}>{open ? <Markdown text={report} /> : report}</div> : null}
      <span className="meta">
        {t('Scheduled job report')}
        {at ? ` · ${clock(at)}` : ''}
      </span>
    </div>
  )
}

function ReplyActions({ messageKey, text, menu, react }: { messageKey: string; text: string; menu: MessageMenuItem[]; react?: ReactControls }) {
  const reading = useReadingKey() === messageKey
  const profile = useContext(PictureProfile)
  const [problem, setProblem] = useState<string | null>(null)
  const read: ReadControls = {
    reading,
    onToggle: () => {
      setProblem(null)
      if (reading) return stopReading()
      readAloud(messageKey, text, profile).catch(e => setProblem(e instanceof Error ? e.message : String(e)))
    }
  }
  return (
    <>
      <MessageActions copy={copyableReply(text)} menu={menu} react={react} read={read} />
      {problem ? (
        <div className="read-problem" role="status">
          {t("Hermes couldn't read this aloud: {error}", { error: problem })}
        </div>
      ) : null}
    </>
  )
}

/**
 * Items redraw only when what they show changes (desktop#197): a streaming
 * delta changes the last item, and every other one is skipped. The
 * Transcript hands them callbacks that keep one identity and read its
 * latest state, so only whether each is offered, and the labels, count.
 */
const offered = (a: unknown, b: unknown) => !a === !b
function sameItemProps(a: ItemProps, b: ItemProps): boolean {
  return (
    a.item === b.item &&
    a.author === b.author &&
    a.followedUp === b.followedUp &&
    a.expandTools === b.expandTools &&
    a.repliedTo === b.repliedTo &&
    a.jump === b.jump &&
    a.face === b.face &&
    a.newest === b.newest &&
    sameTeammates(a.teammates, b.teammates) &&
    a.thinkingToggle?.label === b.thinkingToggle?.label &&
    a.pinToggle?.label === b.pinToggle?.label &&
    offered(a.onQuote, b.onQuote) &&
    offered(a.onRetry, b.onRetry) &&
    offered(a.onEdit, b.onEdit) &&
    offered(a.onFollowUp, b.onFollowUp) &&
    offered(a.onOpenCall, b.onOpenCall) &&
    offered(a.onReact, b.onReact) &&
    offered(a.onBranch, b.onBranch)
  )
}
const sameTeammates = (a: ItemProps['teammates'], b: ItemProps['teammates']) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x.name === b[i]!.name && x.title === b[i]!.title))

const Item = memo(function Item({
  item,
  author,
  face,
  newest,
  onQuote,
  jump,
  onRetry,
  onEdit,
  onFollowUp,
  thinkingToggle,
  expandTools,
  onOpenCall,
  followedUp,
  pinToggle,
  teammates,
  repliedTo,
  onReact,
  onBranch
}: ItemProps) {
  switch (item.kind) {
    case 'user': {
      // A teammate's delivery: a note with its name, what it said one click away.
      const teammate = inbound(item.text)
      if (teammate)
        return (
          <details className="teammate-note" data-key={item.key}>
            <summary>
              <Icon name="bots" />
              {t('Message from {name}', { name: teammateName(teammate.handle, teammates, teammate.sender) })}
              <span className="time">{clock(item.at)}</span>
            </summary>
            {teammate.body ? <Reply text={teammate.body} /> : null}
          </details>
        )
      const envelope = parseReplyEnvelope(item.text)
      const words = envelope ? envelope.message : item.text
      const voice = parseVoiceMessage(words)
      // A voice message's audio is the message itself, not a file beside it.
      const files = voice ? item.attachments?.filter(a => !baseName(a.value).includes(VOICE_FILE_PREFIX)) : item.attachments
      return (
        <div className={`user${item.pending ? ' pending' : ''}`} data-key={item.key}>
          {envelope ? <QuotedCard name={author} quote={envelope.quote} onJump={jump(envelope.quote)} /> : null}
          {files?.length ? <AttachmentChips attachments={files} /> : null}
          {voice ? (
            <div className="bubble voice-bubble">
              <span className="voice-head">
                <Icon name="mic" />
                {t('Voice message')} · {voice.duration}
              </span>
              {voice.transcript ? <span>{voice.transcript}</span> : null}
            </div>
          ) : words.trim() ? (
            <div className="bubble">{words}</div>
          ) : null}
          <span className="time">{item.pending ? t('Sending…') : clock(item.at)}</span>
          {!item.pending && words.trim() ? (
            <MessageActions
              copy={voice ? voice.transcript || words : words}
              menu={[
                ...(onQuote ? [{ label: t('Quote'), onSelect: () => onQuote(quoteRequest({ text: blockquote(words) })) }] : []),
                ...(onEdit ? [{ label: t('Edit and resend'), onSelect: onEdit }] : [])
              ]}
            />
          ) : null}
        </div>
      )
    }
    case 'assistant': {
      const reply = (
        <div className={`assistant${item.streaming ? ' streaming' : ''}`} data-key={item.key}>
          <div className="reply-head">
            {face?.(!!newest) ?? (
              <span className="reply-mark" aria-hidden="true">
                {author.trim().charAt(0).toUpperCase() || 'H'}
              </span>
            )}
            <span className="reply-name">{author}</span>
            {item.at ? <span className="time">{clock(item.at)}</span> : null}
          </div>
          {followedUp ? (
            <span className="followed-up">
              <span aria-hidden="true">✦</span>
              {t('Hermes followed up')}
            </span>
          ) : null}
          <Reply text={item.text} streaming={item.streaming} />
          <ReactionChips reactions={item.reactions ?? []} author={author} onPick={onReact} />
          {!item.streaming && item.text.trim() ? (
            <ReplyActions
              messageKey={item.key}
              text={item.text}
              react={onReact ? { reactions: item.reactions ?? [], onPick: onReact } : undefined}
              menu={[
                ...(onQuote ? [{ label: t('Quote'), onSelect: () => onQuote(quoteRequest({ reply: { author, text: item.text } })) }] : []),
                ...(onBranch ? [{ label: t('Branch'), onSelect: onBranch }] : []),
                ...(onRetry ? [{ label: t('Retry'), onSelect: onRetry }] : []),
                ...(pinToggle ? [pinToggle] : []),
                ...(thinkingToggle ? [thinkingToggle] : [])
              ]}
            />
          ) : null}
        </div>
      )
      // The bot answering a teammate, not the user: folded, the reply a click away, as the phone and Hermes Desktop show it.
      if (repliedTo)
        return (
          <details className="teammate-reply">
            <summary>
              <Icon name="send" />
              {t('Replied to {name}', { name: teammateName(repliedTo, teammates) })}
            </summary>
            {reply}
          </details>
        )
      return reply
    }
    case 'thinking':
      return (
        <details className="thinking">
          <summary>
            <Icon name="chats" />
            {item.streaming ? t('Thinking…') : t('Thought')}
            <span className="show">{t('Show')}</span>
          </summary>
          <div className="thinking-text">{item.text}</div>
        </details>
      )
    case 'tool': {
      const done = item.status === 'done'
      if (item.board) return <BoardView board={item.board} onFollowUp={onFollowUp} />
      // A message to a teammate reads as one: "Messaged Atlas" and what was said.
      const sent = delivery(item.name, item.args)
      const sentTo = sent ? teammateName(sent.target, teammates) : null
      const head = (
        <>
          <span className={`card-icon${done ? '' : ' running'}`}>
            <Icon name={done ? 'code' : 'spinner'} style={done ? undefined : { animation: 'spin 1s linear infinite' }} />
          </span>
          <span className="card-body">
            <span className="card-title">
              {sentTo ? (done ? t('Messaged {name}', { name: sentTo }) : t('Messaging {name}…', { name: sentTo })) : toolTitle(item.name, done)}{' '}
              {item.durationS != null ? <span className="time">{item.durationS.toFixed(1)}s</span> : null}
            </span>
            {sent?.message ? (
              <span className="card-detail">{sent.message}</span>
            ) : item.context || item.summary ? (
              <span className="card-detail">{item.summary || item.context}</span>
            ) : null}
          </span>
        </>
      )
      // A finished call's arguments and result open under it, kept open by Settings > Chat.
      if (!done || (!item.args && !item.result)) return <div className="card">{head}</div>
      return (
        <details className="card-details" open={expandTools}>
          <summary className="card">{head}</summary>
          {item.args ? (
            <div className="card-section">
              <span className="meta">{t('Input')}</span>
              <pre>{item.args}</pre>
            </div>
          ) : null}
          {item.result ? (
            <div className="card-section">
              <span className="meta">{t('Output')}</span>
              <pre>{item.result}</pre>
            </div>
          ) : null}
        </details>
      )
    }
    case 'delegation':
      return <DelegationCard title={item.title} entries={item.entries} at={item.at} />
    case 'call':
      return <CallCard startedAt={item.startedAt} endedAt={item.endedAt} onOpen={onOpenCall ? () => onOpenCall(item.callId) : undefined} />
    case 'cron':
      return <CronReportCard job={item.job} report={item.report} at={item.at} />
    case 'review':
      return (
        <details className="review-card" data-key={item.key}>
          <summary>
            <span className="review-label">{t('SELF-IMPROVEMENT REVIEW')}</span>
            <span className="review-summary">{item.summary}</span>
          </summary>
          {item.details.length ? (
            <ul>
              {item.details.map(detail => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </details>
      )
    case 'notice':
      return <div className={`notice${item.tone === 'error' ? ' error' : ''}`}>{item.text}</div>
    case 'connection':
      return <ConnectionCardView card={item.card} />
    case 'output':
      return (
        <div className="command-output" data-key={item.key}>
          {item.command ? <div className="command-name">{item.command}</div> : null}
          {item.format === 'plain' ? (
            <pre>{item.text}</pre>
          ) : (
            <div className="assistant">
              <Markdown text={item.text} />
            </div>
          )}
        </div>
      )
  }
}, sameItemProps)

/**
 * A turn's run of steps as one card, after the phone's ChatStepGroupHeader:
 * "4 steps · 12s", folded once the turn is done unless Keep tool cards
 * expanded is on, open while it runs; the reader's choice holds after.
 */
function StepRun({
  row,
  live,
  expandTools,
  summaries,
  children
}: {
  row: Extract<Row, { type: 'steps' }>
  live: boolean
  expandTools: boolean
  summaries: StepSummaries
  children: React.ReactNode
}) {
  const summary = summaries.summary(row.items)
  const lookingBack = summaries.lookingBack(row.items)
  const explain = live ? undefined : summaries.explain(row.items)
  const [choice, setChoice] = useState<boolean | null>(null)
  const open = choice ?? (live || expandTools)
  const count = t('{count} steps', { count: String(row.items.length) })
  const time = live ? null : spanText(span(row.items), locale())
  const thoughts = row.items.some(i => i.kind === 'thinking')
  const tools = row.items.some(i => i.kind === 'tool')
  return (
    <div className={open ? 'step-run open' : 'step-run'} data-key={row.id}>
      <button className="step-run-head" aria-expanded={open} onClick={() => setChoice(!open)}>
        <span className="step-run-icons" aria-hidden>
          {thoughts ? <Icon name="chats" /> : null}
          {tools ? <Icon name="code" /> : null}
        </span>
        <span className="step-run-title">{time ? `${count} · ${time}` : count}</span>
        <Icon name="chevron" className="step-run-chevron" />
      </button>
      {summary ? <p className="step-run-summary">{summary}</p> : null}
      {lookingBack ? (
        <p className="step-run-summary looking">
          <span className="running" /> {t('Hermes is looking back…')}
        </p>
      ) : null}
      {open ? (
        <div className="step-run-body">
          {children}
          {explain && !lookingBack ? (
            <button className="link step-run-explain" onClick={explain}>
              {summary ? t('Explain again') : t('Explain these steps')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** A step on its own, after the phone's singleExplained: its card, then what Hermes said about it when asked (Explain this step). */
function LoneStep({ step, live, summaries, children }: { step: ToolItem; live: boolean; summaries: StepSummaries; children: React.ReactNode }) {
  const steps = [step]
  const summary = summaries.summary(steps)
  const lookingBack = summaries.lookingBack(steps)
  const explain = live || lookingBack ? undefined : summaries.explain(steps)
  return (
    <div className="lone-step">
      {children}
      {summary ? <p className="step-run-summary">{summary}</p> : null}
      {lookingBack ? (
        <p className="step-run-summary looking">
          <span className="running" /> {t('Hermes is looking back…')}
        </p>
      ) : null}
      {explain ? (
        <button className="link step-run-explain lone" onClick={explain}>
          {summary ? t('Explain again') : t('Explain this step')}
        </button>
      ) : null}
    </div>
  )
}

/** Consecutive self-improvement reviews as one line, after the phone's ChatReviewRun: folded until opened. */
function ReviewRun({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={open ? 'review-run open' : 'review-run'}>
      <button className="step-run-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="step-run-title">{t('{count} self-improvement reviews', { count: String(count) })}</span>
        <Icon name="chevron" className="step-run-chevron" />
      </button>
      {open ? <div className="step-run-body">{children}</div> : null}
    </div>
  )
}

/** How long a jump's smooth scroll to its row may take, in ms. */
const JUMP_MS = 1500

/**
 * The open chat's transcript, from its store: only this runs as a reply
 * streams, not the window around it (desktop#212).
 */
export function LiveTranscript({ store, ...props }: Omit<ComponentProps<typeof Transcript>, 'state'> & { store: TranscriptStore }) {
  return <Transcript state={useTranscript(store)} {...props} />
}

export function Transcript({
  state,
  loading,
  error,
  requests = [],
  expired = [],
  profile,
  author = 'Hermes',
  face,
  onQuote,
  onCommand,
  display = DEFAULT_DISPLAY,
  sessionId,
  chatId,
  calls,
  onOpenCall,
  followedUp,
  pins,
  teammates,
  onReact,
  onBranch,
  onLoadOlder,
  loadingOlder = false,
  onSeekRow
}: {
  state: TranscriptState
  loading: boolean
  error: string | null
  /** The approvals and questions this chat waits on, drawn after its last item. */
  requests?: PendingRequest[]
  /** Questions Hermes stopped waiting for in this chat, kept to answer in a message. */
  expired?: ExpiredQuestion[]
  /** The chat's profile, whose files its pictures are read from. */
  profile?: string
  /** Who answers in this chat, named on "Replying to" and over each reply. */
  author?: string
  /** The answering bot's picture over each reply; its initial when left out. */
  /** The bot's face on a reply, moving on the newest one. */
  face?: (moving: boolean) => React.ReactNode
  /** Quote goes to the composer; without it there is only Copy. */
  onQuote?: (request: QuoteRequest) => void
  /** Runs a slash command for ⋯'s Retry (`/retry`) and Edit and resend (`/undo N`). */
  onCommand?: (command: string) => void
  /** The profile's Thinking and Tool cards settings. */
  display?: ChatDisplay
  /** The chat's runtime session, which step summaries ask about. */
  sessionId?: string
  /** The chat's own id where one pane draws chat after chat, so each opens at its newest rows. */
  chatId?: string
  /** Voice calls saved with this chat, each drawn as a card where it started. */
  calls?: ChatCall[]
  onOpenCall?: (callId: string) => void
  /** The replies that answer a turn Hermes took on its own, by `followUpId`. */
  followedUp?: Set<string>
  /** Pinned replies: ⋯'s Pin reply and the bar; left out where replies can't be pinned. */
  pins?: PinControls
  /** The bots, for a teammate's name on its messages and on a message sent to one. */
  teammates?: { name: string; title: string }[]
  /** Saves your reaction on a reply (null takes it back); left out where replies can't take one. */
  onReact?: (key: string, emoji: string | null) => void
  /** ⋯'s Branch on a reply; left out while a turn runs or the chat isn't open. */
  onBranch?: (key: string) => void
  /** Reads the stored page before the rows the chat holds; a chat opened on its newest page has more behind it (desktop#291). */
  onLoadOlder?: () => void
  /** Whether that page is on its way, drawn as a line above the rows. */
  loadingOlder?: boolean
  /** Reads the pages before until `found` says the chat holds the row a jump is after (useChat's seekRow). */
  onSeekRow?: (found: (items: readonly TranscriptItem[]) => boolean) => void
}) {
  const [thinkingShown, setThinkingShown] = useState(false)
  const showsThinking = display.thinking === 'show' || (display.thinking === 'on_request' && thinkingShown)
  const hasThinking = display.thinking === 'on_request' && state.items.some(i => i.kind === 'thinking')
  const thinkingToggle = hasThinking
    ? { label: thinkingShown ? t('Hide thinking') : t('Show thinking'), onSelect: () => setThinkingShown(shown => !shown) }
    : undefined
  const shown = useMemo(
    () =>
      withCalls(
        state.items.filter(item =>
          // A reply held back while it could still be a silence marker isn't drawn yet.
          item.kind === 'assistant'
            ? !!item.text.trim()
            : item.kind === 'thinking'
            ? showsThinking
            : item.kind === 'tool' && !item.board
              ? display.toolCards
              : item.kind === 'review'
                ? display.showReviews
                : true
        ),
        calls ?? []
      ),
    [state.items, showsThinking, display.toolCards, display.showReviews, calls]
  )
  const rows = useMemo(() => foldRuns(shown), [shown])
  // A chat past a window's worth of rows draws a window of them — its newest, and the
  // rows above them as the reader scrolls up (rowWindow.ts) — so a streaming reply
  // draws into its own row each frame instead of laying the whole history out again
  // (desktop#291).
  // Which chat the window belongs to: its id, since every chat's history rows carry the
  // same keys (row-0, row-1, …), and the row the window starts on (`anchor`), which a
  // pane with no id tells its chats apart by.
  const chatKey = chatId ?? ''
  const [windowed, setWindowed] = useState<{ chat?: string; start: number | null; anchor?: string }>({ start: null })
  // Another chat opened: its own newest rows, not the window the last one was left at.
  // Rows read in above the chat's (a page before the one it opened on) leave the window
  // on the rows it drew: it starts where its first row is now.
  const start = windowed.chat === chatKey ? heldStart(rows, windowed.start, windowed.anchor) : null
  const drawnWindow = rowWindow(rows.length, start)
  const drawn = drawnWindow.start > 0 ? rows.slice(drawnWindow.start, drawnWindow.end) : rows
  // What the scroll listener reads: the rows and the window as this frame has them.
  const liveRows = useRef({ rows, start: drawnWindow.start, scrolledUp: start !== null, chat: chatKey })
  liveRows.current.rows = rows
  liveRows.current.start = drawnWindow.start
  liveRows.current.scrolledUp = start !== null
  liveRows.current.chat = chatKey
  /** A window of this frame's rows starting at `from`, or the chat's newest rows (null). */
  const windowAt = (from: number | null) => {
    const { rows: thisFrame, chat } = liveRows.current
    const first = from === null ? undefined : thisFrame[from]
    return { chat, start: from, anchor: first ? rowKey(first) : undefined }
  }
  // The page before the chat's rows is read as the reader reaches the top of them (longChat.ts).
  const older = useRef(onLoadOlder)
  older.current = onLoadOlder
  const followedUpKeySet = useMemo(() => followedUpKeys(state.items, followedUp), [state.items, followedUp])
  const repliesToTeammates = useMemo(() => teammateReplies(state.items), [state.items])
  const summaries = useStepSummaries(state, sessionId, profile)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  /** Until when a jump to a row the window left out is scrolling to it. */
  const jumpUntil = useRef(0)
  // Another chat opens on its newest rows and follows them, wherever the last one was left (desktop#467).
  const pinnedChat = useRef(chatKey)
  if (pinnedChat.current !== chatKey) {
    pinnedChat.current = chatKey
    pinned.current = true
  }

  // Follow the reply while the reader is at the bottom; leave them be once they scroll up.
  // At the top of what's drawn the window takes on the rows above it, and back at the
  // bottom it gives them up again, so a long chat stays a window. Once the window holds
  // the chat's first row, the top asks for the stored page before it.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      // A jump to a row is on its way there: the window it drew stays, and nothing follows the end.
      if (performance.now() < jumpUntil.current) return void (pinned.current = false)
      pinned.current = atEnd(el)
      const { rows: thisFrame, start: from, scrolledUp } = liveRows.current
      if (pinned.current) {
        // Only a window the reader scrolled up gives rows back: at the bottom every
        // scroll (a streaming reply's each frame) would otherwise draw the chat again.
        if (scrolledUp) setWindowed(windowAt(null))
      } else if (nearTop(el.scrollTop)) {
        if (from !== 0) setWindowed(windowAt(olderStart(from, thisFrame.length)))
        else older.current?.()
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // A jump to a row the window left out — a pin, a quote, Show in Chat — draws that row's
  // part of the window before the jump looks for it (rowWindow.ts).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    return registerRowOpener(el, key => {
      const at = rowIndex(liveRows.current.rows, key)
      if (at < 0) return false
      // The jump scrolls to the row smoothly: until it lands, a reader who was at the end
      // isn't taken to be there still, which would give the window's rows back mid-jump.
      pinned.current = false
      jumpUntil.current = performance.now() + JUMP_MS
      flushSync(() => setWindowed(windowAt(startAt(at, liveRows.current.rows.length))))
      return true
    })
  }, [])

  // Retry is on the newest reply while it answers the last message sent;
  // Edit and resend on a message of yours with only words, which /undo can give back.
  const actions = useMemo(() => {
    const retryKey = new Set<string>()
    const editTurns = new Map<string, number>()
    let followUpKey: string | undefined
    if (!onCommand || state.running) return { retryKey, editTurns, followUpKey }
    const items = state.items
    // Nothing sent since the last turn's last board: a follow-up asks the next question.
    for (let i = items.length - 1; i >= 0 && items[i]!.kind !== 'user'; i--) {
      const row = items[i]!
      if (row.kind === 'tool' && row.board) {
        if (row.board.next.length) followUpKey = row.key
        break
      }
    }
    const lastUser = items.map(i => i.kind).lastIndexOf('user')
    const lastReply = items.map(i => i.kind).lastIndexOf('assistant')
    if (lastReply > lastUser && lastUser >= 0) retryKey.add(items[lastReply]!.key)
    let turns = 0
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      if (item.kind !== 'user' || item.pending) continue
      turns++
      if (!item.attachments?.length) editTurns.set(item.key, turns)
    }
    return { retryKey, editTurns, followUpKey }
  }, [state, onCommand])

  const retry = async () => {
    const lastUser = state.items.map(i => i.kind).lastIndexOf('user')
    const ranSteps = state.items.slice(lastUser + 1).some(i => i.kind === 'tool')
    // Steps run again: a file written, a message sent, twice.
    if (ranSteps && !(await ask(`${t('Retry this reply?')}\n\n${t('Steps ran for this reply, and retrying runs them again.')}`))) return
    onCommand?.('/retry')
  }

  const edit = async (turns: number) => {
    const later = turns > 1
    if (
      later &&
      !(await ask(
        `${t('Edit and resend this message?')}\n\n${t('Your later messages and the replies to them leave the chat, and this one goes back in the composer to change and send again.')}`
      ))
    )
      return
    onCommand?.(turns > 1 ? `/undo ${turns}` : '/undo')
  }

  // What the items' callbacks read, so each keeps one identity (sameItemProps).
  const latest = useRef({ state, actions, onQuote, onCommand, onOpenCall, onReact, onBranch, retry, edit, togglePin: (_: { key: string; text: string }) => {} })
  latest.current = { ...latest.current, state, actions, onQuote, onCommand, onOpenCall, onReact, onBranch, retry, edit }
  const stable = useMemo(
    () => ({
      jump: (quote: string) => {
        const target = latest.current.state.items.find(i => i.kind === 'assistant' && sameQuotedText(i.text, quote))
        if (!target) return undefined
        return () => {
          // As a pin's jump does: the window it opens isn't given back as the reader at the bottom's.
          pinned.current = false
          revealMessage(scroller.current, target.key)
        }
      },
      quote: (request: QuoteRequest) => latest.current.onQuote?.(request),
      command: (text: string) => latest.current.onCommand?.(text),
      openCall: (callId: string) => latest.current.onOpenCall?.(callId),
      retry: () => void latest.current.retry()
    }),
    []
  )
  const perItem = useRef(new Map<string, { edit: () => void; react: (emoji: string | null) => void; branch: () => void; pin: () => void }>())
  // Each chat opened adds its items' keys; identities don't matter to sameItemProps, so a long session just starts over.
  if (perItem.current.size > 4_000) perItem.current.clear()
  const forItem = (key: string) => {
    let callbacks = perItem.current.get(key)
    if (!callbacks) {
      callbacks = {
        edit: () => {
          const turns = latest.current.actions.editTurns.get(key)
          if (turns) void latest.current.edit(turns)
        },
        react: emoji => latest.current.onReact?.(key, emoji),
        branch: () => latest.current.onBranch?.(key),
        pin: () => {
          const item = latest.current.state.items.find(i => i.key === key)
          if (item?.kind === 'assistant') latest.current.togglePin(item)
        }
      }
      perItem.current.set(key, callbacks)
    }
    return callbacks
  }
  const jump = stable.jump

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [state, requests, expired, drawnWindow.start])

  // Rows drawn above the reader keep their place, whether the window took them on or a
  // stored page was read in: the chat grew above them, so the reader stays as far from its
  // end as they were. That is read before the rows are drawn and set after, so it holds
  // whether or not the browser's own scroll anchoring moved the scroller too.
  const topKey = drawn[0] ? rowKey(drawn[0]) : undefined
  const endKey = rows.length ? rowKey(rows[rows.length - 1]!) : undefined
  const before = useRef<{ chat: string; top?: string; end?: string } | null>(null)
  const fromEnd = useRef<number | null>(null)
  {
    const el = scroller.current
    const last = before.current
    // Not for a jump, which scrolls to its row itself.
    const jumping = performance.now() < jumpUntil.current
    const grewAbove = !jumping && el && last && last.chat === chatKey && last.end === endKey && last.top !== topKey
    fromEnd.current = grewAbove ? el.scrollHeight - el.scrollTop : null
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && fromEnd.current !== null && !pinned.current) el.scrollTop = el.scrollHeight - fromEnd.current
    fromEnd.current = null
    before.current = { chat: chatKey, top: topKey, end: endKey }
  })

  // A page read in above the chat moved the window's start: the window keeps it from here
  // on. A reader still at the top of the rows they had takes on the first of the page now,
  // since a scroller at its top sends no scroll to ask with.
  useLayoutEffect(() => {
    if (windowed.chat !== chatKey || windowed.start === null || start === windowed.start) return
    const el = scroller.current
    const reading = start !== null && start > windowed.start && el && !pinned.current && nearTop(el.scrollTop)
    setWindowed(windowAt(reading ? olderStart(start, rows.length) : start))
  })

  // Rows that leave the scroller at its very top — too few to fill it, a page that drew
  // nothing new above the reader, a window that opened there — can't be scrolled for more,
  // so the window takes on the rows above it, or the page before is asked for.
  const itemCount = state.items.length
  useEffect(() => {
    const el = scroller.current
    if (!el || !itemCount || loading || el.scrollTop > 0) return
    if (drawnWindow.start === 0) older.current?.()
    else if (!pinned.current) setWindowed(windowAt(olderStart(drawnWindow.start, liveRows.current.rows.length)))
  }, [itemCount, loading, drawnWindow.start])

  // Pins: which reply each shows, the bar's order, and the row ids replies pinned as they arrived took.
  const pinList = pins?.list
  const pinKeys = useMemo(() => (pinList?.length ? resolved(pinList, state.items) : new Map<string, string>()), [pinList, state.items])
  const pinnedKeys = useMemo(() => (pinList?.length ? pinnedWhole(pinList, state.items) : new Set<string>()), [pinList, state.items])
  const barPins = useMemo(() => (pinList?.length ? barOrder(pinList, state.items) : []), [pinList, state.items])
  const refreshPins = pins?.refresh
  useEffect(() => {
    if (!pinList?.length || state.running) return
    const next = refreshed(pinList, state.items)
    if (next) refreshPins?.(next)
  }, [pinList, state.items, state.running, refreshPins])
  // A pin from the bar whose reply is in a page not read yet: it jumps once that page is (desktop#486).
  const [barReveal, setBarReveal] = useState<{ id: string; passage?: string } | null>(null)
  const jumpToPin = (pin: { id: string; passage?: string }) => {
    if (!pinKeys.has(pin.id) && onSeekRow) return setBarReveal({ id: pin.id, passage: pin.passage })
    pinned.current = false
    if (pin.passage) revealPassage(scroller.current, pinKeys.get(pin.id), pin.passage)
    else revealMessage(scroller.current, pinKeys.get(pin.id))
  }
  // A pin opened from the list, or from the bar, scrolls to its reply once the chat has it;
  // a chat opened on its newest stored page reads the pages before for it.
  const listReveal = pins?.reveal
  const reveal = listReveal ?? barReveal
  const onRevealed = pins?.onRevealed
  useEffect(() => {
    if (!reveal || loading) return
    const key = pinKeys.get(reveal.id)
    if (!key) {
      const pin = pinList?.find(p => p.id === reveal.id)
      if (pin) onSeekRow?.(items => resolved([pin], items as TranscriptItem[]).has(pin.id))
      else if (!listReveal) setBarReveal(null)
      return
    }
    pinned.current = false
    const passage = reveal.passage
    requestAnimationFrame(() => (passage ? revealPassage(scroller.current, key, passage) : revealMessage(scroller.current, key)))
    if (listReveal) onRevealed?.()
    else setBarReveal(null)
  }, [reveal, listReveal, pinKeys, pinList, loading, onRevealed, onSeekRow])
  // Another chat: a bar pin still being read for isn't this chat's.
  useEffect(() => setBarReveal(null), [chatKey])

  // What reactionTarget allows, without a walk of the chat per reply.
  const newestReply = useMemo(() => [...state.items].reverse().find(i => i.kind === 'assistant')?.key, [state.items])
  const reactable = (item: TranscriptItem) =>
    item.kind === 'assistant' && !!item.text.trim() && (!!item.rowId || (!state.running && item.key === newestReply))
  const renderItem = (item: TranscriptItem) => (
    <Item
      key={item.key}
      item={item}
      author={author}
      face={face}
      newest={item.key === newestReply}
      onQuote={onQuote ? stable.quote : undefined}
      jump={jump}
      onRetry={actions.retryKey.has(item.key) ? stable.retry : undefined}
      onEdit={actions.editTurns.has(item.key) ? forItem(item.key).edit : undefined}
      onFollowUp={actions.followUpKey === item.key && onCommand ? stable.command : undefined}
      thinkingToggle={item.kind === 'assistant' ? thinkingToggle : undefined}
      expandTools={display.expandTools}
      onOpenCall={onOpenCall ? stable.openCall : undefined}
      teammates={teammates}
      followedUp={followedUpKeySet.has(item.key)}
      repliedTo={repliesToTeammates.get(item.key)}
      onReact={onReact && reactable(item) ? forItem(item.key).react : undefined}
      onBranch={onBranch && item.kind === 'assistant' && !item.streaming ? forItem(item.key).branch : undefined}
      pinToggle={
        pins && item.kind === 'assistant' && !item.streaming
          ? { label: pinnedKeys.has(item.key) ? t('Unpin reply') : t('Pin reply'), onSelect: forItem(item.key).pin }
          : undefined
      }
    />
  )
  const togglePin = (item: { key: string; text: string }) => {
    if (!pins) return
    const existing = pinFor({ kind: 'assistant', ...item }, pins.list, state.items)
    if (existing) pins.unpin(existing)
    else pins.pin(item)
  }
  latest.current.togglePin = togglePin

  // Right-click on text selected in a finished reply: Copy, Quote, and Pin or Unpin for the passage.
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; key: string; text: string } | null>(null)
  const closeSelectionMenu = useCallback(() => setSelectionMenu(null), [])
  const onContextMenu = (e: React.MouseEvent) => {
    const selected = replySelection()
    const item = selected && state.items.find(i => i.key === selected.key && i.kind === 'assistant')
    if (!selected || !item || item.kind !== 'assistant' || item.streaming) return
    e.preventDefault()
    setSelectionMenu({ x: e.clientX, y: e.clientY, key: selected.key, text: selected.text })
  }
  const selectionItems = (menu: { key: string; text: string }): MessageMenuItem[] => {
    const item = state.items.find(i => i.key === menu.key)
    const reply = item && item.kind === 'assistant' ? { kind: 'assistant', key: item.key, text: item.text } : null
    const pinnedPassage = pins && reply ? pinForPassage(menu.text, reply, pins.list, state.items) : undefined
    return [
      { label: t('Copy'), onSelect: () => void navigator.clipboard.writeText(menu.text) },
      ...(onQuote ? [{ label: t('Quote'), onSelect: () => onQuote(quoteRequest({ reply: { author, text: menu.text } })) }] : []),
      ...(pins && reply
        ? [
            pinnedPassage
              ? { label: t('Unpin'), onSelect: () => pins.unpin(pinnedPassage) }
              : { label: t('Pin'), onSelect: () => pins.pin({ key: reply.key, text: reply.text }, menu.text) }
          ]
        : [])
    ]
  }

  return (
    <PictureProfile.Provider value={profile}>
      {pins && barPins.length ? <PinnedReplyBar pins={barPins} jump={jumpToPin} onUnpin={pins.unpin} onLabel={pins.label} onShowAll={pins.showAll} /> : null}
      <div className="transcript" ref={scroller} aria-live="polite" onContextMenu={onContextMenu}>
        <div className="transcript-inner">
          {loadingOlder && drawnWindow.start === 0 ? <div className="notice">{t('Loading earlier messages…')}</div> : null}
          {loading ? <div className="notice">{t('Loading…')}</div> : null}
          {error ? <div className="notice error">{error}</div> : null}
          {!loading && !error && shown.length === 0 ? (
            <div className="welcome">
              <h2>{t('What can Hermes do for you?')}</h2>
              <span>{t('Ask anything. Enter sends, Shift Enter adds a line.')}</span>
            </div>
          ) : null}
          {drawn.map(row =>
            row.type === 'steps' ? (
              <StepRun key={row.id} row={row} live={row.trailing && state.running} expandTools={display.expandTools} summaries={summaries}>
                {row.items.map(renderItem)}
              </StepRun>
            ) : row.type === 'reviews' ? (
              <ReviewRun key={row.id} count={row.items.length}>
                {row.items.map(renderItem)}
              </ReviewRun>
            ) : row.item.kind === 'tool' && isStep(row.item) ? (
              <LoneStep key={row.item.key} step={row.item} live={state.running && row === rows[rows.length - 1]} summaries={summaries}>
                {renderItem(row.item)}
              </LoneStep>
            ) : (
              renderItem(row.item)
            )
          )}
          {expired
            .filter(e => !requests.some(r => r.id === e.request.id))
            .map(e => (
              <ExpiredClarifyCard key={`expired-${e.request.id}`} expired={e} onAnswer={onQuote ? text => onQuote(quoteRequest({ text })) : undefined} />
            ))}
          {requests.map(request => (
            <RequestCard key={request.id} request={request} />
          ))}
          {state.running && state.status ? (
            <div className="status-line">
              <span className="running" />
              {state.status}
            </div>
          ) : null}
        </div>
        <JumpToLatest scroller={scroller} onJump={() => (pinned.current = true)} />
      </div>
      {selectionMenu ? <SelectionMenu at={selectionMenu} items={selectionItems(selectionMenu)} onClose={closeSelectionMenu} /> : null}
    </PictureProfile.Provider>
  )
}
