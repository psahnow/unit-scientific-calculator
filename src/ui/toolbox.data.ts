// Function toolbox keys (DESIGN.md §3.5). Plain data, so tests can check every key evaluates.
import { CONSTANTS } from '../engine/units/constants.data';
import { toNumber } from '../engine/num';

/** Constants as keys: symbol with its subscript, value and unit in the tooltip (D35). */
const CONST_KEYS: Key[] = CONSTANTS.map((c) => {
  const [base, sub] = c.key.split('_');
  const v = toNumber(c.value);
  const shown = Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3 ? v.toExponential(6).replace(/\.?0+e/, 'e') : String(Number(v.toPrecision(10)));
  return { label: base, sub, insert: `\\const{${c.latex}}`, title: `${c.name}: ${shown} ${c.unit.replace(/\*/g, '·')}` };
});
const LOWER: [string, string, string][] = [
  ['α', 'alpha', 'alpha'], ['β', 'beta', 'beta'], ['γ', 'gamma', 'gamma (shear strain)'], ['δ', 'delta', 'delta (deflection)'],
  ['ε', 'varepsilon', 'epsilon (strain)'], ['ϵ', 'epsilon', 'lunate epsilon'], ['ζ', 'zeta', 'zeta (damping ratio)'], ['η', 'eta', 'eta (efficiency)'],
  ['θ', 'theta', 'theta (angle)'], ['ϑ', 'vartheta', 'script theta'], ['ι', 'iota', 'iota'], ['κ', 'kappa', 'kappa'],
  ['λ', 'lambda', 'lambda (wavelength)'], ['μ', 'mu', 'mu (friction, viscosity)'], ['ν', 'nu', "nu (Poisson's ratio)"], ['ξ', 'xi', 'xi'],
  ['π', 'pi', 'pi (the constant 3.14159…)'], ['ρ', 'rho', 'rho (density)'], ['σ', 'sigma', 'sigma (stress)'], ['τ', 'tau', 'tau (shear stress, torque)'],
  ['υ', 'upsilon', 'upsilon'], ['ϕ', 'phi', 'phi'], ['φ', 'varphi', 'curly phi'], ['χ', 'chi', 'chi'],
  ['ψ', 'psi', 'psi'], ['ω', 'omega', 'omega (angular velocity)'],
];
const UPPER: [string, string, string][] = [
  ['Γ', 'Gamma', 'capital gamma. Γ( ) is the gamma function'], ['Δ', 'Delta', 'capital delta (change)'], ['Θ', 'Theta', 'capital theta'],
  ['Λ', 'Lambda', 'capital lambda'], ['Ξ', 'Xi', 'capital xi'], ['Π', 'Pi', 'capital pi'], ['Σ', 'Sigma', 'capital sigma'],
  ['Υ', 'Upsilon', 'capital upsilon'], ['Φ', 'Phi', 'capital phi (flux)'], ['Ψ', 'Psi', 'capital psi'],
  ['Ω', 'Omega', 'capital omega. On its own after a number it means the ohm unit'],
];
const GREEK_KEYS: Key[] = [...LOWER, ...UPPER].map(([label, cmd, title]) => ({ label, insert: `\\${cmd}`, title: `Greek ${title}` }));

export interface Key {
  label: string;
  /** Subscript shown after the label (k_B → k with a small B). */
  sub?: string;
  /** LaTeX inserted at the caret; #0 is where the caret lands, #? are further placeholders. */
  insert: string;
  title: string;
  wide?: boolean;
}

const fn = (name: string, cmd = `\\operatorname{${name}}`) => `${cmd}\\left(#0\\right)`;
const fn2 = (name: string, cmd = `\\operatorname{${name}}`) => `${cmd}\\left(#0,#?\\right)`;

export const GROUPS: { id: string; label: string; keys: Key[]; browser?: 'units' }[] = [
  {
    id: 'trig',
    label: 'Trig',
    keys: [
      { label: 'sin', insert: fn('sin', '\\sin'), title: 'Sine. Uses the RAD/DEG mode for bare numbers; 30° works in any mode' },
      { label: 'cos', insert: fn('cos', '\\cos'), title: 'Cosine' },
      { label: 'tan', insert: fn('tan', '\\tan'), title: 'Tangent' },
      { label: 'sec', insert: fn('sec', '\\sec'), title: 'Secant, 1/cos' },
      { label: 'csc', insert: fn('csc', '\\csc'), title: 'Cosecant, 1/sin' },
      { label: 'cot', insert: fn('cot', '\\cot'), title: 'Cotangent, 1/tan' },
      { label: 'sin⁻¹', insert: fn('arcsin', '\\arcsin'), title: 'Inverse sine. Returns an angle (rad or °, per the mode)' },
      { label: 'cos⁻¹', insert: fn('arccos', '\\arccos'), title: 'Inverse cosine' },
      { label: 'tan⁻¹', insert: fn('arctan', '\\arctan'), title: 'Inverse tangent' },
      { label: 'sec⁻¹', insert: fn('arcsec'), title: 'Inverse secant' },
      { label: 'csc⁻¹', insert: fn('arccsc'), title: 'Inverse cosecant' },
      { label: 'cot⁻¹', insert: fn('arccot'), title: 'Inverse cotangent' },
      { label: 'atan2(y, x)', insert: fn2('atan2'), title: 'Angle of the point (x, y), in the right quadrant', wide: true },
      { label: 'hypot', insert: fn('hypot'), title: 'Length of the hypotenuse: hypot(3 m, 4 m) = 5 m' },
      { label: 'π', insert: '\\pi', title: 'Pi' },
      { label: '°', insert: '\\unit{\\degree}', title: 'Degree unit' },
    ],
  },
  {
    id: 'hyp',
    label: 'Hyperbolic',
    keys: [
      { label: 'sinh', insert: fn('sinh', '\\sinh'), title: 'Hyperbolic sine' },
      { label: 'cosh', insert: fn('cosh', '\\cosh'), title: 'Hyperbolic cosine' },
      { label: 'tanh', insert: fn('tanh', '\\tanh'), title: 'Hyperbolic tangent' },
      { label: 'sinh⁻¹', insert: fn('asinh'), title: 'Inverse hyperbolic sine' },
      { label: 'cosh⁻¹', insert: fn('acosh'), title: 'Inverse hyperbolic cosine (x ≥ 1)' },
      { label: 'tanh⁻¹', insert: fn('atanh'), title: 'Inverse hyperbolic tangent (−1 < x < 1)' },
    ],
  },
  {
    id: 'exp',
    label: 'Powers & logs',
    keys: [
      { label: 'x²', insert: '^{2}', title: 'Square the value before the caret' },
      { label: 'xʸ', insert: '^{#0}', title: 'Power' },
      { label: '√x', insert: '\\sqrt{#0}', title: 'Square root. Units work: √(9 m²) = 3 m' },
      { label: 'ⁿ√x', insert: '\\sqrt[#0]{#?}', title: 'n-th root' },
      { label: 'eˣ', insert: 'e^{#0}', title: 'e to the power x' },
      { label: '10ˣ', insert: '10^{#0}', title: 'Ten to the power x' },
      { label: 'ln', insert: fn('ln', '\\ln'), title: 'Natural logarithm' },
      { label: 'log', insert: fn('log', '\\log'), title: 'Base-10 logarithm' },
      { label: 'logₐ', insert: '\\log_{#0}\\left(#?\\right)', title: 'Logarithm to any base' },
      { label: 'exp', insert: fn('exp', '\\exp'), title: 'Exponential, eˣ' },
      { label: 'e', insert: 'e', title: "Euler's number" },
    ],
  },
  {
    id: 'num',
    label: 'Rounding',
    keys: [
      { label: '|x|', insert: '\\left|#0\\right|', title: 'Absolute value' },
      { label: 'round', insert: fn('round'), title: 'Round to a whole number; round(x, 2) to 2 decimals; round(L, mm) to a whole number of mm' },
      { label: 'floor', insert: fn('floor'), title: 'Round down' },
      { label: 'ceil', insert: fn('ceil'), title: 'Round up' },
      { label: 'sign', insert: fn('sign'), title: 'Sign: −1, 0 or 1' },
      { label: 'mod', insert: fn2('mod'), title: 'Remainder: mod(7, 3) = 1. Units must match' },
      { label: 'gcd', insert: fn2('gcd'), title: 'Greatest common divisor of whole numbers' },
      { label: 'lcm', insert: fn2('lcm'), title: 'Least common multiple of whole numbers' },
    ],
  },
  {
    id: 'special',
    label: 'Special',
    keys: [
      { label: 'Γ(x)', insert: '\\Gamma\\left(#0\\right)', title: 'Gamma function. Γ(n) = (n − 1)! for whole n' },
      { label: 'x!', insert: '!', title: 'Factorial of the value before the caret' },
      { label: 'nCr', insert: fn2('nCr'), title: 'Combinations: ways to choose r of n, order ignored' },
      { label: 'nPr', insert: fn2('nPr'), title: 'Permutations: ways to arrange r of n' },
      { label: 'erf', insert: fn('erf'), title: 'Error function' },
      { label: 'erfc', insert: fn('erfc'), title: 'Complementary error function, 1 − erf' },
    ],
  },
  {
    id: 'stats',
    label: 'Statistics',
    keys: [
      { label: 'mean', insert: fn('mean'), title: 'Average of a list: mean([1, 2, 3]) or of a table column' },
      { label: 'median', insert: fn('median'), title: 'Middle value of a list' },
      { label: 'stdev', insert: fn('stdev'), title: 'Sample standard deviation' },
      { label: 'var', insert: fn('var'), title: 'Sample variance' },
      { label: 'sum', insert: fn('sum'), title: 'Total of a list' },
      { label: 'count', insert: fn('count'), title: 'Number of items in a list' },
      { label: 'min', insert: fn('min', '\\min'), title: 'Smallest value' },
      { label: 'max', insert: fn('max', '\\max'), title: 'Largest value' },
      { label: '[ , ]', insert: '\\left[#0\\right]', title: 'List' },
    ],
  },
  {
    id: 'calculus',
    label: 'Calculus',
    keys: [
      { label: 'solve', insert: '\\operatorname{solve}\\left(#0=#?,x\\right)', title: 'Solve an equation for x: solve(x² = 2, x). Add a guess solve(…, x, 1) or a range solve(…, x, 0, 10). Units are worked out, e.g. solve(F/A = 250 MPa, A) gives an area', wide: true },
      { label: 'roots', insert: '\\operatorname{roots}\\left(#0,x\\right)', title: 'Every real root, as a list: roots(x³ − x, x) = [−1, 0, 1]. Polynomials are solved exactly; for other equations give a range: roots(sin(x), x, 0, 10)', wide: true },
      { label: 'ans', insert: 'ans', title: 'The answer of the row above' },
      { label: '∫ₐᵇ dx', insert: '\\int_{#0}^{#?}#?\\,\\mathrm{d}x', title: 'Definite integral. Units carry through: ∫ F dx over metres gives N·m. Limits may be ±∞', wide: true },
      { label: '∫₀^∞ dx', insert: '\\int_{0}^{\\infty}#0\\,\\mathrm{d}x', title: 'Integral from 0 to infinity', wide: true },
      { label: 'd/dx', insert: '\\frac{\\mathrm{d}}{\\mathrm{d}#?}#0', title: 'Derivative with respect to a variable you choose, taken at its current value (define it, e.g. x = 2, or use it inside a function g(x) = d/dx …)' },
      { label: 'd²/dx²', insert: '\\frac{\\mathrm{d}^2}{\\mathrm{d}#?^2}#0', title: 'Second derivative with respect to a variable you choose, at its current value' },
      { label: 'lim', insert: '\\lim_{x\\to#0}#?', title: 'Limit as x approaches a value. Write 0^+ or 0^- for one side' },
      { label: 'lim x→∞', insert: '\\lim_{x\\to\\infty}#0', title: 'Limit as x grows without bound', wide: true },
      { label: 'Σ', insert: '\\sum_{n=#0}^{#?}#?', title: 'Sum: Σ from n = a to b (whole numbers)' },
      { label: 'Π', insert: '\\prod_{n=#0}^{#?}#?', title: 'Product: Π from n = a to b (whole numbers)' },
      { label: '{ x<a: …, … }', insert: '\\left\\{x<#0:#?,#?\\right\\}', title: 'Piecewise: { condition: value, …, otherwise value }. The first true condition wins', wide: true },
      { label: '<', insert: '<', title: 'Less than (in piecewise conditions)' },
      { label: '≤', insert: '\\le', title: 'Less than or equal' },
      { label: '>', insert: '>', title: 'Greater than' },
      { label: '≥', insert: '\\ge', title: 'Greater than or equal' },
      { label: '∞', insert: '\\infty', title: 'Infinity (integral and limit bounds)' },
    ],
  },
  {
    id: 'greek',
    label: 'Greek',
    keys: [
      ...GREEK_KEYS,
    ],
  },
  { id: 'constants', label: 'Constants', keys: CONST_KEYS },
  // the Units tab is a searchable list of every unit, drawn by the Toolbox (D35)
  { id: 'units', label: 'Units', keys: [], browser: 'units' },
];
