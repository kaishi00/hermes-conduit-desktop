import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react'
import type { ContextWindow } from '../state/context'
import { Icon } from './icons'
import { t } from '@shared/i18n'
import { LONG_PASTE_CHARACTERS, attachmentLimitBytes, displayName, stagePaste, tooLargeMessage, voiceTooLargeMessage, type StagedAttachment } from '../state/attachments'
import { stageFile } from '../state/picture'
import { useRecorder } from '../state/useRecorder'
import { blobToBase64, durationLabel, transcribe, voiceFileName, voicePromptText } from '../state/voice'
import { suggestCommands, type SlashCommand } from '../state/slash'
import { INSTRUCTIONS_EVENT, TAP_GUARD_MS, askable, instructionsKey, pauseDelay, type DraftGuesses } from '../state/predictive'
import { composerDrafts, draftStoreKey, isEmptyDraft, type ComposerDraft } from '../state/composerDrafts'
import { SummaryHost } from '../state/useStepSummaries'
import { ClipInbox, indexedClipStore, keepsAfter, memoryClipStore, withRetries, type DictationClip } from '../state/dictationClips'
import { insertingMention, mentionCandidates, mentionQueryAt, mentionTag } from '../state/botMentions'
import type { Bot } from '../state/bots'
import { carriesReply, excerpt, insertQuote, replyEnvelope, type QuoteRequest, type ReplyReference } from '../state/quote'
import { ask } from '../state/dialogs'
import { FileViewer } from './FileViewer'

/** The last folder of a path, the way the phone's chip shows it. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Whether a drag carries files (not words or a link). */
function carriesFiles(event: DragEvent | globalThis.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

interface Props {
  placeholder: string
  running: boolean
  disabled: boolean
  model?: string
  cwd?: string
  /** Sends the message. A promise of false means it didn't go: its words, files and reply come back to the draft. */
  onSend: (text: string, attachments: StagedAttachment[]) => void | Promise<boolean | string | void>
  onStop: () => void
  focusKey: string
  /** Which chat's draft this is: words, files and a reply wait here for that chat until sent. Defaults to `focusKey`. */
  draftKey?: string
  /** Pictures and files can go with the message: the Attach button, a pasted picture, a long paste, a drop. */
  canAttach?: boolean
  /** Where else a dropped file attaches (the chat around the composer). */
  dropZone?: RefObject<HTMLElement | null>
  /** Told whether anything shows above the field (files, a reply, suggestions), so a small window can make room. */
  onStagedChange?: (staged: boolean) => void
  /** Why the staged files can't go with this message, checked on Send, or null. */
  checkAttachments?: (attachments: StagedAttachment[]) => string | null
  /** A quote from the transcript: words go in the draft, a whole message becomes the "Replying to" chip. */
  quote?: QuoteRequest | null
  /** Files to stage now (Quick ask's screenshot), once per id. */
  stageFiles?: { id: number; files: File[] } | null
  /** Ask Hermes About Screen beside Attach: takes the screen and stages it (Quick ask); `capturing` while it runs. */
  screenshot?: { take: () => void; capturing: boolean }
  /** Bumped to send what's in the draft now (a tapped takeover made the chat Conduit's). */
  sendNow?: number
  /** Suggested replies, best first: shown while the draft is empty and nothing is staged. */
  replies?: string[]
  /** A suggested reply clicked: sent as the next message. */
  onSuggestion?: (text: string) => void
  /** Asks about the draft once typing pauses (Predictive's While I pause). */
  onDraftPause?: (draft: string) => Promise<DraftGuesses | null>
  /** Told whether the draft has words, so Hermes doesn't follow up while you write. */
  onDrafting?: (drafting: boolean) => void
  /** The model chip's click: the Model panel. Without it the chip only shows the model. */
  onModel?: () => void
  /** How full the chat's context window is; the ring opens the Context panel. */
  context?: ContextWindow
  onContext?: () => void
  /** The slash commands this chat takes, suggested as a `/` is typed. None in a room. */
  commands?: SlashCommand[]
  /** The draft's words as they go, before any reply wraps them (a room's To row puts its picks' tags in front). */
  address?: (draft: string) => string
  /** The text sent for a draft replying to a message. Defaults to a chat's reply envelope. */
  wrapReply?: (reply: ReplyReference, draft: string) => string
  /** The microphone: a recording typed out (Dictate) or sent as a voice message, transcribed in this profile. */
  voice?: { profile?: string }
  /** The bots a chat can tag: the @ list as `@` is typed, and Mention a Bot beside Attach. The chat's own bot is left out. */
  mentionBots?: Bot[]
}

const chatReply = (reply: ReplyReference, draft: string) => replyEnvelope(reply.text, draft)

/** Hermes dictations whose words haven't reached a draft, kept on this computer (the phone's DictationClipStore). */
export const dictationClips = new ClipInbox(typeof indexedDB === 'undefined' ? memoryClipStore() : indexedClipStore())
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Enter sends, Shift Enter adds a line; while a turn runs the send button stops it. */
export function Composer({
  placeholder,
  running,
  disabled,
  model,
  cwd,
  onSend,
  onStop,
  focusKey,
  draftKey,
  canAttach,
  dropZone,
  onStagedChange,
  checkAttachments,
  quote,
  stageFiles,
  screenshot,
  sendNow = 0,
  replies: guessed,
  onSuggestion,
  onDraftPause,
  onDrafting,
  wrapReply = chatReply,
  address,
  commands,
  onModel,
  context,
  onContext,
  voice,
  mentionBots
}: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  /** The staged file its chip opened in the viewer, to check before it's sent (desktop#611); it closes once the file leaves the composer. */
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = viewingId ? (attachments.find(a => a.id === viewingId) ?? null) : null
  // Once its file is gone (removed, sent, or another chat's draft swapped in), the viewer stays closed, so the draft coming back doesn't reopen it.
  useEffect(() => {
    if (viewingId && !viewing) setViewingId(null)
  }, [viewingId, viewing])
  const closeViewer = useCallback(() => {
    setViewingId(null)
    area.current?.focus()
  }, [])
  const [notice, setNotice] = useState<string | null>(null)
  const [staging, setStaging] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyReference | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const recorder = useRecorder()
  const [transcribing, setTranscribing] = useState(false)
  // The recording's meter moves on the page each frame, not through a draw of the composer (desktop#545).
  const meterOff = useRef<(() => void) | null>(null)
  const meter = useCallback(
    (bar: HTMLSpanElement | null) => {
      meterOff.current?.()
      meterOff.current = null
      if (!bar) return
      bar.style.transform = 'scaleX(0)'
      meterOff.current = recorder.onLevel(level => {
        bar.style.transform = `scaleX(${Math.min(1, level * 2.5)})`
      })
    },
    [recorder.onLevel]
  )

  useEffect(() => {
    area.current?.focus()
  }, [focusKey])

  // A draft belongs to the chat it was typed in (the phone's ComposerDraftStore): leaving keeps it, coming back brings it.
  const host = useContext(SummaryHost)
  const storeKey = draftStoreKey(host, draftKey ?? focusKey)
  const shownDraft = useRef<ComposerDraft>({ text: '', attachments: [], replyTo: null })
  shownDraft.current = { text, attachments, replyTo }
  const shownKey = useRef(storeKey)
  shownKey.current = storeKey
  useEffect(() => {
    recorder.cancel()
    const kept = composerDrafts.peek(storeKey)
    setText(kept?.text ?? '')
    setAttachments(kept?.attachments ?? [])
    setNotice(null)
    setReplyTo(kept?.replyTo ?? null)
    return () => composerDrafts.save(storeKey, shownDraft.current)
  }, [storeKey])

  // A quote lands once per request.
  const quoted = useRef<number | null>(null)
  useEffect(() => {
    if (!quote || quote.id === quoted.current) return
    quoted.current = quote.id
    if ('draft' in quote) {
      setText(quote.draft)
      setReplyTo(quote.reply ?? null)
    } else if ('reply' in quote) setReplyTo(quote.reply)
    else if ('insert' in quote) {
      const el = area.current
      const at = el ? el.selectionStart : text.length
      const end = el ? el.selectionEnd : text.length
      setText(current => {
        const before = current.slice(0, at)
        const pad = before && !/\s$/.test(before) ? ' ' : ''
        const words = `${pad}${quote.insert} `
        requestAnimationFrame(() => el?.setSelectionRange(at + words.length, at + words.length))
        return `${before}${words}${current.slice(end)}`
      })
      el?.focus()
      return
    } else setText(current => insertQuote(quote.text, current))
    const el = area.current
    if (!el) return
    el.focus()
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
  }, [quote])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  async function stage(files: File[]) {
    if (!files.length) return
    const limit = attachmentLimitBytes()
    const tooLarge = files.filter(f => f.size > limit)
    const fitting = files.filter(f => f.size <= limit)
    const unread: string[] = []
    setNotice(tooLarge.length ? tooLargeMessage(tooLarge.map(f => f.name)) : null)
    setStaging(n => n + 1)
    try {
      const staged = await Promise.all(
        fitting.map(file =>
          stageFile(file, crypto.randomUUID()).catch(() => {
            unread.push(file.name)
            return null
          })
        )
      )
      setAttachments(current => [...current, ...staged.filter((s): s is StagedAttachment => !!s)])
      if (unread.length) setNotice(t("Couldn't read {names}.", { names: unread.join(', ') }))
    } finally {
      setStaging(n => n - 1)
      area.current?.focus()
    }
  }

  // Files dropped on the chat around the composer attach too.
  const stageRef = useRef(stage)
  stageRef.current = stage
  useEffect(() => {
    if (stageFiles?.files.length) void stageRef.current(stageFiles.files)
  }, [stageFiles])
  useEffect(() => {
    const zone = dropZone?.current
    if (!zone || !canAttach) return
    let depth = 0
    const over = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    }
    const enter = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event) || disabled) return
      depth++
      setDragging(true)
    }
    const leave = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const drop = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      if (!disabled) void stageRef.current(Array.from(event.dataTransfer?.files ?? []))
    }
    zone.addEventListener('dragover', over)
    zone.addEventListener('dragenter', enter)
    zone.addEventListener('dragleave', leave)
    zone.addEventListener('drop', drop)
    return () => {
      zone.removeEventListener('dragover', over)
      zone.removeEventListener('dragenter', enter)
      zone.removeEventListener('dragleave', leave)
      zone.removeEventListener('drop', drop)
      setDragging(false)
    }
  }, [dropZone, canAttach, disabled])

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!canAttach || disabled) return
    const files = Array.from(event.clipboardData.files)
    if (files.length) {
      event.preventDefault()
      void stage(files)
      return
    }
    const pasted = event.clipboardData.getData('text/plain')
    if (pasted.length > LONG_PASTE_CHARACTERS) {
      event.preventDefault()
      const paste = stagePaste(pasted, crypto.randomUUID())
      if (paste.size > attachmentLimitBytes()) {
        // Too big to go as a file: it goes in the field after all.
        const el = event.currentTarget
        const start = el.selectionStart
        setText(current => current.slice(0, start) + pasted + current.slice(el.selectionEnd))
        return
      }
      setAttachments(current => [...current, paste])
    }
  }

  function remove(id: string) {
    setAttachments(current => current.filter(a => a.id !== id))
    setNotice(null)
    area.current?.focus()
  }

  /** A paste goes back in the field, after what was typed. */
  function unpaste(item: StagedAttachment) {
    if (item.pastedText === undefined) return
    setAttachments(current => current.filter(a => a.id !== item.id))
    setText(current => (current ? `${current}\n${item.pastedText}` : item.pastedText!))
    area.current?.focus()
  }

  // `/` and the start of a name: Hermes' commands that fit, until a space or Esc.
  const suggestions = commands?.length && /^\/[^\s/]*$/.test(text) && text !== dismissed ? suggestCommands(commands, text) : []
  const picked = suggestions[Math.min(highlight, suggestions.length - 1)]
  // `@` and the start of a bot's name, where the caret is: the bots that fit, until a space or Esc.
  const [caret, setCaret] = useState(0)
  const tagging = mentionBots?.length && !picked && text !== dismissed ? mentionQueryAt(text, Math.min(caret, text.length)) : null
  const tagged = tagging ? mentionCandidates(mentionBots, tagging.query).slice(0, 8) : []
  const pickedBot = tagged[Math.min(highlight, tagged.length - 1)]
  const [mentionMenu, setMentionMenu] = useState(false)
  useEffect(() => {
    if (!mentionMenu) return
    const close = () => setMentionMenu(false)
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [mentionMenu])
  useEffect(() => setHighlight(0), [text])

  // Staged files, a note, a reply chip or the suggestions: a small window makes room for them.
  const staged = attachments.length > 0 || staging > 0 || !!notice || !!replyTo || !!picked || !!pickedBot

  // While I pause: the draft, asked about once after the chosen pause; its guesses count only while it stays the same.
  const [draftGuess, setDraftGuess] = useState<(DraftGuesses & { draft: string }) | null>(null)
  const askedDraft = useRef<string | null>(null)
  const latestText = useRef(text)
  const drafting = !!text.trim()
  useEffect(() => onDrafting?.(drafting), [drafting, onDrafting])
  latestText.current = text
  useEffect(() => {
    if (draftGuess && draftGuess.draft !== text) setDraftGuess(null)
    if (!onDraftPause || staged || running || disabled || !askable(text) || askedDraft.current === text) return
    const timer = window.setTimeout(() => {
      askedDraft.current = text
      void onDraftPause(text).then(guess => {
        if (guess && latestText.current === text && (guess.next.length || guess.replies.length)) setDraftGuess({ ...guess, draft: text })
      })
    }, pauseDelay() * 1000)
    return () => window.clearTimeout(timer)
  }, [text, onDraftPause, staged, running, disabled])
  // A draft's guesses made under While I pause instructions since edited go, in this window or another.
  useEffect(() => {
    const drop = () => {
      setDraftGuess(null)
      askedDraft.current = null
    }
    const edited = (e: Event) => {
      if ((e as CustomEvent).detail === 'draft') drop()
    }
    const stored = (e: StorageEvent) => {
      if (e.key === instructionsKey('draft')) drop()
    }
    window.addEventListener(INSTRUCTIONS_EVENT, edited)
    window.addEventListener('storage', stored)
    return () => {
      window.removeEventListener(INSTRUCTIONS_EVENT, edited)
      window.removeEventListener('storage', stored)
    }
  }, [])
  useEffect(() => {
    onStagedChange?.(staged)
  }, [staged, onStagedChange])

  /** A bot picked from the @ list: its tag in place of the `@` being typed, the caret after it. */
  function pickBot(bot: Bot) {
    if (!tagging) return
    const end = Math.min(caret, text.length)
    const tag = `@${mentionTag(bot)} `
    const next = text.slice(0, tagging.start) + tag + text.slice(end).replace(/^\s/, '')
    const at = tagging.start + tag.length
    setText(next)
    setCaret(at)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(at, at)
    })
  }

  /** Mention a Bot: the same tag the @ list puts in, at the end of the draft. */
  function mentionBot(bot: Bot) {
    const next = insertingMention(text, bot)
    setText(next)
    setCaret(next.length)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(next.length, next.length)
    })
  }

  /** A pick only puts the command in the field, with a space for its words. */
  function pick(command: SlashCommand) {
    setText(`/${command.name} `)
    area.current?.focus()
  }

  const hasContent = text.trim().length > 0 || attachments.length > 0
  // Send waits while a dictation runs, until its words are in the draft to read over (Eric, 2026-10-26).
  const dictating = recorder.recording || transcribing
  const canSend = !disabled && hasContent && staging === 0 && !dictating

  function send() {
    if (!canSend) return
    const problem = attachments.length ? (checkAttachments?.(attachments) ?? null) : null
    if (problem) {
      setNotice(problem)
      return
    }
    const replying = replyTo && carriesReply(text, attachments.length > 0)
    const sent: ComposerDraft = { text, attachments, replyTo }
    const sentKey = storeKey
    const words = address ? address(text) : text
    const outcome = onSend(replying ? wrapReply(replyTo, words.trim()) : words, attachments)
    if (outcome) void outcome.then(went => went === false && returnDraft(sentKey, sent))
    setText('')
    setAttachments([])
    setNotice(null)
    // A slash command leaves the reply attached for the next message.
    if (replying) setReplyTo(null)
  }

  /** A send that didn't go comes back to its draft, unless something new was typed there meanwhile. */
  function returnDraft(key: string, draft: ComposerDraft) {
    if (key !== shownKey.current) {
      if (!composerDrafts.peek(key)) composerDrafts.save(key, draft)
      return
    }
    if (!isEmptyDraft(shownDraft.current)) return
    setText(draft.text)
    setAttachments(draft.attachments)
    setReplyTo(draft.replyTo)
  }

  const sentNow = useRef(sendNow)
  useEffect(() => {
    if (sendNow === sentNow.current) return
    sentNow.current = sendNow
    send()
  }, [sendNow])

  useEffect(() => {
    if (recorder.error === 'denied') setNotice(t("Conduit can't use the microphone. Allow it for Conduit in your computer's privacy settings, then try again."))
    else if (recorder.error === 'missing') setNotice(t('No microphone found.'))
    else if (recorder.error) setNotice(recorder.error)
  }, [recorder.error])

  /** Words typed in where the caret is. */
  function typeIn(words: string) {
    const el = area.current
    setText(current => {
      const at = el && document.activeElement === el ? el.selectionStart : current.length
      const before = current.slice(0, at)
      const pad = before && !/\s$/.test(before) ? ' ' : ''
      const next = `${before}${pad}${words}${current.slice(at)}`
      const caret = at + pad.length + words.length
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(caret, caret)
      })
      return next
    })
  }

  // Kept recordings for this host and profile, offered above the composer with Retry and Delete.
  const clipProfile = voice?.profile ?? ''
  useEffect(() => void dictationClips.load(), [])
  useSyncExternalStore(
    listener => dictationClips.subscribe(listener),
    () => dictationClips.version
  )
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set())
  const offeredClips = voice ? dictationClips.offered(host, clipProfile, uploading) : []
  const busyWith = (id: string, on: boolean) =>
    setUploading(current => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  /** The dictation Transcribing waits on; Cancel lets it go (its recording stays for Retry). */
  const waitingOn = useRef<string | null>(null)

  /**
   * One upload of a kept recording. Its words go to the draft that was on
   * screen when it started, even if another chat opened meanwhile; a
   * recording Hermes heard nothing in goes when short and stays when long.
   */
  async function deliver(clip: DictationClip, retries: boolean) {
    const forKey = storeKey
    busyWith(clip.id, true)
    try {
      const upload = () => transcribe(clip.base64, clip.mime, clip.profile || undefined)
      const words = retries ? await withRetries(upload, sleep) : await upload()
      const cancelled = retries && waitingOn.current !== clip.id
      if (!words) {
        if (!keepsAfter(words, clip.duration)) await dictationClips.release(clip.id)
        if (!cancelled) setNotice(t("Hermes didn't hear any words."))
        return
      }
      await dictationClips.release(clip.id)
      if (forKey === shownKey.current) typeIn(words)
      else {
        const kept = composerDrafts.peek(forKey) ?? { text: '', attachments: [], replyTo: null }
        composerDrafts.save(forKey, { ...kept, text: kept.text ? `${kept.text} ${words}` : words })
      }
      setNotice(null)
    } catch (e) {
      setNotice(t("Hermes couldn't transcribe that: {error}", { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      busyWith(clip.id, false)
    }
  }

  /** The recording's words, typed in where the caret is. It's written to this computer before it goes to Hermes. */
  async function dictate() {
    const recording = await recorder.stop()
    if (!recording) return
    const clip: DictationClip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      host,
      profile: clipProfile,
      mime: recording.mime,
      base64: await blobToBase64(recording.blob),
      duration: recording.duration,
      created: Date.now()
    }
    setTranscribing(true)
    waitingOn.current = clip.id
    try {
      await dictationClips.keep(clip)
      await deliver(clip, true)
    } finally {
      if (waitingOn.current === clip.id) {
        waitingOn.current = null
        setTranscribing(false)
      }
    }
  }

  /** The recording as a voice message: the audio as a file, and what Hermes heard as the prompt. */
  async function sendVoice() {
    if (running) {
      setNotice(t('Voice messages send once the reply has finished.'))
      return
    }
    const recording = await recorder.stop()
    if (!recording) return
    setTranscribing(true)
    try {
      const base64 = await blobToBase64(recording.blob)
      const extension = recording.mime.includes('ogg') ? 'ogg' : recording.mime.includes('mp4') ? 'm4a' : 'webm'
      const file: StagedAttachment = {
        id: `voice-${Date.now()}`,
        name: voiceFileName(extension),
        kind: 'file',
        mime: recording.mime,
        size: recording.blob.size,
        base64
      }
      if (file.size > attachmentLimitBytes()) {
        setNotice(voiceTooLargeMessage())
        return
      }
      // Words help every model; without them the file still goes, as the phone sends it.
      const words = await transcribe(base64, recording.mime, voice?.profile).catch(() => '')
      onSend(voicePromptText(recording.duration, words), [file])
      setNotice(null)
    } finally {
      setTranscribing(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pickedBot && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight(h => (Math.min(h, tagged.length - 1) + step + tagged.length) % tagged.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        pickBot(pickedBot)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(text)
        return
      }
    }
    if (picked && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight(h => (Math.min(h, suggestions.length - 1) + step + suggestions.length) % suggestions.length)
        return
      }
      // Tab takes the highlighted command; Enter does too, unless it's already what's typed.
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && text.slice(1).toLowerCase() !== picked.name)) {
        event.preventDefault()
        pick(picked)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(text)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      // Return ends a dictation running, and its words land in the draft rather than going.
      if (recorder.recording) void dictate()
      else send()
    } else if (event.key === 'Escape' && running) {
      event.preventDefault()
      onStop()
    }
  }

  const chips = guessed?.length && onSuggestion && !text.trim() && !staged && !running && !disabled ? guessed : null
  const fill = (value: string) => {
    setText(value)
    requestAnimationFrame(() => {
      const field = area.current
      if (field) {
        field.focus()
        field.setSelectionRange(value.length, value.length)
      }
    })
  }
  const paused = draftGuess && draftGuess.draft === text && onSuggestion && !chips && !staged && !running && !disabled ? draftGuess : null
  return (
    <div className="composer-wrap">
      {chips ? <SuggestedReplies replies={chips} onSend={onSuggestion!} onEdit={fill} /> : null}
      {paused ? (
        <div className="suggested-replies" role="group" aria-label={t('Suggestions')}>
          {paused.next.map(words => (
            <button key={`n${words}`} className="suggested-reply continuation" title={t('Add to your message')} onClick={() => fill(text + words)}>
              …{words.trim()}
            </button>
          ))}
          {paused.replies.map(reply => (
            <button
              key={`r${reply}`}
              className="suggested-reply"
              title={t('Click to send. Right-click to edit it first.')}
              onClick={() => {
                setText('')
                onSuggestion!(reply)
              }}
              onContextMenu={e => {
                e.preventDefault()
                fill(reply)
              }}
            >
              {reply}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`composer${dragging ? ' dropping' : ''}`}>
        {dragging ? (
          <div className="drop-hint">
            <Icon name="paperclip" />
            {t('Drop to attach')}
          </div>
        ) : null}
        {attachments.length || staging ? (
          <div className="staged">
            {attachments.map(a => (
              <span key={a.id} className="staged-chip" title={a.pastedText !== undefined ? t('Click to put the text back in the message') : t('Preview {name}', { name: a.name })}>
                {a.pastedText !== undefined ? (
                  <>
                    <Icon name="file" />
                    <button className="staged-name link" onClick={() => unpaste(a)}>
                      {displayName(a.name)}
                    </button>
                  </>
                ) : (
                  <button className="staged-open" aria-label={t('Preview {name}', { name: displayName(a.name) })} onClick={() => setViewingId(a.id)}>
                    {a.kind === 'image' ? <img src={`data:${a.mime};base64,${a.base64}`} alt="" /> : <Icon name="file" />}
                    <span className="staged-name">{displayName(a.name)}</span>
                  </button>
                )}
                <button className="staged-remove" aria-label={t('Remove {name}', { name: displayName(a.name) })} onClick={() => remove(a.id)}>
                  <Icon name="close" />
                </button>
              </span>
            ))}
            {staging ? <span className="staged-chip busy">{t('Attaching…')}</span> : null}
          </div>
        ) : null}
        {/* FileViewer portals itself (OverWindow). */}
        {viewing ? <FileViewer file={{ staged: viewing }} name={displayName(viewing.name)} onClose={closeViewer} /> : null}
        {picked ? (
          <div className="slash-suggestions" role="listbox" aria-label={t('Slash commands')}>
            {suggestions.map((command, i) => (
              <button
                key={command.name}
                role="option"
                aria-selected={command === picked}
                className={command === picked ? 'active' : undefined}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(command)}
              >
                <span className="slash-name">/{command.name}</span>
                <span className="slash-description">{command.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        {pickedBot ? (
          <div className="slash-suggestions mention-suggestions" role="listbox" aria-label={t('Mention a Bot')}>
            {tagged.map((bot, i) => (
              <button
                key={bot.name}
                role="option"
                aria-selected={bot === pickedBot}
                className={bot === pickedBot ? 'active' : undefined}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pickBot(bot)}
              >
                <span className="slash-name">@{mentionTag(bot)}</span>
                <span className="slash-description">{bot.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {replyTo ? (
          <div className="reply-chip" title={replyTo.text}>
            <span className="reply-chip-body">
              <span className="reply-chip-name">{t('Replying to {name}', { name: replyTo.author })}</span>
              <span className="reply-chip-text">{excerpt(replyTo.text)}</span>
            </span>
            <button className="staged-remove" aria-label={t('Remove the reply')} onClick={() => setReplyTo(null)}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
        {offeredClips.map(clip => (
          <div key={clip.id} className="composer-notice dictation-clip" role="status">
            <span>{t("Your {duration} dictation wasn't transcribed. Its recording is saved.", { duration: durationLabel(clip.duration) })}</span>
            <button className="secondary" disabled={uploading.size > 0 || transcribing} onClick={() => void deliver(clip, false)}>
              {t('Retry')}
            </button>
            <button
              className="staged-remove"
              aria-label={t('Delete')}
              title={t('Delete')}
              onClick={async () => {
                if (await ask(t("Delete this recording? Its words haven't been transcribed."))) void dictationClips.release(clip.id)
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        {notice ? <div className="composer-notice">{notice}</div> : null}
        <label className="sr-only" htmlFor="composer-input">
          {t('Message')}
        </label>
        {recorder.recording || transcribing ? (
          <div className="voice-strip" role="status">
            {transcribing ? (
              <>
                <span className="voice-busy">
                  <Icon name="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                  {t('Transcribing')}
                </span>
                {waitingOn.current ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      // Its recording stays for Retry; words that come later still reach this draft.
                      waitingOn.current = null
                      setTranscribing(false)
                    }}
                  >
                    {t('Cancel')}
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <span className="voice-dot" />
                <span className="voice-time">{durationLabel(recorder.elapsed)}</span>
                <span className="voice-meter" aria-label={t('Microphone input level')}>
                  <span ref={meter} />
                </span>
                <button className="secondary" onClick={recorder.cancel}>
                  {t('Cancel')}
                </button>
                <button className="secondary" onClick={() => void dictate()} title={t('Type out what you said')}>
                  {t('Dictate')}
                </button>
                {canAttach ? (
                  <button className="primary" onClick={() => void sendVoice()}>
                    {t('Send voice message')}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <textarea
          id="composer-input"
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={e => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
          }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="composer-row">
          {canAttach ? (
            <>
              <button className="attach" aria-label={t('Attach')} title={t('Attach')} disabled={disabled} onClick={() => picker.current?.click()}>
                <Icon name="paperclip" />
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={e => {
                  void stage(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
              {screenshot ? (
                <button
                  className="attach"
                  aria-label={t('Ask Hermes About Screen')}
                  title={t('Ask Hermes About Screen')}
                  disabled={disabled || screenshot.capturing}
                  onClick={screenshot.take}
                >
                  <Icon name={screenshot.capturing ? 'spinner' : 'image'} />
                </button>
              ) : null}
            </>
          ) : null}
          {mentionBots?.length ? (
            <span className="message-more composer-mention">
              <button
                className="attach mention-button"
                aria-label={t('Mention a Bot')}
                title={t('Mention a Bot')}
                aria-haspopup="menu"
                aria-expanded={mentionMenu}
                disabled={disabled}
                onClick={e => {
                  e.stopPropagation()
                  setMentionMenu(open => !open)
                }}
              >
                @
              </button>
              {mentionMenu ? (
                <div className="host-menu message-menu mention-menu" role="menu" aria-label={t('Mention a Bot')}>
                  {mentionBots.map(bot => (
                    <button key={bot.name} role="menuitem" onClick={() => mentionBot(bot)}>
                      {bot.title}
                      <span className="meta">@{mentionTag(bot)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
          ) : null}
          {voice ? (
            <button
              className="attach"
              aria-label={t('Record')}
              title={t('Record: dictate, or send a voice message')}
              disabled={disabled || recorder.recording || transcribing}
              onClick={() => {
                setNotice(null)
                recorder.clearError()
                void recorder.start()
              }}
            >
              <Icon name="mic" />
            </button>
          ) : null}
          {onModel ? (
            <button className="chip chip-button" title={t('Model')} aria-haspopup="dialog" disabled={disabled} onClick={onModel}>
              {model || t('Model')}
            </button>
          ) : model ? (
            <span className="chip" title={t('Model')}>
              {model}
            </span>
          ) : null}
          {context && onContext ? (
            <button
              className="chip chip-button context-chip"
              title={t('Context: {percent}% full', { percent: Math.round(context.percent) })}
              aria-label={t('Context: {percent}% full', { percent: Math.round(context.percent) })}
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={onContext}
            >
              <ContextRing percent={context.percent} />
              {Math.round(context.percent)}%
            </button>
          ) : null}
          {cwd ? (
            <span className="chip" title={t('Working folder: {folder}', { folder: cwd })}>
              {folderName(cwd)}
            </span>
          ) : null}
          <span className="hint">{running ? t('Esc stops') : t('Enter sends · Shift Enter new line')}</span>
          {running && !hasContent && !dictating ? (
            <button className="send stop" aria-label={t('Stop')} title={t('Stop (Esc)')} onClick={onStop}>
              <Icon name="stop" />
            </button>
          ) : (
            <button className="send" aria-label={t('Send')} disabled={!canSend} onClick={send}>
              <Icon name="send" style={{ strokeWidth: 2.2 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The window's fullness as a small ring, amber, then orange past 80%. */
export function ContextRing({ percent, size = 14 }: { percent: number; size?: number }) {
  const radius = (size - 3) / 2
  const length = 2 * Math.PI * radius
  const shown = Math.min(100, Math.max(0, percent))
  return (
    <svg className={`context-ring${shown >= 80 ? ' full' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} className="track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="fill"
        strokeDasharray={`${(shown / 100) * length} ${length}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/** One row of suggested replies, after the phone's PredictiveRow: click sends, right-click (or Alt-click) puts it in the draft to edit first. */
function SuggestedReplies({ replies, onSend, onEdit }: { replies: string[]; onSend: (text: string) => void; onEdit: (text: string) => void }) {
  const shownAt = useRef(performance.now())
  const joined = replies.join('\n')
  useEffect(() => {
    shownAt.current = performance.now()
  }, [joined])
  return (
    <div className="suggested-replies" role="group" aria-label={t('Suggested replies')}>
      {replies.map(reply => (
        <button
          key={reply}
          className="suggested-reply"
          title={t('Click to send. Right-click to edit it first.')}
          onClick={e => {
            if (performance.now() - shownAt.current < TAP_GUARD_MS) return
            if (e.altKey) onEdit(reply)
            else onSend(reply)
          }}
          onContextMenu={e => {
            e.preventDefault()
            onEdit(reply)
          }}
        >
          {reply}
        </button>
      ))}
    </div>
  )
}
