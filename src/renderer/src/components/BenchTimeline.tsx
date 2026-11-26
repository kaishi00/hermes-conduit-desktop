import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { t } from '@shared/i18n'
import { sameSteps, stepWhen, timelineSteps, type StepKind, type TimelineStep } from '../state/benchTimeline'
import type { TranscriptStore } from '../state/transcriptStore'
import { Icon } from './icons'

const ICONS: Record<StepKind, Parameters<typeof Icon>[0]['name']> = {
  ask: 'chats',
  command: 'terminal',
  edit: 'file',
  read: 'eye',
  page: 'globe',
  step: 'puzzle'
}

/**
 * The chat's steps, as the timeline draws them. They're made again when the
 * transcript changes, and given out again only when they differ, so a reply
 * streaming in, which changes the transcript every frame, doesn't redraw the
 * bench.
 */
export function useBenchSteps(store: TranscriptStore): TimelineStep[] {
  const kept = useRef<{ items: unknown; steps: TimelineStep[] }>({ items: null, steps: [] })
  return useSyncExternalStore(store.subscribe, () => {
    const { items } = store.get()
    if (items === kept.current.items) return kept.current.steps
    const steps = timelineSteps(items)
    kept.current = { items, steps: sameSteps(steps, kept.current.steps) ? kept.current.steps : steps }
    return kept.current.steps
  })
}

/**
 * The timeline over the bench (desktop issue 453): the chat's steps on a
 * scrubber, the newest at the right. Moving it to a step moves every view
 * there (the chat, the bot's commands, Files); Now goes back to following
 * the chat as it goes. The list behind it shows every step.
 */
export function BenchTimeline({ steps, at, onPick }: { steps: TimelineStep[]; at: string | null; onPick: (key: string | null) => void }) {
  const [listOpen, setListOpen] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const found = at === null ? -1 : steps.findIndex(step => step.key === at)
  const index = found >= 0 ? found : steps.length - 1
  const live = found < 0
  const step = steps[index]

  useEffect(() => {
    if (!listOpen) return
    list.current?.querySelector<HTMLElement>('.on')?.scrollIntoView({ block: 'nearest' })
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.bench-timeline')) setListOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [listOpen])

  if (!steps.length) return null
  const last = steps.length - 1
  const pick = (i: number) => onPick(i >= last ? null : steps[Math.max(0, i)]!.key)
  const fromPointer = (clientX: number) => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width <= 0) return index
    return Math.round(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * last)
  }
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    let shown = fromPointer(e.clientX)
    pick(shown)
    const move = (ev: PointerEvent) => {
      const next = fromPointer(ev.clientX)
      if (next !== shown) pick((shown = next))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const keys = (e: React.KeyboardEvent) => {
    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -10, PageDown: 10 }
    if (e.key in by) pick(Math.max(0, Math.min(last, index + by[e.key]!)))
    else if (e.key === 'Home') pick(0)
    else if (e.key === 'End') pick(last)
    else return
    e.preventDefault()
  }
  const place = (i: number) => (last ? `${(i / last) * 100}%` : '100%')

  return (
    <div className="bench-timeline">
      <button className="bench-timeline-step" title={t('Every step')} aria-expanded={listOpen} onClick={() => setListOpen(open => !open)}>
        {step ? <Icon name={ICONS[step.kind]} /> : null}
        <span className="bench-timeline-title">{step ? (step.detail ? `${step.title}: ${step.detail}` : step.title) : null}</span>
        <span className="meta">{step?.running ? t('Running') : stepWhen(step?.at)}</span>
      </button>
      <div
        className="bench-timeline-track"
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={t('Timeline')}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={index + 1}
        aria-valuetext={step ? `${step.title}${step.detail ? `: ${step.detail}` : ''}` : undefined}
        onPointerDown={drag}
        onKeyDown={keys}
      >
        <div className="bench-timeline-rail" />
        {steps.map((s, i) => (
          <span key={s.key} className={`bench-timeline-tick tick-${s.kind}`} style={{ left: place(i) }} />
        ))}
        <span className={`bench-timeline-thumb${live ? ' live' : ''}`} style={{ left: place(index) }} />
      </div>
      <button className="bench-timeline-now" disabled={live} title={t('Follow the chat as it goes')} onClick={() => onPick(null)}>
        {t('Now')}
      </button>
      {listOpen ? (
        <div className="bench-timeline-list" ref={list} role="listbox" aria-label={t('Every step')}>
          {steps
            .map((s, i) => ({ s, i }))
            .reverse()
            .map(({ s, i }) => (
              <button
                key={s.key}
                role="option"
                aria-selected={i === index}
                className={i === index ? 'on' : undefined}
                onClick={() => {
                  pick(i)
                  setListOpen(false)
                }}
              >
                <Icon name={ICONS[s.kind]} />
                <span className="bench-timeline-title">
                  {s.title}
                  {s.detail ? <span className="bench-timeline-detail">{s.detail}</span> : null}
                </span>
                <span className="meta">{s.running ? t('Running') : stepWhen(s.at)}</span>
              </button>
            ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The bot's command terminal (desktop issue 453): the commands it ran in
 * this chat and what they wrote, in order, read-only, in the drawer beside
 * the shells. The timeline's step shows here, its command marked.
 */
export function BotCommands({ steps, at, shown }: { steps: TimelineStep[]; at: string | null; shown: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const commands = steps.filter(step => step.kind === 'command')
  const lastKey = commands.at(-1)?.key
  const lastOutput = commands.at(-1)?.output

  // Following the chat, the newest command shows; on a step, that step's.
  useEffect(() => {
    const el = box.current
    if (!el || !shown) return
    if (at) el.querySelector<HTMLElement>(`[data-step="${CSS.escape(at)}"]`)?.scrollIntoView({ block: 'start' })
    else el.scrollTop = el.scrollHeight
  }, [at, shown, lastKey, lastOutput])

  return (
    <div className="bench-bot-commands" ref={box} hidden={!shown}>
      {commands.length ? (
        commands.map(step => (
          <div key={step.key} data-step={step.key} className={`bench-bot-command${step.key === at ? ' on' : ''}`}>
            <div className="bench-bot-line">
              <span className="bench-bot-prompt">$</span>
              <span>{step.detail ?? step.title}</span>
              <span className="meta">{step.running ? t('Running') : stepWhen(step.at)}</span>
            </div>
            {step.output ? <pre>{step.output}</pre> : null}
            {typeof step.exitCode === 'number' && step.exitCode !== 0 ? <div className="bench-bot-exit">{t('Ended with code {code}', { code: step.exitCode })}</div> : null}
          </div>
        ))
      ) : (
        <div className="bench-note">{t('The commands the bot runs in this chat show here, with what they wrote.')}</div>
      )}
    </div>
  )
}
