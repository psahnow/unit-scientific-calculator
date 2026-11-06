// Function toolbox keys (DESIGN.md §3.5). Plain data, so tests can check every key evaluates.
export interface Key {
  label: string;
  /** LaTeX inserted at the caret; #0 is where the caret lands, #? are further placeholders. */
  insert: string;
  title: string;
  wide?: boolean;
}

const fn = (name: string, cmd = `\\operatorname{${name}}`) => `${cmd}\\left(#0\\right)`;
const fn2 = (name: string, cmd = `\\operatorname{${name}}`) => `${cmd}\\left(#0,#?\\right)`;

export const GROUPS: { id: string; label: string; keys: Key[] }[] = [
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
];

