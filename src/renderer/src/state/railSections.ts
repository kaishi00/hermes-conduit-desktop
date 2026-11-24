/**
 * Which sections stand in the leading rail, and in what order, kept on this
 * computer as `conduit.railSections.v1`: each section's name in order, with a
 * leading "-" when unpinned (`["chats", "bots", "-pulse", ...]`), after
 * `launchTab.ts`. Chats and Settings stay anchored so the window always has a
 * conversation view and a way back to preferences. An unpinned section opened
 * from elsewhere stands in its stored slot while on screen and leaves once
 * another section is chosen.
 */
import { DEFAULT_RAIL_SECTIONS, type RailSection } from '../../../shared/ipc'

export type { RailSection }
export const RAIL_SECTIONS: readonly RailSection[] = DEFAULT_RAIL_SECTIONS
export const RAIL_STORAGE_KEY = 'conduit.railSections.v1'

const KNOWN = new Set<string>(RAIL_SECTIONS)
const ALWAYS_PINNED = new Set<RailSection>(['chats'])

export interface UnknownRailToken {
  token: string
  after: RailSection | null
}

export interface RailLayout {
  order: RailSection[]
  hidden: ReadonlySet<RailSection>
  /** Tokens written by a newer Conduit build, kept beside the section they followed. */
  unknown: UnknownRailToken[]
}

export function canUnpinSection(section: RailSection): boolean {
  return !ALWAYS_PINNED.has(section)
}

export function parseRailLayout(stored: unknown): RailLayout {
  const order: RailSection[] = []
  const hidden = new Set<RailSection>()
  const unknown: UnknownRailToken[] = []
  const seenUnknown = new Set<string>()

  for (const raw of Array.isArray(stored) ? stored : []) {
    if (typeof raw !== 'string') continue
    const isHidden = raw.startsWith('-')
    const name = isHidden ? raw.slice(1) : raw
    if (!name) continue
    if (!KNOWN.has(name)) {
      if (!seenUnknown.has(name)) {
        seenUnknown.add(name)
        unknown.push({ token: raw, after: order.at(-1) ?? null })
      }
      continue
    }
    const section = name as RailSection
    if (order.includes(section)) continue
    order.push(section)
    if (isHidden && canUnpinSection(section)) hidden.add(section)
  }

  for (const section of RAIL_SECTIONS) {
    if (!order.includes(section)) order.push(section)
  }

  return { order, hidden, unknown }
}

export function serializeRailLayout(layout: RailLayout): string[] {
  const tokens: string[] = layout.unknown.filter(u => u.after === null).map(u => u.token)
  for (const section of layout.order) {
    tokens.push(layout.hidden.has(section) && canUnpinSection(section) ? `-${section}` : section)
    for (const item of layout.unknown) {
      if (item.after === section) tokens.push(item.token)
    }
  }
  return tokens
}

export function isDefaultRailLayout(layout: RailLayout): boolean {
  return layout.hidden.size === 0 && layout.order.length === RAIL_SECTIONS.length && layout.order.every((s, i) => s === RAIL_SECTIONS[i])
}

export function pinnedSections(layout: RailLayout): RailSection[] {
  return layout.order.filter(section => !layout.hidden.has(section))
}

/** The rail's buttons: every pinned section, plus `active` in its stored slot when something else opened it. */
export function shownRailSections(layout: RailLayout, active: RailSection | null): RailSection[] {
  return layout.order.filter(section => !layout.hidden.has(section) || section === active)
}

export function setSectionPinned(layout: RailLayout, section: RailSection, pinned: boolean): RailLayout {
  if (!pinned && !canUnpinSection(section)) return layout
  if (pinned !== layout.hidden.has(section)) return layout
  const hidden = new Set(layout.hidden)
  if (pinned) hidden.delete(section)
  else hidden.add(section)
  return { ...layout, hidden }
}

export function moveRailSection(layout: RailLayout, source: RailSection, target: RailSection, position: 'before' | 'after'): RailLayout {
  if (source === target) return layout
  const without = layout.order.filter(s => s !== source)
  const at = without.indexOf(target)
  if (at < 0) return layout
  const insertAt = position === 'before' ? at : at + 1
  const nextOrder = [...without.slice(0, insertAt), source, ...without.slice(insertAt)]
  if (nextOrder.every((s, i) => s === layout.order[i])) return layout
  return { ...layout, order: nextOrder }
}

/**
 * `section` one place up or down among the buttons the rail shows, for the menu's Move up and Move down
 * (dragging needs a mouse). The layout as it was when there is no shown neighbor on that side.
 */
export function nudgeRailSection(layout: RailLayout, section: RailSection, by: -1 | 1, active: RailSection | null): RailLayout {
  const shown = shownRailSections(layout, active)
  const neighbor = shown[shown.indexOf(section) + by]
  if (!shown.includes(section) || !neighbor) return layout
  return moveRailSection(layout, section, neighbor, by < 0 ? 'before' : 'after')
}

export function resetRailLayout(): RailLayout {
  return parseRailLayout(undefined)
}

/** If the launch section is unpinned on this desktop, open the first pinned section instead. */
export function resolveInitialSection<T extends string>(candidate: T, layout: RailLayout): T | RailSection {
  if (KNOWN.has(candidate) && layout.hidden.has(candidate as RailSection)) {
    return pinnedSections(layout)[0] ?? 'chats'
  }
  return candidate
}

/** When the user unpins the section currently on screen, step to a pinned section so the icon leaves at once. */
export function fallbackAfterUnpin<T extends string>(
  currentSection: T,
  botsSideShown: boolean,
  unpinned: RailSection,
  nextLayout: RailLayout
): { section: T | RailSection; botsSide: boolean } {
  if (unpinned === 'bots' && currentSection === 'chats' && botsSideShown) {
    return { section: currentSection, botsSide: false }
  }
  if (currentSection === unpinned || (unpinned === 'bots' && currentSection === 'room')) {
    return { section: pinnedSections(nextLayout)[0] ?? 'chats', botsSide: false }
  }
  return { section: currentSection, botsSide: botsSideShown }
}

type RailStorage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readRailLayout(storage: RailStorage = localStorage): RailLayout {
  try {
    return parseRailLayout(JSON.parse(storage.getItem(RAIL_STORAGE_KEY) ?? 'null'))
  } catch {
    return parseRailLayout(undefined)
  }
}

export function writeRailLayout(layout: RailLayout, storage: RailStorage = localStorage): void {
  try {
    if (isDefaultRailLayout(layout) && layout.unknown.length === 0) storage.removeItem(RAIL_STORAGE_KEY)
    else storage.setItem(RAIL_STORAGE_KEY, JSON.stringify(serializeRailLayout(layout)))
  } catch {
    // Kept for this window only.
  }
}
