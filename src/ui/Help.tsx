// The keyboard shortcuts panel (D37). The first-run welcome became the start card and tour (D60).
import { useEffect } from 'react';

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
