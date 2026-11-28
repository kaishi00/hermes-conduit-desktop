import { useCallback, useEffect, useState } from 'react'
import { gateway } from '../gateway'
import { LINK_STATUS_PATH, hostClients, iphoneCardDone, noteDayUsed, offersIphone } from './otherApp'

/**
 * Whether the chat list shows the one-time Conduit on iPhone card for the
 * dashboard in use (state/otherApp.ts has the rules). Read once per
 * dashboard per run: the card is rare, and a missed read only leaves it out.
 */
export function useOfferIphone(connected: boolean, host: string): { shown: boolean; done: () => void } {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setShown(false)
    if (!connected || !host) return
    const days = noteDayUsed()
    if (!offersIphone({ iphoneSeen: false, pushPaired: false }, days, iphoneCardDone())) return
    let live = true
    gateway
      .http('GET', LINK_STATUS_PATH, undefined, 8_000)
      .then(body => {
        if (live) setShown(offersIphone(hostClients(body), days, iphoneCardDone()))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [connected, host])
  const done = useCallback(() => setShown(false), [])
  return { shown, done }
}
