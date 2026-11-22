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
 * The questions `profile`'s bot asked that wait past their turn, as a live
 * call's instructions block (askedQuestionsBlock), read from the plugin's
 * waiting list as the call starts. Empty when none waits, the list can't be
 * read, or the plugin can't record a spoken answer (the user answers by
 * click there).
 */
export async function askedQuestionsForCall(profile?: string): Promise<string> {
  try {
    const name = profile && profile !== 'default' ? profile : undefined
    const [status, waiting] = await Promise.all([
      gateway.http('GET', STATUS_PATH, undefined, 8_000).then(pluginStatus, (): PluginStatus => ({ state: 'unknown' })),
      gateway.http('GET', waitingPath(name))
    ])
    if (isOlder(runningVersion(status), SPOKEN_QUESTION_ANSWERS_VERSION)) return ''
    return askedQuestionsBlock(waitingFromResponse(waiting, name))
  } catch {
    return ''
  }
}
