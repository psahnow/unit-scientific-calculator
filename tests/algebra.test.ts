// Algebraic solving and roots( ) (D51).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';
import { toNumber, type Num } from '../src/engine/num';
import type { Value } from '../src/engine/evaluate';

const r = String.raw;
function run(...lines: string[]) {
  const rows: Row[] = lines.map((latex, i) => ({ id: 'r' + i, type: 'expr', latex }));
  return evaluateWorksheet(rows, { angle: 'rad' }).rows.get('r' + (lines.length - 1))!;
}
/** "value unit", or a list "[a, b] unit", or "error: …" */
function show(...lines: string[]): string {
  const v = run(...lines);
  if (v.kind === 'error') return 'error: ' + v.message;
  if (v.kind !== 'value') return v.kind;
  const val = v.value as Value;
  if (val.t === 'q') {
    const f = formatQuantity(val.q);
    return f.unit ? `${f.value} ${f.unit}` : f.value;
  }
  const fs = (val as unknown as { items: never[] }).items.map((q) => formatQuantity(q));
  return `[${fs.map((f) => f.value).join(', ')}]` + (fs[0]?.unit ? ' ' + fs[0].unit : '');
}
function rootsOf(...lines: string[]): { si: Num[]; exact: boolean[] } {
  const v = run(...lines);
  if (v.kind !== 'value' || v.value.t !== 'list') throw new Error(JSON.stringify(v.kind === 'error' ? v.message : v.kind));
  return { si: v.value.items.map((q) => q.si), exact: v.value.items.map((q) => q.si.kind === 'exact') };
}

describe('solve( ) by algebra', () => {
  it('linear equations are exact', () => {
    expect(show(r`\operatorname{solve}\left(2x+3=7,x\right)`)).toBe('2');
    expect(show(r`\operatorname{solve}\left(3x=1,x\right)`)).toBe('1/3');
    expect(show(r`\operatorname{solve}\left(\frac{x}{4}-1=\frac{x}{6},x\right)`)).toBe('12');
  });
  it('quadratics: exact when the roots are rational; the root nearest the guess', () => {
    expect(show(r`\operatorname{solve}\left(x^2-5x+6=0,x\right)`)).toBe('2');
    expect(show(r`\operatorname{solve}\left(x^2-5x+6=0,x,10\right)`)).toBe('3');
    expect(show(r`\operatorname{solve}\left(x^2=2,x\right)`)).toBe('1.414213562');
    expect(show(r`\operatorname{solve}\left(x^2=2,x,-1\right)`)).toBe('−1.414213562');
    expect(show(r`\operatorname{solve}\left(4x^2=1,x,-5,0\right)`)).toBe('−0.5');
  });
  it('with units', () => {
    expect(show(r`\operatorname{solve}\left(\frac{1}{2}\cdot9.81\unit{m}/\unit{s}^2\cdot t^2=20\unit{m},t,1\unit{s}\right)`)).toBe('2.019275109 s');
    expect(show(r`k=200\unit{N}/\unit{m}`, r`\operatorname{solve}\left(k\cdot x=50\unit{N},x\right)`)).toBe('0.25 m');
  });
  it('no real solution', () => {
    expect(show(r`\operatorname{solve}\left(x^2=-1,x,0,10\right)`)).toMatch(/^error: .*no solution between/);
  });
  it('not a polynomial: the numeric solver as before', () => {
    expect(show(r`\operatorname{solve}\left(\cos\left(x\right)=x,x\right)`)).toBe('0.7390851332');
    expect(show(r`F=10\unit{kN}`, r`\operatorname{solve}\left(\frac{F}{A}=250\unit{MPa},A\right)`)).toBe('0.00004 m²');
  });
});

describe('roots( )', () => {
  it('every real root of a polynomial, in order, exact where rational', () => {
    expect(show(r`\operatorname{roots}\left(x^2-5x+6,x\right)`)).toBe('[2, 3]');
    expect(show(r`\operatorname{roots}\left(x^3=x,x\right)`)).toBe('[−1, 0, 1]');
    expect(show(r`\operatorname{roots}\left(x^3-6x^2+11x-6,x\right)`)).toBe('[1, 2, 3]');
    expect(show(r`\operatorname{roots}\left(2x^2-3x-2,x\right)`)).toBe('[−0.5, 2]');
    expect(show(r`\operatorname{roots}\left(x^2-2,x\right)`)).toBe('[−1.414213562, 1.414213562]');
    expect(show(r`\operatorname{roots}\left(\left(x-1\right)^2,x\right)`)).toBe('[1]');
    expect(show(r`\operatorname{roots}\left(x^5-x,x\right)`)).toBe('[−1, 0, 1]');
  });
  it('a range keeps the roots inside it', () => {
    expect(show(r`\operatorname{roots}\left(x^3=x,x,0,5\right)`)).toBe('[0, 1]');
  });
  it('with units', () => {
    expect(show(r`\operatorname{roots}\left(x^2=4\unit{m}^2,x\right)`)).toBe('[−2, 2] m');
  });
  it('typed as letters too', () => {
    expect(show(r`roots\left(x^2-1,x\right)`)).toBe('[−1, 1]');
  });
  it('nothing to solve for', () => {
    expect(show(r`\operatorname{roots}\left(5,x\right)`)).toMatch(/no x left/);
  });
  it('no real roots', () => {
    expect(show(r`\operatorname{roots}\left(x^2+1,x\right)`)).toMatch(/^error: .*no real roots/);
  });
  it('other equations need a range; poles are not roots', () => {
    expect(show(r`\operatorname{roots}\left(\sin\left(x\right),x\right)`)).toMatch(/needs a range/);
    const s = rootsOf(r`\operatorname{roots}\left(\sin\left(x\right),x,-7,7\right)`).si.map(toNumber);
    expect(s.length).toBe(5);
    [-2, -1, 0, 1, 2].forEach((k, i) => expect(s[i]).toBeCloseTo(k * Math.PI, 10));
    const t = rootsOf(r`\operatorname{roots}\left(\tan\left(x\right),x,-2,2\right)`).si.map(toNumber);
    expect(t).toEqual([0]);
  });
});

describe('roots( ) against known roots (random)', () => {
  // seeded
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  /** expand Π (x − r_i) with integer roots into LaTeX */
  const expand = (rs: number[]) => {
    let c = [1];
    for (const root of rs) {
      const next = new Array(c.length + 1).fill(0);
      c.forEach((v, k) => {
        next[k + 1] += v;
        next[k] -= root * v;
      });
      c = next;
    }
    return c
      .map((v, k) => ({ v, k }))
      .filter((t) => t.v !== 0)
      .reverse()
      .map(({ v, k }, i) => `${v < 0 ? '-' : i ? '+' : ''}${Math.abs(v) === 1 && k ? '' : Math.abs(v)}${k ? (k === 1 ? 'x' : `x^{${k}}`) : ''}`)
      .join('');
  };
  it('300 polynomials with integer roots (degree 1–6, repeats allowed): exact and complete', () => {
    for (let i = 0; i < 300; i++) {
      const rs = Array.from({ length: int(1, 6) }, () => int(-9, 9));
      const latex = expand(rs);
      const got = rootsOf(r`\operatorname{roots}\left(${latex},x\right)`);
      const want = [...new Set(rs)].sort((a, b) => a - b);
      expect(got.si.map(toNumber), latex).toEqual(want);
      expect(got.exact.every(Boolean), `${latex} exact`).toBe(true);
    }
  });
  it('300 quadratics with irrational roots match the quadratic formula', () => {
    for (let i = 0; i < 300; i++) {
      const [b, c] = [int(-20, 20), int(-50, 50)];
      const disc = b * b - 4 * c;
      if (disc <= 0 || Number.isInteger(Math.sqrt(disc))) continue;
      const latex = `x^{2}${b < 0 ? '-' : '+'}${Math.abs(b)}x${c < 0 ? '-' : '+'}${Math.abs(c)}`;
      const got = rootsOf(r`\operatorname{roots}\left(${latex},x\right)`).si.map(toNumber);
      const want = [(-b - Math.sqrt(disc)) / 2, (-b + Math.sqrt(disc)) / 2];
      got.forEach((g, k) => expect(Math.abs(g - want[k]), latex).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(want[k]))));
    }
  });
  it('200 cubics (x − a)(x² + b) with one real root and a complex pair', () => {
    for (let i = 0; i < 200; i++) {
      const [a, b] = [int(-9, 9), int(1, 9)];
      const poly = `x^{3}${a > 0 ? '-' : '+'}${Math.abs(a)}x^{2}+${b}x${a * b > 0 ? '-' : '+'}${Math.abs(a * b)}`;
      expect(rootsOf(r`\operatorname{roots}\left(${poly},x\right)`).si.map(toNumber), poly).toEqual([a]);
    }
  });
  it('200 cubics with irrational roots are found to full precision', () => {
    for (let i = 0; i < 200; i++) {
      // (x − a)(x² − b) with b not a square: roots a, ±√b
      const [a, b] = [int(-9, 9), int(2, 30)];
      if (Number.isInteger(Math.sqrt(b))) continue;
      const poly = `x^{3}${a > 0 ? '-' : '+'}${Math.abs(a)}x^{2}-${b}x${a * b > 0 ? '+' : '-'}${Math.abs(a * b)}`;
      const got = rootsOf(r`\operatorname{roots}\left(${poly},x\right)`).si.map(toNumber);
      const want = [a, -Math.sqrt(b), Math.sqrt(b)].sort((p, q) => p - q);
      expect(got.length, poly).toBe(3);
      got.forEach((g, k) => expect(Math.abs(g - want[k]), poly).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(want[k]))));
    }
  });
});
