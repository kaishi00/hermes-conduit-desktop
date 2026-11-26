import { useState } from 'react'
import { t } from '@shared/i18n'
import { Select } from './Select'
import { ATTACHMENT_LIMIT_CHOICES, attachmentLimitMB, isRiskyAttachmentLimit, setAttachmentLimitMB } from '../state/attachments'

/**
 * Settings › Attachments, after the phone's Settings › Chat › Attachments:
 * the largest file the composer stages, kept on this computer. A group
 * room's own limits still apply under it.
 */
export function AttachmentLimitSetting() {
  const [megabytes, setMegabytes] = useState(() => attachmentLimitMB())
  return (
    <>
      <dt>{t('Attachments')}</dt>
      <dd>
        <Select value={megabytes} onChange={picked => setMegabytes(setAttachmentLimitMB(Number(picked)))} aria-label={t('Maximum file size')}>
          {ATTACHMENT_LIMIT_CHOICES.map(choice => (
            <option key={choice} value={choice}>
              {t('{limit} MB', { limit: choice })}
            </option>
          ))}
        </Select>
        <p className="meta">{t('Photos, videos and files larger than this are not attached.')}</p>
        {isRiskyAttachmentLimit(megabytes) ? (
          <p className="meta warns">{t('Large files are held in memory while they upload. A high limit may make Conduit freeze or crash.')}</p>
        ) : null}
      </dd>
    </>
  )
}
