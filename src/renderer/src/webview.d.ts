import 'react'

/** Electron's <webview>, which the main window uses only for a docked chat (components/DockedChat). */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string }
    }
  }
}
