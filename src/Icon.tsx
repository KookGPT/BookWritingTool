// Feather-style 24px stroke icons; one path string per icon keeps this tiny.
const P = {
  pen: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  timeline: 'M3 12h18 M7 8v8 M12 5v14 M17 9v6',
  plot: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  calendar: 'M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18',
  idea: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z M8 2v16 M16 6v16',
  wiki: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  graph: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.59 13.51l6.83 3.98 M15.41 6.51l-6.82 3.98',
  insights: 'M18 20V10 M12 20V4 M6 20v-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  trash: 'M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  settings: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  left: 'M11 17l-5-5 5-5 M18 17l-5-5 5-5',
  right: 'M13 17l5-5-5-5 M6 17l5-5-5-5',
  plus: 'M12 5v14 M5 12h14',
  panel: 'M3 3h18v18H3z M15 3v18',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  focus: 'M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  check: 'M20 6L9 17l-5-5',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  mountain: 'M3 20L9 8l4 7 3-4 5 9z',
  ruler: 'M3 17L17 3l4 4L7 21z M7 13l2 2 M11 9l2 2 M15 5l2 2',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M3 3l18 18',
  x: 'M18 6L6 18 M6 6l12 12',
  pointer: 'M4 3l7 17 2.5-7.5L21 10z M13.5 13.5L20 20',
  pin: 'M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  flag: 'M5 22V3 M5 4h12l-2 4 2 4H5',
  region: 'M4 7l6-4 9 3 2 9-7 6-9-3z',
  border: 'M3 20l3-4 M8 13l3-4 M13 7l3-3 M18 3l3-1',
  road: 'M8 3L5 21 M16 3l3 18 M12 4v3 M12 10v3 M12 17v3',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 21h16',
  layers: 'M12 2L2 7l10 5 10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3 M6 7h4 M14 7h4 M10 3v8a2 2 0 0 0 4 0V3',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  bucket: 'M19 11l-8-8-8.5 8.5a2.1 2.1 0 0 0 0 3L8 20a2.1 2.1 0 0 0 3 0z M5 2l5 5 M2 13h15 M22 20a2 2 0 1 1-4 0c0-1.6 2-4 2-4s2 2.4 2 4z',
} as const

export type IconName = keyof typeof P

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name]} />
    </svg>
  )
}
