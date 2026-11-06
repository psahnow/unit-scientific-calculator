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
  fn(',', ',', 'Comma (lists, function inputs)'),
  '[=]',
  fn('ans', 'ans', 'The answer of the row above'),
  { label: '⌫', class: 'action dim-backspace', command: 'performWithFeedback(deleteBackward)', width: 1.5, tooltip: 'Delete' },
  { label: '↵', class: 'action dim-return', command: 'performWithFeedback(commit)', width: 1.5, tooltip: 'New row' /* handled by setReturnHandler */ },
];
const DIGITS: Key[] = ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[8]', '[9]', '[0]'];

/**
 * The keyboard's ↵ adds a row below the focused one (D40). It acts on its own press, not on MathLive's
 * "commit", which also fires when you leave an edited field and doesn't fire for an unchanged one.
 */
let onReturn: (() => void) | null = null;
export function setReturnHandler(fn: (() => void) | null) {
  onReturn = fn;
}
if (typeof document !== 'undefined')
  document.addEventListener(
    'pointerdown',
    (e) => {
      if ((e.target as Element | null)?.closest?.('.dim-return') && onReturn) {
        e.preventDefault();
        e.stopPropagation();
        onReturn();
      }
    },
    true,
  );

const trig = (n: string, cmd: string, tip: string) => fn(n, op(n, cmd), tip);

const NUMBERS: VirtualKeyboardLayout = {
  id: 'dim-numbers',
  label: '123',
  tooltip: 'Numbers',
  rows: [
    ['[7]', '[8]', '[9]', '[/]', { latex: '\\sqrt{#0}', tooltip: 'Square root' }, { latex: '#@^{2}', tooltip: 'Square' }, { latex: '#@^{#?}', tooltip: 'Power' }, { latex: '\\pi', tooltip: 'π' }, { label: 'e', insert: 'e', tooltip: "Euler's number" }, fn('×10ⁿ', '\\cdot10^{#0}', 'Times ten to the power')],
    ['[4]', '[5]', '[6]', '[*]', fn('%', '\\%', 'Percent'), { latex: '\\left|#0\\right|', tooltip: 'Absolute value' }, fn('°', '\\unit{\\degree}', 'Degrees'), fn('x₁', '_{#0}', 'Subscript, as in F₁'), fn('f(x)', '#@\\left(#0\\right)', 'Brackets after a name: f(x)'), fn('n!', '!', 'Factorial')],
    ['[1]', '[2]', '[3]', '[-]', trig('sin', '\\sin', 'Sine'), trig('cos', '\\cos', 'Cosine'), trig('tan', '\\tan', 'Tangent'), trig('ln', '\\ln', 'Natural log'), trig('log', '\\log', 'Log base 10'), fn('eˣ', 'e^{#0}', 'e to the power')],
    ['[0]', '[.]', '[+]', fn('[ ]', '\\left[#0\\right]', 'List'), fn('∫', '\\int_{#0}^{#?}#?\\,\\mathrm{d}x', 'Definite integral'), fn('d/dx', '\\frac{\\mathrm{d}}{\\mathrm{d}x}#0', 'Derivative at the current x'), fn('lim', '\\lim_{x\\to#0}#?', 'Limit'), fn('Σ', '\\sum_{n=#0}^{#?}#?', 'Sum'), fn('solve', '\\operatorname{solve}\\left(#0=#?,x\\right)', 'Solve an equation for x'), fn('∞', '\\infty', 'Infinity')],
    NAV,
  ],
};

const UNITS: VirtualKeyboardLayout = {
  id: 'dim-units',
  label: 'm kg',
  tooltip: 'Units',
  rows: [
    [unit('mm'), unit('cm'), unit('m'), unit('km'), unit('in'), unit('ft'), unit('mm²', 'mm^2'), unit('m²', 'm^2'), unit('L'), unit('m³', 'm^3')],
    [unit('g'), unit('kg'), unit('lbm'), unit('N'), unit('kN'), unit('lbf'), unit('Pa'), unit('kPa'), unit('MPa'), unit('psi')],
    [unit('J'), unit('kJ'), unit('W'), unit('kW'), unit('hp'), unit('bar'), unit('gal'), unit('Hz'), unit('rad'), unit('Ω', '\\Omega')],
    [unit('s'), unit('min'), unit('h'), unit('°C', '\\degree C'), unit('°F', '\\degree F'), unit('K'), unit('Δ°C', '\\Delta\\degree C', 'Temperature difference'), unit('°', '\\degree'), unit('V'), unit('A')],
    NAV,
  ],
};

const FUNCTIONS: VirtualKeyboardLayout = {
  id: 'dim-functions',
  label: 'ƒ(x)',
  tooltip: 'Functions',
  rows: [
    [trig('sin', '\\sin', 'Sine'), trig('cos', '\\cos', 'Cosine'), trig('tan', '\\tan', 'Tangent'), trig('ln', '\\ln', 'Natural log'), trig('log', '\\log', 'Log base 10'), fn('eˣ', 'e^{#0}', 'e to the power'), fn('10ˣ', '10^{#0}', 'Ten to the power'), fn('ⁿ√', '\\sqrt[#0]{#?}', 'n-th root'), fn('min', op('min', '\\min'), 'Smallest'), fn('max', op('max', '\\max'), 'Largest')],
    [fn('sin⁻¹', op('arcsin', '\\arcsin'), 'Inverse sine'), fn('cos⁻¹', op('arccos', '\\arccos'), 'Inverse cosine'), fn('tan⁻¹', op('arctan', '\\arctan'), 'Inverse tangent'), trig('sinh', '\\sinh', 'Hyperbolic sine'), trig('cosh', '\\cosh', 'Hyperbolic cosine'), trig('tanh', '\\tanh', 'Hyperbolic tangent'), fn('n!', '!', 'Factorial'), fn('Γ', '\\Gamma\\left(#0\\right)', 'Gamma function'), fn('round', op('round'), 'Round'), fn('mean', op('mean'), 'Average of a list')],
    [fn('∫', '\\int_{#0}^{#?}#?\\,\\mathrm{d}x', 'Definite integral'), fn('d/dx', '\\frac{\\mathrm{d}}{\\mathrm{d}x}#0', 'Derivative at the current x'), fn('d²/dx²', '\\frac{\\mathrm{d}^2}{\\mathrm{d}x^2}#0', 'Second derivative'), fn('lim', '\\lim_{x\\to#0}#?', 'Limit'), fn('Σ', '\\sum_{n=#0}^{#?}#?', 'Sum'), fn('Π', '\\prod_{n=#0}^{#?}#?', 'Product'), fn('solve', '\\operatorname{solve}\\left(#0=#?,x\\right)', 'Solve an equation for x'), fn('[ ]', '\\left[#0\\right]', 'List'), fn('{ : }', '\\left\\{x<#0:#?,#?\\right\\}', 'Piecewise'), fn('∞', '\\infty', 'Infinity')],
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
    [...'qwertyuiop'].map(letter),
    [...[...'asdfghjkl'].map(letter), fn('x₁', '_{#0}', 'Subscript, as in F₁')],
    // ⇧ is 1.5 keys wide: 1.5 + 7 + 1 + ½ gap = 10, like every other row
    ['[shift]', ...[...'zxcvbnm'].map(letter), fn('%', '\\%', 'Percent'), '[separator-5]'],
    DIGITS,
    NAV,
  ],
};

const GREEK: VirtualKeyboardLayout = {
  id: 'dim-greek',
  label: 'αβγ',
  tooltip: 'Greek letters',
  rows: [
    ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\varepsilon', '\\zeta', '\\eta', '\\theta', '\\lambda', '\\mu'].map((l) => ({ latex: l })),
    ['\\nu', '\\xi', '\\rho', '\\sigma', '\\tau', '\\phi', '\\chi', '\\psi', '\\omega', '\\kappa'].map((l) => ({ latex: l })),
    [...['\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Sigma', '\\Phi', '\\Psi', '\\Omega', '\\iota'].map((l) => ({ latex: l })), fn('x₁', '_{#0}', 'Subscript')],
    DIGITS,
    NAV,
  ],
};

export const DIMENSIONAL_LAYOUTS: VirtualKeyboardLayout[] = [NUMBERS, UNITS, FUNCTIONS, LETTERS, GREEK];

/** Install the layouts on MathLive's shared keyboard. */
export function setUpKeyboard(
  mathVirtualKeyboard: ({ layouts: unknown; editToolbar?: string; visible?: boolean; boundingRect?: DOMRect } & EventTarget) | undefined,
) {
  if (!mathVirtualKeyboard) return;
  mathVirtualKeyboard.layouts = DIMENSIONAL_LAYOUTS;
  mathVirtualKeyboard.editToolbar = 'none';
  // while it's up: pad the page by its height so nothing hides behind it, and hide the Functions
  // drawer (the keyboard has the same keys)
  mathVirtualKeyboard.addEventListener('geometrychange', () => {
    const h = mathVirtualKeyboard.visible ? (mathVirtualKeyboard.boundingRect?.height ?? 0) : 0;
    const root = document.documentElement;
    root.style.setProperty('--osk-h', `${Math.round(h)}px`);
    root.classList.toggle('osk-open', h > 0);
  });
}
