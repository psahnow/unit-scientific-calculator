// The on-screen maths keyboard for touch devices (D40): only things Dimensional understands, in
// four tabs — numbers, units, functions and Greek — plus MathLive's letters.
import type { VirtualKeyboardLayout, VirtualKeyboardKeycap } from 'mathlive';

type Key = string | Partial<VirtualKeyboardKeycap>;

/** A unit chip; "mm^2" becomes the chip mm with a power, the way typed units are stored. */
const unit = (sym: string, latex = sym, tooltip?: string): Key => {
  const [base, pow] = latex.split('^');
  return { label: sym, insert: `\\unit{${base}}` + (pow ? `^{${pow}}` : ''), class: 'small', tooltip: tooltip ?? sym };
};
const fn = (label: string, insert: string, tooltip: string, extra: Partial<VirtualKeyboardKeycap> = {}): Key => ({ label, insert, class: 'small', tooltip, ...extra });
const op = (name: string, cmd = `\\operatorname{${name}}`) => `${cmd}\\left(#0\\right)`;

/** The same row end on every tab: move, delete, new row. */
const NAV: Key[] = ['[left]', '[right]', '[backspace]', { ...({} as Partial<VirtualKeyboardKeycap>), label: '↵', class: 'action', command: 'performWithFeedback(commit)', width: 1.5, tooltip: 'New row' }];

const NUMBERS: VirtualKeyboardLayout = {
  id: 'dim-numbers',
  label: '123',
  tooltip: 'Numbers',
  rows: [
    ['[7]', '[8]', '[9]', '[/]', '[separator-5]', '[(]', '[)]', { latex: '\\sqrt{#0}', tooltip: 'Square root' }, { latex: '#@^{2}', tooltip: 'Square' }, { latex: '#@^{#?}', tooltip: 'Power' }],
    ['[4]', '[5]', '[6]', '[*]', '[separator-5]', { latex: '\\pi', tooltip: 'π' }, { label: 'e', insert: 'e', tooltip: "Euler's number" }, fn('×10ⁿ', '\\cdot10^{#0}', 'Times ten to the power'), fn('%', '\\%', 'Percent'), { latex: '\\left|#0\\right|', tooltip: 'Absolute value' }],
    ['[1]', '[2]', '[3]', '[-]', '[separator-5]', '[=]', fn('x₁', '_{#0}', 'Subscript, as in F₁'), fn(',', ',', 'Comma (lists, function inputs)'), fn('ans', 'ans', 'The answer of the row above'), fn('°', '\\unit{\\degree}', 'Degrees')],
    ['[0]', '[.]', fn('f(x)', '#@\\left(#0\\right)', 'Brackets after a name: f(x)'), '[+]', '[separator-5]', ...NAV],
  ],
};

const UNITS: VirtualKeyboardLayout = {
  id: 'dim-units',
  label: 'm kg',
  tooltip: 'Units',
  rows: [
    [unit('mm'), unit('cm'), unit('m'), unit('km'), unit('in'), unit('ft'), unit('yd'), unit('mi'), unit('mm²', 'mm^2'), unit('m²', 'm^2')],
    [unit('g'), unit('kg'), unit('t'), unit('lbm'), unit('N'), unit('kN'), unit('lbf'), unit('L'), unit('gal'), unit('m³', 'm^3')],
    [unit('Pa'), unit('kPa'), unit('MPa'), unit('GPa'), unit('psi'), unit('bar'), unit('J'), unit('kJ'), unit('W'), unit('kW')],
    [unit('s'), unit('min'), unit('h'), unit('Hz'), unit('°C', '\\degree C'), unit('°F', '\\degree F'), unit('K'), unit('Δ°C', '\\Delta\\degree C', 'Temperature difference'), unit('rad'), unit('°', '\\degree')],
    [unit('V'), unit('A'), unit('Ω', '\\Omega'), unit('hp'), unit('mph'), '[separator-5]', ...NAV],
  ],
};

const FUNCTIONS: VirtualKeyboardLayout = {
  id: 'dim-functions',
  label: 'ƒ(x)',
  tooltip: 'Functions',
  rows: [
    [fn('sin', op('sin', '\\sin'), 'Sine'), fn('cos', op('cos', '\\cos'), 'Cosine'), fn('tan', op('tan', '\\tan'), 'Tangent'), fn('ln', op('ln', '\\ln'), 'Natural log'), fn('log', op('log', '\\log'), 'Log base 10'), fn('eˣ', 'e^{#0}', 'e to the power'), fn('10ˣ', '10^{#0}', 'Ten to the power'), fn('ⁿ√', '\\sqrt[#0]{#?}', 'n-th root')],
    [fn('sin⁻¹', op('arcsin', '\\arcsin'), 'Inverse sine'), fn('cos⁻¹', op('arccos', '\\arccos'), 'Inverse cosine'), fn('tan⁻¹', op('arctan', '\\arctan'), 'Inverse tangent'), fn('n!', '!', 'Factorial'), fn('Γ', '\\Gamma\\left(#0\\right)', 'Gamma function'), fn('round', op('round'), 'Round'), fn('min', op('min', '\\min'), 'Smallest'), fn('max', op('max', '\\max'), 'Largest')],
    [fn('∫', '\\int_{#0}^{#?}#?\\,\\mathrm{d}x', 'Definite integral'), fn('d/dx', '\\frac{\\mathrm{d}}{\\mathrm{d}x}#0', 'Derivative at the current x'), fn('lim', '\\lim_{x\\to#0}#?', 'Limit'), fn('Σ', '\\sum_{n=#0}^{#?}#?', 'Sum'), fn('Π', '\\prod_{n=#0}^{#?}#?', 'Product'), fn('solve', '\\operatorname{solve}\\left(#0=#?,x\\right)', 'Solve an equation for x'), fn('mean', op('mean'), 'Average of a list'), fn('[ ]', '\\left[#0\\right]', 'List')],
    [fn('{ : }', '\\left\\{x<#0:#?,#?\\right\\}', 'Piecewise'), fn('<', '<', 'Less than'), fn('≤', '\\le', 'Less or equal'), fn('>', '>', 'Greater than'), fn('≥', '\\ge', 'Greater or equal'), fn('∞', '\\infty', 'Infinity'), '[separator-5]', ...NAV],
  ],
};

const GREEK: VirtualKeyboardLayout = {
  id: 'dim-greek',
  label: 'αβγ',
  tooltip: 'Greek letters',
  rows: [
    ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\varepsilon', '\\zeta', '\\eta', '\\theta', '\\lambda', '\\mu'].map((l) => ({ latex: l })),
    ['\\nu', '\\xi', '\\rho', '\\sigma', '\\tau', '\\phi', '\\chi', '\\psi', '\\omega', '\\kappa'].map((l) => ({ latex: l })),
    ['\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Sigma', '\\Phi', '\\Psi', '\\Omega'].map((l) => ({ latex: l })).concat([fn('x₁', '_{#0}', 'Subscript') as { latex: string }]),
    [fn('=', '=', 'Equals'), '[separator-5]', ...NAV],
  ],
};

export const DIMENSIONAL_LAYOUTS: (VirtualKeyboardLayout | 'alphabetic')[] = [NUMBERS, UNITS, FUNCTIONS, 'alphabetic', GREEK];

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
