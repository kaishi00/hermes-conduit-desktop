import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickAsk } from './components/QuickAsk'
import { ChatWindow } from './components/ChatWindow'
import { chatWindowRequest } from '@shared/chatWindows'
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
if (chatWindow) document.documentElement.dataset.window = 'chat'
const screenWindow = screenWindowRequest(window.location.hash)
if (screenWindow) document.documentElement.dataset.window = 'screen'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PictureViewerHost>
      {quick ? <QuickAsk /> : chatWindow ? <ChatWindow chat={chatWindow} /> : screenWindow ? <ScreenWindow screen={screenWindow} /> : <App />}
      <DialogHost />
    </PictureViewerHost>
  </StrictMode>
)
