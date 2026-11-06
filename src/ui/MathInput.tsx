import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';

// MathLive is most of the app's code: load it in its own chunk so the page shows first (D38)
let mathlive: Promise<typeof import('mathlive')> | null = null;
/** Set once loaded, so fields can be created in the same frame they mount (no placeholder flash). */
let mathliveModule: typeof import('mathlive') | null = null;
export function loadMathLive() {
  mathlive ??= import('mathlive').then((m) => {
    m.MathfieldElement.fontsDirectory = '/mathlive-fonts';
    m.MathfieldElement.soundsDirectory = null;
    // the on-screen keyboard (touch devices) gets Dimensional's own keys (D40)
    setUpKeyboard((window as unknown as { mathVirtualKeyboard?: Parameters<typeof setUpKeyboard>[0] }).mathVirtualKeyboard);
    mathliveModule = m;
    return m;
  });
  return mathlive;
}
import { suggestionsFor, type Suggestion } from '../engine/suggest';
import { setUpKeyboard, setReturnHandler, setDivideHandler, setBeforeKeyHandler } from './keyboard';
import { latexToSymbol } from '../engine/latex';

export const MACROS = {
  unit: { args: 1, def: '\\textcolor{var(--unit)}{\\mathrm{#1}}', captureSelection: true, expand: false },
  const: { args: 1, def: '\\textcolor{var(--const)}{#1}', captureSelection: true, expand: false },
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

/**
 * Keys typed right after Enter, before the new row has the caret (D59). They used to land in the
 * row Enter was pressed in. Enter takes the caret out of that row; keys (and further Enters)
 * typed in between are held here and typed into the new row once it has the caret.
 */
const ENTER = 'Enter';
let pendingKeys: string[] | null = null;
let pendingTimer = 0;
function holdKeys(initial: string[] = []) {
  pendingKeys = initial;
  clearTimeout(pendingTimer);
  // a new field can take a moment to be ready; give up only after a long wait, or on a click
  pendingTimer = window.setTimeout(() => (pendingKeys = null), 8000);
}
if (typeof document !== 'undefined') document.addEventListener('pointerdown', () => (pendingKeys = null), true);
if (typeof document !== 'undefined')
  document.addEventListener(
    'keydown',
    (e) => {
      if (!pendingKeys || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 || ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        pendingKeys.push(e.key.length === 1 ? e.key : e.key === 'Enter' ? ENTER : e.key);
      }
    },
    true,
  );
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

/**
 * "/" right after unit chips (5 m / s): MathLive only takes letters and numbers as the numerator, so
 * after a chip it made an empty fraction and "s" landed on top. Wrap the trailing chips (with any
 * powers) as the numerator and put the caret in the denominator: 5 m/s (D41). Returns false when
 * the caret isn't after a chip, so the usual "/" applies.
 */
/** A single letter as MathLive returns it: T, x, \alpha, \Omega … */
const LETTER = /^(?:[A-Za-z]|\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega))$/;
const DIGIT = /^[0-9]$/;
const at = (mf: MathfieldElement, k: number) => (k < 0 ? '' : mf.getValue(k, k + 1, 'latex'));

/**
 * A digit typed right after a letter is its subscript: T1 → T₁, and further digits go on in the
 * subscript (T₁₂) until something else is typed (D47). Not for 1e5-style numbers. Call after the
 * digit is in; returns whether it moved it.
 */
export function autoSubscript(mf: MathfieldElement): boolean {
  const p = mf.position;
  if (p < 2) return false;
  const d = at(mf, p - 1);
  const letter = at(mf, p - 2);
  if (!DIGIT.test(d) || !LETTER.test(letter)) return false;
  if (letter === 'e' && DIGIT.test(at(mf, p - 3))) return false; // 2e5
  mf.selection = { ranges: [[p - 2, p]], direction: 'forward' };
  mf.executeCommand(['insert', `${letter}_{${d}}`, { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after' }]);
  mf.executeCommand('moveToPreviousChar'); // back inside the subscript, after the digit
  return true;
}

/** Whether the caret is at the end of a subscript of digits on a letter (T₁₂|). */
function atEndOfDigitSubscript(mf: MathfieldElement): boolean {
  const p = mf.position;
  if (at(mf, p) !== '') return false; // the next step leaves a group
  let k = p;
  while (k > 0 && DIGIT.test(at(mf, k - 1))) k--;
  if (k === p || at(mf, k - 1) !== '' || !LETTER.test(at(mf, k - 2))) return false;
  const seg = mf.getValue(k - 2, p + 1, 'latex');
  return /_/.test(seg) && !/\^/.test(seg);
}

/** Before a non-digit is typed at the end of such a subscript, step out of it: T₁ then = gives T₁ =. */
export function leaveDigitSubscript(mf: MathfieldElement): boolean {
  if (!atEndOfDigitSubscript(mf)) return false;
  mf.executeCommand('moveAfterParent');
  return true;
}

export function divideAfterChips(mf: MathfieldElement): boolean {
  const pos = mf.position;
  if (pos <= 0) return false;
  const before = mf.getValue(0, pos, 'latex');
  const m = /(?:\\(?:unit|const)\{(?:[^{}]|\{[^{}]*\})*\}(?:\^\{[^{}]*\}|\^[0-9])?)+$/.exec(before);
  if (!m) return false;
  const term = m[0];
  // the caret offset where those chips start (a chip spans several offsets)
  let start = -1;
  for (let k = pos - 1; k >= 0; k--)
    if (mf.getValue(k, pos, 'latex') === term) {
      start = k;
      break;
    }
  if (start < 0) return false;
  mf.selection = { ranges: [[start, pos]], direction: 'forward' };
  mf.executeCommand(['insert', `\\frac{${term}}{#?}`, { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'placeholder' }]);
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
  /** Alt+↑ / Alt+↓: move this row (optional). */
  onMoveRow?(delta: -1 | 1): void;
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

  const [ready, setReady] = useState(false);
  // a layout effect, and synchronously when MathLive is already loaded: the field exists before the
  // browser paints, so rows never change height after they appear (D39)
  useLayoutEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const create = ({ MathfieldElement }: typeof import('mathlive')) => {
    if (cancelled || !host.current) return;
    const mf = new MathfieldElement();
    host.current!.appendChild(mf);
    // MathLive resets its options when the element is moved in the page (dragging rows reorders
    // them), which made chips show as raw LaTeX. Apply them on every (re)connection.
    const applyOptions = () => {
      mf.macros = { ...mf.macros, ...MACROS };
      mf.inlineShortcuts = INLINE_SHORTCUTS;
      // phones and tablets: MathLive's on-screen maths keyboard; mouse and keyboard: none (D7, D37)
      mf.mathVirtualKeyboardPolicy = window.matchMedia?.('(pointer: coarse)').matches ? 'auto' : 'manual';
      mf.smartFence = true;
      mf.smartSuperscript = false; // 10^23: keep typing digits in the exponent
      mf.popoverPolicy = 'off';
      mf.menuItems = [];
      mf.setValue(props.current.latex, { silenceNotifications: true });
    };
    applyOptions();
    if (p.ariaLabel) mf.setAttribute('aria-label', p.ariaLabel);
    mfRef.current = mf;
    const onMount = () => applyOptions();
    mf.addEventListener('mount', onMount);

    const refreshPopover = () => {
      const pos = mf.position;
      const before = mf.getValue(0, pos, 'latex');
      const run = trailingRun(before);
      if (!run) return setPop(null);
      const items = suggestionsFor(latexToSymbol(run.latex), props.current.vars, run.afterNumber);
      setPop(items.length ? { items, sel: 0, navigated: false, prefixLatex: run.latex } : null);
    };

    /**
     * Insert a suggestion for the letters before the caret. Works from the text as it is now, not
     * the list on screen, which can be a keystroke behind when typing fast (m, m, Tab): the user's
     * own pick (arrow keys or a click) is kept if it still fits, otherwise the best match for what
     * is actually typed. Returns false if nothing fits.
     */
    const accept = (picked?: Suggestion, chosen = false): boolean => {
      const run = trailingRun(mf.getValue(0, mf.position, 'latex'));
      const items = run ? suggestionsFor(latexToSymbol(run.latex), props.current.vars, run.afterNumber) : [];
      if (!run || !items.length) {
        setPop(null);
        return false;
      }
      const s = (chosen && picked && items.find((i) => i.insert === picked.insert)) || items[0];
      const n = atomCount(run.latex);
      for (let i = 0; i < n; i++) mf.executeCommand('deleteBackward');
      mf.executeCommand(['insert', s.insert, { insertionMode: 'replaceSelection', selectionMode: 'placeholder', format: 'latex' }]);
      setPop(null);
      props.current.onChange(mf.getValue('latex'));
      return true;
    };

    const onInput = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType === 'insertText' && ie.data && DIGIT.test(ie.data)) autoSubscript(mf);
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
          accept(pv.items[pv.sel], pv.navigated);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setPop(null);
          return;
        }
      }
      if (e.key === 'Tab' && !e.shiftKey && !pv && accept()) {
        // the list hadn't appeared yet: Tab still completes what was typed, rather than leaving the field
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') {
        // MathLive would otherwise enter raw-LaTeX mode, which is confusing here
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // typing on after T₁₂: leave the subscript first (D47)
      if (e.key.length === 1 && !DIGIT.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) leaveDigitSubscript(mf);
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && divideAfterChips(mf)) {
        e.preventDefault();
        e.stopPropagation();
        props.current.onChange(mf.getValue('latex'));
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
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && props.current.onMoveRow) {
        e.preventDefault();
        e.stopPropagation();
        props.current.onMoveRow(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setPop(null);
        props.current.onEnter();
        // normally the new row already has the caret; if not, hold what is typed until it does
        if (document.activeElement === mf) {
          holdKeys();
          mf.blur();
        }
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
      if (pendingKeys) {
        // replayed at once, in order: nothing typed meanwhile can slip in between
        const keys = pendingKeys;
        pendingKeys = null;
        clearTimeout(pendingTimer);
        const nlAt = keys.indexOf(ENTER);
        for (const ch of nlAt < 0 ? keys : keys.slice(0, nlAt)) {
          if (ch === 'Tab') accept(); // complete the unit or name typed so far, as Tab does
          else if (ch === 'Backspace') mf.executeCommand('deleteBackward');
          else if (ch === '*') mf.executeCommand(['insert', String.raw`\cdot`, { format: 'latex' }]);
          else mf.executeCommand(['typedText', ch]);
        }
        if (nlAt > 0) props.current.onChange(mf.getValue('latex'));
        else if (nlAt < 0 && keys.length) props.current.onChange(mf.getValue('latex'));
        if (nlAt >= 0) {
          // another Enter was typed: the rest goes to the row after this one
          holdKeys(keys.slice(nlAt + 1));
          props.current.onEnter();
          mf.blur();
          return;
        }
      }
      setReturnHandler(() => props.current.onEnter());
      setBeforeKeyHandler(() => leaveDigitSubscript(mf));
      setDivideHandler(() => {
        const done = divideAfterChips(mf);
        if (done) props.current.onChange(mf.getValue('latex'));
        return done;
      });
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
    setReady(true);
    cleanup = () => {
      mf.removeEventListener('input', onInput);
      mf.removeEventListener('keydown', onKey, { capture: true });
      mf.removeEventListener('move-out', onMoveOut);
      mf.removeEventListener('focus', onFocus);
      mf.removeEventListener('blur', onBlur);
      mf.removeEventListener('mount', onMount);
      if (lastField === mf) lastField = null;
      mf.remove();
    };
    };
    if (mathliveModule) create(mathliveModule);
    else void loadMathLive().then(create);
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external value changes (undo, chipify, slider)
  useEffect(() => {
    const mf = mfRef.current;
    if (mf && mf.getValue('latex') !== p.latex) mf.setValue(p.latex, { silenceNotifications: true });
  }, [p.latex, ready]);

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
  }, [p.focusNonce, ready]);

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
                (mfRef.current as unknown as { __accept: (s: Suggestion, chosen: boolean) => boolean }).__accept(s, true);
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
