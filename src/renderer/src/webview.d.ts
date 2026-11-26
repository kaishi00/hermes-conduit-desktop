import 'react'

/** Electron's <webview>, which the main window uses for a docked chat (components/DockedChat) and the workbench's Browser tabs (components/BrowserView). */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string }
    }
  }
}
