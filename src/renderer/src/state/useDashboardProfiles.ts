import { useEffect } from 'react'
import { gateway } from '../gateway'
import { setDashboardProfilesHost, watchDashboardProfiles } from './dashboardProfile'
import { STATUS_PATH, askPluginStatus } from './plugin'

/**
 * Whether this dashboard's plugin reads ?conduit_profile=, asked in every
 * window that sends a profile's routes: the main one, a chat in its own
 * window and Quick Ask each have their own copy of what it said.
 */
export function useDashboardProfiles(phase: string | undefined, url: string | null | undefined): void {
  setDashboardProfilesHost(url ?? '')
  useEffect(() => {
    if (phase !== 'open' || !url) return
    return watchDashboardProfiles(url, () => askPluginStatus(() => gateway.http('GET', STATUS_PATH, undefined, 8_000)))
  }, [phase, url])
}
