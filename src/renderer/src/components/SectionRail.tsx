import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { RailSection } from '@shared/ipc'
import {
  canUnpinSection,
  isDefaultRailLayout,
  moveRailSection,
  pinnedSections,
  resetRailLayout,
  setSectionPinned,
  shownRailSections,
  type RailLayout
} from '../state/railSections'
import { glyphs, sectionTitle, shortcutForSection } from '../state/shortcuts'
import { Icon, type IconName } from './icons'

const SECTION_ICONS: Record<RailSection, IconName> = {
  bots: 'bots',
  chats: 'chats',
  tasks: 'tasks',
  pulse: 'pulse',
  artifacts: 'paperclip',
  needs: 'bell'
}

export interface SectionRailProps {
  layout: RailLayout
  /** Which top-rail section is currently active on screen (null when Settings is open). */
  activeSection: RailSection | null
  settingsSelected: boolean
  showSidebarButton: boolean
  onShowSidebar: () => void
  pulseUnseen: number
  needsCount: number
  connected: boolean
  hostLabel?: string
  onSelect: (section: RailSection) => void
  onSettings: () => void
  onChangeLayout: (next: RailLayout) => void
}

interface MenuState {
  x: number
  y: number
  target: RailSection | null
}

/**
 * The window's leading section rail: right-clicking anywhere on the rail opens
 * an Activity Bar–style checklist to pin or unpin sections (Chats and Settings
 * stay anchored), and dragging icons rearranges their order and ⌘1–⌘6 keys.
 */
export function SectionRail({
  layout,
  activeSection,
  settingsSelected,
  showSidebarButton,
  onShowSidebar,
  pulseUnseen,
  needsCount,
  connected,
  hostLabel,
  onSelect,
  onSettings,
  onChangeLayout
}: SectionRailProps) {
  const mac = window.conduit.platform === 'darwin'
  const pinned = pinnedSections(layout)
  const shown = shownRailSections(layout, activeSection)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const draggingRef = useRef<RailSection | null>(null)
  const [dragging, setDragging] = useState<RailSection | null>(null)
  const [dropTarget, setDropTarget] = useState<{ section: RailSection; position: 'before' | 'after' } | null>(null)

  useLayoutEffect(() => {
    if (!menu) {
      setMenuPos(null)
      return
    }
    const el = menuRef.current
    const width = el?.offsetWidth || 220
    const height = el?.offsetHeight || 280
    setMenuPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    const close = () => setMenu(null)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const openMenu = (x: number, y: number, target: RailSection | null) => {
    setMenu({ x, y, target })
  }

  const ariaLabelFor = (section: RailSection): string => {
    if (section === 'pulse' && pulseUnseen) return t('Pulse, new cards')
    if (section === 'needs' && needsCount) return t('Needs you, {count}', { count: needsCount })
    return sectionTitle(section)
  }

  const titleFor = (section: RailSection): string => {
    const label = sectionTitle(section)
    const key = shortcutForSection(section, pinned, mac)
    return key ? `${label} (${key})` : label
  }

  const settingsKey = glyphs('settings', mac)
  const customized = !isDefaultRailLayout(layout)

  return (
    <>
      <nav
        className="rail"
        aria-label={t('Sections')}
        onContextMenu={e => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          openMenu(e.clientX || Math.round(rect.right + 4), e.clientY || Math.round(rect.top + 14), null)
        }}
      >
        {showSidebarButton ? (
          <button
            className="railbtn rail-show-list"
            aria-label={t('Show Sidebar')}
            title={`${t('Show Sidebar')} (${glyphs('toggle-sidebar', mac)})`}
            onClick={onShowSidebar}
          >
            <Icon name="chevronsRight" />
          </button>
        ) : null}
        <div className="rail-sections">
          {shown.map(section => {
            const drop = dropTarget?.section === section ? dropTarget.position : null
            const className = [
              'railbtn',
              dragging === section ? 'dragging' : '',
              drop === 'before' ? 'drop-before' : '',
              drop === 'after' ? 'drop-after' : ''
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={section}
                className={className}
                draggable
                aria-label={ariaLabelFor(section)}
                title={titleFor(section)}
                aria-current={activeSection === section ? 'page' : undefined}
                onClick={() => onSelect(section)}
                onContextMenu={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  openMenu(e.clientX || Math.round(rect.right + 4), e.clientY || Math.round(rect.top), section)
                }}
                onDragStart={e => {
                  setMenu(null)
                  draggingRef.current = section
                  setDragging(section)
                  if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', section)
                  }
                }}
                onDragOver={e => {
                  const from = draggingRef.current
                  if (!from || from === section) return
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  const rect = e.currentTarget.getBoundingClientRect()
                  const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                  setDropTarget(cur => (cur?.section === section && cur.position === position ? cur : { section, position }))
                }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDropTarget(cur => (cur?.section === section ? null : cur))
                  }
                }}
                onDrop={e => {
                  const from = draggingRef.current
                  draggingRef.current = null
                  setDragging(null)
                  setDropTarget(null)
                  if (!from || from === section) return
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                  const next = moveRailSection(layout, from, section, position)
                  if (next !== layout) onChangeLayout(next)
                }}
                onDragEnd={() => {
                  draggingRef.current = null
                  setDragging(null)
                  setDropTarget(null)
                }}
              >
                <Icon name={SECTION_ICONS[section]} />
                {section === 'pulse' && pulseUnseen > 0 && activeSection !== 'pulse' ? (
                  <span className="badge">{pulseUnseen > 99 ? '99+' : pulseUnseen}</span>
                ) : null}
                {section === 'needs' && needsCount > 0 ? (
                  <span className="badge">{needsCount > 99 ? '99+' : needsCount}</span>
                ) : null}
              </button>
            )
          })}
        </div>
        <span className="spacer" />
        <button
          className="railbtn"
          aria-label={t('Settings')}
          title={`${t('Settings')} (${settingsKey})`}
          aria-current={settingsSelected ? 'page' : undefined}
          onClick={onSettings}
        >
          <Icon name="settings" />
        </button>
        <span
          className={`dot${connected ? '' : ' warn'}`}
          role="img"
          aria-label={connected ? t('Connected') : t('Not connected')}
          title={connected ? t('Connected to {host}', { host: hostLabel ?? '' }) : t('Not connected')}
        />
      </nav>
      {menu ? (
        <div
          ref={menuRef}
          className="host-menu row-menu rail-menu"
          role="menu"
          onContextMenu={e => e.preventDefault()}
          style={{
            left: menuPos?.left ?? Math.max(8, Math.min(menu.x, window.innerWidth - 228)),
            top: menuPos?.top ?? Math.max(8, Math.min(menu.y, window.innerHeight - 288))
          }}
        >
          {menu.target && canUnpinSection(menu.target) ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  const isPinned = !layout.hidden.has(menu.target!)
                  onChangeLayout(setSectionPinned(layout, menu.target!, !isPinned))
                  setMenu(null)
                }}
              >
                {!layout.hidden.has(menu.target)
                  ? t('Unpin {name}', { name: sectionTitle(menu.target) })
                  : t('Pin {name}', { name: sectionTitle(menu.target) })}
              </button>
              <div className="rail-menu-sep" role="separator" />
            </>
          ) : null}
          {layout.order.map(section => {
            const isPinned = !layout.hidden.has(section)
            const locked = !canUnpinSection(section)
            const key = shortcutForSection(section, pinned, mac)
            return (
              <button
                key={section}
                role="menuitemcheckbox"
                aria-checked={isPinned}
                disabled={locked}
                className="rail-menu-item"
                onClick={() => {
                  if (locked) return
                  onChangeLayout(setSectionPinned(layout, section, !isPinned))
                  setMenu(null)
                }}
              >
                <span className="host-check" aria-hidden="true">
                  {isPinned ? <Icon name="check" /> : null}
                </span>
                <span className="rail-menu-label">{sectionTitle(section)}</span>
                {key ? <span className="rail-menu-key">{key}</span> : null}
              </button>
            )
          })}
          <div className="rail-menu-sep" role="separator" />
          <button role="menuitemcheckbox" aria-checked={true} disabled className="rail-menu-item">
            <span className="host-check" aria-hidden="true">
              <Icon name="check" />
            </span>
            <span className="rail-menu-label">{t('Settings')}</span>
            <span className="rail-menu-key">{settingsKey}</span>
          </button>
          {customized ? (
            <>
              <div className="rail-menu-sep" role="separator" />
              <button
                role="menuitem"
                onClick={() => {
                  onChangeLayout(resetRailLayout())
                  setMenu(null)
                }}
              >
                {t('Reset Sections')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
