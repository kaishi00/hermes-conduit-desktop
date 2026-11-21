import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

/**
 * The app's dropdown: a field that opens a rounded menu drawn by the app, in place of a native
 * <select>, whose list Windows and macOS draw square and in their own colors. It takes <option>
 * children as a <select> does, so a screen swaps the tag and reads the picked value directly.
 */

export type SelectOptionRow = { value: string; label: ReactNode; disabled: boolean; lang?: string }

type Props = {
  value: string | number
  onChange: (value: string) => void
  children: ReactNode
  disabled?: boolean
  className?: string
  title?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  /** Two or three short, fixed choices: drawn as segmented buttons, as the phone's Settings draw them. */
  segments?: boolean
}

type OptionProps = { value?: string | number; disabled?: boolean; lang?: string; children?: ReactNode }

/** The <option> rows among the children, through fragments, arrays and conditionals. */
export function selectOptions(children: ReactNode): SelectOptionRow[] {
  const rows: SelectOptionRow[] = []
  Children.forEach(children, child => {
    if (!isValidElement(child)) return
    if (child.type === Fragment) {
      rows.push(...selectOptions((child as ReactElement<{ children?: ReactNode }>).props.children))
      return
    }
    if (child.type !== 'option') return
    const props = (child as ReactElement<OptionProps>).props
    const label = props.children ?? ''
    rows.push({ value: String(props.value ?? textOf(label)), label, disabled: !!props.disabled, lang: props.lang })
  })
  return rows
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  // A label drawn with elements (a face beside a name) types ahead by its text.
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children)
  return ''
}

/** The row the field shows: the one matching the value, else none, as a <select> with no matching option shows blank. */
export function shownOption(rows: SelectOptionRow[], value: string): SelectOptionRow | undefined {
  return rows.find(row => row.value === value)
}

/** The next row a key moves to, skipping disabled rows; stays put at either end. */
export function stepOption(rows: SelectOptionRow[], from: number, step: number): number {
  for (let i = from + step; i >= 0 && i < rows.length; i += step) if (!rows[i].disabled) return i
  return from
}

const MENU_MAX = 320
const GAP = 4
const MARGIN = 8

type Place = { left: number; top?: number; bottom?: number; width: number; maxHeight: number }

export function Select(props: Props) {
  return props.segments ? <Segments {...props} /> : <Menu {...props} />
}

function Segments({ value, onChange, children, disabled, title, id, ...aria }: Props) {
  const rows = selectOptions(children)
  const current = String(value)
  return (
    <div id={id} className="segmented conduit-segments" role="radiogroup" title={title} aria-label={aria['aria-label']} aria-labelledby={aria['aria-labelledby']}>
      {rows.map(row => (
        <button
          key={row.value}
          type="button"
          role="radio"
          aria-checked={row.value === current}
          disabled={disabled || row.disabled}
          onClick={() => row.value !== current && onChange(row.value)}
        >
          <span lang={row.lang}>{row.label}</span>
        </button>
      ))}
    </div>
  )
}

function Menu({ value, onChange, children, disabled, className, title, id, ...aria }: Props) {
  const rows = selectOptions(children)
  const current = String(value)
  const shown = shownOption(rows, current)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [place, setPlace] = useState<Place | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()

  function openMenu() {
    if (disabled || rows.length === 0) return
    const at = rows.findIndex(row => row.value === current)
    setActive(at >= 0 && !rows[at].disabled ? at : stepOption(rows, -1, 1))
    setOpen(true)
  }

  function close(refocus: boolean) {
    setOpen(false)
    setPlace(null)
    if (refocus) trigger.current?.focus()
  }

  function pick(index: number) {
    const row = rows[index]
    if (!row || row.disabled) return
    close(true)
    if (row.value !== current) onChange(row.value)
  }

  // Under the field, or above it when there's more room there; never past the window's edges.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - GAP - MARGIN
    const above = rect.top - GAP - MARGIN
    const needed = Math.min(MENU_MAX, menu.current?.scrollHeight ?? MENU_MAX)
    const up = below < needed && above > below
    const width = Math.max(rect.width, 160)
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN))
    setPlace(
      up
        ? { left, bottom: window.innerHeight - rect.top + GAP, width, maxHeight: Math.min(MENU_MAX, above) }
        : { left, top: rect.bottom + GAP, width, maxHeight: Math.min(MENU_MAX, below) }
    )
  }, [open])

  useEffect(() => {
    if (!open || !place) return
    const row = menu.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, place, active])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close(false)
    }
    // The page moving under it would leave it floating where the field was.
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close(false)
    }
    const onResize = () => close(false)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [open])

  function typeahead(key: string) {
    const now = Date.now()
    const text = (now - typed.current.at > 700 ? '' : typed.current.text) + key.toLowerCase()
    typed.current = { text, at: now }
    const start = text.length === 1 ? active + 1 : active
    for (let n = 0; n < rows.length; n++) {
      const i = (start + n) % rows.length
      if (!rows[i].disabled && textOf(rows[i].label).toLowerCase().startsWith(text)) return setActive(i)
    }
  }

  function onMenuKey(e: React.KeyboardEvent) {
    // Its own keys: the sheet or page around it never sees them.
    e.stopPropagation()
    if (e.key === 'ArrowDown') setActive(i => stepOption(rows, i, 1))
    else if (e.key === 'ArrowUp') setActive(i => stepOption(rows, i, -1))
    else if (e.key === 'Home') setActive(stepOption(rows, -1, 1))
    else if (e.key === 'End') setActive(stepOption(rows, rows.length, -1))
    else if (e.key === 'Enter' || e.key === ' ') pick(active)
    else if (e.key === 'Escape') close(true)
    else if (e.key === 'Tab') return close(true)
    else if (e.key.length === 1) typeahead(e.key)
    else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        id={id}
        className={className ? `conduit-select ${className}` : 'conduit-select'}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            openMenu()
          }
        }}
      >
        <span className="conduit-select-value" lang={shown?.lang}>
          {shown?.label}
        </span>
        <Icon name="chevronDown" className="conduit-select-chevron" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              id={listId}
              className="host-menu conduit-select-menu"
              role="listbox"
              aria-label={aria['aria-label']}
              style={
                place
                  ? { position: 'fixed', left: place.left, top: place.top ?? 'auto', bottom: place.bottom ?? 'auto', minWidth: place.width, maxHeight: place.maxHeight }
                  : { position: 'fixed', visibility: 'hidden' }
              }
              // Clicks inside it are its own: a sheet that closes on an outside click stays open.
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onKeyDown={onMenuKey}
            >
              {rows.map((row, i) => (
                <button
                  key={`${row.value}-${i}`}
                  type="button"
                  role="option"
                  tabIndex={i === active ? 0 : -1}
                  aria-selected={row.value === current}
                  disabled={row.disabled}
                  className={i === active ? 'active' : undefined}
                  onMouseEnter={() => !row.disabled && setActive(i)}
                  onClick={() => pick(i)}
                >
                  <span className="conduit-select-row" lang={row.lang}>
                    {row.label}
                  </span>
                  {row.value === current ? <Icon name="check" className="host-check" /> : <span className="host-check" />}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/**
 * Whether a key was pressed in an open dropdown's menu. A sheet that closes on Escape from a
 * capture-phase listener hears the key before the menu does, so it leaves the key to the menu.
 */
export function inSelectMenu(event: Event): boolean {
  const target = event.target
  return target instanceof Element && !!target.closest('.conduit-select-menu')
}
