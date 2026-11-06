// Correctness suite (D43): every number the calculator shows is checked against an oracle that does
// not share code with the engine — published reference values (NIST SP 811, CODATA 2022), closed
// forms, identities, or plain JavaScript floating point — over thousands of seeded random cases.
// A new unit or constant fails here until its reference value is added below.
//
//   FUZZ_N=5000 FUZZ_SEED=123 npx vitest run tests/correctness.test.ts   (a deeper run)
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatFloat, formatQuantity, type FormatOptions } from '../src/engine/format';
import { UNITS, SI_PREFIXES, BINARY_PREFIXES } from '../src/engine/units/units.data';
import { CONSTANTS } from '../src/engine/units/constants.data';
import { symbolToLatex } from '../src/engine/latex';
import { lookupUnit } from '../src/engine/units/registry';
import { toNumber, type Num } from '../src/engine/num';
import { DIM_KEYS, type Dim } from '../src/engine/dim';
import type { Quantity } from '../src/engine/quantity';

const r = String.raw;
declare const process: { env: Record<string, string | undefined> };
const N_CASES = Number(process.env.FUZZ_N ?? 400);
const SEED = Number(process.env.FUZZ_SEED ?? 20261106);

// ── seeded randomness (mulberry32) ──────────────────────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  /** A decimal string with a few significant digits over a wide range, e.g. "-0.00342" or "81250". */
  const dec = (minExp = -4, maxExp = 6, signed = true) => {
    const digits = String(int(1, 999999)).replace(/0+$/, '') || '1';
    const exp = int(minExp, maxExp);
    const v = Number(digits) * Math.pow(10, exp - (digits.length - 1));
    const s = toPlain(v);
    return signed && next() < 0.3 ? '-' + s : s;
  };
  return { next, int, pick, dec };
}
/** A number as a plain decimal string (no exponent), exactly as typed. */
function toPlain(v: number): string {
  const s = v.toPrecision(15);
  return String(Number(s)).includes('e') ? Number(s).toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : String(Number(s));
}

// ── running the engine ──────────────────────────────────────────────────────────────────────────
type Line = string | { latex: string; unit?: string };
function evalLast(lines: Line[], angle: 'rad' | 'deg' = 'rad'): { q: Quantity; raw: number } | { error: string } {
  const rows: Row[] = lines.map((l, i) =>
    typeof l === 'string' ? { id: 'r' + i, type: 'expr', latex: l } : { id: 'r' + i, type: 'expr', latex: l.latex, displayUnit: l.unit },
  );
  const res = evaluateWorksheet(rows, { angle }).rows.get('r' + (lines.length - 1));
  if (!res) return { error: 'no result' };
  if (res.kind === 'error') return { error: res.message };
  if (res.kind !== 'value' || res.value.t !== 'q') return { error: 'not a single value: ' + res.kind };
  // a display unit that can't be used is reported, never silently replaced
  if (res.unitError) return { error: 'display unit: ' + res.unitError };
  return { q: res.value.q, raw: toNumber(formatQuantity(res.value.q).raw) };
}
function value(lines: Line[] | Line, angle: 'rad' | 'deg' = 'rad'): number {
  const out = evalLast(Array.isArray(lines) ? lines : [lines], angle);
  if ('error' in out) throw new Error(`${JSON.stringify(lines)} → error: ${out.error}`);
  return out.raw;
}
function isError(lines: Line[] | Line): boolean {
  return 'error' in evalLast(Array.isArray(lines) ? lines : [lines]);
}
const u = (id: string) => r`\unit{${symbolToLatex(id)}}`;
const paren = (s: string) => r`\left(${s}\right)`;
/** Numbers as typed in LaTeX: negatives in brackets so they compose safely. */
const lit = (s: string) => (s.startsWith('-') ? paren(s) : s);

/** |a − b| within a relative tolerance (with an absolute floor for values near zero). */
function close(actual: number, expected: number, rel = 1e-12, abs = 1e-300): boolean {
  if (Number.isNaN(expected)) return Number.isNaN(actual);
  if (!Number.isFinite(expected)) return actual === expected;
  return Math.abs(actual - expected) <= Math.max(rel * Math.abs(expected), abs);
}
function expectClose(actual: number, expected: number, what: string, rel = 1e-12, abs = 1e-300) {
  if (!close(actual, expected, rel, abs))
    throw new Error(`${what}: got ${actual}, expected ${expected} (rel. error ${Math.abs(actual - expected) / Math.abs(expected)})`);
}

/**
 * The display contract for numeric results: the number shown is right to within one unit of its
 * last digit (never finer than 10 significant figures), and shows at least 6 significant digits.
 */
function expectShownRight(lines: Line[], want: number, what: string, angle: 'rad' | 'deg' = 'rad', scale = 0) {
  const out = evalLast(lines, angle);
  if ('error' in out) throw new Error(`${what}: ${out.error}`);
  const s = formatQuantity(out.q).value.replace(/−/g, '-');
  if (/×10/.test(s)) throw new Error(`${what}: unexpected scientific notation ${s}`);
  const decimals = /\.(\d+)/.exec(s)?.[1].length ?? 0;
  const lastDigit = Math.max(Math.pow(10, -decimals), Math.pow(10, Math.floor(Math.log10(Math.abs(want) || 1)) - 9));
  const unit = Math.min(lastDigit, Math.max(1e-6 * Math.max(Math.abs(want), scale), 1e-12));
  expectClose(Number(s), want, `${what} shown as ${s}`, 0, Math.max(unit, 1e-12));
}

// ── reference data, written independently of the catalogue ──────────────────────────────────────
/** Dimension shorthand: "M L T-2" → {M:1, L:1, T:-2}. */
function D(spec: string): Dim {
  const d = Object.fromEntries(DIM_KEYS.map((k) => [k, 0])) as Dim;
  for (const part of spec.split(/\s+/).filter(Boolean)) {
    const m = /^([LMTIKNJA])(-?\d+)?$/.exec(part)!;
    d[m[1] as keyof Dim] = m[2] ? Number(m[2]) : 1;
  }
  return d;
}
const PI = Math.PI;
/** Value of one of each unit in SI coherent units (NIST SP 811 Appendix B; CODATA 2022). */
const REF: Record<string, [number, string, number?]> = {
  // SI base and coherent derived
  m: [1, 'L'], g: [1e-3, 'M'], s: [1, 'T'], A: [1, 'I'], K: [1, 'K'], mol: [1, 'N'], cd: [1, 'J'], rad: [1, 'A'],
  N: [1, 'M L T-2'], Pa: [1, 'M L-1 T-2'], J: [1, 'M L2 T-2'], W: [1, 'M L2 T-3'], Hz: [1, 'T-1'], C: [1, 'I T'],
  V: [1, 'M L2 T-3 I-1'], Ω: [1, 'M L2 T-3 I-2'], S: [1, 'M-1 L-2 T3 I2'], F: [1, 'M-1 L-2 T4 I2'], H: [1, 'M L2 T-2 I-2'],
  Wb: [1, 'M L2 T-2 I-1'], T: [1, 'M T-2 I-1'], lm: [1, 'J'], lx: [1, 'J L-2'],
  // length
  in: [0.0254, 'L'], ft: [0.3048, 'L'], yd: [0.9144, 'L'], mi: [1609.344, 'L'], nmi: [1852, 'L'], mil: [2.54e-5, 'L'],
  µin: [2.54e-8, 'L'], Å: [1e-10, 'L'], au: [149597870700, 'L'], ly: [9460730472580800, 'L'], pc: [3.0856775814913673e16, 'L'],
  // area
  ha: [1e4, 'L2'], acre: [4046.8564224, 'L2'], cmil: [5.067074790974977e-10, 'L2'], b: [1e-28, 'L2'],
  // volume
  L: [1e-3, 'L3'], cc: [1e-6, 'L3'], gal: [3.785411784e-3, 'L3'], qt: [9.46352946e-4, 'L3'], pt: [4.73176473e-4, 'L3'],
  cup: [2.365882365e-4, 'L3'], floz: [2.95735295625e-5, 'L3'], tbsp: [1.478676478125e-5, 'L3'], tsp: [4.92892159375e-6, 'L3'],
  bbl: [0.158987294928, 'L3'], gal_UK: [4.54609e-3, 'L3'], pt_UK: [5.6826125e-4, 'L3'], floz_UK: [2.84130625e-5, 'L3'],
  // mass
  t: [1000, 'M'], lbm: [0.45359237, 'M'], oz: [0.028349523125, 'M'], gr: [6.479891e-5, 'M'], slug: [14.593902937206364, 'M'],
  ton: [907.18474, 'M'], ton_UK: [1016.0469088, 'M'], Da: [1.66053906892e-27, 'M'],
  // time
  min: [60, 'T'], h: [3600, 'T'], d: [86400, 'T'], wk: [604800, 'T'], yr: [31557600, 'T'],
  // force
  lbf: [4.4482216152605, 'M L T-2'], kip: [4448.2216152605, 'M L T-2'], ozf: [0.27801385095378125, 'M L T-2'],
  kgf: [9.80665, 'M L T-2'], tonf: [8896.443230521, 'M L T-2'], pdl: [0.138254954376, 'M L T-2'], dyn: [1e-5, 'M L T-2'],
  // pressure
  bar: [1e5, 'M L-1 T-2'], atm: [101325, 'M L-1 T-2'], psi: [6894.757293168361, 'M L-1 T-2'], ksi: [6894757.293168361, 'M L-1 T-2'],
  psf: [47.88025898033584, 'M L-1 T-2'], mmHg: [133.322387415, 'M L-1 T-2'], inHg: [3386.389, 'M L-1 T-2'],
  inH2O: [249.08891, 'M L-1 T-2'], Torr: [133.32236842105263, 'M L-1 T-2'],
  // energy, power
  Wh: [3600, 'M L2 T-2'], cal: [4.184, 'M L2 T-2'], BTU: [1055.05585262, 'M L2 T-2'], thm: [105480400, 'M L2 T-2'],
  eV: [1.602176634e-19, 'M L2 T-2'], erg: [1e-7, 'M L2 T-2'],
  hp: [745.6998715822702, 'M L2 T-3'], hp_M: [735.49875, 'M L2 T-3'], TR: [3516.8528420666667, 'M L2 T-3'],
  VA: [1, 'M L2 T-3'], VAr: [1, 'M L2 T-3'],
  // motion
  mph: [0.44704, 'L T-1'], kn: [1852 / 3600, 'L T-1'], Gal: [0.01, 'L T-2'],
  // temperature (offset in K as the third entry)
  '°C': [1, 'K', 273.15], '°F': [5 / 9, 'K', 255.37222222222223], '°R': [5 / 9, 'K'], 'Δ°C': [1, 'K'], 'Δ°F': [5 / 9, 'K'],
  // angle, rotation
  '°': [PI / 180, 'A'], '′': [PI / 10800, 'A'], '″': [PI / 648000, 'A'], grad: [PI / 200, 'A'], rev: [2 * PI, 'A'],
  rpm: [0.10471975511965977, 'A T-1'],
  // electrical, flow, viscosity, radiation, chemistry
  Ah: [3600, 'I T'], Gs: [1e-4, 'M T-2 I-1'], gpm: [6.30901964e-5, 'L3 T-1'], cfm: [4.719474432e-4, 'L3 T-1'],
  P: [0.1, 'M L-1 T-1'], St: [1e-4, 'L2 T-1'], Gy: [1, 'L2 T-2'], Sv: [1, 'L2 T-2'], Bq: [1, 'T-1'], Ci: [3.7e10, 'T-1'],
  M: [1000, 'N L-3'], kat: [1, 'N T-1'],
  // data and ratios
  bit: [1, ''], B: [8, ''], '%': [0.01, ''], '‰': [0.001, ''], ppm: [1e-6, ''], µε: [1e-6, ''],
};
const PREFIX_REF: Record<string, number> = {
  Q: 1e30, R: 1e27, Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, µ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24, r: 1e-27, q: 1e-30,
  Ki: 1024, Mi: 1048576, Gi: 1073741824, Ti: 1099511627776,
};
/** SI value of one of a unit symbol, prefixed or not (kg, MPa, KiB…), from the reference tables. */
function refFactor(id: string): number {
  if (REF[id]) return REF[id][0];
  for (const [p, f] of Object.entries(PREFIX_REF)) if (id.startsWith(p) && REF[id.slice(p.length)]) return f * REF[id.slice(p.length)][0];
  throw new Error('no reference for unit ' + id);
}
function refDim(id: string): Dim {
  if (REF[id]) return D(REF[id][1]);
  for (const p of Object.keys(PREFIX_REF)) if (id.startsWith(p) && REF[id.slice(p.length)]) return D(REF[id.slice(p.length)][1]);
  throw new Error('no reference for unit ' + id);
}
/** SI factor of a whole display unit (kN·m/s²…) from the references. */
const refUnitFactor = (unit: { id: string; power: number }[]) => unit.reduce((f, t) => f * Math.pow(refFactor(t.id), t.power), 1);
const dimTimes = (a: Dim, b: Dim, p = 1) => Object.fromEntries(DIM_KEYS.map((k) => [k, a[k] + p * b[k]])) as Dim;
const dimStr = (d: Dim) => DIM_KEYS.filter((k) => Math.abs(d[k]) > 1e-9).map((k) => k + d[k]).join(' ');

const CATALOGUE = UNITS.filter((x) => !x.prefixOf);
const ABSOLUTE_TEMPS = new Set(['°C', '°F']);
const LINEAR = CATALOGUE.filter((x) => !ABSOLUTE_TEMPS.has(x.id));
const PREFIXABLE = CATALOGUE.filter((x) => x.prefixable);

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('unit catalogue against NIST / CODATA reference values', () => {
  it('every unit has a reference entry, the same SI factor and the same dimension', () => {
    for (const def of CATALOGUE) {
      expect(REF[def.id], `reference value for ${def.id}`).toBeDefined();
      const [f, dimSpec, offset] = REF[def.id];
      expectClose(toNumber(def.factor), f, `factor of ${def.id}`, 1e-13);
      expect(dimStr(def.dim), `dimension of ${def.id}`).toBe(dimStr(D(dimSpec)));
      expectClose(def.offset ? toNumber(def.offset) : 0, offset ?? 0, `offset of ${def.id}`, 1e-13);
    }
  });
  it('every prefix is the exact power it names', () => {
    for (const [p, f] of [...SI_PREFIXES, ...BINARY_PREFIXES]) {
      expect(f.kind, p).toBe('exact');
      expectClose(toNumber(f), PREFIX_REF[p], p, 1e-15);
    }
    expect(SI_PREFIXES.length + BINARY_PREFIXES.length).toBe(Object.keys(PREFIX_REF).length);
  });
  it('exact definitions stay exact (no floating-point drift in the catalogue)', () => {
    for (const id of ['in', 'ft', 'mi', 'lbm', 'lbf', 'psi', 'gal', 'acre', 'BTU', 'hp', 'slug', 'Torr', 'kn', 'mph']) {
      const def = UNITS.find((x) => x.id === id)!;
      expect(def.factor.kind, id).toBe('exact');
    }
  });
});

describe('conversions through the whole pipeline (typed LaTeX → result → display unit)', () => {
  it('one of every unit, shown in the SI unit, is its reference value', () => {
    for (const def of LINEAR) {
      const si = evalLast([{ latex: '1' + u(def.id) }]);
      if ('error' in si) throw new Error(def.id + ': ' + si.error);
      expectClose(toNumber(si.q.si), REF[def.id][0], `1 ${def.id} in SI`, 1e-12);
      expect(dimStr(si.q.dim), def.id).toBe(dimStr(D(REF[def.id][1])));
      expectClose(si.raw, 1, `1 ${def.id} displays as 1 ${def.id}`, 1e-13);
    }
  });
  it(`${N_CASES} random values converted between random units of the same dimension`, () => {
    const R = rng(SEED);
    const byDim = new Map<string, typeof LINEAR>();
    for (const def of LINEAR) byDim.set(dimStr(def.dim), [...(byDim.get(dimStr(def.dim)) ?? []), def]);
    const groups = [...byDim.values()].filter((g) => g.length > 1);
    for (let i = 0; i < N_CASES; i++) {
      const g = R.pick(groups);
      const a = R.pick(g), b = R.pick(g);
      const v = R.dec();
      const got = value({ latex: lit(v) + u(a.id), unit: b.id });
      expectClose(got, (Number(v) * REF[a.id][0]) / REF[b.id][0], `${v} ${a.id} → ${b.id}`, 1e-12);
    }
  });
  it(`${N_CASES} random prefixed units (k, M, µ, Ki…) convert by their exact power of ten`, () => {
    const R = rng(SEED + 1);
    for (let i = 0; i < N_CASES; i++) {
      const def = R.pick(PREFIXABLE);
      const [p] = R.pick(SI_PREFIXES);
      const v = R.dec(-3, 3);
      const out = evalLast([{ latex: lit(v) + u(p + def.id), unit: def.id }]);
      // a prefixed symbol that is itself another unit (PS = metric horsepower) means that unit
      if (lookupUnit(p + def.id)?.prefixOf !== def.id) continue;
      if ('error' in out) throw new Error(`${p}${def.id}: ${out.error}`);
      expectClose(out.raw, Number(v) * PREFIX_REF[p], `${v} ${p}${def.id} → ${def.id}`, 1e-12);
    }
  });
  it('temperatures: fixed points and random affine conversions', () => {
    const t = (v: string, from: string, to: string) => value({ latex: lit(v) + u(from), unit: to });
    expectClose(t('0', '°C', 'K'), 273.15, '0 °C in K');
    expectClose(t('0', '°C', '°F'), 32, '0 °C in °F');
    expectClose(t('100', '°C', '°F'), 212, '100 °C in °F');
    expectClose(t('-40', '°C', '°F'), -40, '−40 °C in °F');
    expectClose(t('0', '°F', '°R'), 459.67, '0 °F in °R');
    expectClose(t('0', '°R', 'K'), 0, '0 °R in K');
    // a plain kelvin value may be read as an absolute temperature (D45), with a note saying so
    expectClose(t('0', 'K', '°F'), -459.67, '0 K in °F');
    expectClose(t('300', 'K', '°C'), 26.85, '300 K in °C', 1e-12);
    expectClose(t('300', 'mK', '°C'), -272.85, '300 mK in °C', 1e-12);
    const note = (lines: Line[]) => {
      const rows: Row[] = lines.map((l, i) =>
        typeof l === 'string' ? { id: 'r' + i, type: 'expr', latex: l } : { id: 'r' + i, type: 'expr', latex: l.latex, displayUnit: l.unit },
      );
      const res = evaluateWorksheet(rows, { angle: 'rad' }).rows.get('r' + (lines.length - 1));
      return res?.kind === 'value' ? res.unitNote : undefined;
    };
    expect(note([{ latex: '300' + u('K'), unit: '°C' }])).toMatch(/absolute temperature.*change/);
    expect(note([{ latex: '300' + u('K'), unit: 'K' }])).toBeUndefined();
    // …but a temperature difference stays a difference: no exception for computed or Δ values
    expect(isError({ latex: `30${u('°C')}-10${u('°C')}`, unit: '°F' })).toBe(true);
    expect(isError({ latex: '10' + u('Δ°C'), unit: '°C' })).toBe(true);
    expect(isError({ latex: '10' + u('°R'), unit: '°F' })).toBe(true);
    // a dependent of a kelvin value shown in °C is that temperature, shown in °C
    expectClose(value([{ latex: 'T=300' + u('K'), unit: '°C' }, 'T']), 26.85, 'T inherits °C', 1e-12);
    expectClose(t('10', 'Δ°C', 'Δ°F'), 18, '10 Δ°C in Δ°F');
    const R = rng(SEED + 2);
    for (let i = 0; i < N_CASES; i++) {
      const v = R.dec(-2, 3);
      const x = Number(v);
      expectClose(t(v, '°C', '°F'), (x * 9) / 5 + 32, `${v} °C → °F`, 1e-12, 1e-12);
      expectClose(t(v, '°F', '°C'), ((x - 32) * 5) / 9, `${v} °F → °C`, 1e-12, 1e-12);
      expectClose(t(v, '°C', 'K'), x + 273.15, `${v} °C → K`, 1e-12, 1e-12);
      expectClose(t(v, '°F', 'K'), ((x + 459.67) * 5) / 9, `${v} °F → K`, 1e-12, 1e-12);
    }
    // differences of absolute temperatures are deltas; sums of them are refused
    expectClose(value(r`30${u('°F')}-10${u('°F')}`), 20, '30 °F − 10 °F');
    expect(isError(r`30${u('°C')}+10${u('°C')}`)).toBe(true);
  });
});

describe('arithmetic against floating point and exact rationals', () => {
  it(`${N_CASES} random expressions of +, −, ×, ÷, powers and roots`, () => {
    const R = rng(SEED + 3);
    for (let i = 0; i < N_CASES; i++) {
      const [a, b, c] = [R.dec(), R.dec(), R.dec(-2, 3, false)];
      const [x, y, z] = [Number(a), Number(b), Number(c)];
      const k = R.int(-3, 4);
      const cases: [string, number][] = [
        [`${lit(a)}+${lit(b)}`, x + y],
        [`${lit(a)}-${lit(b)}`, x - y],
        [r`${lit(a)}\cdot${lit(b)}`, x * y],
        [r`\frac{${a}}{${b}}`, x / y],
        [`${lit(a)}^{${k}}`, Math.pow(x, k)],
        [r`\sqrt{${c}}`, Math.sqrt(z)],
        [r`\sqrt[3]{${lit(a)}}`, Math.cbrt(x)],
        [r`${paren(`${lit(a)}+${lit(b)}`)}\cdot${c}-\frac{${a}}{${c}}`, (x + y) * z - x / z],
        [r`\frac{${lit(a)}\cdot${lit(b)}}{${c}^{2}}+${lit(b)}`, (x * y) / (z * z) + y],
      ];
      for (const [latex, want] of cases) expectClose(value(latex), want, latex, 1e-11, 1e-200);
    }
  });
  it(`${N_CASES} random fraction sums are exact and fully reduced`, () => {
    const R = rng(SEED + 4);
    const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
    for (let i = 0; i < N_CASES; i++) {
      const [p, q, s, t] = [R.int(-50, 50), R.int(1, 40), R.int(-50, 50), R.int(1, 40)];
      const out = evalLast([r`\frac{${p}}{${q}}+\frac{${s}}{${t}}`.replace(/\{-/g, '{-')]);
      if ('error' in out) throw new Error(out.error);
      const raw = formatQuantity(out.q).raw as Num;
      let n = BigInt(p * t + s * q), d = BigInt(q * t);
      const g = gcd(n, d) || 1n;
      [n, d] = [n / g, d / g];
      expect(raw.kind, `${p}/${q} + ${s}/${t} stays exact`).toBe('exact');
      if (raw.kind === 'exact') expect([raw.n, raw.d], `${p}/${q} + ${s}/${t}`).toEqual([n, d]);
    }
  });
  it('identities hold exactly: (a/b)·b = a, a − a = 0, 0.1 + 0.2 = 0.3', () => {
    const R = rng(SEED + 5);
    for (let i = 0; i < N_CASES; i++) {
      const [a, b] = [R.dec(), R.dec(-2, 4, false)];
      expect(value(r`\frac{${lit(a)}}{${b}}\cdot${b}`), a).toBe(Number(a));
      expect(value(`${lit(a)}-${lit(a)}`)).toBe(0);
    }
    expect(value('0.1+0.2')).toBe(0.3);
  });
});

describe('arithmetic with units (smart simplify must never change the value)', () => {
  it(`${N_CASES} random products, quotients and sums of quantities`, () => {
    const R = rng(SEED + 6);
    const pool = LINEAR.filter((x) => !['bit', 'B'].includes(x.id));
    for (let i = 0; i < N_CASES; i++) {
      const [ua, ub] = [R.pick(pool), R.pick(pool)];
      const [a, b] = [R.dec(-2, 4), R.dec(-2, 4, false)];
      const [A, B] = [Number(a) * REF[ua.id][0], Number(b) * REF[ub.id][0]];
      const [da, db] = [refDim(ua.id), refDim(ub.id)];
      const qa = paren(lit(a) + u(ua.id)), qb = paren(b + u(ub.id));
      const check = (latex: string, si: number, dim: Dim) => {
        const out = evalLast([latex]);
        if ('error' in out) throw new Error(`${latex}: ${out.error}`);
        expectClose(toNumber(out.q.si), si, `SI value of ${latex}`, 1e-11, 1e-300);
        // angles are dimensionless in SI: the engine may drop rad from a product (N·m·rad = N·m)
        const noAngle = (d: Dim) => dimStr({ ...d, A: 0 });
        expect(noAngle(out.q.dim), latex).toBe(noAngle(dim));
        // what is displayed, in the unit displayed, is the same quantity
        expectClose(out.raw * refUnitFactor(out.q.unit), si, `display of ${latex} in ${JSON.stringify(out.q.unit)}`, 1e-11, 1e-300);
      };
      check(r`${qa}\cdot${qb}`, A * B, dimTimes(da, db));
      check(r`\frac{${qa}}{${qb}}`, A / B, dimTimes(da, db, -1));
      // angles are dimensionless in SI, so 5 % + 3° is allowed (0.05 + 0.0524 rad)
      // (but Hz + rpm is refused on purpose: mixing up cycles and radians is a classic error)
      if (dimStr(da) === dimStr(db)) {
        check(`${qa}+${qb}`, A + B, da);
        check(`${qa}-${qb}`, A - B, da);
      } else if (dimStr({ ...da, A: 0 }) === dimStr({ ...db, A: 0 })) {
        if (!isError(`${qa}+${qb}`)) check(`${qa}+${qb}`, A + B, da);
      } else {
        expect(isError(`${qa}+${qb}`), `${ua.id} + ${ub.id} must be refused`).toBe(true);
      }
    }
  });
  it('values carried through variables convert the same way', () => {
    const R = rng(SEED + 7);
    for (let i = 0; i < N_CASES / 4; i++) {
      const [f, a] = [R.dec(0, 3, false), R.dec(0, 3, false)];
      const got = value(['F=' + f + u('kN'), 'A=' + a + u('mm') + '^{2}', { latex: r`\frac{F}{A}`, unit: 'MPa' }]);
      expectClose(got, (Number(f) * 1000) / Number(a), `${f} kN / ${a} mm² in MPa`, 1e-12);
    }
  });
});

describe('functions against independent references', () => {
  const op = (name: string, args: string) => r`\operatorname{${name}}\left(${args}\right)`;
  it(`${N_CASES} random arguments: trig, inverse trig and hyperbolic (radians and degrees)`, () => {
    const R = rng(SEED + 8);
    for (let i = 0; i < N_CASES; i++) {
      const x = R.dec(-3, 1);
      const v = Number(x);
      const t = R.dec(-4, -1); // in (−1, 1)
      const w = Number(t);
      const rad: [string, number][] = [
        [r`\sin\left(${x}\right)`, Math.sin(v)],
        [r`\cos\left(${x}\right)`, Math.cos(v)],
        [r`\tan\left(${x}\right)`, Math.tan(v)],
        [r`\sec\left(${x}\right)`, 1 / Math.cos(v)],
        [r`\csc\left(${x}\right)`, 1 / Math.sin(v)],
        [r`\cot\left(${x}\right)`, 1 / Math.tan(v)],
        [r`\sinh\left(${x}\right)`, Math.sinh(v)],
        [r`\cosh\left(${x}\right)`, Math.cosh(v)],
        [r`\tanh\left(${x}\right)`, Math.tanh(v)],
        [r`\arcsin\left(${t}\right)`, Math.asin(w)],
        [r`\arccos\left(${t}\right)`, Math.acos(w)],
        [r`\arctan\left(${x}\right)`, Math.atan(v)],
        [op('asinh', x), Math.asinh(v)],
        [op('atanh', t), Math.atanh(w)],
      ];
      for (const [latex, want] of rad) expectClose(value(latex), want, latex, 1e-12, 1e-15);
      const deg = R.dec(-1, 3);
      const dv = (Number(deg) * Math.PI) / 180;
      // converting a large angle to radians in floating point costs about |θ|·ε absolutely
      const tol = Math.max(1e-15, 8e-16 * Math.abs(dv));
      expectClose(value(r`\sin\left(${deg}\right)`, 'deg'), Math.sin(dv), `sin(${deg}°)`, 1e-12, tol);
      expectClose(value(r`\cos\left(${deg}\right)`, 'deg'), Math.cos(dv), `cos(${deg}°)`, 1e-12, tol);
      expectClose(value(r`\sin\left(${deg}${u('°')}\right)`), Math.sin(dv), `sin(${deg} °) in rad mode`, 1e-12, tol);
      expectClose(value(r`\arcsin\left(${t}\right)`, 'deg'), (Math.asin(w) * 180) / Math.PI, `asin(${t}) in degrees`, 1e-12, 1e-15);
    }
  });
  it('exact trig values in degree mode', () => {
    const exact: [string, number][] = [
      ['sin', 0], ['sin', 30], ['sin', 90], ['sin', 150], ['sin', 180], ['sin', 270], ['cos', 60], ['cos', 90], ['cos', 120], ['tan', 45], ['tan', 135],
    ];
    const want: Record<string, number> = {
      'sin 0': 0, 'sin 30': 0.5, 'sin 90': 1, 'sin 150': 0.5, 'sin 180': 0, 'sin 270': -1, 'cos 60': 0.5, 'cos 90': 0, 'cos 120': -0.5, 'tan 45': 1, 'tan 135': -1,
    };
    for (const [f, a] of exact) expect(value('\\' + f + r`\left(${a}\right)`, 'deg'), `${f}(${a}°)`).toBe(want[`${f} ${a}`]);
  });
  it(`${N_CASES} random arguments: exp, ln, log, powers`, () => {
    const R = rng(SEED + 9);
    for (let i = 0; i < N_CASES; i++) {
      const x = R.dec(-3, 1);
      const p = R.dec(-4, 6, false);
      const [v, q] = [Number(x), Number(p)];
      expectClose(value(r`e^{${x}}`), Math.exp(v), `e^${x}`, 1e-12);
      expectClose(value(op('exp', x)), Math.exp(v), `exp(${x})`, 1e-12);
      expectClose(value(r`\ln\left(${p}\right)`), Math.log(q), `ln(${p})`, 1e-12, 1e-15);
      expectClose(value(r`\log\left(${p}\right)`), Math.log10(q), `log(${p})`, 1e-12, 1e-15);
      expectClose(value(r`\log_{2}\left(${p}\right)`), Math.log2(q), `log₂(${p})`, 1e-12, 1e-15);
      expectClose(value(r`${p}^{${x}}`), Math.pow(q, v), `${p}^${x}`, 1e-11);
    }
  });
  it('gamma: factorials, half-integers, recurrence and reflection', () => {
    let f = 1;
    for (let n = 1; n <= 20; n++) {
      expect(value(r`\Gamma\left(${n}\right)`), `Γ(${n})`).toBe(f);
      expect(value(`${n - 1}!`), `${n - 1}!`).toBe(f);
      f *= n;
    }
    // Γ(n + ½) = (2n)! √π / (4ⁿ n!)
    const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
    for (let n = 0; n <= 10; n++)
      expectClose(value(r`\Gamma\left(${n}.5\right)`), (fact(2 * n) * Math.sqrt(Math.PI)) / (Math.pow(4, n) * fact(n)), `Γ(${n}.5)`, 1e-13);
    const R = rng(SEED + 10);
    for (let i = 0; i < N_CASES; i++) {
      const x = R.dec(-2, 1, false);
      const v = Number(x);
      if (Number.isInteger(v)) continue;
      const g = value(r`\Gamma\left(${x}\right)`);
      expectClose(value(r`\Gamma\left(${x}+1\right)`), v * g, `Γ(${x}+1) = ${x}·Γ(${x})`, 1e-12);
      // 1 − x exactly (x has at most 6 decimals), so the oracle doesn't lose digits near x = 1
      const w = Number((1 - v).toFixed(8));
      if (v < 1) expectClose(g * value(r`\Gamma\left(1-${x}\right)`), Math.PI / Math.sin(Math.PI * w), `reflection at ${x}`, 1e-12);
    }
    expectClose(value(r`\Gamma\left(-0.5\right)`), -2 * Math.sqrt(Math.PI), 'Γ(−½)', 1e-13);
    expect(isError(r`\Gamma\left(-3\right)`)).toBe(true);
  });
  it('erf and erfc against numerical integration and tabulated values', () => {
    // independent erf: composite Simpson's rule on 2/√π ∫₀ˣ e^(−t²) dt
    const simpsonErf = (x: number) => {
      const n = 4000, h = x / n;
      let s = 1 + Math.exp(-x * x);
      for (let k = 1; k < n; k++) s += (k % 2 ? 4 : 2) * Math.exp(-(k * h) * (k * h));
      return ((2 / Math.sqrt(Math.PI)) * s * h) / 3;
    };
    const R = rng(SEED + 11);
    for (let i = 0; i < N_CASES; i++) {
      const x = R.dec(-3, 0);
      const v = Number(x);
      if (Math.abs(v) > 4) continue;
      const e = value(op('erf', x));
      expectClose(e, simpsonErf(v), `erf(${x})`, 1e-12, 1e-16);
      expectClose(e + value(op('erfc', x)), 1, `erf + erfc at ${x}`, 1e-14);
    }
    const table: [string, string, number][] = [
      ['erf', '0.5', 0.5204998778130465], ['erfc', '4', 1.541725790028002e-8], ['erfc', '5', 1.5374597944280349e-12], ['erfc', '6', 2.1519736712498913e-17],
    ];
    for (const [f, x, want] of table) expectClose(value(op(f, x)), want, `${f}(${x})`, 1e-12);
  });
  it(`${N_CASES} random lists: sum, mean, median, variance, stdev, min, max`, () => {
    const R = rng(SEED + 12);
    for (let i = 0; i < N_CASES / 4; i++) {
      const xs = Array.from({ length: R.int(2, 9) }, () => R.dec(-2, 3));
      const v = xs.map(Number);
      const list = r`L=\left[${xs.join(',')}\right]`;
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      const sorted = [...v].sort((a, b) => a - b);
      const mid = Math.floor(v.length / 2);
      const median = v.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1);
      const checks: [string, number][] = [
        ['sum', v.reduce((s, x) => s + x, 0)], ['mean', mean], ['median', median], ['var', variance],
        ['stdev', Math.sqrt(variance)], ['min', sorted[0]], ['max', sorted[sorted.length - 1]], ['count', v.length],
      ];
      for (const [f, want] of checks) expectClose(value([list, op(f, 'L')]), want, `${f}(${xs})`, 1e-11, 1e-12);
    }
  });
  it(`${N_CASES} random whole numbers: nCr, nPr, gcd, lcm, mod, floor, ceil, round`, () => {
    const R = rng(SEED + 13);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
    for (let i = 0; i < N_CASES; i++) {
      const n = R.int(0, 30), k = R.int(0, 30);
      let c = 1;
      for (let j = 0; j < Math.min(k, n - k); j++) c = (c * (n - j)) / (j + 1);
      expect(value(op('nCr', `${n},${k}`)), `nCr(${n},${k})`).toBe(k > n ? 0 : Math.round(c));
      // Pascal's rule
      if (n > 0 && k > 0 && k <= n)
        expect(value(op('nCr', `${n},${k}`))).toBe(value(op('nCr', `${n - 1},${k - 1}`)) + value(op('nCr', `${n - 1},${k}`)));
      let p = 1n;
      for (let j = 0; j < k; j++) p *= BigInt(n - j);
      expect(value(op('nPr', `${n},${k}`)), `nPr(${n},${k})`).toBe(k > n ? 0 : Number(p));
      const a = R.int(1, 10000), b = R.int(1, 10000);
      expect(value(op('gcd', `${a},${b}`))).toBe(gcd(a, b));
      expect(value(op('lcm', `${a},${b}`))).toBe((a * b) / gcd(a, b));
      const m = R.int(-500, 500), d = R.int(1, 50) * (R.next() < 0.3 ? -1 : 1);
      expect(value(op('mod', `${m},${d}`)), `mod(${m},${d})`).toBe(m - d * Math.floor(m / d));
      const x = R.dec(-2, 3);
      expect(value(op('floor', x)) + 0, `floor(${x})`).toBe(Math.floor(Number(x)) + 0);
      expect(value(op('ceil', x)) + 0, `ceil(${x})`).toBe(Math.ceil(Number(x)) + 0);
      expect(value(op('round', x)) + 0, `round(${x})`).toBe(Math.floor(Number(x) + 0.5) + 0);
    }
  });
});

describe('calculus and solve against closed forms', () => {
  it(`${N_CASES / 4} random polynomial integrals match their antiderivatives`, () => {
    const R = rng(SEED + 14);
    for (let i = 0; i < N_CASES / 4; i++) {
      const c = [R.int(-9, 9), R.int(-9, 9), R.int(-9, 9), R.int(-9, 9)];
      const [a, b] = [R.int(-5, 2), R.int(3, 8)];
      const poly = `${c[0]}+${lit(String(c[1]))}x+${lit(String(c[2]))}x^{2}+${lit(String(c[3]))}x^{3}`;
      const F = (x: number) => c[0] * x + (c[1] * x ** 2) / 2 + (c[2] * x ** 3) / 3 + (c[3] * x ** 4) / 4;
      expectClose(value(r`\int_{${a}}^{${b}}${paren(poly)}\,dx`), F(b) - F(a), `∫ ${poly} from ${a} to ${b}`, 1e-10, 1e-10);
    }
  });
  it(`${N_CASES / 4} random smooth integrals: ∫ sin, ∫ eˣ, ∫ 1/x`, () => {
    const R = rng(SEED + 15);
    for (let i = 0; i < N_CASES / 4; i++) {
      const b = R.dec(-2, 1, false);
      const v = Number(b);
      expectClose(value(r`\int_{0}^{${b}}\sin\left(x\right)\,dx`), 1 - Math.cos(v), `∫₀^${b} sin`, 1e-10, 1e-12);
      expectClose(value(r`\int_{0}^{${b}}e^{x}\,dx`), Math.exp(v) - 1, `∫₀^${b} eˣ`, 1e-10, 1e-12);
      expectClose(value(r`\int_{1}^{${b}+1}\frac{1}{x}\,dx`), Math.log(v + 1), `∫₁^${b}+1 1/x`, 1e-10, 1e-12);
    }
  });
  it('hard integrals (singular ends, infinite ranges) show only correct digits', () => {
    const cases: [string, number][] = [
      [r`\int_{0}^{1}\frac{1}{\sqrt{x}}\,dx`, 2],
      [r`\int_{0}^{1}\ln\left(x\right)\,dx`, -1],
      [r`\int_{0}^{1}x^{-0.5}\cos\left(x\right)\,dx`, 1.8090484758005438],
      [r`\int_{0}^{\infty}e^{-x}\,dx`, 1],
      [r`\int_{-\infty}^{\infty}e^{-x^{2}}\,dx`, Math.sqrt(Math.PI)],
      [r`\int_{0}^{\infty}\frac{1}{1+x^{2}}\,dx`, Math.PI / 2],
      [r`\int_{0}^{1}\sqrt{1-x^{2}}\,dx`, Math.PI / 4],
      [r`\int_{0}^{\pi}\sin\left(x\right)^{2}\,dx`, Math.PI / 2],
    ];
    for (const [latex, want] of cases) expectShownRight([latex], want, latex);
  });
  it(`${N_CASES / 4} random derivatives match the analytic derivative`, () => {
    const R = rng(SEED + 16);
    for (let i = 0; i < N_CASES / 4; i++) {
      const c = [R.int(-9, 9), R.int(-9, 9), R.int(-9, 9)];
      const x0 = R.dec(-2, 1);
      const v = Number(x0);
      const poly = `${c[0]}x+${lit(String(c[1]))}x^{2}+${lit(String(c[2]))}x^{3}`;
      const want = c[0] + 2 * c[1] * v + 3 * c[2] * v * v;
      const f = c[0] * v + c[1] * v * v + c[2] * v ** 3;
      // numeric derivatives are rounded to 1×10⁻⁹ of the function's scale (first) or 1×10⁻⁸
      // (second), so the result is within a unit of its last digit shown
      const S = (w: number, fx: number, order: number) => Math.max(Math.abs(w), Math.abs(fx) / Math.max(Math.abs(v), 1) ** order);
      const at = `x=${lit(x0)}`;
      expectClose(value([at, r`\frac{d}{dx}${paren(poly)}`]), want, `d/dx ${poly} at ${x0}`, 0, 1e-8 * S(want, f, 1));
      expectClose(value([at, r`\frac{d}{dx}\sin\left(x\right)`]), Math.cos(v), `d/dx sin at ${x0}`, 0, 1e-8 * S(Math.cos(v), Math.sin(v), 1));
      const want2 = 2 * c[1] + 6 * c[2] * v;
      expectClose(value([at, r`\frac{d^2}{dx^2}${paren(poly)}`]), want2, `d²/dx² ${poly} at ${x0}`, 0, 1e-7 * S(want2, f, 2));
      expectClose(value([at, r`\frac{d^2}{dx^2}\sin\left(x\right)`]), -Math.sin(v), `d²/dx² sin at ${x0}`, 0, 1e-7 * S(Math.sin(v), Math.sin(v), 2));
    }
  });
  it(`${N_CASES / 4} random limits at removable singularities and infinity`, () => {
    const R = rng(SEED + 19);
    for (let i = 0; i < N_CASES / 4; i++) {
      const a = R.dec(-2, 1);
      const v = Number(a);
      const k = R.int(1, 9);
      const show = (latex: string, want: number, what: string) => expectShownRight([latex], want, what);
      show(r`\lim_{x\to${lit(a)}}\frac{x^{2}-${lit(a)}^{2}}{x-${lit(a)}}`, 2 * v, `lim (x²−a²)/(x−a) at ${a}`);
      show(r`\lim_{x\to0}\frac{\sin\left(${k}x\right)}{x}`, k, `lim sin(${k}x)/x`);
      show(r`\lim_{x\to0}\frac{e^{${k}x}-1}{x}`, k, `lim (e^${k}x − 1)/x`);
      show(r`\lim_{x\to0}\frac{1-\cos\left(x\right)}{x^{2}}`, 0.5, 'lim (1 − cos x)/x²');
      show(r`\lim_{x\to\infty}\left(1+\frac{${k}}{x}\right)^{x}`, Math.exp(k), `lim (1 + ${k}/x)^x`);
      show(r`\lim_{x\to\infty}\left(\sqrt{x^{2}+${k}x}-x\right)`, k / 2, `lim √(x² + ${k}x) − x`);
    }
  });
  it(`${N_CASES / 4} random cases the symbolic rules don't cover still come out right (numeric fallback)`, () => {
    const R = rng(SEED + 20);
    const honest = expectShownRight;
    for (let i = 0; i < N_CASES / 4; i++) {
      const b = R.dec(-1, 0, false);
      const v = Number(b);
      // ∫ x sin x = sin x − x cos x (a product: no rule here)
      honest([r`\int_{0}^{${b}}x\sin\left(x\right)dx`], Math.sin(v) - v * Math.cos(v), `∫₀^${b} x sin x`);
      // degree mode trig derivative: cos(x°)·π/180
      const d = R.dec(-1, 2);
      const k = Math.PI / 180;
      honest([`x=${lit(d)}`, r`\frac{d}{dx}\sin\left(x\right)`], Math.cos(Number(d) * k) * k, `d/dx sin(${d}°)`, 'deg', k);
      // x^x has a variable exponent and base: the rule applies, but check it against the closed form
      honest([`x=${b}`, r`\frac{d}{dx}x^{x}`], Math.pow(v, v) * (Math.log(v) + 1), `d/dx x^x at ${b}`);
      // x ln x → 0 as x → 0⁺ (not a quotient: numeric)
      honest([r`\lim_{x\to0^{+}}x\ln\left(x\right)`], 0, 'lim x ln x');
    }
  });
  it(`${N_CASES / 4} random quadratics: solve finds a root that satisfies the equation`, () => {
    const R = rng(SEED + 17);
    for (let i = 0; i < N_CASES / 4; i++) {
      const r1 = R.int(-20, 0) + R.int(0, 9) / 10, r2 = R.int(1, 20) + R.int(0, 9) / 10;
      const [s, p] = [r1 + r2, r1 * r2];
      const eq = r`x^{2}-${lit(toPlain(s))}x+${lit(toPlain(p))}=0`;
      const [lo, hi] = [toPlain(r2 - 0.5), toPlain(r2 + 0.5)];
      const root = value(r`\operatorname{solve}\left(${eq},x,${lo},${hi}\right)`);
      // either root may be found if both are in range; it must be a real root, inside the range
      const want = Math.abs(root - r1) < Math.abs(root - r2) ? r1 : r2;
      expectClose(root, want, `root of ${eq} in [${lo}, ${hi}]`, 1e-10, 1e-10);
      expect(root >= Number(lo) && root <= Number(hi), `root ${root} inside [${lo}, ${hi}]`).toBe(true);
    }
  });
});

describe('formatting shows correctly rounded numbers', () => {
  const parse = (s: string) => {
    const sup: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
    const m = /^(.*?)(?:×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$/.exec(s.replace(/−/g, '-'))!;
    const exp = m[2] ? Number([...m[2]].map((ch) => sup[ch]).join('')) : 0;
    return Number(m[1] + 'e' + exp);
  };
  it(`${N_CASES * 5} random numbers in every notation round-trip to the correctly rounded value`, () => {
    const R = rng(SEED + 18);
    for (let i = 0; i < N_CASES * 5; i++) {
      const x = (R.next() < 0.5 ? -1 : 1) * R.next() * Math.pow(10, R.int(-15, 15));
      const sigFigs = R.int(1, 15);
      for (const notation of ['auto', 'scientific', 'engineering'] as const) {
        const o: FormatOptions = { sigFigs, notation, mode: 'auto' };
        const s = formatFloat(x, o);
        const want = Number(x.toPrecision(sigFigs));
        expectClose(parse(s), want, `${x} at ${sigFigs} s.f. (${notation}) shown as "${s}"`, 1e-15);
        // significant digits shown (a whole number's trailing zeros are place holders)
        const mant = s.replace(/×10.*$/, '').replace(/[−-]/g, '');
        const digits = (mant.includes('.') ? mant.replace('.', '') : mant.replace(/0+$/, '')).replace(/^0+/, '');
        expect(digits.length, `"${s}" has at most ${sigFigs} significant digits`).toBeLessThanOrEqual(Math.max(sigFigs, 3));
      }
    }
  });
});

describe('physical constants against CODATA 2022', () => {
  const REF_CONST: Record<string, [number, string]> = {
    c: [299792458, 'L T-1'], h: [6.62607015e-34, 'M L2 T-1'], ħ: [1.0545718176461565e-34, 'M L2 T-1'],
    q_e: [1.602176634e-19, 'I T'], k_B: [1.380649e-23, 'M L2 T-2 K-1'], N_A: [6.02214076e23, 'N-1'],
    R: [8.31446261815324, 'M L2 T-2 K-1 N-1'], G: [6.6743e-11, 'L3 M-1 T-2'], g_0: [9.80665, 'L T-2'],
    ε_0: [8.8541878188e-12, 'M-1 L-3 T4 I2'], µ_0: [1.25663706127e-6, 'M L T-2 I-2'], σ_SB: [5.670374419e-8, 'M T-3 K-4'],
    m_e: [9.1093837139e-31, 'M'], m_p: [1.67262192595e-27, 'M'], m_n: [1.67492750056e-27, 'M'], a_0: [5.29177210544e-11, 'L'],
    P_atm: [101325, 'M L-1 T-2'], R_air: [287.05, 'L2 T-2 K-1'],
  };
  it('every constant has its reference SI value and dimension', () => {
    for (const c of CONSTANTS) {
      expect(REF_CONST[c.key], `reference for ${c.key}`).toBeDefined();
      const out = evalLast([r`\const{${c.latex}}`]);
      if ('error' in out) throw new Error(c.key + ': ' + out.error);
      expectClose(toNumber(out.q.si), REF_CONST[c.key][0], `${c.key} in SI`, 1e-12);
      expect(dimStr(out.q.dim), c.key).toBe(dimStr(D(REF_CONST[c.key][1])));
    }
  });
});
