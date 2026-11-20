/**
 * A link into Settings > Models for one profile, after the phone's: Group
 * Settings' router model opens the default profile's helper models there
 * (hermes-conduit#2909). The link asks here; the app opens Settings on it.
 */
export interface ModelsRequest {
  profile: string
  /** Each ask is a new one, even for the same profile. */
  n: number
}

let count = 0
const listeners = new Set<(request: ModelsRequest) => void>()

export function openModelsSettings(profile: string) {
  const request = { profile, n: ++count }
  listeners.forEach(listener => listener(request))
}

export function onModelsSettings(listener: (request: ModelsRequest) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
