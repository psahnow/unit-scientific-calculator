// AST evaluation with units, lists and builtins (DESIGN.md §5.3).
import * as N from './num';
import type { Node, Cond } from './ast';
import { integrate, derivative, limit, NumericError } from './calculus';
import { isUnitOnly } from './ast';
import * as Q from './quantity';
import { type Quantity, CalcError, scalar, describe } from './quantity';
import { dim, dimEq, isDimlessLoose, isAngle, DIMLESS } from './dim';
import { type UnitExpr, unitDim, unitFactor, offsetUnit, getUnit, combine, parseUnitExpr } from './units/registry';
import { CONST_BY_KEY } from './units/constants.data';

export type Value = { t: 'q'; q: Quantity } | { t: 'list'; items: Quantity[] };

export interface FuncDef {
  params: string[];
  body: Node;
  /** Scope the function was defined in; its body looks names up there (lexical scoping). */
  env?: Env;
}

export interface Env {
  getVar(name: string): Value | undefined; // throws for errors in the defining row
  getFunc(name: string): FuncDef | undefined;
  angle: 'rad' | 'deg';
  locals?: Map<string, Value>;
  depth?: number;
}

export const qv = (q: Quantity): Value => ({ t: 'q', q });

export function unitQuantity(u: UnitExpr): Quantity {
  if (offsetUnit(u)) return Q.fromUnit(N.ONE, u);
  const q: Quantity = { si: unitFactor(u), dim: unitDim(u), unit: u };
  if (u.length === 1 && u[0].power === 1 && getUnit(u[0].id).tempKind === 'delta') q.tempKind = 'delta';
  return q;
}

const constCache = new Map<string, Quantity>();
function constQuantity(key: string): Quantity {
  let q = constCache.get(key);
  if (!q) {
    const c = CONST_BY_KEY.get(key);
    if (!c) throw new CalcError(`Unknown constant ${key}`);
    q = Q.fromUnit(c.value, parseUnitExpr(c.unit));
    constCache.set(key, q);
  }
  return q;
}

function asQ(v: Value, what = 'value'): Quantity {
  if (v.t !== 'q') throw new CalcError(`Expected a single ${what}, got a list`);
  return v.q;
}

/** Broadcast a binary op over lists (Desmos-style; shorter length wins). */
function broadcast2(a: Value, b: Value, f: (x: Quantity, y: Quantity) => Quantity): Value {
  if (a.t === 'q' && b.t === 'q') return qv(f(a.q, b.q));
  const ai = a.t === 'list' ? a.items : null;
  const bi = b.t === 'list' ? b.items : null;
  const n = Math.min(ai?.length ?? Infinity, bi?.length ?? Infinity);
  const items: Quantity[] = [];
  for (let i = 0; i < n; i++) items.push(f(ai ? ai[i] : (a as { q: Quantity }).q, bi ? bi[i] : (b as { q: Quantity }).q));
  return { t: 'list', items: unifyList(items) };
}
function broadcast1(a: Value, f: (x: Quantity) => Quantity): Value {
  return a.t === 'q' ? qv(f(a.q)) : { t: 'list', items: unifyList(a.items.map(f)) };
}

/** All list items share the first element's display unit. */
export function unifyList(items: Quantity[]): Quantity[] {
  if (!items.length) return items;
  const first = items[0];
  return items.map((q, i) => {
    if (i === 0) return q;
    if (!dimEq(q.dim, first.dim)) throw new CalcError(`List items must share a dimension: ${describe(first)} vs ${describe(q)}`);
    return { ...q, unit: first.unit, tempKind: q.tempKind };
  });
}

export function evalUnitNode(n: Node, env: Env): UnitExpr {
  switch (n.k) {
    case 'unit':
      return [{ id: n.id, power: 1 }];
    case 'bin': {
      if (n.op === '*') return evalUnitNode(n.a, env).concat(evalUnitNode(n.b, env));
      if (n.op === '/') return evalUnitNode(n.a, env).concat(evalUnitNode(n.b, env).map((t) => ({ id: t.id, power: -t.power })));
      if (n.op === '^') {
        const p = N.toNumber(asQ(evaluate(n.b, env)).si);
        return evalUnitNode(n.a, env).map((t) => ({ id: t.id, power: t.power * p }));
      }
    }
  }
  throw new CalcError('Invalid unit expression');
}

export function evaluate(n: Node, env: Env): Value {
  switch (n.k) {
    case 'num':
      return qv(scalar(n.v));
    case 'pi':
      return qv(scalar(N.float(Math.PI)));
    case 'euler':
      return qv(scalar(N.float(Math.E)));
    case 'var': {
      const local = env.locals?.get(n.name);
      if (local) return local;
      const v = env.getVar(n.name);
      if (!v) throw new CalcError(`“${n.name}” isn't defined yet: add a row like ${n.name} = 5`);
      return v;
    }
    case 'unit':
      return qv(unitQuantity([{ id: n.id, power: 1 }]));
    case 'const':
      return qv(constQuantity(n.key));
    case 'bin': {
      if (isUnitOnly(n)) return qv(unitQuantity(combine(evalUnitNode(n, env))));
      const a = evaluate(n.a, env);
      const b = evaluate(n.b, env);
      const f = { '+': Q.add, '-': Q.sub, '*': Q.mul, '/': Q.div, '^': Q.pow }[n.op];
      return broadcast2(a, b, f);
    }
    case 'neg':
      return broadcast1(evaluate(n.a, env), Q.neg);
    case 'qty': {
      const v = evaluate(n.v, env);
      const u = combine(evalUnitNode(n.u, env));
      const uq = unitQuantity(u);
      return broadcast1(v, (x) => {
        if (dimEq(x.dim, DIMLESS) && !x.unit.length) return Q.fromUnit(x.si, u);
        return Q.mul(x, uq);
      });
    }
    case 'fact':
      return broadcast1(evaluate(n.a, env), (x) => {
        if (!Q.isScalar(x)) throw new CalcError('Factorial needs a dimensionless number');
        return scalar(N.factorial(x.si));
      });
    case 'abs':
      return broadcast1(evaluate(n.a, env), absQ);
    case 'root': {
      const k = asQ(evaluate(n.n, env));
      if (!Q.isScalar(k)) throw new CalcError('Root index must be a number');
      const kn = N.toNumber(k.si);
      return broadcast1(evaluate(n.a, env), (x) =>
        Number.isInteger(kn) && kn > 0 ? Q.root(x, kn) : Q.pow(x, scalar(N.div(N.ONE, k.si))),
      );
    }
    case 'list': {
      const items = n.items.map((it) => asQ(evaluate(it, env), 'item (nested lists are not supported)'));
      return { t: 'list', items: unifyList(items) };
    }
    case 'ucall': {
      const fd = env.getFunc(n.name);
      if (!fd) throw new CalcError(`“${n.name}” isn't a function: define it like ${n.name}(x) = …`);
      if (fd.params.length !== n.args.length)
        throw new CalcError(`${n.name} expects ${fd.params.length} argument${fd.params.length === 1 ? '' : 's'}`);
      if ((env.depth ?? 0) > 200) throw new CalcError('Too much recursion');
      const locals = new Map(env.locals ?? []);
      fd.params.forEach((p, i) => locals.set(p, evaluate(n.args[i], env)));
      try {
        return evaluate(fd.body, { ...(fd.env ?? env), locals, depth: (env.depth ?? 0) + 1 });
      } catch (e) {
        if (e instanceof CalcError) throw new CalcError(`${n.name}: ${e.message}`);
        throw e;
      }
    }
    case 'integral':
      return qv(evalIntegral(n, env));
    case 'deriv':
      return qv(evalDerivative(n, env));
    case 'limit':
      return qv(evalLimit(n, env));
    case 'series':
      return qv(evalSeries(n, env));
    case 'piecewise': {
      for (const b of n.branches) if (!b.cond || condHolds(b.cond, env)) return evaluate(b.value, env);
      throw new CalcError('No piecewise case applies here, and there is no “otherwise” value');
    }
    case 'call': {
      let r = callBuiltin(n.name, n.args.map((a) => evaluate(a, env)), env, n.base ? asQ(evaluate(n.base, env)) : undefined, n.args);
      if (n.power) {
        const p = evaluate(n.power, env);
        r = broadcast2(r, p, Q.pow);
      }
      return r;
    }
  }
}

// ── Calculus and piecewise (D27) ─────────────────────────────────────────────
type CalcNode<K extends Node['k']> = Extract<Node, { k: K }>;

/** Env where `v` is bound to the quantity q. */
function bind(env: Env, v: string, q: Quantity): Env {
  const locals = new Map(env.locals ?? []);
  locals.set(v, qv(q));
  return { ...env, locals };
}

const isZeroOrInf = (q: Quantity) => {
  const x = N.toNumber(q.si);
  return dimEq(q.dim, DIMLESS) && !q.unit.length && (x === 0 || !Number.isFinite(x));
};

/** Size of one display unit of q, in SI: the natural step for numeric methods. */
function unitScale(q: Quantity): number {
  const f = q.unit.length ? Math.abs(N.toNumber(unitFactor(q.unit))) : 1;
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/** f(x) as a plain SI number, checking every sample has the same dimension. */
function sampler(body: Node, env: Env, v: string, like: Quantity, what: string) {
  let dimRef: Quantity | undefined;
  const at = (x: number): Quantity => {
    const r = evaluate(body, bind(env, v, { si: N.float(x), dim: like.dim, unit: like.unit }));
    const q = asQ(r, `value from the ${what}`);
    if (dimRef && !dimEq(q.dim, dimRef.dim)) throw new CalcError(`The ${what} changes dimension (${describe(dimRef)} vs ${describe(q)})`);
    dimRef ??= q;
    return q;
  };
  return { at, num: (x: number) => N.toNumber(at(x).si) };
}

function numeric<T>(fn: () => T, what: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof NumericError) throw new CalcError(`This ${what.toLowerCase()} ${e.message}`);
    throw e;
  }
}

function withSi(q: Quantity, si: number): Quantity {
  return { si: N.float(si), dim: q.dim, unit: q.unit };
}

function evalIntegral(n: CalcNode<'integral'>, env: Env): Quantity {
  const lo = asQ(evaluate(n.lo, env), 'lower limit');
  const hi = asQ(evaluate(n.hi, env), 'upper limit');
  // the variable takes the units of the limits; 0 and ∞ fit any unit
  const like = isZeroOrInf(lo) ? hi : lo;
  for (const b of [lo, hi])
    if (!isZeroOrInf(b) && !dimEq(b.dim, like.dim)) throw new CalcError(`Integral limits don't match: ${describe(lo)} and ${describe(hi)}`);
  const a = N.toNumber(lo.si);
  const b = N.toNumber(hi.si);
  const s = sampler(n.body, env, n.v, like, 'integrand');
  const scale = unitScale(like);
  const mid = Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a + scale : Number.isFinite(b) ? b - scale : 0;
  const sample = s.at(mid);
  const value = numeric(() => integrate(s.num, a, b), 'Integral');
  const unitOf = Q.mul({ ...sample, si: N.ONE, tempKind: undefined }, { si: N.ONE, dim: like.dim, unit: like.unit });
  return withSi(unitOf, value);
}

function evalDerivative(n: CalcNode<'deriv'>, env: Env): Quantity {
  const cur = env.locals?.get(n.v) ?? env.getVar(n.v);
  if (!cur)
    throw new CalcError(`d/d${n.v} is taken at the current value of ${n.v}: define ${n.v}, or use it in a function like g(${n.v}) = d/d${n.v} …`);
  const x0 = asQ(cur, `value of ${n.v}`);
  const s = sampler(n.body, env, n.v, x0, 'expression');
  const sample = s.at(N.toNumber(x0.si));
  const value = numeric(() => derivative(s.num, N.toNumber(x0.si), unitScale(x0), n.order), 'Derivative');
  let unitOf: Quantity = { ...sample, si: N.ONE, tempKind: undefined };
  const per = { si: N.ONE, dim: x0.dim, unit: x0.unit };
  for (let k = 0; k < n.order; k++) unitOf = Q.div(unitOf, per);
  return withSi(unitOf, value);
}

function evalLimit(n: CalcNode<'limit'>, env: Env): Quantity {
  const to = asQ(evaluate(n.to, env), 'limit point');
  const a = N.toNumber(to.si);
  const scale = unitScale(to);
  const s = sampler(n.body, env, n.v, to, 'expression');
  const probe = Number.isFinite(a) ? a + (n.dir === '-' ? -1 : 1) * 0.01 * Math.max(Math.abs(a), scale) : a > 0 ? 1e3 * scale : -1e3 * scale;
  const sample = s.at(probe);
  const value = numeric(() => limit(s.num, a, scale, n.dir), 'Limit');
  return withSi({ ...sample, tempKind: undefined }, value);
}

function evalSeries(n: CalcNode<'series'>, env: Env): Quantity {
  const int = (node: Node, what: string): bigint => {
    const q = asQ(evaluate(node, env), what);
    const x = q.si;
    if (!Q.isScalar(q) || !N.isExact(x) || x.d !== 1n) {
      if (Q.isScalar(q) && !Number.isFinite(N.toNumber(x))) throw new CalcError(`${n.op === 'sum' ? 'Σ' : 'Π'} needs a finite upper limit`);
      throw new CalcError(`The ${what} of ${n.op === 'sum' ? 'Σ' : 'Π'} must be a whole number`);
    }
    return x.n;
  };
  const lo = int(n.lo, 'lower limit');
  const hi = int(n.hi, 'upper limit');
  if (hi - lo > 1_000_000n) throw new CalcError('That’s more than a million terms');
  let acc: Quantity | undefined;
  for (let k = lo; k <= hi; k++) {
    const term = asQ(evaluate(n.body, bind(env, n.v, scalar(N.exact(k)))), 'term');
    acc = acc ? (n.op === 'sum' ? Q.add(acc, term) : Q.mul(acc, term)) : term;
  }
  return acc ?? scalar(n.op === 'sum' ? N.ZERO : N.ONE);
}

function condHolds(c: Cond, env: Env): boolean {
  const qs = c.items.map((x) => asQ(evaluate(x, env), 'value in a condition'));
  for (let i = 0; i < c.ops.length; i++) {
    const a = qs[i];
    const b = qs[i + 1];
    if (!dimEq(a.dim, b.dim) && !isZeroOrInf(a) && !isZeroOrInf(b)) throw new CalcError(`Can't compare ${describe(a)} with ${describe(b)}`);
    const r = N.cmp(a.si, b.si);
    const ok = { '<': r < 0, '>': r > 0, '≤': r <= 0, '≥': r >= 0, '=': r === 0, '≠': r !== 0 }[c.ops[i]];
    if (!ok) return false;
  }
  return true;
}

function absQ(x: Quantity): Quantity {
  if (x.tempKind === 'absolute') throw new CalcError("Can't take abs of an absolute temperature");
  return N.cmp(x.si, N.ZERO) < 0 ? Q.neg(x) : x;
}

// ── Builtins ─────────────────────────────────────────────────────────────────
const RAD = [{ id: 'rad', power: 1 }];
const DEG = [{ id: '°', power: 1 }];
const ANGLE = dim({ A: 1 });

function toRadians(x: Quantity, env: Env, fn: string): number {
  if (isAngle(x.dim)) return N.toNumber(x.si);
  if (dimEq(x.dim, DIMLESS)) return env.angle === 'deg' ? (N.toNumber(x.si) * Math.PI) / 180 : N.toNumber(x.si);
  throw new CalcError(`${fn} expects an angle or a dimensionless number; got ${describe(x)}`);
}

/** Exact results at special angles (multiples of 30°/45°). */
function exactTrig(fn: string, rad: number): N.Num | null {
  const deg = (rad * 180) / Math.PI;
  const k = Math.round(deg);
  if (Math.abs(deg - k) > 1e-9) return null;
  const m = ((k % 360) + 360) % 360;
  const sinT: Record<number, N.Num> = { 0: N.ZERO, 30: N.exact(1n, 2n), 90: N.ONE, 150: N.exact(1n, 2n), 180: N.ZERO, 210: N.exact(-1n, 2n), 270: N.exact(-1n), 330: N.exact(-1n, 2n) };
  const cosT: Record<number, N.Num> = { 0: N.ONE, 60: N.exact(1n, 2n), 90: N.ZERO, 120: N.exact(-1n, 2n), 180: N.exact(-1n), 240: N.exact(-1n, 2n), 270: N.ZERO, 300: N.exact(1n, 2n) };
  const tanT: Record<number, N.Num> = { 0: N.ZERO, 45: N.ONE, 135: N.exact(-1n), 180: N.ZERO, 225: N.ONE, 315: N.exact(-1n) };
  if (fn === 'sin') return sinT[m] ?? null;
  if (fn === 'cos') return cosT[m] ?? null;
  if (fn === 'tan') return tanT[m] ?? null;
  return null;
}

function requireDimless(x: Quantity, fn: string): number {
  if (!isDimlessLoose(x.dim)) throw new CalcError(`${fn} expects a dimensionless number; got ${describe(x)}`);
  return N.toNumber(x.si);
}

function angleResult(r: number, env: Env): Quantity {
  return { si: N.float(r), dim: ANGLE, unit: env.angle === 'deg' ? DEG : RAD };
}

function flatten(args: Value[]): Quantity[] {
  const out: Quantity[] = [];
  for (const a of args) a.t === 'q' ? out.push(a.q) : out.push(...a.items);
  return out;
}

function sameDimAll(xs: Quantity[], fn: string) {
  if (!xs.length) throw new CalcError(`${fn} needs at least one value`);
  for (const x of xs)
    if (!dimEq(x.dim, xs[0].dim)) throw new CalcError(`${fn}: can't mix ${describe(xs[0])} and ${describe(x)}`);
}

function inUnitOf(q: Quantity, like: Quantity): Quantity {
  return { ...q, unit: like.unit, tempKind: like.tempKind ?? q.tempKind };
}

const ELEMENTWISE = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'arcsec', 'arccsc', 'arccot', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'exp', 'ln', 'log', 'sqrt', 'abs', 'floor', 'ceil', 'sign', 'gamma', 'erf', 'erfc',
]);

/** Non-negative integer argument (exact), for combinatorics and number theory. */
function requireInt(x: Quantity, fn: string): bigint {
  if (!isDimlessLoose(x.dim)) throw new CalcError(`${fn} expects whole numbers; got ${describe(x)}`);
  const v = x.si;
  if (N.isExact(v) && v.d === 1n) return v.n;
  const f = N.toNumber(v);
  if (Number.isInteger(f) && Math.abs(f) <= Number.MAX_SAFE_INTEGER) return BigInt(f);
  throw new CalcError(`${fn} expects whole numbers`);
}

const bigAbs = (a: bigint) => (a < 0n ? -a : a);
function bigGcd(a: bigint, b: bigint): bigint {
  a = bigAbs(a);
  b = bigAbs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
/** Γ(x) for real x (Lanczos, g = 7; reflection for x < ½). */
export function gammaReal(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaReal(1 - x));
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/** erf(x): Taylor series near 0, continued fraction for erfc in the tails. */
export function erfReal(x: number): number {
  if (x < 0) return -erfReal(-x);
  if (x < 2.5) {
    let term = x;
    let sum = x;
    for (let n = 1; n < 100; n++) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return (2 / Math.sqrt(Math.PI)) * sum;
  }
  return 1 - erfcTail(x);
}
function erfcTail(x: number): number {
  let k = x;
  for (let n = 60; n >= 1; n--) k = x + n / 2 / k;
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * k);
}

function callBuiltin(name: string, args: Value[], env: Env, base: Quantity | undefined, argNodes: Node[]): Value {
  if (ELEMENTWISE.has(name)) {
    if (args.length !== 1) throw new CalcError(`${name} expects 1 argument`);
    return broadcast1(args[0], (x) => elementwise(name, x, env, base));
  }
  switch (name) {
    case 'atan2': {
      const [y, x] = args.map((a) => asQ(a));
      if (!y || !x) throw new CalcError('atan2 expects 2 arguments');
      if (!dimEq(y.dim, x.dim)) throw new CalcError(`atan2: can't mix ${describe(y)} and ${describe(x)}`);
      return qv(angleResult(Math.atan2(N.toNumber(y.si), N.toNumber(x.si)), env));
    }
    case 'nthroot': {
      const [x, k] = args.map((a) => asQ(a));
      if (!x || !k) throw new CalcError('nthroot expects 2 arguments');
      return qv(Q.root(x, N.toNumber(k.si)));
    }
    case 'round': {
      if (args.length === 2 && isUnitOnly(argNodes[1])) {
        // round(L, mm): round in that unit, show in that unit
        const u = combine(evalUnitNode(argNodes[1], env));
        return broadcast1(args[0], (x) => Q.mapDisplay(Q.convertTo(x, u), roundNum));
      }
      if (args.length === 2) {
        const d = N.toNumber(asQ(args[1]).si);
        const f = N.powRational(N.exact(10n), Math.round(d));
        return broadcast1(args[0], (x) => Q.mapDisplay(x, (v) => N.div(roundNum(N.mul(v, f)), f)));
      }
      return broadcast1(args[0], (x) => Q.mapDisplay(x, roundNum));
    }
    case 'mod': {
      const [a, b] = args;
      if (!a || !b) throw new CalcError('mod expects 2 arguments');
      return broadcast2(a, b, (x, y) => {
        if (!dimEq(x.dim, y.dim)) throw new CalcError(`mod: can't mix ${describe(x)} and ${describe(y)}`);
        const q = N.floor(N.div(x.si, y.si));
        return { ...x, si: N.sub(x.si, N.mul(y.si, q)) };
      });
    }
    case 'min':
    case 'max': {
      const xs = flatten(args);
      sameDimAll(xs, name);
      let best = xs[0];
      for (const x of xs) if ((name === 'min' ? N.cmp(x.si, best.si) < 0 : N.cmp(x.si, best.si) > 0)) best = x;
      return qv(inUnitOf(best, xs[0]));
    }
    case 'sum': {
      const xs = flatten(args);
      if (!xs.length) return qv(scalar(N.ZERO));
      let acc = xs[0];
      for (const x of xs.slice(1)) acc = Q.add(acc, x);
      return qv(acc);
    }
    case 'mean': {
      const xs = flatten(args);
      sameDimAll(xs, name);
      let acc = xs[0];
      for (const x of xs.slice(1)) acc = Q.add(acc, x);
      return qv({ ...acc, si: N.div(acc.si, N.exact(BigInt(xs.length))) });
    }
    case 'median': {
      const xs = flatten(args);
      sameDimAll(xs, name);
      const s = [...xs].sort((a, b) => N.cmp(a.si, b.si));
      const mid = Math.floor(s.length / 2);
      const si = s.length % 2 ? s[mid].si : N.div(N.add(s[mid - 1].si, s[mid].si), N.exact(2n));
      return qv({ ...xs[0], si });
    }
    case 'var':
    case 'stdev': {
      const xs = flatten(args);
      sameDimAll(xs, name);
      if (xs.length < 2) throw new CalcError(`${name} needs at least 2 values`);
      const n = BigInt(xs.length);
      let m: N.Num = N.ZERO;
      for (const x of xs) m = N.add(m, x.si);
      m = N.div(m, N.exact(n));
      let ss: N.Num = N.ZERO;
      for (const x of xs) {
        const d = N.sub(x.si, m);
        ss = N.add(ss, N.mul(d, d));
      }
      const variance = N.div(ss, N.exact(n - 1n));
      const first = xs[0];
      const sq = Q.mul({ ...first, si: N.ONE }, { ...first, si: N.ONE });
      const varQ: Quantity = { ...sq, si: variance };
      return qv(name === 'var' ? varQ : Q.root(varQ, 2));
    }
    case 'count':
      return qv(scalar(N.exact(BigInt(flatten(args).length))));
    case 'nCr':
    case 'nPr': {
      if (args.length !== 2) throw new CalcError(`${name} expects 2 arguments`);
      return broadcast2(args[0], args[1], (a, b) => {
        const n = requireInt(a, name);
        const k = requireInt(b, name);
        if (n < 0n || k < 0n) throw new CalcError(`${name} expects non-negative whole numbers`);
        if (k > n) return scalar(N.ZERO);
        let r = 1n;
        for (let i = 0n; i < k; i++) r *= n - i;
        if (name === 'nCr') {
          let f = 1n;
          for (let i = 2n; i <= k; i++) f *= i;
          r /= f;
        }
        return scalar(N.exact(r));
      });
    }
    case 'gcd':
    case 'lcm': {
      const xs = flatten(args).map((x) => requireInt(x, name));
      if (!xs.length) throw new CalcError(`${name} needs at least one value`);
      let acc = bigAbs(xs[0]);
      for (const v of xs.slice(1)) {
        if (name === 'gcd') acc = bigGcd(acc, v);
        else acc = acc === 0n || v === 0n ? 0n : bigAbs(acc * v) / bigGcd(acc, v);
      }
      return qv(scalar(N.exact(acc)));
    }
    case 'hypot': {
      const xs = flatten(args);
      sameDimAll(xs, name);
      let acc: Quantity | null = null;
      for (const x of xs) {
        const sq = Q.mul(x, x);
        acc = acc ? Q.add(acc, sq) : sq;
      }
      return qv(inUnitOf(Q.root(acc!, 2), xs[0]));
    }
  }
  throw new CalcError(`Unknown function ${name}`);
}

function roundNum(v: N.Num): N.Num {
  return N.floor(N.add(v, N.exact(1n, 2n)));
}

function elementwise(name: string, x: Quantity, env: Env, base?: Quantity): Quantity {
  switch (name) {
    case 'sin':
    case 'cos':
    case 'tan':
    case 'sec':
    case 'csc':
    case 'cot': {
      const r = toRadians(x, env, name);
      const core = name === 'sec' ? 'cos' : name === 'csc' ? 'sin' : name === 'cot' ? 'tan' : name;
      const ex = exactTrig(core, r);
      let v: N.Num = ex ?? N.float((Math as unknown as Record<string, (n: number) => number>)[core](r));
      if (core !== name) v = N.div(N.ONE, v);
      return scalar(v);
    }
    case 'asin':
    case 'acos':
    case 'atan':
    case 'arcsec':
    case 'arccsc':
    case 'arccot': {
      const v = requireDimless(x, name);
      const r =
        name === 'asin' ? Math.asin(v) : name === 'acos' ? Math.acos(v) : name === 'atan' ? Math.atan(v)
        : name === 'arcsec' ? Math.acos(1 / v) : name === 'arccsc' ? Math.asin(1 / v) : Math.atan(1 / v);
      if (Number.isNaN(r)) throw new CalcError(`${name}: argument out of range`);
      return angleResult(r, env);
    }
    case 'sinh':
      return scalar(N.float(Math.sinh(requireDimless(x, name))));
    case 'asinh':
      return scalar(N.float(Math.asinh(requireDimless(x, name))));
    case 'acosh': {
      const v = requireDimless(x, name);
      if (v < 1) throw new CalcError('acosh: argument must be at least 1');
      return scalar(N.float(Math.acosh(v)));
    }
    case 'atanh': {
      const v = requireDimless(x, name);
      if (Math.abs(v) >= 1) throw new CalcError('atanh: argument must be between −1 and 1');
      return scalar(N.float(Math.atanh(v)));
    }
    case 'gamma': {
      const v = requireDimless(x, name);
      if (Number.isInteger(v) && v <= 0) throw new CalcError('Γ is undefined at 0 and negative whole numbers');
      // exact for positive whole numbers: Γ(n) = (n − 1)!
      if (N.isExact(x.si) && x.si.d === 1n && x.si.n <= 1001n) return scalar(N.factorial(N.exact(x.si.n - 1n)));
      return scalar(N.float(gammaReal(v)));
    }
    case 'erf':
      return scalar(N.float(erfReal(requireDimless(x, name))));
    case 'erfc': {
      const v = requireDimless(x, name);
      return scalar(N.float(v >= 2.5 ? erfcTail(v) : 1 - erfReal(v)));
    }
    case 'cosh':
      return scalar(N.float(Math.cosh(requireDimless(x, name))));
    case 'tanh':
      return scalar(N.float(Math.tanh(requireDimless(x, name))));
    case 'exp':
      return scalar(N.float(Math.exp(requireDimless(x, name))));
    case 'ln': {
      const v = requireDimless(x, name);
      if (v <= 0) throw new CalcError('ln of a non-positive number');
      return scalar(N.float(Math.log(v)));
    }
    case 'log': {
      const v = requireDimless(x, name);
      if (v <= 0) throw new CalcError('log of a non-positive number');
      const b = base ? requireDimless(base, 'log base') : 10;
      // exact for integer powers of the base
      const r = Math.log(v) / Math.log(b);
      const ri = Math.round(r);
      if (Math.abs(r - ri) < 1e-12 && N.isExact(x.si) && N.cmp(N.powRational(N.fromNumber(b), ri), x.si) === 0)
        return scalar(N.exact(BigInt(ri)));
      return scalar(N.float(b === 10 ? Math.log10(v) : r));
    }
    case 'sqrt':
      return Q.root(x, 2);
    case 'abs':
      return absQ(x);
    case 'floor':
      return Q.mapDisplay(x, N.floor);
    case 'ceil':
      return Q.mapDisplay(x, (v) => N.neg(N.floor(N.neg(v))));
    case 'sign':
      return scalar(N.exact(BigInt(N.cmp(x.si, N.ZERO))));
  }
  throw new CalcError(`Unknown function ${name}`);
}
