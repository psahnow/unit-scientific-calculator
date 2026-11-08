// Vectors and complex numbers (D63): optional per worksheet. Both are values made of ordinary
// quantities, so units, exact fractions and unit conversion carry over unchanged.
//   vector:  { t: 'vec', items }   every component has the same kind of unit, shown in one unit
//   complex: { t: 'cx', re, im }   real and imaginary parts share a unit (Z = 3 + 4i Ω)
import * as N from './num';
import * as Q from './quantity';
import { type Quantity, CalcError, scalar, describe } from './quantity';
import { dim, dimEq, isDimlessLoose, DIMLESS } from './dim';

export type VecValue = { t: 'vec'; items: Quantity[] };
export type CxValue = { t: 'cx'; re: Quantity; im: Quantity };
type QValue = { t: 'q'; q: Quantity };
type ListValue = { t: 'list'; items: Quantity[] };
export type AnyValue = QValue | ListValue | VecValue | CxValue;

const qv = (q: Quantity): QValue => ({ t: 'q', q });
const zeroLike = (q: Quantity): Quantity => ({ si: N.ZERO, dim: q.dim, unit: q.unit });
const ANGLE = dim({ A: 1 });
const RAD = [{ id: 'rad', power: 1 }];
const DEG = [{ id: '°', power: 1 }];

// ── Vectors ──────────────────────────────────────────────────────────────────

/** A vector's components share a kind of unit, shown in the first one's unit. */
export function vec(items: Quantity[]): VecValue {
  if (!items.length) throw new CalcError('A vector needs at least one component');
  const plainZero = (q: Quantity) => N.isZero(q.si) && dimEq(q.dim, DIMLESS) && !q.unit.length;
  // a plain 0 takes the others' unit: (0, 3 m) is (0 m, 3 m)
  const ref = items.find((q) => !plainZero(q)) ?? items[0];
  return {
    t: 'vec',
    items: items.map((q) => {
      if (q.tempKind === 'absolute') throw new CalcError('A vector can’t hold a temperature in °C or °F; use K or a temperature difference');
      if (dimEq(q.dim, ref.dim)) return { ...q, unit: ref.unit };
      if (plainZero(q)) return zeroLike(ref);
      throw new CalcError(`Every part of a vector needs the same kind of unit: ${describe(ref)} and ${describe(q)} don't mix`);
    }),
  };
}

/** i, j, k, or e₁ … eₙ: a unit vector, as long as its position (j = (0, 1)). */
export function basis(n: number): VecValue {
  return { t: 'vec', items: Array.from({ length: n }, (_, i) => scalar(i === n - 1 ? N.ONE : N.ZERO)) };
}

/** Pad the shorter vector with zeros, so i + j = (1, 1) and (1, 2) + k = (1, 2, 1). */
const padTo = (xs: Quantity[], n: number) => xs.concat(Array.from({ length: Math.max(0, n - xs.length) }, () => zeroLike(xs[0])));
function pad(a: Quantity[], b: Quantity[]): [Quantity[], Quantity[]] {
  const n = Math.max(a.length, b.length);
  return [padTo(a, n), padTo(b, n)];
}

export function dot(a: VecValue, b: VecValue): Quantity {
  const [x, y] = pad(a.items, b.items);
  let acc = Q.mul(x[0], y[0]);
  for (let i = 1; i < x.length; i++) acc = Q.add(acc, Q.mul(x[i], y[i]));
  return acc;
}

export function cross(a: VecValue, b: VecValue): VecValue {
  if (a.items.length > 3 || b.items.length > 3) throw new CalcError('The cross product (×) only works for vectors with up to 3 components');
  const [a1, a2, a3] = padTo(a.items, 3);
  const [b1, b2, b3] = padTo(b.items, 3);
  const m = Q.mul;
  return vec([Q.sub(m(a2, b3), m(a3, b2)), Q.sub(m(a3, b1), m(a1, b3)), Q.sub(m(a1, b2), m(a2, b1))]);
}

/** |v|: the length of a vector. */
export function norm(a: VecValue): Quantity {
  return Q.root(dot(a, a), 2);
}

function vecBin(op: '+' | '-' | '*' | '/' | '^', a: AnyValue, b: AnyValue): AnyValue {
  if (a.t === 'list' || b.t === 'list') throw new CalcError('Vectors and lists don’t mix: use ( ) for a vector and [ ] for a list');
  if (a.t === 'cx' || b.t === 'cx') throw new CalcError('Vectors and complex numbers don’t mix');
  if (op === '+' || op === '-') {
    if (a.t !== 'vec' || b.t !== 'vec') throw new CalcError(`Can't ${op === '+' ? 'add a vector and a single value' : 'subtract a vector and a single value'}`);
    const [x, y] = pad(a.items, b.items);
    return vec(x.map((q, i) => (op === '+' ? Q.add : Q.sub)(q, y[i])));
  }
  if (op === '*') {
    if (a.t === 'vec' && b.t === 'vec') return qv(dot(a, b)); // u · v
    if (a.t === 'vec') return vec(a.items.map((q) => Q.mul(q, (b as QValue).q)));
    return vec((b as VecValue).items.map((q) => Q.mul((a as QValue).q, q)));
  }
  if (op === '/') {
    if (b.t === 'vec') throw new CalcError("Can't divide by a vector");
    return vec((a as VecValue).items.map((q) => Q.div(q, b.q)));
  }
  // ^: only v² = v · v
  if (a.t === 'vec' && b.t === 'q' && N.cmp(b.q.si, N.exact(2n)) === 0 && isDimlessLoose(b.q.dim)) return qv(dot(a, a));
  throw new CalcError('A vector can only be squared (v² = v · v). For its length, use |v|');
}

// ── Complex numbers ──────────────────────────────────────────────────────────

/** re + im·i; a part that is zero, or a rounding speck next to the other, drops out (e^{iπ} = −1). */
export function cx(re: Quantity, im: Quantity): AnyValue {
  if (re.tempKind === 'absolute' || im.tempKind === 'absolute') throw new CalcError('A complex number can’t be a temperature in °C or °F');
  const r = N.toNumber(re.si);
  const m = N.toNumber(im.si);
  const big = Math.max(Math.abs(r), Math.abs(m));
  const speck = (x: number, n: N.Num) => !N.isExact(n) && Math.abs(x) < 1e-14 * big;
  if (N.isZero(im.si) || speck(m, im.si)) return qv(re);
  if (speck(r, re.si)) re = zeroLike(re);
  return { t: 'cx', re, im: { ...im, unit: re.unit } };
}

const asCx = (v: AnyValue): CxValue => {
  if (v.t === 'cx') return v;
  if (v.t === 'q') return { t: 'cx', re: v.q, im: zeroLike(v.q) };
  throw new CalcError(v.t === 'vec' ? 'Vectors and complex numbers don’t mix' : 'Lists and complex numbers don’t mix');
};

/** The imaginary unit, i (or j). */
export const IMAG: CxValue = { t: 'cx', re: scalar(N.ZERO), im: scalar(N.ONE) };

function cmul(a: CxValue, b: CxValue): AnyValue {
  const m = Q.mul;
  return cx(Q.sub(m(a.re, b.re), m(a.im, b.im)), Q.add(m(a.re, b.im), m(a.im, b.re)));
}
function cdiv(a: CxValue, b: CxValue): AnyValue {
  const m = Q.mul;
  const d = Q.add(m(b.re, b.re), m(b.im, b.im));
  return cx(Q.div(Q.add(m(a.re, b.re), m(a.im, b.im)), d), Q.div(Q.sub(m(a.im, b.re), m(a.re, b.im)), d));
}

/** |z| */
export function cabs(z: CxValue): Quantity {
  return Q.root(Q.add(Q.mul(z.re, z.re), Q.mul(z.im, z.im)), 2);
}
/** arg z, in radians (a number). */
const argNum = (z: CxValue) => Math.atan2(N.toNumber(z.im.si), N.toNumber(z.re.si));

/** z^w for any complex z, w; units only with a real, simple-fraction power. */
function cpow(z: CxValue, w: CxValue): AnyValue {
  const wIsReal = N.isZero(w.im.si);
  if (!isDimlessLoose(w.re.dim) || !isDimlessLoose(w.im.dim)) throw new CalcError(`A power must be a plain number, not ${describe(w.re)}`);
  // whole-number powers stay exact: (1 + 2i)³ = −11 − 2i
  if (wIsReal && N.isInteger(w.re.si) && Math.abs(N.toNumber(w.re.si)) <= 1000) {
    let n = Math.abs(N.toNumber(w.re.si));
    let result: CxValue = { t: 'cx', re: scalar(N.ONE), im: scalar(N.ZERO) };
    let base = z;
    while (n > 0) {
      if (n & 1) result = asCx(cmul(result, base));
      n >>= 1;
      if (n) base = asCx(cmul(base, base));
    }
    return N.toNumber(w.re.si) < 0 ? cdiv(asCx(qv(scalar(N.ONE))), result) : cx(result.re, result.im);
  }
  const hasUnits = !isDimlessLoose(z.re.dim);
  if (hasUnits && !wIsReal) throw new CalcError('A value with units can only be raised to a real power');
  // on the numbers in SI: z^w = exp(w · ln z)
  const r = Math.hypot(N.toNumber(z.re.si), N.toNumber(z.im.si));
  if (r === 0) return qv(scalar(N.ZERO));
  const lnR = Math.log(r);
  const th = argNum(z);
  const a = N.toNumber(w.re.si);
  const b = N.toNumber(w.im.si);
  const mag = Math.exp(a * lnR - b * th);
  const ang = b * lnR + a * th;
  let re: Quantity = scalar(N.float(mag * Math.cos(ang)));
  let im: Quantity = scalar(N.float(mag * Math.sin(ang)));
  if (hasUnits) {
    const unitPart = Q.pow({ si: N.ONE, dim: z.re.dim, unit: z.re.unit }, w.re);
    re = Q.mul(re, unitPart);
    im = Q.mul(im, unitPart);
  }
  return cx(re, im);
}

function cxBin(op: '+' | '-' | '*' | '/' | '^', a: AnyValue, b: AnyValue): AnyValue {
  const x = asCx(a);
  const y = asCx(b);
  switch (op) {
    case '+':
      return cx(Q.add(x.re, y.re), Q.add(x.im, y.im));
    case '-':
      return cx(Q.sub(x.re, y.re), Q.sub(x.im, y.im));
    case '*':
      return cmul(x, y);
    case '/':
      return cdiv(x, y);
    case '^':
      return cpow(x, y);
  }
}

/** A negative number to a fractional power, when complex numbers are on: √−4 = 2i. */
export function needsComplexPow(a: Quantity, e: Quantity): boolean {
  return N.toNumber(a.si) < 0 && isDimlessLoose(e.dim) && !N.isInteger(e.si);
}
export function complexPow(a: Quantity, e: Quantity): AnyValue {
  return cpow(asCx(qv(a)), asCx(qv(e)));
}

/** r∠θ: θ is an angle, or a plain number read in the RAD/DEG mode. */
export function polar(r: Quantity, th: Quantity, angle: 'rad' | 'deg'): AnyValue {
  let t: number;
  if (dimEq(th.dim, ANGLE)) t = N.toNumber(th.si);
  else if (dimEq(th.dim, DIMLESS)) t = N.toNumber(th.si) * (angle === 'deg' ? Math.PI / 180 : 1);
  else throw new CalcError(`After ∠ put an angle, like 30°, not ${describe(th)}`);
  return cx(Q.mul(r, scalar(N.float(Math.cos(t)))), Q.mul(r, scalar(N.float(Math.sin(t)))));
}

/** ln of a negative number, when complex numbers are on: ln(−1) = iπ. */
export function lnNegative(q: Quantity): AnyValue {
  return cx(scalar(N.float(Math.log(-N.toNumber(q.si)))), scalar(N.float(Math.PI)));
}

// ── Shared entry points for the evaluator ───────────────────────────────────

/** Apply a linear, part-by-part change (attach a unit, convert units) to each component or part. */
export function mapParts(a: VecValue | CxValue, f: (q: Quantity) => Quantity): AnyValue {
  return a.t === 'vec' ? vec(a.items.map(f)) : cx(f(a.re), f(a.im));
}

export const isVecOrCx = (v: AnyValue) => v.t === 'vec' || v.t === 'cx';

export function binOp(op: '+' | '-' | '*' | '/' | '^', a: AnyValue, b: AnyValue): AnyValue {
  if (a.t === 'vec' || b.t === 'vec') return vecBin(op, a, b);
  if (a.t === 'list' || b.t === 'list') throw new CalcError('Lists and complex numbers don’t mix');
  return cxBin(op, a, b);
}

export function negate(a: VecValue | CxValue): AnyValue {
  return a.t === 'vec' ? vec(a.items.map(Q.neg)) : cx(Q.neg(a.re), Q.neg(a.im));
}

/** |v| or |z| */
export function magnitude(a: VecValue | CxValue): Quantity {
  return a.t === 'vec' ? norm(a) : cabs(a);
}

/** The functions that understand vectors and complex numbers. undefined: not one of them. */
export function builtin(name: string, args: AnyValue[], angle: 'rad' | 'deg'): AnyValue | undefined {
  const one = () => {
    if (args.length !== 1) throw new CalcError(`${name} needs 1 input`);
    return args[0];
  };
  const two = () => {
    if (args.length !== 2) throw new CalcError(`${name} needs 2 inputs`);
    return args as [AnyValue, AnyValue];
  };
  const asVec = (v: AnyValue): VecValue => {
    if (v.t !== 'vec') throw new CalcError(`${name} needs vectors, like (1, 2, 3)`);
    return v;
  };
  switch (name) {
    case 'dot': {
      const [a, b] = two();
      return qv(dot(asVec(a), asVec(b)));
    }
    case 'cross': {
      const [a, b] = two();
      return cross(asVec(a), asVec(b));
    }
    case 'norm':
      return qv(norm(asVec(one())));
    case 're':
      return qv(asCx(one()).re);
    case 'im':
      return qv(asCx(one()).im);
    case 'conj': {
      const z = asCx(one());
      return cx(z.re, Q.neg(z.im));
    }
    case 'arg': {
      // the angle doesn't depend on the unit: it is worked out on the numbers
      const r = argNum(asCx(one()));
      return qv({ si: N.float(r), dim: ANGLE, unit: angle === 'deg' ? DEG : RAD });
    }
  }
  const a = args.length === 1 ? args[0] : undefined;
  if (!a || a.t !== 'cx') return undefined;
  switch (name) {
    case 'abs':
      return qv(cabs(a));
    case 'sqrt':
      return cpow(a, asCx(qv(scalar(N.exact(1n, 2n)))));
    case 'exp':
      if (!isDimlessLoose(a.re.dim)) throw new CalcError(`exp needs a plain number, not ${describe(a.re)}`);
      return cpow(asCx(qv(scalar(N.float(Math.E)))), a);
    case 'ln': {
      if (!isDimlessLoose(a.re.dim)) throw new CalcError(`ln needs a plain number, not ${describe(a.re)}`);
      const r = Math.hypot(N.toNumber(a.re.si), N.toNumber(a.im.si));
      return cx(scalar(N.float(Math.log(r))), scalar(N.float(argNum(a))));
    }
  }
  throw new CalcError(`${name} doesn't work with complex numbers yet`);
}

/** Every function that understands vectors or complex numbers (for errors and suggestions). */
export const VECX_FUNCS = ['dot', 'cross', 'norm', 're', 'im', 'conj', 'arg'];
