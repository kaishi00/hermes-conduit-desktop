import { t } from '@shared/i18n'
import type { HeaderMenuItem } from '../components/HeaderMenu'
import type { MoveTarget } from '../components/ChatList'
import type { ChatRow } from './chats'
import { MUTE_CHOICES, muteEnd, type ChatMute } from './chatMute'

/** What the open chat's menu can do: each step left out is one this chat or this Hermes doesn't offer. */
export interface ChatMenuSteps {
  archive?: () => void
  pin?: () => void
  /** Whether it's starred, with its switch. */
  star?: { on: boolean; toggle: () => void }
  done?: { on: boolean; toggle: () => void }
  /** Its mute (null when it has none), and the change: seconds, null until unmuted, 0 to unmute. */
  mute?: { now: ChatMute | null; set: (seconds: number | null) => void }
  rename?: () => void
  move?: { targets: () => Promise<MoveTarget[]>; to: (target: MoveTarget) => void }
  remove?: () => void
}

/**
 * The open chat's menu in its header (issue 448): its row's steps in the
 * chat list, in the list's order. Open Beside and Open in New Window are the
 * header's own buttons, the open chat is read, and a pinned chat's place
 * among the pins is the list's to change, so those four stay out.
 */
export function chatMenuItems(row: Pick<ChatRow, 'pinned'>, steps: ChatMenuSteps): HeaderMenuItem[] {
  const items: HeaderMenuItem[] = []
  if (steps.archive) items.push({ key: 'archive', label: t('Archive'), onClick: steps.archive })
  if (steps.pin) items.push({ key: 'pin', label: row.pinned ? t('Unpin') : t('Pin'), onClick: steps.pin })
  if (steps.star) items.push({ key: 'star', label: steps.star.on ? t('Unstar') : t('Star'), onClick: steps.star.toggle })
  if (steps.done) items.push({ key: 'done', label: steps.done.on ? t('Mark as Not Done') : t('Mark as Done'), onClick: steps.done.toggle })
  if (steps.mute) {
    const { now, set } = steps.mute
    items.push(
      now
        ? {
            key: 'unmute',
            label: now.until === null ? t('Unmute Notifications') : t('Unmute (Muted Until {time})', { time: muteEnd(now.until) }),
            onClick: () => set(0)
          }
        : {
            key: 'mute',
            label: t('Mute Notifications'),
            items: () => MUTE_CHOICES.map(choice => ({ key: choice.key, label: choice.label(), onClick: () => set(choice.seconds) }))
          }
    )
  }
  if (steps.rename) items.push({ key: 'rename', label: t('Rename'), onClick: steps.rename })
  if (steps.move) {
    const { targets, to } = steps.move
    items.push({
      key: 'move',
      label: t('Move to Project'),
      loading: t('Loading projects…'),
      empty: t('No Projects'),
      items: async () => (await targets()).map(target => ({ key: target.id, label: target.title, title: target.path, onClick: () => to(target) }))
    })
  }
  if (steps.remove) items.push({ key: 'delete', label: t('Delete'), danger: true, onClick: steps.remove })
  return items
}
