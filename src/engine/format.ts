// Number and quantity formatting (DESIGN.md §3.3).
import * as N from './num';
import type { Num } from './num';
import { type Quantity, displayValue } from './quantity';
import { formatUnit, superscript } from './units/registry';

export type Notation = 'auto' | 'scientific' | 'engineering';
export type DisplayMode = 'auto' | 'decimal' | 'fraction';

export interface FormatOptions {
  sigFigs: number;
  notation: Notation;
  mode: DisplayMode;
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
      if (s.length <= Math.max(o.sigFigs, 12) && o.notation !== 'scientific' && o.notation !== 'engineering')
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
  const useSci = o.notation !== 'auto' || ax >= 1e12 || ax < 1e-6;
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
  return { value: formatNum(raw, o), unit: formatUnit(q.unit), raw };
}
