// Number and quantity formatting (DESIGN.md §3.3).
import * as N from './num';
import type { Num } from './num';
import { type Quantity, displayValue } from './quantity';
import { formatUnit, superscript } from './units/registry';
import { dimEq, DIMLESS } from './dim';

export type Notation = 'auto' | 'scientific' | 'engineering';
export type DisplayMode = 'auto' | 'decimal' | 'fraction';

export interface FormatOptions {
  sigFigs: number;
  notation: Notation;
  mode: DisplayMode;
  /** Auto notation switches to ×10ⁿ at |x| ≥ 10^sciAbove (default 12; 21 = effectively never). */
  sciAbove?: number;
}

export const DEFAULT_FORMAT: FormatOptions = { sigFigs: 10, notation: 'auto', mode: 'auto' };

function terminates(d: bigint): boolean {
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}

/** Whether this exact value has a meaningful fraction form. */
export function hasFractionForm(n: Num): boolean {
  return n.kind === 'exact' && n.d !== 1n && n.d <= 1000000n;
}

export function formatNum(n: Num, o: FormatOptions = DEFAULT_FORMAT): string {
  if (n.kind === 'exact') {
    const wantFraction =
      o.mode === 'fraction' ? hasFractionForm(n) : o.mode === 'auto' && n.d !== 1n && n.d <= 1000n && !terminates(n.d);
    if (wantFraction) return `${n.n < 0n ? '−' : ''}${n.n < 0n ? -n.n : n.n}/${n.d}`;
    if (n.d === 1n) {
      const s = (n.n < 0n ? -n.n : n.n).toString();
      const above = o.sciAbove ?? 12;
      // a whole number with more digits than the significant figures is rounded like any other (D59)
      if (o.notation === 'auto' && s.length <= above && s.replace(/0+$/, '').length <= o.sigFigs)
        return (n.n < 0n ? '−' : '') + s;
    }
  }
  return formatFloat(N.toNumber(n), o);
}

export function formatFloat(x: number, o: FormatOptions): string {
  if (Number.isNaN(x)) return 'undefined';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  if (x === 0) return '0';
  const sign = x < 0 ? '−' : '';
  const ax = Math.abs(x);
  let exp = Math.floor(Math.log10(ax));
  // guard against rounding pushing to the next decade
  const rounded = Number(ax.toPrecision(o.sigFigs));
  exp = Math.floor(Math.log10(rounded));
  const useSci = o.notation !== 'auto' || rounded >= Math.pow(10, o.sciAbove ?? 12) || ax < 1e-6;
  if (!useSci) return sign + trimZeros(rounded.toPrecision(o.sigFigs), true);
  if (o.notation === 'engineering') exp = Math.floor(exp / 3) * 3;
  const mant = rounded / Math.pow(10, exp);
  let m = trimZeros(Number(mant.toPrecision(o.sigFigs)).toPrecision(o.sigFigs), true);
  if (o.notation === 'engineering') m = trimZeros(String(Number(mant.toPrecision(o.sigFigs))), false);
  return exp === 0 ? sign + m : `${sign}${m}×10${superscript(exp)}`;
}

function trimZeros(s: string, expand: boolean): string {
  if (expand && /e/.test(s)) s = Number(s).toString();
  if (s.includes('.') && !/e/.test(s)) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function formatQuantity(q: Quantity, o: FormatOptions = DEFAULT_FORMAT): { value: string; unit: string; raw: Num } {
  const raw = displayValue(q);
  // automatic fractions only for plain numbers (1/3); with units, decimals read better
  // (3 ft + 1 m = 6.28 ft, not 2393/381 ft). The a/b switch still offers the fraction (D59).
  const mode = o.mode === 'auto' && (q.unit.length > 0 || !dimEq(q.dim, DIMLESS)) ? 'decimal' : o.mode;
  return { value: formatNum(raw, { ...o, mode }), unit: formatUnit(q.unit), raw };
}

// ── Vectors, complex numbers and lists (D63) ─────────────────────────────────

/** How a vector or complex answer is written: the row's switch picks the other form (D63). */
export interface ValueView {
  /** Vectors as 3î + 4ĵ (not (3, 4)); complex numbers in polar form 5∠53.13° (not 3 + 4i). */
  alt?: boolean;
  angle?: 'rad' | 'deg';
  /** The letter for √−1. */
  imag?: 'i' | 'j';
}

type AnyValue =
  | { t: 'q'; q: Quantity }
  | { t: 'list'; items: Quantity[] }
  | { t: 'vec'; items: Quantity[] }
  | { t: 'cx'; re: Quantity; im: Quantity };

const BASIS = ['î', 'ĵ', 'k̂'];
const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n: number) => String(n).replace(/[0-9]/g, (d) => SUB_DIGITS[Number(d)]);

/** Terms like 3î, −ĵ, 2.5e₄ joined with + and −; zero terms left out. */
function joinTerms(terms: [string, string][]): string {
  const kept = terms.filter(([c]) => c !== '0');
  if (!kept.length) return '0';
  return kept
    .map(([c, sym], i) => {
      const neg = c.startsWith('−');
      const mag = neg ? c.slice(1) : c;
      const body = (mag === '1' && sym ? '' : mag) + sym;
      if (i === 0) return (neg ? '−' : '') + body;
      return (neg ? ' − ' : ' + ') + body;
    })
    .join('');
}

/** Any answer as text: the number part and its unit (shown on the unit button). */
export function formatValue(v: AnyValue, o: FormatOptions, view: ValueView = {}): { value: string; unit: string } {
  if (v.t === 'q') {
    const f = formatQuantity(v.q, o);
    return { value: f.value, unit: f.unit };
  }
  if (v.t === 'list') {
    return { value: '[' + v.items.map((x) => formatQuantity(x, o).value).join(', ') + ']', unit: v.items[0] ? formatUnit(v.items[0].unit) : '' };
  }
  if (v.t === 'vec') {
    const unit = v.items[0] ? formatUnit(v.items[0].unit) : '';
    const parts = v.items.map((x) => formatQuantity(x, o).value);
    if (!view.alt) return { value: '(' + parts.join(', ') + ')', unit };
    const syms = parts.map((_, i) => (parts.length <= 3 ? BASIS[i] : 'e' + sub(i + 1)));
    const text = joinTerms(parts.map((p, i) => [p, syms[i]]));
    return { value: unit && /[+−]/.test(text.slice(1)) ? `(${text})` : text, unit };
  }
  const unit = formatUnit(v.re.unit);
  const letter = view.imag ?? 'i';
  if (view.alt) {
    // polar: |z| ∠ angle, the angle following RAD/DEG
    // both parts are in the same unit, so the size and angle can be read off the shown numbers
    const re = N.toNumber(displayValue(v.re));
    const im = N.toNumber(displayValue(v.im));
    const r = Math.hypot(re, im);
    const th = Math.atan2(im, re);
    const ang = view.angle === 'deg' ? `${formatFloat((th * 180) / Math.PI, o)}°` : `${formatFloat(th, o)} rad`;
    return { value: `${formatFloat(r, o)}∠${ang}`, unit };
  }
  const re = formatQuantity(v.re, o).value;
  const im = formatQuantity(v.im, o).value;
  const text = joinTerms([
    [re, ''],
    [im, letter],
  ]);
  return { value: unit && /[+−]/.test(text.slice(1)) ? `(${text})` : text, unit };
}
