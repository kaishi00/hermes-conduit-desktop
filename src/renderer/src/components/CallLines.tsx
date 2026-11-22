import { useLayoutEffect, useRef } from 'react'
import { atEnd } from '../state/scrollEnd'

export interface CallLine {
  id: number
  who: 'user' | 'assistant'
  text: string
}

/**
 * A live call's transcript under its status. It follows the newest line, as
 * the phone's call screen does (anchored at the bottom), unless the user has
 * scrolled up to read; scrolling back to the end follows again.
 */
export function CallLines({ lines }: { lines: readonly CallLine[] }) {
  const list = useRef<HTMLOListElement>(null)
  const following = useRef(true)
  // Runs after every render, so a line growing word by word keeps up too.
  useLayoutEffect(() => {
    const el = list.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  })
  if (!lines.length) return null
  return (
    <ol
      ref={list}
      className="voice-call-lines"
      aria-live="polite"
      onScroll={event => {
        following.current = atEnd(event.currentTarget)
      }}
    >
      {lines.map(line => (
        <li key={line.id} className={line.who === 'user' ? 'voice-call-line said' : 'voice-call-line'}>
          {line.text}
        </li>
      ))}
    </ol>
  )
}
