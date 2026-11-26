import { useId, type ReactNode } from 'react'

/**
 * The section glyphs ("1b, sculpted, simplified"; Eric 2026-11-26): solid
 * shapes on a 24-unit grid, a front plane in the text colour and, for most, a
 * back plane at half strength with a cut between them (Bots and Needs you are
 * one plane each). Everything is currentColor, so a
 * glyph takes the theme's neutral text colour at rest and the user's accent
 * when its section is open; no colour is baked in.
 *
 * Masks: white keeps, black cuts. Each glyph gets its own mask ids, so two
 * copies on screen never share (or fight over) a mask.
 */
export type NavGlyphName = 'bots' | 'chats' | 'tasks' | 'pulse' | 'artifacts' | 'needs' | 'settings'

const W = { fill: '#fff' }
const K = { fill: '#000' }
const box = { x: -2, y: -2, width: 28, height: 28 }

type Mask = (inner: ReactNode, secondary?: boolean) => ReactNode

function glyph(name: NavGlyphName, mask: Mask): ReactNode {
  switch (name) {
    case 'bots':
      return mask(
        <>
          <path d="M4.8 14.4v-1.6a7.2 7.2 0 0114.4 0v1.6" stroke="#fff" strokeWidth={2.8} fill="none" strokeLinecap="round" />
          <rect x={2.5} y={11.6} width={5} height={8.6} rx={2.5} {...W} />
          <rect x={16.5} y={11.6} width={5} height={8.6} rx={2.5} {...W} />
          <path d="M19 19.4c0 1.8-1.6 2.6-4.6 2.6" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" />
          <rect x={9.4} y={20.5} width={5.4} height={3.1} rx={1.55} {...W} />
        </>
      )
    case 'chats':
      return (
        <>
          {mask(
            <>
              <rect x={8.6} y={2.4} width={13} height={10} rx={5} {...W} />
              <path d="M19.4 11l2 4.6-4.8-2.4z" {...W} />
              <rect x={1} y={5.9} width={16.4} height={13.6} rx={6.6} {...K} />
            </>,
            true
          )}
          {mask(
            <>
              <rect x={2.4} y={7.3} width={13.6} height={10.8} rx={5.3} {...W} />
              <path d="M4.4 16.2l-1.6 5.2 5.6-3.2z" {...W} />
            </>
          )}
        </>
      )
    case 'tasks':
      return (
        <>
          {mask(
            <>
              <rect x={13.6} y={2.8} width={7.8} height={7.6} rx={2.6} {...W} />
              <rect x={13.6} y={12.4} width={7.8} height={8.8} rx={2.6} {...W} />
            </>,
            true
          )}
          {mask(
            <>
              <rect x={2.6} y={2.8} width={9.6} height={18.4} rx={3} {...W} />
              <path d="M5 12.4l2.1 2.1 3-3.4" stroke="#000" strokeWidth={2.1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </>
      )
    case 'pulse': {
      const wave = 'M1.6 12.6h4.2l2.2-4.6 3.6 9 2.8-7 1.6 2.6h6.4'
      return (
        <>
          {mask(
            <>
              <circle cx={12} cy={12} r={9.6} {...W} />
              <path d={wave} stroke="#000" strokeWidth={5.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </>,
            true
          )}
          <path d={wave} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )
    }
    case 'artifacts':
      return (
        <>
          {mask(
            <>
              <rect x={8.6} y={2.4} width={12.8} height={14} rx={3.2} {...W} />
              <rect x={1.4} y={5.9} width={15.8} height={17} rx={4.6} {...K} />
            </>,
            true
          )}
          {mask(
            <>
              <rect x={2.8} y={7.3} width={13} height={14.3} rx={3.2} {...W} />
              <rect x={5.8} y={11.6} width={7} height={2} rx={1} {...K} />
              <rect x={5.8} y={15.4} width={4.6} height={2} rx={1} {...K} />
            </>
          )}
        </>
      )
    case 'needs':
      return mask(
        <>
          <rect x={2.4} y={2.6} width={19.2} height={15.6} rx={6.4} {...W} />
          <path d="M13.4 16.6l7 5.6-.6-7.6z" {...W} />
          <rect x={10.7} y={5.9} width={2.6} height={7.1} rx={1.3} {...K} />
          <circle cx={12} cy={15.4} r={1.55} {...K} />
        </>
      )
    case 'settings':
      return (
        <>
          {mask(
            <>
              <rect x={2.2} y={4.6} width={19.6} height={5} rx={2.5} {...W} />
              <rect x={2.2} y={14.4} width={19.6} height={5} rx={2.5} {...W} />
              <circle cx={15.6} cy={7.1} r={5.1} {...K} />
              <circle cx={8.4} cy={16.9} r={5.1} {...K} />
            </>,
            true
          )}
          <circle cx={15.6} cy={7.1} r={3.7} fill="currentColor" />
          <circle cx={8.4} cy={16.9} r={3.7} fill="currentColor" />
        </>
      )
  }
}

export function NavGlyph({ name, className }: { name: NavGlyphName; className?: string }) {
  // useId gives ":r1:"; colons are awkward inside url(#…), so keep word characters only.
  const base = `nav${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  let n = 0
  const mask: Mask = (inner, secondary = false) => {
    const id = `${base}-${n++}`
    return (
      <g key={id}>
        <defs>
          <mask id={id} maskUnits="userSpaceOnUse" {...box}>
            {inner}
          </mask>
        </defs>
        <rect
          {...box}
          fill="currentColor"
          fillOpacity={secondary ? 0.5 : undefined}
          mask={`url(#${id})`}
        />
      </g>
    )
  }
  return (
    <svg
      className={className ? `glyph ${className}` : 'glyph'}
      data-glyph={name}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {glyph(name, mask)}
    </svg>
  )
}
