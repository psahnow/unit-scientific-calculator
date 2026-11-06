// Dimensional brand mark and About card (DESIGN.md D30).
import { useEffect } from 'react';

/** Square brackets, as in dimensional analysis ([F] = M·L·T⁻²), around an italic d. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="5" fill="var(--fg)" />
      <path d="M11 7.5H7.5v17H11M21 7.5h3.5v17H21" fill="none" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="square" />
      <text x="16" y="21.5" textAnchor="middle" fontFamily="KaTeX_Math, 'Times New Roman', serif" fontStyle="italic" fontSize="15" fill="var(--accent)">
        d
      </text>
    </svg>
  );
}

export function About({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="about" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="about-card">
        <button className="icon-btn about-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h2 id="about-title">
          <BrandMark className="brand-mark" />
          Dimensional
        </h2>
        <p className="tagline">Every number knows its units.</p>
        <p className="eg">6 N ÷ 2 mm² = 3 MPa</p>
        <ul>
          <li>Type units after numbers; results come out in the units the math produces.</li>
          <li>Every result has a unit dropdown; the number always matches the unit shown.</li>
          <li>Exact fractions where possible, folders, tables, sliders, calculus.</li>
          <li>Turn on unit packages per worksheet in ⚙ Settings.</li>
        </ul>
        <p>
          Worksheets are saved in this browser. Made by{' '}
          <a href="https://perrysahnow.com" target="_blank" rel="noreferrer">
            Perry Sahnow
          </a>
          .
        </p>
      </div>
    </div>
  );
}
