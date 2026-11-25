import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import type { MixedTile } from '../state/botOrder'
import type { HostBadge } from '../state/keptHosts'
import type { CronJob, CronRun } from '../state/cron'
import { KanbanBoard, type TaskFocus } from './KanbanBoard'
import { ScheduledJobs } from './ScheduledJobs'

type Segment = 'board' | 'scheduled'
const SEGMENT_KEY = 'conduit.tasksSegment'

interface Props {
  bots: Bot[] | null
  connected: boolean
  profile: string | null
  onProfile: (profile: string | null) => void
  /** Every combined dashboard's profiles, in the Chats column's order, for Scheduled's column. */
  tiles?: readonly MixedTile[]
  badgeFor?: (tile: MixedTile) => HostBadge | null
  /** A dashboard's badge by its URL (null: this one), for Board's picker. */
  hostBadge?: (host: string | null) => HostBadge | null
  onOpenRun: (run: CronRun, job: CronJob) => void
  /** A task to open on Board (a chat's Kanban task, from its line). */
  focus?: TaskFocus | null
  onFocused?: () => void
}

/** The phone's Tasks tab: the task board, and the scheduled jobs. */
export function Tasks({ bots, connected, profile, onProfile, tiles, badgeFor, hostBadge, onOpenRun, focus, onFocused }: Props) {
  const [segment, setSegment] = useState<Segment>(() => {
    // A chat's task waiting to open: straight to Board, without drawing Scheduled first.
    if (focus) return 'board'
    try {
      return localStorage.getItem(SEGMENT_KEY) === 'scheduled' ? 'scheduled' : 'board'
    } catch {
      return 'board'
    }
  })
  const pick = (next: Segment) => {
    setSegment(next)
    try {
      localStorage.setItem(SEGMENT_KEY, next)
    } catch {
      // Kept for this window only.
    }
  }
  // A chat's task opens on Board, whichever segment Tasks last showed.
  const focusN = focus?.n
  useEffect(() => {
    if (focusN !== undefined) pick('board')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusN])
  const switcher = (
    <div className="segmented tasks-segment" role="tablist" aria-label={t('Tasks')}>
      <button role="tab" aria-selected={segment === 'board'} className={segment === 'board' ? 'on' : undefined} onClick={() => pick('board')}>
        {t('Board')}
      </button>
      <button role="tab" aria-selected={segment === 'scheduled'} className={segment === 'scheduled' ? 'on' : undefined} onClick={() => pick('scheduled')}>
        {t('Scheduled')}
      </button>
    </div>
  )
  return segment === 'board' ? (
    <KanbanBoard connected={connected} bots={bots} tiles={tiles} hostBadge={hostBadge} segment={switcher} focus={focus} onFocused={onFocused} />
  ) : (
    <ScheduledJobs bots={bots} connected={connected} profile={profile} onProfile={onProfile} tiles={tiles} badgeFor={badgeFor} onOpenRun={onOpenRun} segment={switcher} />
  )
}
