import type { Num } from './num';

export interface Span {
  s: number;
  e: number;
}

export type Node =
  | { k: 'num'; v: Num }
  | { k: 'var'; name: string }
  | { k: 'unit'; id: string }
  | { k: 'const'; key: string }
  | { k: 'pi' }
  | { k: 'euler' }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'neg'; a: Node }
  | { k: 'qty'; v: Node; u: Node } // value with attached unit factors
  | { k: 'call'; name: string; args: Node[]; base?: Node; power?: Node }
  | { k: 'ucall'; name: string; args: Node[] }
  | { k: 'list'; items: Node[] }
  | { k: 'fact'; a: Node }
  | { k: 'abs'; a: Node }
  | { k: 'root'; n: Node; a: Node }
  // calculus and piecewise (D27): `v` is the bound variable
  | { k: 'integral'; v: string; lo: Node; hi: Node; body: Node }
  | { k: 'deriv'; v: string; order: 1 | 2; body: Node }
  | { k: 'limit'; v: string; to: Node; dir?: '+' | '-'; body: Node }
  | { k: 'series'; op: 'sum' | 'prod'; v: string; lo: Node; hi: Node; body: Node }
  | { k: 'piecewise'; branches: { cond?: Cond; value: Node }[] }
  // solve(lhs = rhs, v[, guess | lo, hi]) (D33)
  // roots(…) (D51): `all` — every real root, as a list
  | { k: 'solve'; v: string; lhs: Node; rhs: Node; hints: Node[]; all?: boolean };

/** Chained comparison a < b ≤ c … */
export interface Cond {
  items: Node[];
  ops: CmpOp[];
}
export type CmpOp = '<' | '>' | '≤' | '≥' | '=' | '≠';

export type ParsedRow =
  | { kind: 'empty' }
  | { kind: 'expr'; expr: Node }
  | { kind: 'def'; name: string; expr: Node }
  // paramUnits (D52): f(l: m) — an input's declared unit (a unit-only node), if it has one
  | { kind: 'fdef'; name: string; params: string[]; paramUnits?: (Node | undefined)[]; expr: Node };

/** A letter run the parser resolved to a unit/constant that should become a chip. */
export interface ChipFix {
  s: number;
  e: number;
  kind: 'unit' | 'const';
  id: string;
  /** The letters as typed (e.g. "F"), for matching against variable names. */
  text?: string;
}

export function isUnitOnly(n: Node): boolean {
  switch (n.k) {
    case 'unit':
      return true;
    case 'bin':
      if (n.op === '*' || n.op === '/') return isUnitOnly(n.a) && isUnitOnly(n.b);
      if (n.op === '^') return isUnitOnly(n.a) && isNumeric(n.b);
      return false;
    default:
      return false;
  }
}
function isNumeric(n: Node): boolean {
  return n.k === 'num' || (n.k === 'neg' && isNumeric(n.a)) || (n.k === 'bin' && n.op === '/' && isNumeric(n.a) && isNumeric(n.b));
}

export function collectRefs(n: Node, out: Set<string> = new Set()): Set<string> {
  switch (n.k) {
    case 'var':
      out.add(n.name);
      break;
    case 'ucall':
      out.add(n.name);
      n.args.forEach((a) => collectRefs(a, out));
      break;
    case 'bin':
      collectRefs(n.a, out);
      collectRefs(n.b, out);
      break;
    case 'neg':
    case 'fact':
    case 'abs':
      collectRefs(n.a, out);
      break;
    case 'qty':
      collectRefs(n.v, out);
      collectRefs(n.u, out);
      break;
    case 'call':
      n.args.forEach((a) => collectRefs(a, out));
      if (n.base) collectRefs(n.base, out);
      if (n.power) collectRefs(n.power, out);
      break;
    case 'list':
      n.items.forEach((a) => collectRefs(a, out));
      break;
    case 'root':
      collectRefs(n.n, out);
      collectRefs(n.a, out);
      break;
    case 'integral':
    case 'series':
    case 'deriv':
    case 'limit': {
      const inner = collectRefs(n.body);
      inner.delete(n.v);
      inner.forEach((r) => out.add(r));
      if (n.k === 'integral' || n.k === 'series') {
        collectRefs(n.lo, out);
        collectRefs(n.hi, out);
      }
      if (n.k === 'limit') collectRefs(n.to, out);
      if (n.k === 'deriv') out.add(n.v); // evaluated at the current value of v
      break;
    }
    case 'solve': {
      const inner = new Set<string>();
      collectRefs(n.lhs, inner);
      collectRefs(n.rhs, inner);
      inner.delete(n.v);
      inner.forEach((r) => out.add(r));
      n.hints.forEach((h) => collectRefs(h, out));
      break;
    }
    case 'piecewise':
      for (const b of n.branches) {
        b.cond?.items.forEach((x) => collectRefs(x, out));
        collectRefs(b.value, out);
      }
      break;
  }
  return out;
}
