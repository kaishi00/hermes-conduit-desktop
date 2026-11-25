import { memo, useState } from 'react'
import { t } from '@shared/i18n'
import { dialable, list, mailtoLink, number, people, share, smsLink, strings, text, textRecipient, type Board, type Card, type Person } from '../state/boards'
import { Icon } from './icons'
import { Markdown } from './Markdown'

/**
 * The cards a conduit_show call showed: drawn here for the plainer kinds,
 * stacked or as tabs, else the board's Markdown. Its follow-ups, while it's
 * the last turn's last board, send as the user's next message. Drawn again
 * only for another board (boards are made new, never changed in place), so a
 * board placed in a streaming reply isn't rebuilt every frame (desktop#542).
 */
export const BoardView = memo(function BoardView({ board, onFollowUp }: { board: Board; onFollowUp?: (text: string) => void }) {
  const [tab, setTab] = useState(0)
  const shown = board.tabs ? [board.cards[Math.min(tab, board.cards.length - 1)]!] : board.cards
  return (
    <div className="shown">
      {board.cards.length ? (
        <>
          {board.tabs ? (
            <div className="segmented shown-tabs" role="tablist">
              {board.cards.map((card, index) => (
                <button key={index} role="tab" aria-selected={index === tab} className={index === tab ? 'on' : undefined} onClick={() => setTab(index)}>
                  {card.title || t('Card {number}', { number: index + 1 })}
                </button>
              ))}
            </div>
          ) : null}
          {shown.map((card, index) => (
            <CardView key={`${tab}-${index}`} card={card} titled={!board.tabs} />
          ))}
        </>
      ) : board.markdown ? (
        <div className="shown-card assistant">
          <Markdown text={board.markdown} />
        </div>
      ) : null}
      {onFollowUp && board.next.length ? <BoardFollowUps next={board.next} onFollowUp={onFollowUp} /> : null}
    </div>
  )
})

/** A board's follow-ups: under the board at its own row, or under the reply that placed it. */
export function BoardFollowUps({ next, onFollowUp }: { next: string[]; onFollowUp: (text: string) => void }) {
  return (
    <div className="shown-next">
      {next.map(text => (
        <button key={text} className="chip" onClick={() => onFollowUp(text)}>
          {text}
        </button>
      ))}
    </div>
  )
}

function CardView({ card, titled }: { card: Card; titled: boolean }) {
  return (
    <section className={`shown-card kind-${card.type}`}>
      {titled && card.title ? <h4>{card.title}</h4> : null}
      <CardBody card={card} />
    </section>
  )
}

function CardBody({ card }: { card: Card }) {
  switch (card.type) {
    case 'contact':
      return (
        <div className="shown-people">
          {people(card).map((person, index) => (
            <PersonRow key={index} person={person} />
          ))}
        </div>
      )
    case 'stats':
      return (
        <div className="shown-stats">
          {list(card.stats).map((stat, index) => (
            <div key={index} className="shown-stat">
              <span className="meta">{text(stat.label)}</span>
              <strong className={stat.tone === 'good' ? 'good' : stat.tone === 'bad' ? 'bad' : undefined}>{text(stat.value)}</strong>
              {stat.change ? (
                <span className={`shown-change ${text(stat.trend)}`}>
                  {stat.trend === 'up' ? '▲ ' : stat.trend === 'down' ? '▼ ' : ''}
                  {text(stat.change)}
                </span>
              ) : null}
              {stat.detail ? <span className="meta">{text(stat.detail)}</span> : null}
            </div>
          ))}
        </div>
      )
    case 'table': {
      const table = (card.table ?? {}) as { columns?: unknown; rows?: unknown }
      const columns = strings(table.columns)
      const rows = Array.isArray(table.rows) ? table.rows.map(strings) : []
      return <SortableTable columns={columns} rows={rows} />
    }
    case 'checklist':
      return <Checklist items={list(card.checklist)} />
    case 'steps':
      return (
        <ol className="shown-steps">
          {list(card.steps).map((step, index) => (
            <li key={index}>
              <span>{text(step.text)}</span>
              {number(step.timer) ? <span className="meta"> · {timerText(number(step.timer)!)}</span> : null}
            </li>
          ))}
        </ol>
      )
    case 'list':
      return (
        <ul className="shown-list">
          {list(card.list).map((row, index) => (
            <li key={index}>
              <div>
                {row.url ? (
                  <a href={text(row.url)} target="_blank" rel="noreferrer">
                    {text(row.title)}
                  </a>
                ) : (
                  <strong>{text(row.title)}</strong>
                )}
                {row.detail ? <div className="meta">{text(row.detail)}</div> : null}
              </div>
              {row.value ? <span className="shown-value">{text(row.value)}</span> : null}
            </li>
          ))}
        </ul>
      )
    case 'progress':
      return (
        <div className="shown-progress">
          {list(card.progress).map((row, index) => {
            const goal = number(row.goal)
            const value = number(row.value) ?? 0
            const unit = text(row.unit)
            return (
              <div key={index}>
                <div className="shown-progress-top">
                  <span>{text(row.label)}</span>
                  <span className="meta">
                    {goal ? `${value.toLocaleString()} / ${goal.toLocaleString()}` : `${Math.round(share(value, goal) * 100)}%`}
                    {unit ? ` ${unit}` : ''}
                  </span>
                </div>
                <div className="shown-bar">
                  <span style={{ width: `${share(value, goal) * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )
    case 'callout': {
      const callout = (card.callout ?? {}) as { text?: unknown; tone?: unknown }
      return (
        <div className={`shown-callout ${text(callout.tone) || 'note'}`}>
          <Markdown text={text(callout.text)} />
        </div>
      )
    }
    case 'status': {
      const status = (card.status ?? {}) as Record<string, unknown>
      const progress = number(status.progress)
      return (
        <div className={`shown-status ${text(status.phase)}`}>
          <strong>{text(status.state)}</strong>
          {status.detail ? <span className="meta">{text(status.detail)}</span> : null}
          {progress !== undefined ? (
            <div className="shown-bar">
              <span style={{ width: `${share(progress, 1) * 100}%` }} />
            </div>
          ) : null}
          {status.eta ? <span className="meta">{text(status.eta)}</span> : null}
          {list(status.milestones).length ? (
            <ul className="shown-milestones">
              {list(status.milestones).map((step, index) => (
                <li key={index} className={step.done === true ? 'done' : undefined}>
                  <Icon name={step.done === true ? 'check' : 'clock'} />
                  {text(step.label)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )
    }
    case 'timeline':
      return (
        <div className="shown-timeline">
          {list(card.timeline).map((day, index) => (
            <div key={index} className="shown-day">
              <div className="shown-day-head">
                <strong>{text(day.label)}</strong>
                {day.title ? <span className="meta"> · {text(day.title)}</span> : null}
              </div>
              <ul>
                {list(day.stops).map((stop, stopIndex) => (
                  <li key={stopIndex}>
                    {stop.time ? <span className="shown-time">{text(stop.time)}</span> : null}
                    <span>
                      {text(stop.text)}
                      {stop.place ? <span className="meta"> · {text(stop.place)}</span> : null}
                      {stop.note ? <div className="meta">{text(stop.note)}</div> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )
    default:
      return null
  }
}

function timerText(seconds: number): string {
  if (seconds < 60) return t('{count} s', { count: seconds })
  if (seconds < 3600) return t('{count} min', { count: Math.round(seconds / 60) })
  return t('{count} h', { count: Math.round((seconds / 3600) * 10) / 10 })
}

/** A table to sort: a column's header sorts by it, numbers as numbers. */
function SortableTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const [sort, setSort] = useState<{ column: number; up: boolean } | null>(null)
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const x = a[sort.column] ?? ''
        const y = b[sort.column] ?? ''
        const nx = Number(x.replace(/[^0-9.-]/g, ''))
        const ny = Number(y.replace(/[^0-9.-]/g, ''))
        const order = x.trim() && y.trim() && Number.isFinite(nx) && Number.isFinite(ny) && /\d/.test(x) && /\d/.test(y) ? nx - ny : x.localeCompare(y)
        return sort.up ? order : -order
      })
    : rows
  return (
    <div className="shown-table">
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index}>
                <button onClick={() => setSort(current => ({ column: index, up: current?.column === index ? !current.up : true }))}>
                  {column}
                  {sort?.column === index ? (sort.up ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={index}>
              {columns.map((_, cell) => (
                <td key={cell}>{row[cell] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A checklist the user ticks here; the ticks stay in this window. */
function Checklist({ items }: { items: Record<string, unknown>[] }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  let group = ''
  return (
    <ul className="shown-checklist">
      {items.map((item, index) => {
        const heading = text(item.group) && text(item.group) !== group ? text(item.group) : null
        if (heading) group = heading
        return (
          <li key={index}>
            {heading ? <div className="shown-group">{heading}</div> : null}
            <label>
              <input
                type="checkbox"
                checked={ticked.has(index)}
                onChange={() =>
                  setTicked(current => {
                    const next = new Set(current)
                    if (next.has(index)) next.delete(index)
                    else next.add(index)
                    return next
                  })
                }
              />
              <span>{text(item.text)}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A contact card's person, after the phone's RichPersonRow: who they are,
 * how to reach them, and a text Hermes wrote for the user. Send text copies
 * it and opens Messages to them, where the user pastes and sends it:
 * nothing is sent for them.
 */
function PersonRow({ person }: { person: Person }) {
  const [copied, setCopied] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const recipient = textRecipient(person)
  const phone = dialable(person.phone)
  const initials = person.name
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
  const open = (link: string) => window.open(link, '_blank', 'noopener')
  return (
    <div className="shown-person">
      <div className="shown-person-head">
        <span className="shown-person-avatar" aria-hidden="true">
          {person.photo && !photoFailed ? <img src={person.photo} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} /> : initials}
        </span>
        <div>
          <strong>{person.name}</strong>
          {person.detail ? <div className="meta">{person.detail}</div> : null}
        </div>
      </div>
      {person.phone ? <div className="shown-person-line">{person.phone}</div> : null}
      {person.email ? <div className="shown-person-line">{person.email}</div> : null}
      {person.address ? <div className="shown-person-line">{person.address}</div> : null}
      {person.note ? <div className="meta shown-person-note">{person.note}</div> : null}
      {person.message ? (
        <div className="shown-person-message" aria-label={t('Text to send')}>
          {person.message}
        </div>
      ) : null}
      <div className="shown-person-actions">
        {recipient && person.message ? (
          <button
            className="primary"
            onClick={() => {
              void navigator.clipboard.writeText(person.message!).then(
                () => setCopied(true),
                () => undefined
              )
              open(smsLink(recipient))
            }}
          >
            {copied ? t('Copied') : t('Send text')}
          </button>
        ) : null}
        {phone ? <button onClick={() => open(`tel:${phone}`)}>{t('Call')}</button> : null}
        {phone && !person.message ? <button onClick={() => open(smsLink(phone))}>{t('Message')}</button> : null}
        {person.email ? <button onClick={() => open(mailtoLink(person.email!))}>{t('Email')}</button> : null}
        {person.url ? <button onClick={() => open(person.url!)}>{t('Website')}</button> : null}
      </div>
      {copied ? <p className="meta">{t('The text is copied: paste it in Messages and send it there.')}</p> : null}
    </div>
  )
}
