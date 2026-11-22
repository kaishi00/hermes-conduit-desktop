/// <reference types="vite/client" />

/** noVNC's RFB client (the Bot Screen viewer), which ships no types: only what the viewer uses. */
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | object, options?: { shared?: boolean; credentials?: Record<string, string> })
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    background: string
    qualityLevel: number
    disconnect(): void
    focus(): void
    sendKey(keysym: number, code: string | null, down?: boolean): void
    clipboardPasteFrom(text: string): void
  }
}

/** package.json's version, set at build time (electron.vite.config.mts). */
declare const __APP_VERSION__: string
