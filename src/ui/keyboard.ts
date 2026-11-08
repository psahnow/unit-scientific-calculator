// The on-screen maths keyboard for touch devices (D40): only things Dimensional understands, in
// five tabs — numbers, units, functions, letters and Greek — all on the same grid.
import type { VirtualKeyboardLayout, VirtualKeyboardKeycap } from 'mathlive';

type Key = string | Partial<VirtualKeyboardKeycap>;

/** A unit chip; "mm^2" becomes the chip mm with a power, the way typed units are stored. */
const unit = (sym: string, latex = sym, tooltip?: string): Key => {
  const [base, pow] = latex.split('^');
  return { label: sym, insert: `\\unit{${base}}` + (pow ? `^{${pow}}` : ''), class: 'small', tooltip: tooltip ?? sym };
};
const fn = (label: string, insert: string, tooltip: string, extra: Partial<VirtualKeyboardKeycap> = {}): Key => ({ label, insert, class: 'small', tooltip, ...extra });
const op = (name: string, cmd = `\\operatorname{${name}}`) => `${cmd}\\left(#0\\right)`;

/**
 * Every tab is the same grid: four rows of ten keys, then this same bottom row, so the keyboard keeps
 * its size and ← → ⌫ ↵ never move when you switch tabs (D40).
 */
const NAV: Key[] = [
  '[left]',
  '[right]',
  '[(]',
  '[)]',
  fn(',', ',', 'Comma, for lists and function inputs'),
  '[=]',
  fn('x₁', '_{#0}', 'Subscript, as in F₁ (on a keyboard, type _)'),
  { label: '⌫', class: 'action dim-backspace', command: 'performWithFeedback(deleteBackward)', width: 1.5, tooltip: 'Delete' },
  { label: '↵', class: 'action dim-return', command: 'performWithFeedback(commit)', width: 1.5, tooltip: 'New row' /* handled by setReturnHandler */ },
]
const DIGITS: Key[] = ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[8]', '[9]', '[0]'];
/** ÷: a fraction of what's before the caret; after unit chips, handled by setDivideHandler. */
const DIVIDE: Key = { latex: '\\frac{#@}{#?}', label: '÷', class: 'big-op dim-divide', tooltip: 'Divide' };

/**
 * The keyboard's ↵ adds a row below the focused one (D40). It acts on its own press, not on MathLive's
 * "commit", which also fires when you leave an edited field and doesn't fire for an unchanged one.
 */
let onReturn: (() => void) | null = null;
export function setReturnHandler(fn: (() => void) | null) {
  onReturn = fn;
}
/** ÷ after unit chips puts them on top (see divideAfterChips); otherwise MathLive's own fraction. */
let onDivide: (() => boolean) | null = null;
export function setDivideHandler(fn: (() => boolean) | null) {
  onDivide = fn;
}
/** Runs before an on-screen key that types something other than a digit (leaves T₁₂'s subscript). */
let onBeforeKey: (() => void) | null = null;
export function setBeforeKeyHandler(fn: (() => void) | null) {
  onBeforeKey = fn;
}
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target as Element | null;
      // an on-screen key that types something (not a digit, an arrow, ⌫, ⇧ or a page key)
      const cap = t?.closest?.('.MLK__layer div[tabindex="-1"]');
      if (cap && !cap.matches('.action, .shift, .dim-page, .dim-return, .dim-hide-kb') && !/^[0-9]$/.test((cap.getAttribute('aria-label') ?? cap.textContent ?? '').trim())) onBeforeKey?.();
      if (t?.closest?.('.dim-return') && onReturn) {
        e.preventDefault();
        e.stopPropagation();
        onReturn();
      } else if (t?.closest?.('.dim-divide') && onDivide?.()) {
        e.preventDefault();
        e.stopPropagation();
      } else if (t?.closest?.('.dim-hide-kb')) {
        // hidden on lift (below): MathLive would refocus the field after a press in the keyboard
        e.preventDefault();
        e.stopPropagation();
      } else if (e.pointerType === 'touch') {
        // a touch on a math field that isn't being edited may be the start of a scroll: don't let
        // MathLive focus it (and raise the keyboard) yet; focus it on lift if the finger didn't move
        const mf = t?.closest?.('math-field') as (HTMLElement & { getOffsetFromPoint?(x: number, y: number): number; position: number }) | null;
        if (mf && document.activeElement !== mf && !mf.contains(document.activeElement)) {
          e.stopPropagation();
          pendingTap = { mf, id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp };
        }
      }
    },
    true,
  );
  // a lift close to where the touch began, soon after, is a tap: edit that field there
  document.addEventListener(
    'pointerup',
    (e) => {
      if ((e.target as Element | null)?.closest?.('.dim-hide-kb')) {
        e.preventDefault();
        e.stopPropagation();
        hideKeyboard();
        return;
      }
      const p = pendingTap;
      if (!p || e.pointerId !== p.id) return;
      pendingTap = null;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP || e.timeStamp - p.at > 800) return;
      e.stopPropagation();
      p.mf.focus();
      try {
        const offset = p.mf.getOffsetFromPoint?.(e.clientX, e.clientY);
        if (typeof offset === 'number' && offset >= 0) p.mf.position = offset;
      } catch {
        /* keep MathLive's caret */
      }
    },
    true,
  );
  // the browser took the touch for a scroll
  document.addEventListener('pointercancel', (e) => {
    if (pendingTap?.id === e.pointerId) pendingTap = null;
  }, true);
}

/** Pixels a finger may drift and still count as a tap. */
const TAP_SLOP = 10;
let pendingTap: { mf: HTMLElement & { getOffsetFromPoint?(x: number, y: number): number; position: number }; id: number; x: number; y: number; at: number } | null = null;

let keyboardRef: { hide?(): void } | undefined;
/** Close the on-screen keyboard and stop editing (the "hide keyboard" button). */
function hideKeyboard() {
  const active = document.activeElement as HTMLElement | null;
  if (active?.tagName === 'MATH-FIELD') active.blur();
  keyboardRef?.hide?.();
  // in case a late handler put focus back
  setTimeout(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a?.tagName === 'MATH-FIELD') a.blur();
  }, 0);
}

/** A "hide keyboard" button at the right of the keyboard's tab bar (MathLive leaves it empty). */
let watched: Element | null = null;
function ensureHideButton() {
  // MathLive redraws the tab bar (switching pages, say): put the button back each time
  const kb = document.querySelector('.ML__keyboard');
  if (kb && kb !== watched) {
    watched = kb;
    new MutationObserver(() => ensureHideButton()).observe(kb, { childList: true, subtree: true });
  }
  // every keyboard page has its own tab bar
  for (const right of document.querySelectorAll('.ML__keyboard .MLK__toolbar .right')) {
    if (!right.querySelector('.dim-hide-kb')) right.appendChild(hideButton());
  }
}

function hideButton(): HTMLElement {
  const b = document.createElement('div');
  b.className = 'dim-hide-kb';
  b.setAttribute('role', 'button');
  b.setAttribute('aria-label', 'Hide keyboard');
  b.title = 'Hide keyboard';
  b.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="11" rx="2"/><path d="M7 7h.01M10 7h.01M13 7h.01M16 7h.01M8 10.5h8"/><path d="M9 18l3 3 3-3"/></svg>';
  return b;
}

const trig = (n: string, cmd: string, tip: string) => fn(n, op(n, cmd), tip);

const NUMBERS: VirtualKeyboardLayout = {
  id: 'dim-numbers',
  label: '123',
  tooltip: 'Numbers',
  rows: [
    ['[7]', '[8]', '[9]', DIVIDE, { latex: '\\sqrt{#0}', tooltip: 'Square root' }, { latex: '#@^{2}', tooltip: 'Square' }, { latex: '#@^{#?}', tooltip: 'Power' }, { latex: '\\pi', tooltip: 'π' }, { label: 'e', insert: 'e', tooltip: "Euler's number" }, fn('×10ⁿ', '\\cdot10^{#0}', 'Times ten to the power')],
    ['[4]', '[5]', '[6]', '[*]', fn('%', '\\%', 'Percent'), { latex: '\\left|#0\\right|', tooltip: 'Absolute value' }, fn('°', '\\unit{\\degree}', 'Degrees'), fn('ans', 'ans', 'The answer of the row above'), fn('f(x)', '#@\\left(#0\\right)', 'Brackets after a name: f(x)'), fn('n!', '!', 'Factorial')],
    ['[1]', '[2]', '[3]', '[-]', trig('sin', '\\sin', 'Sine'), trig('cos', '\\cos', 'Cosine'), trig('tan', '\\tan', 'Tangent'), trig('ln', '\\ln', 'Natural log'), trig('log', '\\log', 'Log base 10'), fn('eˣ', 'e^{#0}', 'e to the power')],
    ['[0]', '[.]', '[+]', fn('[ ]', '\\left[#0\\right]', 'List'), fn('∫', '\\int_{#0}^{#?}#?\\,\\mathrm{d}x', 'Definite integral'), fn('d/dx', '\\frac{\\mathrm{d}}{\\mathrm{d}#?}#0', 'Derivative: choose the variable, then the expression'), fn('lim', '\\lim_{x\\to#0}#?', 'Limit'), fn('Σ', '\\sum_{n=#0}^{#?}#?', 'Sum'), fn('solve', '\\operatorname{solve}\\left(#0=#?,x\\right)', 'Solve an equation for x'), fn('∞', '\\infty', 'Infinity')],
    NAV,
  ],
};

/** A compound unit key, e.g. m/s or N·m. */
const cu = (label: string, insert: string, tooltip = label): Key => ({ label, insert, class: 'small', tooltip });
const page = (label: string, to: string, tooltip: string): Key => ({ label, class: 'small dim-page', command: ['switchKeyboardLayer', to], tooltip });

/** Units has two pages; the last key of the fourth row turns the page (D40). */
const UNITS: VirtualKeyboardLayout = {
  id: 'dim-units',
  label: 'm kg',
  tooltip: 'Units',
  layers: [
    {
      id: 'dim-units-1',
      rows: [
        [unit('mm'), unit('cm'), unit('m'), unit('km'), unit('in'), unit('ft'), unit('mm²', 'mm^2'), unit('m²', 'm^2'), unit('L'), unit('m³', 'm^3')],
        [unit('g'), unit('kg'), unit('lbm'), unit('N'), unit('kN'), unit('lbf'), unit('Pa'), unit('kPa'), unit('MPa'), unit('psi')],
        [unit('J'), unit('kJ'), unit('W'), unit('kW'), unit('hp'), unit('bar'), unit('gal'), unit('Hz'), unit('rad'), unit('°', '\\degree')],
        [unit('s'), unit('min'), unit('h'), unit('°C', '\\degree C'), unit('°F', '\\degree F'), unit('K'), unit('Δ°C', '\\Delta\\degree C', 'Temperature difference'), unit('V'), unit('A'), page('more ›', 'dim-units-2', 'More units')],
        NAV,
      ],
    },
    {
      id: 'dim-units-2',
      rows: [
        [unit('µm', '\\mu m'), unit('nm'), unit('yd'), unit('mi'), unit('mL'), unit('ha'), unit('acre'), unit('cm²', 'cm^2'), unit('in²', 'in^2'), unit('ft²', 'ft^2')],
        [unit('mg'), unit('t'), unit('oz'), unit('MN'), unit('GPa'), unit('atm'), cu('N·m', '\\unit{N}\\cdot\\unit{m}', 'Newton-metres (torque)'), cu('kN·m', '\\unit{kN}\\cdot\\unit{m}'), cu('W/m²', '\\unit{W}/\\unit{m}^{2}'), cu('kg/m³', '\\unit{kg}/\\unit{m}^{3}', 'Density')],
        [unit('Wh'), unit('kWh'), unit('cal'), unit('mph'), cu('km/h', '\\unit{km}/\\unit{h}'), cu('m/s', '\\unit{m}/\\unit{s}'), cu('ft/s', '\\unit{ft}/\\unit{s}'), cu('m/s²', '\\unit{m}/\\unit{s}^{2}', 'Acceleration'), cu('rad/s', '\\unit{rad}/\\unit{s}', 'Angular velocity'), unit('Ω', '\\Omega')],
        [unit('mA'), unit('kV'), unit('mV'), unit('d', 'd', 'day'), unit('wk'), unit('yr'), unit('%', '\\%', 'percent'), unit('ppm'), unit('kHz'), page('‹ back', 'dim-units-1', 'Common units')],
        NAV,
      ],
    },
  ],
};

const FUNCTIONS: VirtualKeyboardLayout = {
  id: 'dim-functions',
  label: 'ƒ(x)',
  tooltip: 'Functions',
  rows: [
    [trig('sin', '\\sin', 'Sine'), trig('cos', '\\cos', 'Cosine'), trig('tan', '\\tan', 'Tangent'), trig('ln', '\\ln', 'Natural log'), trig('log', '\\log', 'Log base 10'), fn('eˣ', 'e^{#0}', 'e to the power'), fn('10ˣ', '10^{#0}', 'Ten to the power'), fn('ⁿ√', '\\sqrt[#0]{#?}', 'n-th root'), fn('min', op('min', '\\min'), 'Smallest'), fn('max', op('max', '\\max'), 'Largest')],
    [fn('sin⁻¹', op('arcsin', '\\arcsin'), 'Inverse sine'), fn('cos⁻¹', op('arccos', '\\arccos'), 'Inverse cosine'), fn('tan⁻¹', op('arctan', '\\arctan'), 'Inverse tangent'), trig('sinh', '\\sinh', 'Hyperbolic sine'), trig('cosh', '\\cosh', 'Hyperbolic cosine'), trig('tanh', '\\tanh', 'Hyperbolic tangent'), fn('n!', '!', 'Factorial'), fn('Γ', '\\Gamma\\left(#0\\right)', 'Gamma function'), fn('round', op('round'), 'Round'), fn('mean', op('mean'), 'Average of a list')],
    [fn('∫', '\\int_{#0}^{#?}#?\\,\\mathrm{d}x', 'Definite integral'), fn('d/dx', '\\frac{\\mathrm{d}}{\\mathrm{d}#?}#0', 'Derivative: choose the variable, then the expression'), fn('d²/dx²', '\\frac{\\mathrm{d}^2}{\\mathrm{d}#?^2}#0', 'Second derivative: choose the variable, then the expression'), fn('lim', '\\lim_{x\\to#0}#?', 'Limit'), fn('Σ', '\\sum_{n=#0}^{#?}#?', 'Sum'), fn('Π', '\\prod_{n=#0}^{#?}#?', 'Product'), fn('solve', '\\operatorname{solve}\\left(#0=#?,x\\right)', 'Solve an equation for x'), fn('[ ]', '\\left[#0\\right]', 'List'), fn('{ : }', '\\left\\{x<#0:#?,#?\\right\\}', 'Piecewise'), fn('∞', '\\infty', 'Infinity')],
    [fn('<', '<', 'Less than'), fn('≤', '\\le', 'Less or equal'), fn('>', '>', 'Greater than'), fn('≥', '\\ge', 'Greater or equal'), fn('mod', op('mod') .replace('#0', '#0,#?'), 'Remainder: mod(7, 3) = 1'), fn('gcd', op('gcd').replace('#0', '#0,#?'), 'Greatest common divisor'), fn('lcm', op('lcm').replace('#0', '#0,#?'), 'Least common multiple'), fn('nCr', op('nCr').replace('#0', '#0,#?'), 'Combinations'), fn('nPr', op('nPr').replace('#0', '#0,#?'), 'Permutations'), fn('erf', op('erf'), 'Error function')],
    NAV,
  ],
};

/** Letters, with ⇧ for capitals: the same grid as the other tabs (MathLive's own has 11 columns). */
const letter = (c: string): Key => ({ latex: c, shift: c.toUpperCase() });
const LETTERS: VirtualKeyboardLayout = {
  id: 'dim-letters',
  label: 'abc',
  tooltip: 'Letters (names)',
  rows: [
    DIGITS,
    [...'qwertyuiop'].map(letter),
    [...[...'asdfghjkl'].map(letter), fn('.', '.', 'Decimal point')],
    // ⇧ is 1.5 keys wide: 1.5 + 7 + 1 + ½ gap = 10, like every other row
    ['[shift]', ...[...'zxcvbnm'].map(letter), fn('%', '\\%', 'Percent'), '[separator-5]'],
    NAV,
  ],
};

const GREEK: VirtualKeyboardLayout = {
  id: 'dim-greek',
  label: 'αβγ',
  tooltip: 'Greek letters',
  rows: [
    DIGITS,
    ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\varepsilon', '\\zeta', '\\eta', '\\theta', '\\lambda', '\\mu'].map((l) => ({ latex: l })),
    ['\\nu', '\\xi', '\\rho', '\\sigma', '\\tau', '\\phi', '\\chi', '\\psi', '\\omega', '\\kappa'].map((l) => ({ latex: l })),
    ['\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Xi', '\\Pi', '\\Sigma', '\\Phi', '\\Psi', '\\Omega'].map((l) => ({ latex: l })),
    NAV,
  ],
};

export const DIMENSIONAL_LAYOUTS: VirtualKeyboardLayout[] = [NUMBERS, UNITS, FUNCTIONS, LETTERS, GREEK];

/** Install the layouts on MathLive's shared keyboard. */
export function setUpKeyboard(
  mathVirtualKeyboard: ({ layouts: unknown; editToolbar?: string; visible?: boolean; boundingRect?: DOMRect } & EventTarget) | undefined,
) {
  if (!mathVirtualKeyboard) return;
  keyboardRef = mathVirtualKeyboard as { hide?(): void };
  mathVirtualKeyboard.layouts = DIMENSIONAL_LAYOUTS;
  mathVirtualKeyboard.editToolbar = 'none';
  // while it's up: pad the page by its height so nothing hides behind it, and hide the Functions
  // drawer (the keyboard has the same keys)
  mathVirtualKeyboard.addEventListener('geometrychange', () => {
    const h = mathVirtualKeyboard.visible ? (mathVirtualKeyboard.boundingRect?.height ?? 0) : 0;
    const root = document.documentElement;
    root.style.setProperty('--osk-h', `${Math.round(h)}px`);
    root.classList.toggle('osk-open', h > 0);
    if (h > 0) {
      ensureHideButton();
      keepFieldVisible(h);
    }
  });
  // the field can also move or grow while the keyboard is up (a new row, a fraction)
  const later = () => {
    const h = mathVirtualKeyboard.visible ? (mathVirtualKeyboard.boundingRect?.height ?? 0) : 0;
    if (h > 0) keepFieldVisible(h);
  };
  document.addEventListener('focusin', later);
  document.addEventListener('input', later);
}

/**
 * Scroll so the math field being edited sits between the sticky header and the on-screen keyboard
 * (with its result too, when the whole row fits). Runs now and again after the keyboard's slide-in.
 */
function keepFieldVisible(oskHeight: number) {
  const run = () => {
    const active = document.activeElement;
    const field = active?.closest?.('math-field') ?? (active?.tagName === 'MATH-FIELD' ? active : null);
    if (!field) return;
    const head = document.querySelector('.app-head')?.getBoundingClientRect().bottom ?? 0;
    const bottomLimit = window.innerHeight - oskHeight - 12;
    const room = bottomLimit - head - 12;
    const row = field.closest('.row');
    const f = field.getBoundingClientRect();
    const r = row?.getBoundingClientRect();
    // the whole row (input and result) if it fits, else just the field
    const target = r && r.height <= room ? r : f;
    if (target.bottom > bottomLimit) window.scrollBy({ top: target.bottom - bottomLimit, behavior: 'instant' as ScrollBehavior });
    else if (target.top < head + 12) window.scrollBy({ top: target.top - head - 12, behavior: 'instant' as ScrollBehavior });
  };
  requestAnimationFrame(run);
  setTimeout(run, 320);
}
