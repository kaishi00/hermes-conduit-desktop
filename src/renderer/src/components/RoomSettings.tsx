import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { MAX_NOTES_BYTES, MAX_PURPOSE_CHARACTERS, contextSave, type Room, type RoomContext, type Routing } from '../state/groups'
import { gateway } from '../gateway'
import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { groupRouterSlot, hasOwnModel, type HelperSlot } from '../state/helperModels'
import { openModelsSettings } from '../state/modelsLink'

const AUXILIARY = '/api/model/auxiliary'

/**
 * Pick who answers automatically: the model that picks, the default profile's Group router helper, which Hermes
 * uses for every auto-routed room on this Hermes (hermes-conduit#2909). Change opens Settings > Models for the
 * default profile. Shown once Hermes lists the slot (the plugin adds it from 0.186.0).
 */
function RouterModelRow({ mainBot, onOpen }: { mainBot: string; onOpen: () => void }) {
  const [slot, setSlot] = useState<HelperSlot | null>(() => groupRouterSlot(keptAnswer(AUXILIARY)))
  useEffect(() => {
    let live = true
    const keep = answerKeeper(AUXILIARY)
    gateway
      .http('GET', AUXILIARY)
      .then(raw => {
        if (!live) return
        keep(raw)
        setSlot(groupRouterSlot(raw))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  if (!slot) return null
  return (
    <>
      <div className="room-router">
        <span>{t('Model')}</span>
        <span className="meta">{hasOwnModel(slot) ? slot.model : t('Same as chats')}</span>
        <button type="button" className="link" onClick={onOpen}>
          {t('Change')}
        </button>
      </div>
      <p className="meta">
        {t('This is {name}’s Group router helper. It picks for every group chat on this Hermes that answers automatically.', { name: mainBot })}
      </p>
    </>
  )
}

const modeTitle = (mode: Routing) =>
  mode === 'everyone' ? t('Everyone answers') : mode === 'lead' ? t('A lead picks who answers') : t('Pick who answers automatically')

function modeCaption(draft: RoomContext): string {
  if (draft.newerRouting) return t('This room answers in a way set in a newer app. It stays that way unless you pick another.')
  switch (draft.routing) {
    case 'everyone':
      return t('Every member gets a turn on a message that names nobody.')
    case 'lead':
      return t('The lead picks who takes a message that names nobody. @mentions and @everyone still go straight to those members.')
    case 'auto':
      return t('A quick model call picks who a message is for. @mentions still go straight to the members you name.')
  }
}

/**
 * A hosted room's Group Settings, after the phone's sheet: its purpose,
 * shared notes, and where the host routes, who answers a message that names
 * nobody. Hermes routes; this only sets it.
 */
export function RoomSettings({
  room,
  context,
  modes,
  mainBot,
  onSave,
  onClose
}: {
  room: Room
  context: RoomContext
  /** The Who answers choices the host offers; none on a host before routing. */
  modes: Routing[]
  /** The default profile's bot, whose Group router helper picks in an automatic room. */
  mainBot: string
  onSave: (save: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<RoomContext>(context)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const update = (patch: Partial<RoomContext>) => setDraft(current => ({ ...current, ...patch }))

  useEffect(() => {
    first.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, saving])

  const purposeTooLong = draft.purpose.trim().length > MAX_PURPOSE_CHARACTERS
  const notesTooLong = new TextEncoder().encode(draft.notes).length > MAX_NOTES_BYTES
  const leadMissing = draft.routing === 'lead' && !draft.newerRouting && !room.members.some(m => m.memberId === draft.leadMemberId)
  const edited =
    draft.purpose !== context.purpose ||
    draft.notes !== context.notes ||
    draft.routing !== context.routing ||
    draft.leadMemberId !== context.leadMemberId ||
    draft.newerRouting !== context.newerRouting
  const canSave = edited && !saving && !purposeTooLong && !notesTooLong && !leadMissing

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(contextSave(draft, context))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="shortcuts-backdrop" onClick={() => !saving && onClose()}>
      <form
        className="shortcuts-sheet room-settings"
        role="dialog"
        aria-modal="true"
        aria-label={t('Group Settings')}
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault()
          void save()
        }}
      >
        <header>
          <button type="button" className="link" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </button>
          <h2>{t('Group Settings')}</h2>
          <button type="submit" className="link strong" disabled={!canSave}>
            {saving ? t('Saving…') : t('Save')}
          </button>
        </header>
        {error ? <p className="ask-error">{error}</p> : null}

        <h3>{t('Purpose')}</h3>
        <input
          ref={first}
          className="input-ask-field"
          value={draft.purpose}
          placeholder={t('What this room is for, in one line')}
          aria-label={t('Purpose')}
          onChange={e => update({ purpose: e.target.value })}
        />
        {purposeTooLong ? <p className="ask-error">{t('Keep the purpose under 500 characters.')}</p> : null}

        <h3>{t('Shared notes')}</h3>
        <textarea
          className="input-ask-field"
          rows={4}
          value={draft.notes}
          placeholder={t('Facts every member should keep in mind')}
          aria-label={t('Shared notes')}
          onChange={e => update({ notes: e.target.value })}
        />
        {notesTooLong ? <p className="ask-error">{t('Shared notes are too long. Keep them under 4 KB.')}</p> : null}
        <p className="meta">{t('Every member reads the purpose and notes with each message. A change applies from the next message.')}</p>

        {modes.length ? (
          <>
            <h3>{t('Who answers')}</h3>
            <div role="radiogroup" aria-label={t('Who answers')} className="room-modes">
              {context.newerRouting ? (
                <label className="room-mode">
                  <input type="radio" name="routing" checked={!!draft.newerRouting} onChange={() => update({ newerRouting: context.newerRouting })} />
                  <span>{t('As set elsewhere ({mode})', { mode: context.newerRouting })}</span>
                </label>
              ) : null}
              {modes.map(mode => (
                <label key={mode} className="room-mode">
                  <input
                    type="radio"
                    name="routing"
                    checked={!draft.newerRouting && draft.routing === mode}
                    onChange={() =>
                      update({
                        routing: mode,
                        newerRouting: '',
                        leadMemberId: mode === 'lead' ? draft.leadMemberId || context.leadMemberId || room.members[0]?.memberId || '' : ''
                      })
                    }
                  />
                  <span>{modeTitle(mode)}</span>
                </label>
              ))}
            </div>
            <p className="meta">{modeCaption(draft)}</p>
            {draft.routing === 'auto' && !draft.newerRouting ? (
              <RouterModelRow
                mainBot={mainBot}
                onOpen={() => {
                  onClose()
                  openModelsSettings('default')
                }}
              />
            ) : null}
            {draft.routing === 'lead' && !draft.newerRouting ? (
              <>
                <h3>{t('Lead')}</h3>
                <div role="radiogroup" aria-label={t('Lead')} className="room-modes">
                  {room.members.map(member => (
                    <label key={member.memberId} className="room-mode">
                      <input
                        type="radio"
                        name="lead"
                        checked={draft.leadMemberId === member.memberId}
                        onChange={() => update({ leadMemberId: member.memberId })}
                      />
                      <span>{member.displayName ?? member.profile ?? member.memberId}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </form>
    </div>
  )
}
