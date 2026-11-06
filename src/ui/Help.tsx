// First-run welcome and the keyboard shortcuts panel (D37).
import { useEffect, useState } from 'react';

const LS_WELCOMED = 'dimensional:welcomed';

/** A short welcome shown until dismissed (per browser). */
export function Welcome() {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(LS_WELCOMED) !== '1';
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(LS_WELCOMED, '1');
    } catch {
      /* per-browser convenience only */
    }
  };
  // a floating card over the corner of the page: it never pushes the worksheet down, so nothing
  // jumps when it's dismissed (D42)
  return (
    <section className="welcome" role="dialog" aria-label="Welcome to Dimensional">
      <button className="icon-btn about-close" aria-label="Dismiss welcome" onClick={dismiss}>
        ✕
      </button>
      <h2>Welcome to Dimensional</h2>
      <p className="welcome-eg">
        <span className="eg">F = 6 kN</span>, then <span className="eg">F / 2 mm²</span> → <span className="eg">3 MPa</span>
      </p>
      <ul>
        <li>Type units after numbers; suggestions appear as you type.</li>
        <li>Tap a result’s unit to see it in another unit.</li>
        <li>
          <b>ƒ(x) Functions</b> has trig, calculus, solve and constants; <b>⚙</b> has more unit packages.
        </li>
        <li className="kbd-only">
          <kbd>Ctrl</kbd> <kbd>/</kbd> lists keyboard shortcuts.
        </li>
        <li>Worksheets are saved in this browser only; use Export to keep a copy.</li>
      </ul>
      <button className="text-btn strong" onClick={dismiss}>
        Got it
      </button>
    </section>
  );
}

const ROWS: [string[], string][] = [
  [['Enter'], 'New row below'],
  [['↑', '↓'], 'Move between rows'],
  [['Alt', '↑ / ↓'], 'Move the row up or down'],
  [['Backspace'], 'In an empty row: delete it. Right after a unit chip: turn it back into letters'],
  [['Tab'], 'Insert the highlighted suggestion (unit, name, function)'],
  [['Esc'], 'Close suggestions, menus and dialogs'],
  [['Ctrl', 'Z'], 'Undo (Ctrl Shift Z or Ctrl Y: redo)'],
  [['Ctrl', '.'], 'Open or close the Functions drawer'],
  [['Ctrl', 'P'], 'Print or save as PDF'],
  [['Ctrl', '/'], 'Show these shortcuts'],
  [['/'], 'Start a fraction'],
  [['^'], 'Power (type the exponent, then → to leave it)'],
  [['_'], 'Subscript, as in F_1'],
  [['*'], 'Multiply (shown as ·)'],
];

export function Shortcuts({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="about" role="dialog" aria-modal="true" aria-labelledby="sc-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="about-card shortcuts">
        <button className="icon-btn about-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h2 id="sc-title">Keyboard shortcuts</h2>
        <table>
          <tbody>
            {ROWS.map(([keys, what]) => (
              <tr key={what}>
                <td>
                  {keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && ' '}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">On a Mac, use ⌘ instead of Ctrl.</p>
      </div>
    </div>
  );
}
