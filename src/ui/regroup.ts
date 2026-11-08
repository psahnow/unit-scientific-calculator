// How a division by a unit or by a value is grouped while typing (D66). Pure text rules, so they
// are unit-tested; MathInput applies them live to the fraction being edited.
//
//   6 m / s     → 6 (m/s)       a unit per unit: the number stays outside      6\frac{\unit{m}}{\unit{s}}
//   6 m / 3 s   → (6 m)/(3 s)   a value over a value: the quantity goes on top  \frac{6\unit{m}}{3\unit{s}}
//
// Only "number + units" moves (2·6 m / 3 s → 2·(6 m)/(3 s)). The answer is the same either way;
// only the layout changes.
import { latexToSymbol } from '../engine/latex';

const CHIPS = String.raw`(?:\\(?:unit|const)\{(?:[^{}]|\{[^{}]*\})*\}(?:\^\{[^{}]*\}|\^[0-9])?)+`;
const NUM = String.raw`[0-9]+(?:\.[0-9]+)?`;

/** The text of a {…} group starting at `open` (the index of "{"), and the index after its "}". */
function group(s: string, open: number): [string, number] | null {
  if (s[open] !== '{') return null;
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '\\') {
      k++;
      continue;
    }
    if (s[k] === '{') depth++;
    else if (s[k] === '}' && --depth === 0) return [s.slice(open + 1, k), k + 1];
  }
  return null;
}

/**
 * Whether a denominator is a value (a number, a constant, brackets, or a name you defined) rather
 * than units alone. Letters that aren't a defined name are taken as units still being typed (k → kg),
 * so the grouping doesn't flip while you type them.
 */
export function isValueDenominator(den: string, vars: readonly string[]): boolean {
  if (/\\const\{/.test(den)) return true;
  const rest = den.replace(new RegExp(CHIPS, 'g'), ' ');
  if (/[0-9]/.test(rest) || /\\left\(|\(/.test(rest)) return true;
  const names = rest.matchAll(/(\\[A-Za-z]+|[A-Za-z])(?:_\{([^{}]*)\}|_([A-Za-z0-9]))?/g);
  for (const m of names) {
    if (/^\\(left|right|cdot|times|placeholder)$/.test(m[1])) continue;
    const sub = m[2] ?? m[3];
    const name = latexToSymbol(m[1]) + (sub ? '_' + sub : '');
    if (vars.includes(name)) return true;
  }
  return false;
}

export interface Regroup {
  /** Where the rewritten text starts and ends in the row's LaTeX. */
  s: number;
  e: number;
  latex: string;
  /** 'up': the quantity moves on top; 'down': it moves back out. */
  dir: 'up' | 'down';
  /** The quantity that moves, as it reads on top (6\unit{m}): how a field remembers the fractions it moved. */
  quantity: string;
  /** The denominator, unchanged by the move. */
  den: string;
}

/**
 * Every fraction in a row whose grouping should change: `6\frac{m}{3 s}` → `\frac{6 m}{3 s}`, and
 * back (`\frac{6 m}{s}` → `6\frac{m}{s}`) for a fraction this field regrouped and whose denominator
 * is units again. `ours` tells which fractions the field moved a number into, by their numerator.
 */
export function regroups(latex: string, vars: readonly string[], ours: (numerator: string) => boolean): Regroup[] {
  const out: Regroup[] = [];
  const frac = /\\frac\{/g;
  for (let m = frac.exec(latex); m; m = frac.exec(latex)) {
    const at = m.index;
    const num = group(latex, at + 5);
    if (!num) continue;
    const den = group(latex, num[1]);
    if (!den) continue;
    const end = den[1];
    const value = isValueDenominator(den[0], vars);
    // 6\frac{units}{value} → \frac{6 units}{value}
    const head = latex.slice(0, at);
    const before = new RegExp(`(${NUM})$`).exec(head);
    // the number must stand on its own: not the end of a longer number, a subscript or a name (x_{6}, a6),
    // though a command like \cdot may come right before it
    const lead = before ? head.slice(0, head.length - before[1].length) : '';
    const standsAlone = !!before && !/[0-9.}]$/.test(lead) && (!/[A-Za-z]$/.test(lead) || /\\[A-Za-z]+$/.test(lead));
    if (value && standsAlone && new RegExp(`^${CHIPS}$`).test(num[0])) {
      out.push({
        s: at - before[1].length,
        e: end,
        latex: `\\frac{${before[1]}${num[0]}}{${den[0]}}`,
        dir: 'up',
        quantity: before[1] + num[0],
        den: den[0],
      });
      continue;
    }
    // \frac{6 units}{units} → 6\frac{units}{units}, only for a fraction this field regrouped
    const inner = new RegExp(`^(${NUM})(${CHIPS})$`).exec(num[0]);
    if (!value && inner && ours(num[0]))
      out.push({ s: at, e: end, latex: `${inner[1]}\\frac{${inner[2]}}{${den[0]}}`, dir: 'down', quantity: num[0], den: den[0] });
  }
  return out;
}
