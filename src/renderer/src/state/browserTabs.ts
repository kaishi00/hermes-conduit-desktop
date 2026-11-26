/** What a workbench Browser tab opens (components/BrowserView; desktop issue 451). */
import { t } from '../../../shared/i18n'
import { hostPageParts, hostPageUrl, readAddress } from '../../../shared/browserAddress'

/** A saved address on the dashboard on screen: a host page saved on another names it again. */
export function addressHere(url: string | null, hostKey: string | null): string | null {
  if (!url) return null
  const page = hostPageParts(url)
  if (!page) return url
  return hostKey ? hostPageUrl(hostKey, page.port, page.path) : null
}

/** The address an input opens, or why it can't. */
export function addressFor(input: string, hostKey: string | null, hostPages: boolean): { url: string } | { note: string } {
  const address = readAddress(input)
  if (!address) return { note: t('Enter a port, such as 5173, for a server on the host, or a web address.') }
  if (address.kind === 'web') return { url: address.url }
  if (!hostPages || !hostKey) return { note: t('Update the Conduit plugin on this host to see its pages.') }
  return { url: hostPageUrl(hostKey, address.port, address.path) }
}
