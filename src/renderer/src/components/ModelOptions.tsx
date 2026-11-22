import { useCallback, useContext, useSyncExternalStore } from 'react'
import { SummaryHost } from '../state/useStepSummaries'
import { picksFor, recordSwitch, subscribePicks, togglePin, updatePicks, type ModelPick } from '../state/modelQuickPicks'
import { saveVisibility, subscribeVisibility, visibilityFor, type ModelVisibility } from '../state/modelVisibility'

/** This host's Quick picks, with Pin/Unpin and a switch's record. */
export function useModelQuickPicks() {
  const host = useContext(SummaryHost)
  const picks = useSyncExternalStore(subscribePicks, () => picksFor(host))
  const toggle = useCallback((pick: ModelPick) => updatePicks(host, p => togglePin(p, pick)), [host])
  const switched = useCallback((to: ModelPick, from?: ModelPick | null) => updatePicks(host, p => recordSwitch(p, to, from)), [host])
  return { picks, toggle, switched }
}

/** This host's models and providers hidden with Edit, and a change to them, saved at once. */
export function useModelVisibility() {
  const host = useContext(SummaryHost)
  const read = () => visibilityFor(host)
  const visibility = useSyncExternalStore(subscribeVisibility, read, read)
  const change = useCallback((edit: (v: ModelVisibility) => ModelVisibility) => saveVisibility(host, edit(visibilityFor(host))), [host])
  return { visibility, change }
}
