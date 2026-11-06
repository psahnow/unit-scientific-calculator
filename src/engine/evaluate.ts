// AST evaluation with units, lists and builtins (DESIGN.md §5.3).
import * as N from './num';
import type { Node, Cond } from './ast';
import { integrate, derivative, limit, findRoot, findAllRoots, NumericError } from './calculus';
import { polyOf, coefficients, realRoots, termSize } from './algebra';
import { isUnitOnly, collectRefs } from './ast';
import * as Q from './quantity';
import { type Quantity, CalcError, scalar, describe } from './quantity';
import { dim, dimEq, dimDiv, dimPow, isDimlessLoose, isAngle, DIMLESS, type Dim } from './dim';
import { type UnitExpr, unitDim, unitFactor, offsetUnit, getUnit, combine, parseUnitExpr, formatUnit } from './units/registry';
import { CONST_BY_KEY } from './units/constants.data';
import { diff, antiderivative, div as divNode, type Need } from './symbolic';

export type Value = { t: 'q'; q: Quantity } | { t: 'list'; items: Quantity[] };

export interface FuncDef {
  params: string[];
  /** Declared input units, f(l: m) (D52). */
  paramUnits?: (Node | undefined)[];
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

/**
 * An input to f(l: m) (D52): a quantity of the declared dimension, shown in the declared unit
 * (3 in → 0.0762 m); a plain number is read in that unit (3 → 3 m).
 */
/** The unit an input declares: f(l: m) → m; f(k: real) → none, a plain number (D54). */
export function declaredUnit(un: Node, env: Env): UnitExpr {
  return un.k === 'num' ? [] : combine(evalUnitNode(un, env));
}

function typedInput(q: Quantity, u: UnitExpr, fn: string, param: string): Quantity {
  const want = unitDim(u);
  if (!q.unit.length && dimEq(q.dim, DIMLESS) && !dimEq(want, DIMLESS)) return Q.fromUnit(q.si, u);
  if (!dimEq(q.dim, want))
    throw new CalcError(
      u.length
        ? `${fn} needs ${param} in ${formatUnit(u)} (${describe({ dim: want, unit: u })}); got ${describe(q)}`
        : `${fn} needs ${param} as a plain number (real), without units; got ${describe(q)}`,
    );
  return Q.convertTo(q, u);
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
      if ((env.depth ?? 0) > 200) throw new RecursionError(`“${n.name}” keeps calling itself and never stops: give it a case that doesn't call ${n.name}, e.g. with a piecewise { }`);
      const locals = new Map(env.locals ?? []);
      fd.params.forEach((p, i) => {
        const arg = evaluate(n.args[i], env);
        const un = fd.paramUnits?.[i];
        locals.set(p, un ? broadcast1(arg, (q) => typedInput(q, declaredUnit(un, fd.env ?? env), n.name, p)) : arg);
      });
      try {
        return evaluate(fd.body, { ...(fd.env ?? env), locals, depth: (env.depth ?? 0) + 1 });
      } catch (e) {
        // one "f: " prefix at most, and none on the self-call explanation
        if (e instanceof RecursionError || (e instanceof CalcError && e.message.startsWith(`${n.name}: `))) throw e;
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
    case 'solve':
      return evalSolve(n, env);
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
  // exact answer from an antiderivative when there is one (D44); the numeric value checks it
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const sym = attempt(() => {
      const ctx = { v: n.v, deg: env.angle === 'deg', constValue: (c: Node) => scalarOf(c, env) };
      const { F, needs } = antiderivative(n.body, ctx);
      const at = (x: Quantity) => bind(env, n.v, { si: x.si, dim: like.dim, unit: like.unit });
      if (!needs.every((nd) => holds(nd, [at(lo), at(hi)]))) return null;
      const Fa = asQ(evaluate(F, at(lo)));
      const Fb = asQ(evaluate(F, at(hi)));
      const scaleF = Math.max(Math.abs(N.toNumber(Fa.si)), Math.abs(N.toNumber(Fb.si)));
      return agree(Q.sub(Fb, Fa), unitOf, value, Math.max(1e-7 * Math.abs(value), 1e-9 * scaleF));
    });
    if (sym) return sym;
  }
  return withSi(unitOf, value);
}

/** Run a symbolic attempt; any failure means "use the numeric answer". */
function attempt(fn: () => Quantity | null): Quantity | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** The exact value of a plain-number node that doesn't involve the variable, if it has one. */
function scalarOf(c: Node, env: Env): N.Num | null {
  const v = evaluate(c, env);
  return v.t === 'q' && Q.isScalar(v.q) ? v.q.si : null;
}

/** Whether a linear expression keeps the sign an antiderivative needs, at both ends. */
function holds(nd: Need, ends: Env[]): boolean {
  const [x, y] = ends.map((e) => N.toNumber(asQ(evaluate(nd.L, e)).si));
  if (nd.kind === 'pos') return x > 0 && y > 0;
  if (nd.kind === 'nonneg') return x >= 0 && y >= 0;
  return x * y > 0;
}

/**
 * A symbolic result is used only when it has the expected dimension and agrees with the numeric
 * one; it then keeps its exact value (1/3, not 0.3333333333) in the numeric result's units.
 */
function agree(sym: Quantity, unitOf: Quantity, numericValue: number, tol: number): Quantity | null {
  if (!dimEq(sym.dim, unitOf.dim)) return null;
  const x = N.toNumber(sym.si);
  if (!Number.isFinite(x) || !(Math.abs(x - numericValue) <= tol)) return null;
  return { si: sym.si, dim: unitOf.dim, unit: unitOf.unit };
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
  // exact derivative by the rules of differentiation when they cover the expression (D44)
  const sym = attempt(() => {
    const ctx = { v: n.v, deg: env.angle === 'deg' };
    let d: Node | null = n.body;
    for (let k = 0; k < n.order && d; k++) d = diff(d, ctx);
    const q: Quantity = d ? asQ(evaluate(d, bind(env, n.v, x0))) : { si: N.ZERO, dim: unitOf.dim, unit: unitOf.unit };
    const x = Math.max(Math.abs(N.toNumber(x0.si)), unitScale(x0));
    const S = Math.max(Math.abs(value), Math.abs(N.toNumber(sample.si)) / Math.pow(x, n.order));
    return agree(q, unitOf, value, (n.order === 1 ? 1e-6 : 1e-5) * S);
  });
  return sym ?? withSi(unitOf, value);
}

function evalLimit(n: CalcNode<'limit'>, env: Env): Quantity {
  const to = asQ(evaluate(n.to, env), 'limit point');
  const a = N.toNumber(to.si);
  const scale = unitScale(to);
  const s = sampler(n.body, env, n.v, to, 'expression');
  const probe = Number.isFinite(a) ? a + (n.dir === '-' ? -1 : 1) * 0.01 * Math.max(Math.abs(a), scale) : a > 0 ? 1e3 * scale : -1e3 * scale;
  const sample = s.at(probe);
  const value = numeric(() => limit(s.num, a, scale, n.dir), 'Limit');
  const unitOf = { ...sample, tempKind: undefined };
  // exact value by substitution, or by l'Hôpital's rule for 0/0 (D44); the numeric limit checks it
  if (Number.isFinite(a) && Number.isFinite(value)) {
    const sym = attempt(() => {
      const q = substituteLimit(n.body, bind(env, n.v, to), { v: n.v, deg: env.angle === 'deg' }, 0);
      return q && agree(q, unitOf, value, 1e-6 * Math.max(Math.abs(value), Math.abs(N.toNumber(sample.si))));
    });
    if (sym) return sym;
  }
  return withSi(unitOf, value);
}

/** The body's value at the limit point, applying l'Hôpital's rule (up to 4 times) to 0/0. */
function substituteLimit(body: Node, at: Env, ctx: { v: string; deg: boolean }, depth: number): Quantity | null {
  try {
    const q = asQ(evaluate(body, at));
    if (Number.isFinite(N.toNumber(q.si))) return q;
  } catch {
    /* not defined at the point: try l'Hôpital */
  }
  if (depth >= 4 || body.k !== 'bin' || body.op !== '/') return null;
  const top = asQ(evaluate(body.a, at));
  const bottom = asQ(evaluate(body.b, at));
  if (N.toNumber(top.si) !== 0 || N.toNumber(bottom.si) !== 0) return null;
  const da = diff(body.a, ctx);
  const db = diff(body.b, ctx);
  if (!da || !db) return null;
  return substituteLimit(divNode(da, db), at, ctx, depth + 1);
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

function evalSolve(n: CalcNode<'solve'>, env: Env): Value {
  const hints = n.hints.map((h) => asQ(evaluate(h, env), 'guess'));
  // the variable's units: from the guess/range, else its current value, else worked out from the equation
  const current = env.locals?.get(n.v) ?? (() => {
    try {
      return env.getVar(n.v);
    } catch {
      return undefined;
    }
  })();
  let like: Quantity | undefined = hints.find((h) => !isZeroOrInf(h)) ?? (current?.t === 'q' ? current.q : undefined);
  const side = (node: Node, x: Quantity) => asQ(evaluate(node, bind(env, n.v, x)), 'value');
  if (!like) like = inferUnknown(n, side);
  const unitOf = { dim: like.dim, unit: like.unit };
  const at = (x: number) => ({ si: N.float(x), ...unitOf });
  // f(x) = lhs − rhs, which must have matching dimensions
  const probe = (x: number) => {
    const a = side(n.lhs, at(x));
    const b = side(n.rhs, at(x));
    if (!dimEq(a.dim, b.dim) && !isZeroOrInf(a) && !isZeroOrInf(b))
      throw new CalcError(`The two sides of the equation don't match: ${describe(a)} and ${describe(b)}`);
    return N.toNumber(a.si) - N.toNumber(b.si);
  };
  const scale = unitScale(like);
  const guess = hints.length === 1 ? N.toNumber(hints[0].si) : current?.t === 'q' ? N.toNumber(current.q.si) : scale;
  probe(guess); // surface dimension errors with a clear message
  const lo = hints.length === 2 ? N.toNumber(hints[0].si) : undefined;
  const hi = hints.length === 2 ? N.toNumber(hints[1].si) : undefined;
  const inRange = (r: N.Num) => lo === undefined || hi === undefined || (N.toNumber(r) >= Math.min(lo, hi) && N.toNumber(r) <= Math.max(lo, hi));
  const asRoot = (r: N.Num): Quantity => ({ si: r, dim: like.dim, unit: like.unit });

  // algebra first (D51): a polynomial in the unknown has all its real roots worked out, exactly when
  // possible; each is checked back in the equation, and anything doubtful goes to the numeric solver
  let noUnknown = false;
  const algebraic = ((): N.Num[] | null => {
    try {
      const ctx = { v: n.v, x: { si: N.ONE, dim: like.dim, unit: like.unit }, constant: (c: Node) => asQ(evaluate(c, env)) };
      const p = polyOf(n.lhs, ctx);
      const q = polyOf(n.rhs, ctx);
      const diff = p.map((x) => x ?? null);
      for (let k = 0; k < q.length; k++) {
        const b = q[k];
        if (!b) continue;
        diff[k] = diff[k] ? Q.sub(diff[k]!, b) : Q.neg(b);
      }
      const cs = coefficients(diff);
      if (cs.length < 2) {
        noUnknown = true; // no unknown left: let the numeric solver explain
        return null;
      }
      const rs = realRoots(cs);
      // every root must satisfy the equation as written
      for (const r of rs) {
        const x = N.toNumber(r);
        if (Math.abs(probe(x)) > 1e-9 * termSize(cs, x) + 1e-300) return null;
      }
      return rs;
    } catch {
      return null;
    }
  })();

  if (n.all) {
    let rs: N.Num[];
    if (algebraic) rs = algebraic.filter(inRange);
    else {
      if (noUnknown) throw new CalcError(`There’s no ${n.v} left in this equation to find roots for`);
      if (lo === undefined || hi === undefined)
        throw new CalcError(`This equation isn’t a polynomial in ${n.v}, so roots( ) needs a range to search: roots(…, ${n.v}, 0, 10)`);
      rs = numeric(() => findAllRoots(probe, lo, hi), 'Equation').map((x) => N.float(snapRoot(x, scale)));
    }
    if (!rs.length) throw new CalcError(lo !== undefined ? 'This equation has no real roots in that range' : 'This equation has no real roots');
    return { t: 'list', items: rs.map(asRoot) };
  }
  if (algebraic) {
    const candidates = algebraic.filter(inRange);
    if (candidates.length) {
      // the root nearest the guess (or the lowest in a range)
      const best = candidates.reduce((a, b) => (lo === undefined && Math.abs(N.toNumber(b) - guess) < Math.abs(N.toNumber(a) - guess) ? b : a));
      return qv(asRoot(best));
    }
  }
  const root = numeric(() => findRoot(probe, guess, scale, lo, hi), 'Equation');
  return qv(asRoot(N.float(snapRoot(root, scale))));
}

/** 1.9999999999997 → 2 when that's within rounding of the solver. */
function snapRoot(x: number, scale: number): number {
  const r = Math.round(x / scale * 1e9) / 1e9 * scale;
  return Math.abs(r - x) <= 1e-12 * Math.max(Math.abs(x), scale) ? r : x;
}

/** Work out the unknown's dimension from how the equation's dimensions change with it. */
function inferUnknown(n: CalcNode<'solve'>, side: (node: Node, x: Quantity) => Quantity): Quantity {
  const plain = scalar(N.ONE);
  try {
    const rhs = side(n.rhs, plain);
    const d0 = side(n.lhs, plain).dim;
    const d1 = side(n.lhs, { si: N.ONE, dim: dim({ L: 1 }), unit: [{ id: 'm', power: 1 }] }).dim;
    const p = d1.L - d0.L; // how many times the unknown multiplies into the left side
    if (p === 0) return plain;
    const need = dimDiv(rhs.dim, d0);
    const xd = dimPow(need, 1 / p);
    return { si: N.ONE, dim: xd, unit: siUnitFor(xd) };
  } catch {
    return plain;
  }
}

/** A plain SI unit expression for a dimension (m², N, …). */
function siUnitFor(d: Dim): UnitExpr {
  const base: [keyof Dim, string][] = [['L', 'm'], ['M', 'kg'], ['T', 's'], ['I', 'A'], ['K', 'K'], ['N', 'mol'], ['J', 'cd'], ['A', 'rad']];
  const raw = base.filter(([k]) => d[k] !== 0).map(([k, id]) => ({ id, power: d[k] }));
  return Q.mul({ si: N.ONE, dim: d, unit: raw }, scalar(N.ONE)).unit;
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

class RecursionError extends CalcError {}

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
  if (!isDimlessLoose(x.dim)) {
    const u = formatUnit(x.unit) || describe(x);
    throw new CalcError(`${fn} needs a plain number, but this has units (${u}). Divide by a unit to use its value, like ${fn}(x / 1 ${x.unit[0]?.id ?? 'm'})`);
  }
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

// ── Dimensional analysis of a function body (D53) ────────────────────────────
/**
 * The unit an expression gives, worked out from the units alone (no input values): typed inputs
 * have their declared units, worksheet names their values' units, and each operation combines
 * units the way the evaluator does (N·m, kN/mm², √(m²) = m; sin, ln … give plain numbers). The
 * result is a unit quantity (SI value 1) or null when it can't be told without values.
 */
export function inferUnit(n: Node, env: Env, known: Map<string, Quantity>, depth = 0): Quantity | null {
  if (depth > 40) return null;
  const one = (q: Quantity): Quantity => ({ si: N.ONE, dim: q.dim, unit: q.unit, ...(q.tempKind ? { tempKind: q.tempKind } : {}) });
  const plain = scalar(N.ONE);
  const sub = (m: Node, k = known) => inferUnit(m, env, k, depth + 1);
  const constant = (m: Node): Quantity | null => {
    try {
      const v = evaluate(m, env);
      return v.t === 'q' ? v.q : (v.items[0] ?? null);
    } catch {
      return null;
    }
  };
  const uses = (m: Node) => [...known.keys()].some((k) => collectRefs(m).has(k));
  try {
    switch (n.k) {
      case 'num':
      case 'pi':
      case 'euler':
      case 'fact':
        return plain;
      case 'var': {
        const k = known.get(n.name);
        if (k) return k;
        const c = constant(n);
        return c && one(c);
      }
      case 'unit':
      case 'const': {
        const c = constant(n);
        return c && one(c);
      }
      case 'qty': {
        const [a, b] = [sub(n.v), sub(n.u)];
        return a && b ? Q.mul(a, b) : null;
      }
      case 'neg':
      case 'abs':
        return sub(n.a);
      case 'list':
        return n.items.length ? sub(n.items[0]) : null;
      case 'piecewise':
        return n.branches.length ? sub(n.branches[0].value) : null;
      case 'root': {
        const [a, k] = [sub(n.a), uses(n.n) ? null : constant(n.n)];
        return a && k ? Q.root(a, N.toNumber(k.si)) : null;
      }
      case 'bin': {
        const [a, b] = [sub(n.a), n.op === '^' ? null : sub(n.b)];
        if (n.op === '^') {
          if (!a) return null;
          if (dimEq(a.dim, DIMLESS)) return plain;
          const e = uses(n.b) ? null : constant(n.b);
          return e ? Q.pow(a, e) : null;
        }
        if (!a || !b) return null;
        if (n.op === '*') return Q.mul(a, b);
        if (n.op === '/') return Q.div(a, b);
        // + and −: the dimensions must match; the first operand's unit wins
        return dimEq(a.dim, b.dim) ? a : null;
      }
      case 'call': {
        let r = inferCall(n.name, n.args.map((a) => sub(a)), n.args, env, known, constant, uses);
        if (r && n.power) {
          const e = uses(n.power) ? null : constant(n.power);
          r = e ? Q.pow(r, e) : null;
        }
        return r;
      }
      case 'ucall': {
        const fd = env.getFunc(n.name);
        if (!fd || !fd.paramUnits || fd.params.some((_, i) => !fd.paramUnits?.[i])) return null;
        const inner = new Map<string, Quantity>();
        fd.params.forEach((p, i) => inner.set(p, unitQuantity(declaredUnit(fd.paramUnits![i]!, fd.env ?? env))));
        return inferUnit(fd.body, fd.env ?? env, inner, depth + 1);
      }
      case 'integral': {
        const v = sub(n.hi) ?? sub(n.lo);
        if (!v) return null;
        const body = sub(n.body, new Map(known).set(n.v, one(v)));
        return body ? Q.mul(body, one(v)) : null;
      }
      case 'deriv': {
        const v = known.get(n.v) ?? (() => {
          const c = constant({ k: 'var', name: n.v });
          return c && one(c);
        })();
        if (!v) return null;
        let r = sub(n.body, new Map(known).set(n.v, v));
        for (let k = 0; k < n.order && r; k++) r = Q.div(r, v);
        return r;
      }
      case 'limit': {
        const v = sub(n.to);
        return v ? sub(n.body, new Map(known).set(n.v, one(v))) : null;
      }
      case 'series':
        return n.op === 'sum' ? sub(n.body, new Map(known).set(n.v, plain)) : null;
    }
  } catch {
    return null;
  }
  return null;
}

const PLAIN_FUNCS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'exp', 'ln', 'log',
  'sign', 'gamma', 'erf', 'erfc', 'nCr', 'nPr', 'gcd', 'lcm', 'count',
]);
const SAME_FUNCS = new Set(['abs', 'floor', 'ceil', 'round', 'min', 'max', 'sum', 'mean', 'median', 'stdev', 'hypot', 'mod']);

function inferCall(
  name: string,
  args: (Quantity | null)[],
  argNodes: Node[],
  env: Env,
  _known: Map<string, Quantity>,
  constant: (m: Node) => Quantity | null,
  uses: (m: Node) => boolean,
): Quantity | null {
  if (PLAIN_FUNCS.has(name)) return scalar(N.ONE);
  if (['asin', 'acos', 'atan', 'arcsec', 'arccsc', 'arccot', 'atan2'].includes(name)) return unitQuantity(env.angle === 'deg' ? DEG : RAD);
  if (SAME_FUNCS.has(name)) return args[0] ?? null;
  if (name === 'sqrt') return args[0] ? Q.root(args[0], 2) : null;
  if (name === 'var') return args[0] ? Q.mul(args[0], args[0]) : null;
  if (name === 'nthroot') {
    const k = argNodes[1] && !uses(argNodes[1]) ? constant(argNodes[1]) : null;
    return args[0] && k ? Q.root(args[0], N.toNumber(k.si)) : null;
  }
  return null;
}
