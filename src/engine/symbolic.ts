// Symbolic calculus (D44): exact derivatives and antiderivatives as expression trees, which the
// normal evaluator then works out with units and exact rationals. Anything not covered throws
// Unsupported and the caller falls back to the numeric method; the caller also checks every
// symbolic answer against the numeric one, so a gap here can cost precision but never a wrong value.
import type { Node } from './ast';
import { collectRefs } from './ast';
import * as N from './num';

export class Unsupported extends Error {}

export interface SymCtx {
  /** The variable of differentiation / integration. */
  v: string;
  /** Degree mode: trig takes degrees, so the plain rules don't apply. */
  deg: boolean;
}

// ── node builders, with the obvious simplifications ──
export const num = (n: number | bigint, d: bigint = 1n): Node => ({ k: 'num', v: N.exact(BigInt(n), d) });
const isNum = (n: Node, k: number) => n.k === 'num' && N.isExact(n.v) && n.v.n === BigInt(k) && n.v.d === 1n;
const bin = (op: '+' | '-' | '*' | '/' | '^', a: Node, b: Node): Node => ({ k: 'bin', op, a, b });
export const mul = (a: Node, b: Node): Node => (isNum(a, 1) ? b : isNum(b, 1) ? a : bin('*', a, b));
export const div = (a: Node, b: Node): Node => (isNum(b, 1) ? a : bin('/', a, b));
export const add = (a: Node, b: Node): Node => bin('+', a, b);
export const sub = (a: Node, b: Node): Node => bin('-', a, b);
export const pow = (a: Node, b: Node): Node => (isNum(b, 1) ? a : bin('^', a, b));
export const neg = (a: Node): Node => ({ k: 'neg', a });
const call = (name: string, a: Node): Node => ({ k: 'call', name, args: [a] });
const sq = (a: Node) => pow(a, num(2));

export const dependsOn = (n: Node, v: string) => collectRefs(n).has(v);

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'arcsec', 'arccsc', 'arccot']);

// ── differentiation; null means zero ──
type D = Node | null;
const dAdd = (a: D, b: D): D => (a && b ? add(a, b) : (a ?? b));
const dSub = (a: D, b: D): D => (a && b ? sub(a, b) : a ? a : b ? neg(b) : null);
const dMul = (a: D, b: Node): D => (a ? mul(a, b) : null);

export function diff(n: Node, c: SymCtx): D {
  if (!dependsOn(n, c.v)) return null;
  switch (n.k) {
    case 'var':
      return num(1);
    case 'neg': {
      const a = diff(n.a, c);
      return a ? neg(a) : null;
    }
    case 'qty':
      if (dependsOn(n.u, c.v)) throw new Unsupported();
      return dMul(diff(n.v, c), n.u);
    case 'bin': {
      const { a, b } = n;
      switch (n.op) {
        case '+':
          return dAdd(diff(a, c), diff(b, c));
        case '-':
          return dSub(diff(a, c), diff(b, c));
        case '*': {
          const db = diff(b, c);
          return dAdd(dMul(diff(a, c), b), db ? mul(a, db) : null);
        }
        case '/': {
          const da = diff(a, c);
          if (!dependsOn(b, c.v)) return da ? div(da, b) : null;
          const db = diff(b, c)!;
          return div(dSub(da ? mul(da, b) : null, mul(a, db))!, sq(b));
        }
        case '^': {
          const da = diff(a, c);
          if (!dependsOn(b, c.v)) return da ? mul(mul(b, pow(a, sub(b, num(1)))), da) : null; // b·aᵇ⁻¹·a′
          const db = diff(b, c)!;
          const lnA = a.k === 'euler' ? null : call('ln', a);
          if (!da) return mul(n, lnA ? mul(lnA, db) : db); // aᵇ·ln a·b′
          return mul(n, add(lnA ? mul(db, lnA) : db, div(mul(b, da), a))); // aᵇ·(b′ ln a + b a′/a)
        }
      }
      break;
    }
    case 'abs': {
      const da = diff(n.a, c);
      return da ? mul(call('sign', n.a), da) : null;
    }
    case 'root':
      if (dependsOn(n.n, c.v)) throw new Unsupported();
      return diff(pow(n.a, div(num(1), n.n)), c);
    case 'call': {
      if (n.power) return diff(pow({ ...n, power: undefined }, n.power), c);
      if (n.args.length !== 1) throw new Unsupported();
      const u = n.args[0];
      const du = diff(u, c);
      if (!du) return null;
      if (c.deg && TRIG.has(n.name)) throw new Unsupported();
      if (n.base) {
        if (n.name !== 'log' || dependsOn(n.base, c.v)) throw new Unsupported();
        return div(du, mul(u, call('ln', n.base))); // u′ / (u ln b)
      }
      const outer = derivOf(n.name, u);
      return outer === 'div' ? div(du, divisorOf(n.name, u)) : mul(outer, du);
    }
  }
  throw new Unsupported();
}

/** d/du f(u) for one-argument functions; 'div' means u′ / divisorOf(f, u). */
function derivOf(f: string, u: Node): Node | 'div' {
  switch (f) {
    case 'sin':
      return call('cos', u);
    case 'cos':
      return neg(call('sin', u));
    case 'sec':
      return mul(call('sec', u), call('tan', u));
    case 'csc':
      return neg(mul(call('csc', u), call('cot', u)));
    case 'sinh':
      return call('cosh', u);
    case 'cosh':
      return call('sinh', u);
    case 'exp':
      return call('exp', u);
    case 'abs':
      return call('sign', u);
    case 'erf':
      return mul(div(num(2), call('sqrt', { k: 'pi' })), call('exp', neg(sq(u))));
    case 'erfc':
      return neg(mul(div(num(2), call('sqrt', { k: 'pi' })), call('exp', neg(sq(u)))));
    case 'tan':
    case 'cot':
    case 'tanh':
    case 'asin':
    case 'acos':
    case 'atan':
    case 'arccot':
    case 'arcsec':
    case 'arccsc':
    case 'asinh':
    case 'acosh':
    case 'atanh':
    case 'ln':
    case 'log':
    case 'sqrt':
      return 'div';
  }
  throw new Unsupported();
}
function divisorOf(f: string, u: Node): Node {
  const one = num(1);
  switch (f) {
    case 'tan':
      return sq(call('cos', u));
    case 'cot':
      return neg(sq(call('sin', u)));
    case 'tanh':
      return sq(call('cosh', u));
    case 'asin':
      return call('sqrt', sub(one, sq(u)));
    case 'acos':
      return neg(call('sqrt', sub(one, sq(u))));
    case 'atan':
      return add(one, sq(u));
    case 'arccot':
      return neg(add(one, sq(u)));
    case 'arcsec':
      return mul({ k: 'abs', a: u }, call('sqrt', sub(sq(u), one)));
    case 'arccsc':
      return neg(mul({ k: 'abs', a: u }, call('sqrt', sub(sq(u), one))));
    case 'asinh':
      return call('sqrt', add(sq(u), one));
    case 'acosh':
      return call('sqrt', sub(sq(u), one));
    case 'atanh':
      return sub(one, sq(u));
    case 'ln':
      return u;
    case 'log':
      return mul(u, call('ln', num(10)));
    case 'sqrt':
      return mul(num(2), call('sqrt', u));
  }
  throw new Unsupported();
}

// ── antiderivatives ──
/**
 * A condition the antiderivative needs on [a, b] for F(b) − F(a) to be the integral. Each is on a
 * linear expression L of the variable, so checking both ends settles it.
 */
export interface Need {
  L: Node;
  kind: 'pos' | 'nonneg' | 'nonzero';
}
export interface Anti {
  F: Node;
  needs: Need[];
}

/** Hooks into the evaluator: the value of a node that doesn't involve the variable. */
export interface AntiCtx extends SymCtx {
  constValue(n: Node): N.Num | null;
}

/** L = αv + β with α constant: returns α (as a node), or null if L isn't linear in v. */
function slope(L: Node, c: SymCtx): Node | null {
  if (!dependsOn(L, c.v)) return null;
  let d: D;
  try {
    d = diff(L, c);
  } catch {
    return null;
  }
  if (!d || dependsOn(d, c.v)) return null;
  return d;
}

export function antiderivative(n: Node, c: AntiCtx): Anti {
  const needs: Need[] = [];
  const F = anti(n, c, needs);
  return { F, needs };
}

function anti(n: Node, c: AntiCtx, needs: Need[]): Node {
  const v: Node = { k: 'var', name: c.v };
  if (!dependsOn(n, c.v)) return mul(n, v);
  switch (n.k) {
    case 'var':
      return div(sq(v), num(2));
    case 'neg':
      return neg(anti(n.a, c, needs));
    case 'qty':
      if (dependsOn(n.u, c.v)) throw new Unsupported();
      return mul(anti(n.v, c, needs), n.u);
    case 'bin': {
      const { a, b } = n;
      switch (n.op) {
        case '+':
          return add(anti(a, c, needs), anti(b, c, needs));
        case '-':
          return sub(anti(a, c, needs), anti(b, c, needs));
        case '*':
          if (!dependsOn(a, c.v)) return mul(a, anti(b, c, needs));
          if (!dependsOn(b, c.v)) return mul(anti(a, c, needs), b);
          throw new Unsupported();
        case '/':
          if (!dependsOn(b, c.v)) return div(anti(a, c, needs), b);
          if (!dependsOn(a, c.v)) {
            // a / Lᵏ
            const [L, k] = b.k === 'bin' && b.op === '^' && !dependsOn(b.b, c.v) ? [b.a, b.b] : [b, num(1)];
            return mul(a, powerAnti(L, neg(k), c, needs));
          }
          throw new Unsupported();
        case '^':
          if (!dependsOn(b, c.v)) return powerAnti(a, b, c, needs);
          if (!dependsOn(a, c.v)) {
            // aᴸ = e^(L ln a)
            const al = slope(b, c);
            if (!al) throw new Unsupported();
            if (a.k === 'euler') return div(n, al);
            const base = c.constValue(a);
            if (!base || N.cmp(base, N.ZERO) <= 0 || N.cmp(base, N.ONE) === 0) throw new Unsupported();
            return div(n, mul(al, call('ln', a)));
          }
          throw new Unsupported();
      }
      break;
    }
    case 'root':
      if (dependsOn(n.n, c.v)) throw new Unsupported();
      return powerAnti(n.a, div(num(1), n.n), c, needs);
    case 'call': {
      if (n.power || n.base || n.args.length !== 1) throw new Unsupported();
      const L = n.args[0];
      const al = slope(L, c);
      if (!al) throw new Unsupported();
      if (c.deg && TRIG.has(n.name)) throw new Unsupported();
      switch (n.name) {
        case 'exp':
          return div(n, al);
        case 'sin':
          return div(neg(call('cos', L)), al);
        case 'cos':
          return div(call('sin', L), al);
        case 'sinh':
          return div(call('cosh', L), al);
        case 'cosh':
          return div(call('sinh', L), al);
        case 'sqrt':
          return powerAnti(L, div(num(1), num(2)), c, needs);
        case 'ln':
          needs.push({ L, kind: 'pos' });
          return div(sub(mul(L, call('ln', L)), L), al); // (L ln L − L)/α
      }
      throw new Unsupported();
    }
  }
  throw new Unsupported();
}

/** ∫ Lᵏ dv for linear L and constant k. */
function powerAnti(L: Node, k: Node, c: AntiCtx, needs: Need[]): Node {
  const al = slope(L, c);
  if (!al) throw new Unsupported();
  const kv = c.constValue(k);
  if (!kv) throw new Unsupported();
  if (N.cmp(kv, N.exact(-1n)) === 0) {
    needs.push({ L, kind: 'nonzero' });
    return div(call('ln', { k: 'abs', a: L }), al);
  }
  const wholeNonNeg = N.isExact(kv) && kv.d === 1n && kv.n >= 0n;
  const wholeNeg = N.isExact(kv) && kv.d === 1n && kv.n < 0n;
  if (!wholeNonNeg) needs.push({ L, kind: wholeNeg ? 'nonzero' : N.cmp(kv, N.ZERO) > 0 ? 'nonneg' : 'pos' });
  const k1 = add(k, num(1));
  return div(pow(L, k1), mul(k1, al));
}
