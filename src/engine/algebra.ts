// Algebraic solving (D51): an equation that is a polynomial in the unknown (after expanding, with
// units) is solved by algebra: exactly when it can be (linear, rational roots, quadratics with a
// square discriminant), otherwise to full floating-point precision. Anything else is left to the
// numeric solver. Every root is checked back in the equation by the caller.
import type { Node } from './ast';
import * as N from './num';
import type { Num } from './num';
import * as Q from './quantity';
import { type Quantity, scalar } from './quantity';
import { dependsOn } from './symbolic';

export class NotPolynomial extends Error {}

const MAX_DEGREE = 12;

export interface PolyCtx {
  v: string;
  /** One of the unknown (SI value 1, with its dimension). */
  x: Quantity;
  /** The value of a node that doesn't involve the unknown. */
  constant(n: Node): Quantity;
}

/** Coefficients of a polynomial in the unknown, lowest power first (null = no term). */
type Poly = (Quantity | null)[];

const addQ = (a: Quantity | null, b: Quantity | null, sub = false): Quantity | null =>
  a && b ? (sub ? Q.sub(a, b) : Q.add(a, b)) : a ? a : b ? (sub ? Q.neg(b) : b) : null;

function polyAdd(a: Poly, b: Poly, sub = false): Poly {
  const out: Poly = [];
  for (let k = 0; k < Math.max(a.length, b.length); k++) out.push(addQ(a[k] ?? null, b[k] ?? null, sub));
  return out;
}
function polyMul(a: Poly, b: Poly): Poly {
  if (a.length + b.length - 2 > MAX_DEGREE) throw new NotPolynomial();
  const out: Poly = new Array(a.length + b.length - 1).fill(null);
  a.forEach((x, i) =>
    b.forEach((y, j) => {
      if (x && y) out[i + j] = addQ(out[i + j], Q.mul(x, y));
    }),
  );
  return out;
}

export function polyOf(n: Node, c: PolyCtx): Poly {
  if (!dependsOn(n, c.v)) return [c.constant(n)];
  switch (n.k) {
    case 'var':
      return [null, c.x];
    case 'neg':
      return polyOf(n.a, c).map((q) => (q ? Q.neg(q) : null));
    case 'qty':
      if (dependsOn(n.u, c.v)) throw new NotPolynomial();
      return polyMul(polyOf(n.v, c), [c.constant(n.u)]);
    case 'bin': {
      switch (n.op) {
        case '+':
          return polyAdd(polyOf(n.a, c), polyOf(n.b, c));
        case '-':
          return polyAdd(polyOf(n.a, c), polyOf(n.b, c), true);
        case '*':
          return polyMul(polyOf(n.a, c), polyOf(n.b, c));
        case '/': {
          if (dependsOn(n.b, c.v)) throw new NotPolynomial();
          const d = c.constant(n.b);
          return polyOf(n.a, c).map((q) => (q ? Q.div(q, d) : null));
        }
        case '^': {
          if (dependsOn(n.b, c.v)) throw new NotPolynomial();
          const e = c.constant(n.b);
          if (!Q.isScalar(e) || !N.isExact(e.si) || e.si.d !== 1n || e.si.n < 0n || e.si.n > BigInt(MAX_DEGREE)) throw new NotPolynomial();
          const base = polyOf(n.a, c);
          let out: Poly = [scalar(N.ONE)];
          for (let k = 0n; k < e.si.n; k++) out = polyMul(out, base);
          return out;
        }
      }
    }
  }
  throw new NotPolynomial();
}

/** SI coefficients, lowest power first, without trailing zero terms. */
export function coefficients(p: Poly): Num[] {
  const cs = p.map((q) => (q ? q.si : N.ZERO));
  while (cs.length && N.isZero(cs[cs.length - 1])) cs.pop();
  return cs;
}

// ── real roots of a polynomial ──
const big = (a: Num) => a as { kind: 'exact'; n: bigint; d: bigint };
const absB = (a: bigint) => (a < 0n ? -a : a);
function gcdB(a: bigint, b: bigint): bigint {
  a = absB(a);
  b = absB(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
function isqrt(n: bigint): bigint | null {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x * x === n ? x : null;
}
const evalExact = (cs: Num[], x: Num) => cs.reduceRight<Num>((acc, c) => N.add(N.mul(acc, x), c), N.ZERO);
const evalFloat = (cs: number[], x: number) => cs.reduceRight((acc, c) => acc * x + c, 0);

/** Divisors of |n| (n ≠ 0), or null if there are too many to try. */
function divisors(n: bigint): bigint[] | null {
  n = absB(n);
  if (n > 10n ** 12n) return null;
  const out: bigint[] = [];
  for (let i = 1n; i * i <= n; i++) {
    if (n % i === 0n) {
      out.push(i);
      if (i * i !== n) out.push(n / i);
    }
    if (out.length > 400) return null;
  }
  return out;
}

/** Divide by (x − r) exactly (synthetic division); r is a root. */
function deflate(cs: Num[], r: Num): Num[] {
  const out: Num[] = new Array(cs.length - 1);
  let carry: Num = N.ZERO;
  for (let k = cs.length - 1; k >= 1; k--) {
    carry = N.add(N.mul(carry, r), cs[k]);
    out[k - 1] = carry;
  }
  return out;
}

/** All real roots, ascending, each listed once; exact where possible. */
export function realRoots(cs: Num[]): Num[] {
  if (cs.length <= 1) return [];
  const found: Num[] = [];
  let p = cs;
  // x = 0
  while (p.length > 1 && N.isZero(p[0])) {
    found.push(N.ZERO);
    p = p.slice(1);
  }
  // rational roots (rational root theorem), when every coefficient is an exact rational
  if (p.length > 3 && p.every(N.isExact)) {
    const l = p.reduce((acc, c) => (acc * big(c).d) / gcdB(acc, big(c).d), 1n);
    const ints = p.map((c) => (big(c).n * l) / big(c).d);
    const ps = divisors(ints[0]);
    const qs = divisors(ints[ints.length - 1]);
    if (ps && qs && ps.length * qs.length <= 4000) {
      for (const a of ps)
        for (const b of qs)
          for (const s of [1n, -1n]) {
            if (p.length <= 3) break;
            const r = N.exact(s * a, b);
            while (p.length > 1 && N.isZero(evalExact(p, r))) {
              found.push(r);
              p = deflate(p, r);
            }
          }
    }
  }
  found.push(...remainingRoots(p));
  return dedupe(found);
}

function remainingRoots(p: Num[]): Num[] {
  const d = p.length - 1;
  if (d <= 0) return [];
  if (d === 1) return [N.neg(N.div(p[0], p[1]))];
  if (d === 2) return quadratic(p[0], p[1], p[2]);
  return floatRoots(p.map(N.toNumber)).map(N.float);
}

/** a + bx + cx² = 0 */
function quadratic(a: Num, b: Num, c: Num): Num[] {
  const disc = N.sub(N.mul(b, b), N.mul(N.exact(4n), N.mul(a, c)));
  if (N.cmp(disc, N.ZERO) < 0) return [];
  const twoC = N.mul(N.exact(2n), c);
  if (N.isZero(disc)) return [N.neg(N.div(b, twoC))];
  if (N.isExact(disc)) {
    const sn = isqrt(big(disc).n);
    const sd = isqrt(big(disc).d);
    if (sn !== null && sd !== null) {
      const s = N.exact(sn, sd);
      return [N.div(N.sub(N.neg(b), s), twoC), N.div(N.add(N.neg(b), s), twoC)];
    }
  }
  // stable formula: q = −(b + sign(b)√disc)/2, roots q/c and a/q
  const [A, B, C] = [N.toNumber(a), N.toNumber(b), N.toNumber(c)];
  const sq = Math.sqrt(N.toNumber(disc));
  const q = -0.5 * (B + (B >= 0 ? sq : -sq));
  return [N.float(q / C), N.float(A / q)];
}

/** Real roots of a float polynomial: between consecutive turning points the sign decides. */
function floatRoots(cs: number[]): number[] {
  const d = cs.length - 1;
  if (d === 1) return [-cs[0] / cs[1]];
  if (d === 2) return quadratic(N.float(cs[0]), N.float(cs[1]), N.float(cs[2])).map(N.toNumber);
  const deriv = cs.slice(1).map((c, i) => c * (i + 1));
  const turns = floatRoots(deriv).sort((a, b) => a - b);
  // Cauchy bound: every root has |x| < 1 + max |c_k / c_d|
  const bound = 1 + Math.max(...cs.slice(0, -1).map((c) => Math.abs(c / cs[d])));
  const pts = [-bound, ...turns.filter((t) => Math.abs(t) < bound), bound];
  const size = (x: number) => cs.reduce((s, c, k) => s + Math.abs(c) * Math.abs(x) ** k, 0);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i];
    // a turning point that touches zero is a repeated root
    if (i > 0 && i < pts.length - 1 && Math.abs(evalFloat(cs, x)) <= 1e-12 * size(x)) out.push(x);
    if (i === pts.length - 1) break;
    let a = x,
      b = pts[i + 1];
    let fa = evalFloat(cs, a),
      fb = evalFloat(cs, b);
    if (fa === 0 || fb === 0 || Math.sign(fa) === Math.sign(fb)) continue;
    for (let k = 0; k < 300 && b - a > 0; k++) {
      const m = (a + b) / 2;
      if (m === a || m === b) break;
      const fm = evalFloat(cs, m);
      if (fm === 0) {
        a = b = m;
        break;
      }
      if (Math.sign(fm) === Math.sign(fa)) [a, fa] = [m, fm];
      else [b, fb] = [m, fm];
    }
    out.push((a + b) / 2);
  }
  return out;
}

function dedupe(rs: Num[]): Num[] {
  const sorted = [...rs].sort((a, b) => N.cmp(a, b));
  const out: Num[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(N.toNumber(r) - N.toNumber(prev)) <= 1e-12 * Math.max(1, Math.abs(N.toNumber(r)))) {
      if (!N.isExact(prev) && N.isExact(r)) out[out.length - 1] = r; // keep the exact one
      continue;
    }
    out.push(r);
  }
  return out;
}

/** Σ |c_k|·|x|^k: the size of the terms at x, for judging whether a root really is one. */
export function termSize(cs: Num[], x: number): number {
  return cs.reduce((s, c, k) => s + Math.abs(N.toNumber(c)) * Math.abs(x) ** k, 0);
}
