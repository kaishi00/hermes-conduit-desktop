import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { LINK_STATUS_PATH, hostClients, iphoneCardDone, noteDayUsed, offersIphone } from './otherApp'

/**
 * Whether the chat list shows the one-time Conduit on iPhone card for the
 * dashboard in use (state/otherApp.ts has the rules). Read once per
 * dashboard per run, not again on a reconnect, so a card on screen stays
 * put: the card is rare, and a missed read only leaves it out.
 */
export function useOfferIphone(connected: boolean, host: string): { shown: boolean; done: () => void } {
  const [shownFor, setShownFor] = useState<string | null>(null)
  const read = useRef(new Set<string>())
  useEffect(() => {
    if (!connected || !host || read.current.has(host)) return
    read.current.add(host)
    const days = noteDayUsed()
    if (!offersIphone({ iphoneSeen: false, pushPaired: false }, days, iphoneCardDone())) return
    gateway
      .http('GET', LINK_STATUS_PATH, undefined, 8_000)
      .then(body => {
        if (offersIphone(hostClients(body), days, iphoneCardDone())) setShownFor(host)
      })
      .catch(() => undefined)
  }, [connected, host])
  const done = useCallback(() => setShownFor(null), [])
  return { shown: shownFor !== null && shownFor === host, done }
}
