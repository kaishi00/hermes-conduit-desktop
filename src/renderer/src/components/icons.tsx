/** The line icons from the mockups (24-unit grid, 1.7 stroke). */
const paths = {
  chats: <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4z" />,
  bots: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M14 15c2.5-.6 5 .7 6 3.5" />
    </>
  ),
  tasks: <path d="M4 7l2 2 3-3M4 16l2 2 3-3M12 8h8M12 17h8" />,
  pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M4 7h16M7 12h10M10 17h4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  minimize: <path d="M6 12h12" />,
  maximize: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  close: <path d="M7 7l10 10M17 7L7 17" />,
  envelope: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  leave: (
    <>
      <path d="M14 4.5H6.5A1.5 1.5 0 005 6v12a1.5 1.5 0 001.5 1.5H14" />
      <path d="M11 12h9M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  linked: (
    <>
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M3 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M11 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5" />
    </>
  ),
  window: (
    <>
      <path d="M13 5H5.5A1.5 1.5 0 004 6.5v11A1.5 1.5 0 005.5 19h13a1.5 1.5 0 001.5-1.5V12M4 9h9" />
      <path d="M18 3v6M15 6h6" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  phone: <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 005.5 5.5L16 13l4 1.5v3a2 2 0 01-2 2A15 15 0 014.5 6a2 2 0 012-2z" />,
  phoneDown: <path d="M3 13.5c5-4.5 13-4.5 18 0l-2 3-3.5-1.2v-2.6a10 10 0 00-7 0v2.6L5 16.5z" />,
  micOff: (
    <>
      <path d="M9 9v2a3 3 0 005 2.2M15 10V6a3 3 0 00-5.8-1M5 11a7 7 0 0011.5 5.3M19 11a7 7 0 01-.6 2.8M12 18v3M4 4l16 16" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  chevronsLeft: <path d="M12 7l-5 5 5 5M18 7l-5 5 5 5" />,
  chevronsRight: <path d="M6 7l5 5-5 5M12 7l5 5-5 5" />,
  sidePanel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M15 4.5v15" />
    </>
  ),
  chevronDown: <path d="M5 9l7 7 7-7" />,
  chevronUp: <path d="M5 15l7-7 7 7" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  speaker: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />,
  code: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />,
  bell: <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20a2 2 0 004 0" />,
  hand: <path d="M8 12V6.5a1.5 1.5 0 013 0V11M11 11V5a1.5 1.5 0 013 0v6M14 11V6.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-.5a6 6 0 01-4.7-2.3L4 15.2a1.5 1.5 0 012.3-1.9L8 15z" />,
  handSlash: <path d="M8 12V6.5a1.5 1.5 0 013 0V11M11 11V5a1.5 1.5 0 013 0v6M14 11V6.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-.5a6 6 0 01-4.7-2.3L4 15.2a1.5 1.5 0 012.3-1.9L8 15zM4 4l16 16" />,
  bellSlash: <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20a2 2 0 004 0M4 4l16 16" />,
  file: <path d="M7 3h7l4 4v14H7zM14 3v4h4" />,
  screen: <path d="M4 5h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM9 21h6M12 17v4" />,
  folder: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  paperclip: <path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8" />,
  audio: <path d="M9 18V6l10-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM19 16a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />,
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 16l5-5 4 4 2-2 5 5" />
      <circle cx="15.5" cy="9.5" r="1.5" />
    </>
  ),
  video: <path d="M4 7h11v10H4zM15 10.5l5-3v9l-5-3" />,
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  server: <path d="M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01" />,
  puzzle: <path d="M10 4a2 2 0 014 0v2h4v4h-2a2 2 0 000 4h2v4h-4v-2a2 2 0 00-4 0v2H6v-4h2a2 2 0 000-4H6V6h4z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  star: <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.2c.9 1.3 2.1 1.9 3.5 1.9s2.6-.6 3.5-1.9M9.3 9.6v.6M14.7 9.6v.6" />
    </>
  ),
  house: <path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5M10 19v-5h4v5" />,
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </>
  ),
  spinner: <path d="M12 4a8 8 0 108 8" />,
  bench: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M10 4.5v15M10 13.5h10.5" />
    </>
  ),
  branch: (
    <>
      <circle cx="7" cy="6" r="2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="8" r="2" />
      <path d="M7 8v8M17 10c0 4-10 2-10 6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M7.5 10l2.5 2-2.5 2M12 14.5h4" />
    </>
  ),
  undo: <path d="M9 6L5 10l4 4M5 10h9.5a4.5 4.5 0 010 9H11" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </>
  ),
  attach: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  refresh: <path d="M20 12a8 8 0 11-2.34-5.66M20 4v4.5h-4.5" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  )
} as const

export type IconName = keyof typeof paths

export function Icon({ name, style, className }: { name: IconName; style?: React.CSSProperties; className?: string }) {
  return (
    <svg className={className ? `ico ${className}` : 'ico'} data-icon={name} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {paths[name]}
    </svg>
  )
}
