// Numeric core: exact bigint rationals that degrade to float64 after irrational ops.

export type Num =
  | { kind: 'exact'; n: bigint; d: bigint } // reduced, d > 0
  | { kind: 'float'; v: number };

const abs = (a: bigint) => (a < 0n ? -a : a);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function exact(n: bigint, d: bigint = 1n): Num {
  if (d === 0n) throw new EvalError('Division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  return { kind: 'exact', n: n / g, d: d / g };
}

export const float = (v: number): Num => ({ kind: 'float', v });
export const ZERO = exact(0n);
export const ONE = exact(1n);

/** Parse a decimal literal ("0.45359237", "1e-3", "12") exactly. */
export function parseDecimal(s: string): Num {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s.trim());
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new SyntaxError(`Bad number '${s}'`);
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] || '0';
  const frac = m[3] ?? '';
  const exp = Number(m[4] ?? 0) - frac.length;
  let n = BigInt(intPart + frac) * sign;
  let d = 1n;
  if (exp >= 0) n *= 10n ** BigInt(exp);
  else d = 10n ** BigInt(-exp);
  return exact(n, d);
}

export function fromNumber(v: number): Num {
  if (Number.isInteger(v) && Math.abs(v) < Number.MAX_SAFE_INTEGER) return exact(BigInt(v));
  return float(v);
}

export function toNumber(a: Num): number {
  if (a.kind === 'float') return a.v;
  // Preserve precision for huge numerators/denominators.
  const n = a.n,
    d = a.d;
  const nn = Number(n),
    dd = Number(d);
  if (Number.isFinite(nn) && Number.isFinite(dd)) return nn / dd;
  const shift = BigInt(Math.max(n.toString().length, d.toString().length) - 300);
  const s = 10n ** (shift > 0n ? shift : 0n);
  return Number(n / s) / Number(d / s);
}

export const isExact = (a: Num): a is { kind: 'exact'; n: bigint; d: bigint } => a.kind === 'exact';
export const isZero = (a: Num) => (a.kind === 'exact' ? a.n === 0n : a.v === 0);

export function add(a: Num, b: Num): Num {
  if (a.kind === 'exact' && b.kind === 'exact') return exact(a.n * b.d + b.n * a.d, a.d * b.d);
  return float(toNumber(a) + toNumber(b));
}
export function neg(a: Num): Num {
  return a.kind === 'exact' ? { kind: 'exact', n: -a.n, d: a.d } : float(-a.v);
}
export const sub = (a: Num, b: Num) => add(a, neg(b));
export function mul(a: Num, b: Num): Num {
  if (a.kind === 'exact' && b.kind === 'exact') return exact(a.n * b.n, a.d * b.d);
  return float(toNumber(a) * toNumber(b));
}
export function div(a: Num, b: Num): Num {
  if (isZero(b)) throw new EvalError('Division by zero');
  if (a.kind === 'exact' && b.kind === 'exact') return exact(a.n * b.d, a.d * b.n);
  return float(toNumber(a) / toNumber(b));
}

function intRoot(x: bigint, k: bigint): bigint | null {
  if (x < 0n) return null;
  if (x < 2n) return x;
  let r = BigInt(Math.round(Math.pow(Number(x), 1 / Number(k))));
  for (const c of [r - 1n, r, r + 1n]) if (c >= 0n && c ** k === x) return c;
  // Newton refinement for very large values
  r = x;
  let y = ((k - 1n) * r + x / r ** (k - 1n)) / k;
  while (y < r) {
    r = y;
    y = ((k - 1n) * r + x / r ** (k - 1n)) / k;
  }
  return r ** k === x ? r : null;
}

/** a ^ (p/q) — exact when possible. */
export function powRational(a: Num, p: number, q = 1): Num {
  if (a.kind === 'exact' && Number.isInteger(p) && Number.isInteger(q) && q > 0 && Math.abs(p) <= 4096) {
    let n = a.n,
      d = a.d;
    const neg_ = n < 0n;
    if (q !== 1) {
      const Q = BigInt(q);
      if (neg_ && q % 2 === 0) throw new EvalError('Even root of a negative number');
      const rn = intRoot(neg_ ? -n : n, Q);
      const rd = intRoot(d, Q);
      if (rn === null || rd === null) return float(signedPow(toNumber(a), p / q));
      n = neg_ ? -rn : rn;
      d = rd;
    }
    const P = BigInt(Math.abs(p));
    if (p < 0) {
      if (n === 0n) throw new EvalError('Division by zero');
      return exact(d ** P, n ** P);
    }
    return exact(n ** P, d ** P);
  }
  return float(signedPow(toNumber(a), p / q));
}

function signedPow(x: number, e: number) {
  if (x < 0) {
    // odd-denominator roots of negatives are real
    const r = Math.pow(-x, e);
    const fr = toFraction(e);
    if (fr && fr[1] % 2 === 1) return fr[0] % 2 === 0 ? r : -r;
    return NaN;
  }
  return Math.pow(x, e);
}

/** Approximate a float as a small fraction p/q (|q| ≤ 1000) if it is one. */
export function toFraction(x: number): [number, number] | null {
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-12) return [p, q];
  }
  return null;
}

/** Num ^ Num where the exponent is dimensionless. */
export function pow(a: Num, b: Num): Num {
  if (b.kind === 'exact' && abs(b.d) <= 1000n && abs(b.n) <= 4096n) return powRational(a, Number(b.n), Number(b.d));
  return float(Math.pow(toNumber(a), toNumber(b)));
}

export function cmp(a: Num, b: Num): number {
  if (a.kind === 'exact' && b.kind === 'exact') {
    const x = a.n * b.d - b.n * a.d;
    return x < 0n ? -1 : x > 0n ? 1 : 0;
  }
  const x = toNumber(a) - toNumber(b);
  return x < 0 ? -1 : x > 0 ? 1 : 0;
}

export function isInteger(a: Num): boolean {
  return a.kind === 'exact' ? a.d === 1n : Number.isInteger(a.v);
}

export function floor(a: Num): Num {
  if (a.kind === 'exact') {
    let q = a.n / a.d;
    if (a.n < 0n && q * a.d !== a.n) q -= 1n;
    return exact(q);
  }
  return float(Math.floor(a.v));
}

export function factorial(a: Num): Num {
  if (a.kind === 'exact' && a.d === 1n && a.n >= 0n && a.n <= 1000n) {
    let r = 1n;
    for (let i = 2n; i <= a.n; i++) r *= i;
    return exact(r);
  }
  // Gamma via Lanczos for non-integers
  return float(gamma(toNumber(a) + 1));
}

function gamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
