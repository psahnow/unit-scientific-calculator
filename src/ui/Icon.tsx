// Small line icons for the row buttons. Drawn here rather than typed as Unicode symbols (⧉ ✎ ⎘ ⟷),
// which look different (or go missing) from one operating system and font to the next.
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  // two overlapping sheets
  duplicate: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  // a clipboard
  copy: (
    <>
      <rect x="3.5" y="3" width="9" height="10.5" rx="1.5" />
      <path d="M6 3V2.2a.7.7 0 0 1 .7-.7h2.6a.7.7 0 0 1 .7.7V3M5.8 7.2h4.4M5.8 9.8h4.4" />
    </>
  ),
  check: <path d="M3 8.5l3.2 3L13 4.5" />,
  trash: <path d="M2.5 4.2h11M6 4.2V2.8a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.4M4 4.2l.6 8.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.4M6.7 6.8v4M9.3 6.8v4" />,
  pencil: <path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.2.7.7-3.2zM9.2 4.3l2.5 2.5" />,
  // a track with a knob
  slider: (
    <>
      <path d="M1.8 8h12.4" />
      <circle cx="9.5" cy="8" r="2.2" fill="var(--bg)" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
