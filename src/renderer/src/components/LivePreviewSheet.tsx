import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { livePreview, type LivePreview, type PreviewHost } from '../state/livePreview'
import { MEMORY_PATH, withProfile, type VoiceMode } from '../state/gptLive'
import { canRecall } from '../state/liveCall'
import { webSearchAvailable } from '../state/qwenLive'
import { STATUS_PATH as LOCAL_STATUS_PATH, frontModel } from '../state/localLive'
import { dashboardProfilePath } from '../state/dashboardProfile'
import { inSelectMenu } from './Select'

/** What the next call would read from the host as it starts, for `mode`'s preview. */
async function previewHost(mode: VoiceMode, profile?: string): Promise<PreviewHost> {
  if (mode === 'local') {
    const status = await gateway.http('GET', dashboardProfilePath(LOCAL_STATUS_PATH, profile), undefined, 30_000).catch(() => null)
    return { fastModel: !!frontModel(status)?.available }
  }
  if (mode !== 'gemini' && mode !== 'qwen' && mode !== 'grok') return {}
  const [recall, hostSearch] = await Promise.all([
    gateway.http('GET', withProfile(MEMORY_PATH, profile)).then(canRecall, () => false),
    mode === 'grok' ? Promise.resolve(false) : webSearchAvailable(profile).catch(() => false)
  ])
  return { recall, hostSearch }
}

/** Live call style's "What Conduit sends", after the phone's LiveVoiceInstructionsPreviewSheet. */
export function LivePreviewSheet({ mode, profile, onClose }: { mode: VoiceMode; profile?: string; onClose: () => void }) {
  const done = useRef<HTMLButtonElement>(null)
  // undefined while the host is read; null when this mode sends no instructions.
  const [preview, setPreview] = useState<LivePreview | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    void previewHost(mode, profile).then(host => {
      if (live) setPreview(livePreview(mode, host))
    })
    return () => {
      live = false
    }
  }, [mode, profile])

  useEffect(() => {
    done.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event)) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-sheet live-preview" role="dialog" aria-modal="true" aria-label={t('What Conduit sends')} onClick={e => e.stopPropagation()}>
        <header>
          <h2>{t('What Conduit sends')}</h2>
          <span className="spacer" />
          <button ref={done} className="link" onClick={onClose}>
            {t('Done')}
          </button>
        </header>
        {preview === undefined ? (
          <div className="notice">{t('Loading…')}</div>
        ) : preview ? (
          <>
            <p className="meta">
              {preview.isLocalLive
                ? t('Conduit sends this to your fast model as its instructions for every call; nothing else is added before it. Personality is read when a call starts.')
                : t(
                    "Conduit adds this to {mode}'s instructions for every call. Your Hermes server adds its own voice persona before it. Memory and personality are read when a call starts.",
                    { mode: preview.mode }
                  )}
            </p>
            <pre className="live-preview-text">{preview.instructions}</pre>
            {preview.openingTurn ? (
              <>
                <p className="meta">{t("Sent as the call's first turn when it connects:")}</p>
                <pre className="live-preview-text">{preview.openingTurn}</pre>
              </>
            ) : null}
          </>
        ) : (
          <p className="meta">{t('Turn on a live voice mode to see what Conduit sends.')}</p>
        )}
      </div>
    </div>
  )
}
