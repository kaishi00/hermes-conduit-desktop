import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickAsk } from './components/QuickAsk'
import { ChatWindow } from './components/ChatWindow'
import type { ChatWindowRequest } from '@shared/ipc'
import { chatWindowRequest, pulseFrameRequest } from '@shared/chatWindows'
import { DockedPulse } from './components/DockedPulse'
import { ScreenWindow } from './components/ScreenWindow'
import { screenWindowRequest } from '@shared/screenWindows'
import { PictureViewerHost } from './components/Picture'
import { DialogHost } from './components/Dialogs'
import './styles/theme.css'
import './styles/app.css'
import { setLanguage } from '@shared/i18n'
import { applyStoredAppearance } from './state/appearance'
import { installMouseBack } from './state/mouseBack'

setLanguage(window.conduit.language.resolved)
document.documentElement.lang = window.conduit.language.resolved
document.documentElement.dataset.platform = window.conduit.platform
applyStoredAppearance()
// The mouse's back button goes back from any page or sheet with a Back.
installMouseBack()
// The quick ask window follows an accent or text style picked in the main one.
window.addEventListener('storage', () => applyStoredAppearance())
const quick = window.location.hash === '#quick'
if (quick) document.documentElement.dataset.window = 'quick'
const chatWindow = chatWindowRequest(window.location.hash)
if (chatWindow) document.documentElement.dataset.window = chatWindow.docked ? 'docked' : 'chat'
const pulseFrame = pulseFrameRequest(window.location.hash)
if (pulseFrame) document.documentElement.dataset.window = 'docked'
const screenWindow = screenWindowRequest(window.location.hash)
if (screenWindow) document.documentElement.dataset.window = 'screen'

/** A chat window's page; a docked one is pointed at another chat of its dashboard by its hash, with no reload. */
function ChatPage({ first }: { first: ChatWindowRequest }) {
  const [chat, setChat] = useState(first)
  useEffect(() => {
    const read = () => {
      const next = chatWindowRequest(window.location.hash)
      if (next) setChat(next)
    }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  return <ChatWindow key={chat.id} chat={chat} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PictureViewerHost>
      {quick ? <QuickAsk /> : chatWindow ? <ChatPage first={chatWindow} /> : pulseFrame ? <DockedPulse /> : screenWindow ? <ScreenWindow screen={screenWindow} /> : <App />}
      <DialogHost />
    </PictureViewerHost>
  </StrictMode>
)
