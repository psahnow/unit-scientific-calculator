import { useEffect, useRef, useState } from 'react';
import { MathfieldElement } from 'mathlive';

MathfieldElement.fontsDirectory = '/mathlive-fonts';
MathfieldElement.soundsDirectory = null;
import { suggestionsFor, type Suggestion } from '../engine/suggest';
import { latexToSymbol } from '../engine/latex';

export const MACROS = {
  unit: { args: 1, def: '\\textcolor{#0f8f86}{\\mathrm{#1}}', captureSelection: true, expand: false },
  const: { args: 1, def: '\\textcolor{#8b5cf6}{#1}', captureSelection: true, expand: false },
};

const GREEK_SHORTCUTS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda',
  'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta',
  'Theta', 'Lambda', 'Xi', 'Sigma', 'Phi', 'Psi', 'Omega',
];
/** Curated shortcuts: no "in" → ∈ etc., which would clash with units. */
export const INLINE_SHORTCUTS: Record<string, string> = {
  ...Object.fromEntries(GREEK_SHORTCUTS.map((g) => [g, `\\${g}`])),
  pi: '\\pi',
  sqrt: '\\sqrt{#0}',
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
  arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
  ln: '\\ln', log: '\\log', exp: '\\exp',
  '*': '\\cdot',
  '>=': '\\ge', '<=': '\\le',
};

// ── Toolbox insertion: the most recently focused field receives function keys ──
let lastField: MathfieldElement | null = null;
let pendingInsert: string | null = null;

function insertInto(mf: MathfieldElement, latex: string) {
  mf.focus();
  mf.executeCommand(['insert', latex, { format: 'latex', selectionMode: 'placeholder', insertionMode: 'replaceSelection' }]);
}

/** Insert LaTeX at the caret of the expression being edited. With `pending`, the next field to get focus receives it. */
export function insertIntoMath(latex: string, opts: { pending?: boolean } = {}): boolean {
  if (opts.pending) {
    pendingInsert = latex;
    return true;
  }
  if (!lastField || !lastField.isConnected) return false;
  insertInto(lastField, latex);
  return true;
}

interface Props {
  latex: string;
  focusNonce?: number;
  autoFocus?: boolean;
  vars: string[];
  onChange(latex: string): void;
  onEnter(): void;
  onMoveOut(dir: 'up' | 'down'): void;
  onDeleteEmpty(): void;
  onFocus(): void;
  onBlur(): void;
  ariaLabel?: string;
}

interface Popover {
  items: Suggestion[];
  sel: number;
  navigated: boolean;
  prefixLatex: string;
}

/** Trailing letter run before the caret (incl. \mu, \Omega, \degree, \Delta). */
function trailingRun(before: string): { latex: string; afterNumber: boolean } | null {
  const m = /((?:\\(?:mu|Omega|degree|Delta)\s*|[A-Za-z])+)$/.exec(before);
  if (!m) return null;
  const rest = before.slice(0, before.length - m[1].length);
  // don't complete inside a command name or subscript
  if (/\\[A-Za-z]*$/.test(rest) || /_\{?[A-Za-z0-9]*$/.test(rest)) return null;
  const afterNumber = /[0-9.)}]\s*$/.test(rest) || /\\right\)\s*$/.test(rest);
  return { latex: m[1], afterNumber };
}

function atomCount(latex: string): number {
  return [...latexToSymbol(latex)].length;
}

export function MathInput(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mfRef = useRef<MathfieldElement | null>(null);
  const props = useRef(p);
  props.current = p;
  const [pop, setPop] = useState<Popover | null>(null);
  const popRef = useRef<Popover | null>(null);
  popRef.current = pop;

  useEffect(() => {
    const mf = new MathfieldElement();
    host.current!.appendChild(mf);
    mf.macros = { ...mf.macros, ...MACROS };
    mf.inlineShortcuts = INLINE_SHORTCUTS;
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.smartFence = true;
    mf.smartSuperscript = false; // 10^23: keep typing digits in the exponent
    mf.popoverPolicy = 'off';
    mf.menuItems = [];
    if (p.ariaLabel) mf.setAttribute('aria-label', p.ariaLabel);
    mf.value = p.latex;
    mfRef.current = mf;

    const refreshPopover = () => {
      const pos = mf.position;
      const before = mf.getValue(0, pos, 'latex');
      const run = trailingRun(before);
      if (!run) return setPop(null);
      const items = suggestionsFor(latexToSymbol(run.latex), props.current.vars, run.afterNumber);
      setPop(items.length ? { items, sel: 0, navigated: false, prefixLatex: run.latex } : null);
    };

    const accept = (s: Suggestion) => {
      const pv = popRef.current;
      if (!pv) return;
      const n = atomCount(pv.prefixLatex);
      for (let i = 0; i < n; i++) mf.executeCommand('deleteBackward');
      mf.executeCommand(['insert', s.insert, { insertionMode: 'replaceSelection', selectionMode: 'placeholder', format: 'latex' }]);
      setPop(null);
      props.current.onChange(mf.getValue('latex'));
    };

    const onInput = () => {
      props.current.onChange(mf.getValue('latex'));
      refreshPopover();
    };
    const onKey = (e: KeyboardEvent) => {
      const pv = popRef.current;
      if (pv) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          const d = e.key === 'ArrowDown' ? 1 : -1;
          setPop({ ...pv, sel: (pv.sel + d + pv.items.length) % pv.items.length, navigated: true });
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && pv.navigated)) {
          e.preventDefault();
          e.stopPropagation();
          accept(pv.items[pv.sel]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setPop(null);
          return;
        }
      }
      if (e.key === 'Escape') {
        // MathLive would otherwise enter raw-LaTeX mode, which is confusing here
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === '*' && !e.ctrlKey && !e.metaKey) {
        // typeset multiplication as a centred dot, never an asterisk
        e.preventDefault();
        e.stopPropagation();
        mf.executeCommand(['insert', '\\cdot', { format: 'latex' }]);
        props.current.onChange(mf.getValue('latex'));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setPop(null);
        props.current.onEnter();
        return;
      }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey) {
        if (mf.getValue('latex') === '') {
          e.preventDefault();
          e.stopPropagation();
          props.current.onDeleteEmpty();
          return;
        }
        // Backspace on a unit chip turns it back into plain letters (spec §4.2 step 4)
        const pos = mf.position;
        const sel = mf.selection;
        if (pos > 0 && sel.ranges.length === 1 && sel.ranges[0][0] === sel.ranges[0][1]) {
          // a chip counts as several caret positions, so look at the text before the caret
          const before = mf.getValue(0, pos, 'latex');
          const m = /\\(unit|const)\{((?:[^{}]|\{[^{}]*\})*)\}$/.exec(before);
          if (m) {
            e.preventDefault();
            e.stopPropagation();
            mf.executeCommand('deleteBackward');
            mf.executeCommand(['insert', m[2], { format: 'latex' }]);
            props.current.onChange(mf.getValue('latex'));
            return;
          }
        }
      }
      if ((e.key === 'z' || e.key === 'y') && (e.ctrlKey || e.metaKey)) {
        // let the app-level undo handle it
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('usc-undo', { detail: e.key === 'y' || e.shiftKey ? 'redo' : 'undo' }));
      }
    };
    const onMoveOut = (e: Event) => {
      const dir = (e as CustomEvent).detail?.direction;
      if (dir === 'upward' || dir === 'downward') {
        e.preventDefault();
        props.current.onMoveOut(dir === 'upward' ? 'up' : 'down');
      }
    };
    const onFocus = () => {
      lastField = mf;
      props.current.onFocus();
      if (pendingInsert) {
        const l = pendingInsert;
        pendingInsert = null;
        setTimeout(() => insertInto(mf, l), 0);
      }
    };
    const onBlur = () => {
      setTimeout(() => setPop(null), 150);
      props.current.onBlur();
    };
    mf.addEventListener('input', onInput);
    mf.addEventListener('keydown', onKey, { capture: true });
    mf.addEventListener('move-out', onMoveOut);
    mf.addEventListener('focus', onFocus);
    mf.addEventListener('blur', onBlur);
    (mf as unknown as { __accept: typeof accept }).__accept = accept;
    if (p.autoFocus) requestAnimationFrame(() => mf.focus());
    return () => {
      mf.removeEventListener('input', onInput);
      mf.removeEventListener('keydown', onKey, { capture: true });
      mf.removeEventListener('move-out', onMoveOut);
      mf.removeEventListener('focus', onFocus);
      mf.removeEventListener('blur', onBlur);
      if (lastField === mf) lastField = null;
      mf.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external value changes (undo, chipify, slider)
  useEffect(() => {
    const mf = mfRef.current;
    if (mf && mf.getValue('latex') !== p.latex) mf.setValue(p.latex, { silenceNotifications: true });
  }, [p.latex]);

  useEffect(() => {
    if (p.focusNonce && mfRef.current) {
      const mf = mfRef.current;
      // a freshly created mathfield may not accept focus on the first frame; retry briefly
      let tries = 0;
      const attempt = () => {
        mf.focus();
        if (document.activeElement !== mf && tries++ < 10) setTimeout(attempt, 20);
        else mf.position = mf.lastOffset;
      };
      setTimeout(attempt, 0);
    }
  }, [p.focusNonce]);

  return (
    <div className="math-input">
      <div ref={host} className="math-host" />
      {pop && (
        <ul className="ac-pop" role="listbox">
          {pop.items.map((s, i) => (
            <li
              key={s.kind + s.label}
              role="option"
              aria-selected={i === pop.sel}
              className={i === pop.sel ? 'sel' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                (mfRef.current as unknown as { __accept: (s: Suggestion) => void }).__accept(s);
                mfRef.current?.focus();
              }}
            >
              <span className={`ac-sym ac-${s.kind}`}>{s.label}</span>
              <span className="ac-detail">{s.detail}</span>
            </li>
          ))}
          <li className="ac-hint">Tab to insert · ↑↓ to choose · Esc to dismiss</li>
        </ul>
      )}
    </div>
  );
}
