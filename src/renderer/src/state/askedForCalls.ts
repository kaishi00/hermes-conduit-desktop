import { gateway } from '../gateway'
import { askedQuestionsBlock, waitingFromResponse, waitingPath } from './needsYou'
import { isOlder, pluginStatus, runningVersion, STATUS_PATH, type PluginStatus } from './plugin'

/**
 * The plugin version that records a spoken answer to a question that waits
 * past its turn (work_propose with its id and answer, notifier #977), after
 * the phone's NotifierPluginStatus.spokenQuestionAnswersVersion. Its rows are
 * listed from 0.189.0, so an older plugin would take the answer as a new
 * request and leave the question open (hermes-conduit issue 2985).
 */
export const SPOKEN_QUESTION_ANSWERS_VERSION = '0.191.0'

/**
 * The call's profile's plugin status, which decides whether a spoken answer
 * is recorded: asked of that profile, as the call's other plugin reads are
 * (rings.ts), and asked once more after a transient failure (a timeout, a
 * gateway hiccup), since an unread version leaves the questions out of the
 * whole call. A 404 (no plugin) isn't asked again.
 */
async function callPluginStatus(profile?: string): Promise<PluginStatus> {
  const path = profile ? `${STATUS_PATH}?profile=${encodeURIComponent(profile)}` : STATUS_PATH
  for (let attempt = 0; ; attempt++) {
    try {
      return pluginStatus(await gateway.http('GET', path, undefined, 8_000))
    } catch (e) {
      if (attempt > 0 || (e as { code?: unknown } | null)?.code === 404) return { state: 'unknown' }
    }
  }
}

/**
 * The questions `profile`'s bot asked that wait past their turn, as a live
 * call's instructions block (askedQuestionsBlock), read from the plugin's
 * waiting list as the call starts. Empty when none waits, the list can't be
 * read, or the plugin can't record a spoken answer (the user answers by
 * click there).
 */
export async function askedQuestionsForCall(profile?: string): Promise<string> {
  try {
    const name = profile && profile !== 'default' ? profile : undefined
    const [status, waiting] = await Promise.all([callPluginStatus(name), gateway.http('GET', waitingPath(name))])
    if (isOlder(runningVersion(status), SPOKEN_QUESTION_ANSWERS_VERSION)) return ''
    return askedQuestionsBlock(waitingFromResponse(waiting, name))
  } catch {
    return ''
  }
}
