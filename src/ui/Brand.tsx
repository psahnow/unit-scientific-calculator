// Dimensional brand mark and About card (DESIGN.md D30).
import { useEffect } from 'react';

/** Square brackets, as in dimensional analysis ([F] = M·L·T⁻²), around a bold italic d, all in paper colour. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="5" fill="var(--fg)" />
      <path d="M11 7.5H7.5v17H11M21 7.5h3.5v17H21" fill="none" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="square" />
      <text x="16" y="22" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontWeight="700" fontSize="17" fill="var(--bg)">
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
          <li>Type units after numbers. Answers come out in the units your formula produces.</li>
          <li>Click an answer’s unit to show it in another. The number always matches the unit.</li>
          <li>Exact fractions, folders, tables, sliders and calculus.</li>
          <li>More units, like ksi or eV, are in ⚙ Settings.</li>
        </ul>
        <p>
          <b>Private:</b> no account and no tracking. Your worksheets stay in this browser, and it works offline. Made by{' '}
          <a href="https://perrysahnow.com" target="_blank" rel="noreferrer">
            Perry Sahnow
          </a>
          .
        </p>
      </div>
    </div>
  );
}
