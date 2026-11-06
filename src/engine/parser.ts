// LaTeX (MathLive) → AST. Resolves letter runs into variables, units, constants (DESIGN.md §4).
import type { Availability } from './units/packages';
import { tokenize, type Tok } from './latex';
import type { Node, ParsedRow, ChipFix } from './ast';
import { isUnitOnly } from './ast';
import { parseDecimal, float } from './num';
import { lookupUnit } from './units/registry';
import { CONST_BY_KEY } from './units/constants.data';

export class ParseError extends Error {}

export interface ParseContext {
  vars: Set<string>;
  funcs: Set<string>;
  /** Units recognised from bare letters (unit packages, D26). Chips always work. Default: all. */
  units?: Availability;
}

/** Functions callable by a plain letter run followed by "(". */
export const LETTER_FUNCS = new Set([
  'abs', 'sqrt', 'exp', 'ln', 'log', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'atan2',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'min', 'max', 'mod', 'round', 'floor', 'ceil', 'sign',
  'sum', 'mean', 'median', 'stdev', 'var', 'count', 'length', 'nthroot', 'hypot', 'total',
  'asinh', 'acosh', 'atanh', 'arsinh', 'arcosh', 'artanh', 'gamma', 'erf', 'erfc', 'nCr', 'nPr', 'gcd', 'lcm',
]);
/** LaTeX commands that are functions (\sin, \operatorname{abs}, …). */
const CMD_FUNCS = new Set([...LETTER_FUNCS, 'arcsec', 'arccsc', 'arccot', 'lg', 'sgn', 'operatorname']);

export interface ParseResult {
  row: ParsedRow;
  chips: ChipFix[];
}

/** Extract the defined name (variable or function) from a row without full parsing. */
export function peekDefinition(latex: string): { name: string; kind: 'var' | 'func'; params: string[] } | null {
  const toks = tokenize(latex);
  const eq = topLevelEq(toks);
  if (eq < 0) return null;
  const lhs = parseLhs(toks.slice(0, eq));
  return lhs;
}

function topLevelEq(toks: Tok[]): number {
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'open' && t.v !== '|') depth++;
    else if (t.t === 'close' && t.v !== '|') depth--;
    else if (t.t === 'op' && t.v === '=' && depth === 0) return i;
  }
  return -1;
}

function readSub(toks: Tok[], i: number): [string, number] {
  // toks[i] is '_'
  const t = toks[i + 1];
  if (!t) return ['', i + 1];
  if (t.t === 'open' && t.v === '{') {
    let j = i + 2;
    let txt = '';
    let depth = 1;
    while (j < toks.length) {
      const u = toks[j];
      if (u.t === 'open' && u.v === '{') depth++;
      if (u.t === 'close' && u.v === '}') {
        depth--;
        if (depth === 0) break;
      }
      if (u.t === 'letter' || u.t === 'num') txt += u.v;
      j++;
    }
    return [txt, j + 1];
  }
  if (t.t === 'num') return [t.v[0], i + 2];
  if (t.t === 'letter') return [t.v, i + 2];
  return ['', i + 1];
}

function parseLhs(toks: Tok[]): { name: string; kind: 'var' | 'func'; params: string[] } | null {
  if (!toks.length || toks[0].t !== 'letter') return null;
  let name = toks[0].v;
  let i = 1;
  if (toks[i]?.t === 'op' && toks[i].v === '_') {
    const [sub, j] = readSub(toks, i);
    name += '_' + sub;
    i = j;
  }
  if (i === toks.length) return { name, kind: 'var', params: [] };
  if (toks[i].t === 'open' && toks[i].v === '(') {
    const params: string[] = [];
    i++;
    while (i < toks.length && !(toks[i].t === 'close' && toks[i].v === ')')) {
      const t = toks[i];
      if (t.t === 'letter') {
        let p = t.v;
        i++;
        if (toks[i]?.t === 'op' && toks[i].v === '_') {
          const [sub, j] = readSub(toks, i);
          p += '_' + sub;
          i = j;
        }
        params.push(p);
      } else if (t.t === 'op' && t.v === ',') i++;
      else return null;
    }
    if (i === toks.length - 1) return { name, kind: 'func', params };
  }
  return null;
}

export function parseRow(latex: string, ctx: ParseContext): ParseResult {
  const toks = tokenize(latex);
  const chips: ChipFix[] = [];
  if (!toks.length) return { row: { kind: 'empty' }, chips };
  const eq = topLevelEq(toks);
  if (eq >= 0) {
    const lhs = parseLhs(toks.slice(0, eq));
    if (!lhs) throw new ParseError('Left side of “=” must be a name like x, F_1 or f(x)');
    const rhsToks = toks.slice(eq + 1);
    if (!rhsToks.length) throw new ParseError('Missing value after “=”');
    const local: ParseContext =
      lhs.kind === 'func' ? { ...ctx, vars: new Set([...ctx.vars, ...lhs.params]) } : ctx;
    const p = new Parser(rhsToks, local, chips);
    const expr = p.parseAll();
    return {
      row: lhs.kind === 'func' ? { kind: 'fdef', name: lhs.name, params: lhs.params, expr } : { kind: 'def', name: lhs.name, expr },
      chips,
    };
  }
  const p = new Parser(toks, ctx, chips);
  return { row: { kind: 'expr', expr: p.parseAll() }, chips };
}

/** Parse a standalone expression (table cells, slider bounds). */
export function parseExpression(latex: string, ctx: ParseContext): Node {
  const toks = tokenize(latex);
  if (!toks.length) throw new ParseError('Empty');
  return new Parser(toks, ctx, []).parseAll();
}

class Parser {
  i = 0;
  constructor(
    private toks: Tok[],
    private ctx: ParseContext,
    private chips: ChipFix[],
  ) {}

  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t?.t === 'op' && t.v === v;
  }
  isOpen(v?: string, o = 0) {
    const t = this.peek(o);
    return t?.t === 'open' && (v === undefined || t.v === v);
  }
  isClose(v?: string) {
    const t = this.peek();
    return (t?.t === 'close' && (v === undefined || t.v === v)) || (v === '|' && t?.t === 'open' && t.v === '|');
  }
  expectClose(v: string) {
    if (!this.isClose(v)) throw new ParseError(`Expected “${v}”`);
    this.i++;
  }

  parseAll(): Node {
    const n = this.parseExpr();
    if (this.i < this.toks.length) {
      const t = this.toks[this.i];
      throw new ParseError(`Unexpected “${'v' in t ? t.v : '?'}”`);
    }
    return n;
  }

  parseExpr(): Node {
    let a = this.parseTerm();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.peek() as { v: string }).v as '+' | '-';
      this.i++;
      const b = this.parseTerm();
      a = { k: 'bin', op, a, b };
    }
    return a;
  }

  startsPrimary(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.t === 'num' || t.t === 'letter' || t.t === 'unit' || t.t === 'const') return true;
    if (t.t === 'open') return t.v !== '|' || true;
    if (t.t === 'cmd') return true;
    return false;
  }

  parseTerm(): Node {
    let acc: Node = this.parseUnary(false);
    let explicit = false;
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.peek() as { v: string }).v as '*' | '/';
        this.i++;
        let b = this.parseUnary(op === '*');
        // number–unit juxtaposition binds tighter than · and / (2·20 °C = 2·(20 °C))
        while (this.startsPrimary() && !(this.isOpen('|') && this.inAbs > 0)) {
          const save = this.i;
          const nChips = this.chips.length;
          const f = this.parsePostfix(true);
          if (!isUnitOnly(f)) {
            this.i = save;
            this.chips.length = nChips;
            break;
          }
          b = bindImplicit(b, f);
        }
        acc = { k: 'bin', op, a: acc, b };
        explicit = true;
        continue;
      }
      // An absolute-value bar can close an enclosing |…|; don't treat it as implicit start.
      if (this.isOpen('|') && this.inAbs > 0) break;
      if (this.startsPrimary()) {
        const f = this.parsePostfix(true);
        acc = bindImplicit(acc, f);
        explicit = false;
        continue;
      }
      break;
    }
    void explicit;
    return acc;
  }

  inAbs = 0;

  parseUnary(prevIsValue: boolean): Node {
    if (this.isOp('-')) {
      this.i++;
      return { k: 'neg', a: this.parseUnary(false) };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.parseUnary(false);
    }
    return this.parsePostfix(prevIsValue);
  }

  parsePostfix(prevIsValue: boolean): Node {
    let a = this.parsePrimary(prevIsValue);
    for (;;) {
      if (this.isOp('^')) {
        this.i++;
        const ex = this.parseGroupOrToken();
        if (ex === 'degree') a = { k: 'qty', v: a, u: { k: 'unit', id: '°' } };
        else a = { k: 'bin', op: '^', a, b: ex };
      } else if (this.isOp('!')) {
        this.i++;
        a = { k: 'fact', a };
      } else if (this.isOp('%')) {
        this.i++;
        a = { k: 'qty', v: a, u: { k: 'unit', id: '%' } };
      } else if (this.isOp('_') && a.k === 'unit') {
        // subscript on a chip unit, ignore
        this.i++;
        this.parseGroupOrToken();
      } else break;
    }
    return a;
  }

  /** ^{…} or ^x ; returns 'degree' for ^{\circ}. */
  parseGroupOrToken(): Node | 'degree' {
    const t = this.peek();
    if (!t) throw new ParseError('Missing exponent');
    if (t.t === 'open' && t.v === '{') {
      const n = this.toks[this.i + 1];
      const c = this.toks[this.i + 2];
      if (n?.t === 'letter' && n.v === '°' && c?.t === 'close') {
        this.i += 3;
        return 'degree';
      }
      this.i++;
      const e = this.parseExpr();
      this.expectClose('}');
      return e;
    }
    if (t.t === 'letter' && t.v === '°') {
      this.i++;
      return 'degree';
    }
    if (t.t === 'num') {
      // ^23 without braces means ^2 then 3
      if (t.v.length > 1) {
        this.toks.splice(this.i, 1, { ...t, v: t.v[0] }, { ...t, v: t.v.slice(1) });
      }
      this.i++;
      return { k: 'num', v: parseDecimal(t.v[0]) };
    }
    return this.parsePrimary(false);
  }

  group(): Node {
    if (!this.isOpen('{')) return this.parsePostfix(false);
    this.i++;
    const e = this.isClose('}') ? ({ k: 'num', v: parseDecimal('0') } as Node) : this.parseExpr();
    this.expectClose('}');
    return e;
  }

  parseArgs(): Node[] {
    // at '('
    this.i++;
    const args: Node[] = [];
    if (this.isClose(')')) {
      this.i++;
      return args;
    }
    for (;;) {
      args.push(this.parseExpr());
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      this.expectClose(')');
      return args;
    }
  }

  parsePrimary(prevIsValue: boolean): Node {
    const t = this.peek();
    if (!t) throw new ParseError('Incomplete expression');
    switch (t.t) {
      case 'num': {
        this.i++;
        if (t.v === '.') throw new ParseError('Unexpected “.”');
        return { k: 'num', v: parseDecimal(t.v) };
      }
      case 'unit': {
        this.i++;
        const u = lookupUnit(t.v);
        if (!u) throw new ParseError(`Unknown unit “${t.v}”`);
        return { k: 'unit', id: u.id };
      }
      case 'const': {
        this.i++;
        if (!CONST_BY_KEY.has(t.v)) throw new ParseError(`Unknown constant “${t.v}”`);
        return { k: 'const', key: t.v };
      }
      case 'open': {
        if (t.v === '(') {
          this.i++;
          const first = this.parseExpr();
          if (this.isOp(',')) {
            // tuple → list
            const items = [first];
            while (this.isOp(',')) {
              this.i++;
              items.push(this.parseExpr());
            }
            this.expectClose(')');
            return { k: 'list', items };
          }
          this.expectClose(')');
          return first;
        }
        if (t.v === '[') {
          this.i++;
          const items: Node[] = [];
          if (!this.isClose(']'))
            for (;;) {
              items.push(this.parseExpr());
              if (this.isOp(',')) {
                this.i++;
                continue;
              }
              break;
            }
          this.expectClose(']');
          return { k: 'list', items };
        }
        if (t.v === '{') return this.group();
        if (t.v === '|') {
          this.i++;
          this.inAbs++;
          const e = this.parseExpr();
          this.inAbs--;
          this.expectClose('|');
          return { k: 'abs', a: e };
        }
        break;
      }
      case 'letter':
        return this.parseLetterRun(prevIsValue);
      case 'cmd':
        return this.parseCommand();
      default:
        break;
    }
    throw new ParseError(`Unexpected “${'v' in t ? t.v : '?'}”`);
  }

  parseCommand(): Node {
    const t = this.peek() as Extract<Tok, { t: 'cmd' }>;
    this.i++;
    const name = t.v;
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const a = this.group();
      const b = this.group();
      return { k: 'bin', op: '/', a, b };
    }
    if (name === 'sqrt') {
      let n: Node = { k: 'num', v: parseDecimal('2') };
      if (this.isOpen('[')) {
        this.i++;
        n = this.parseExpr();
        this.expectClose(']');
      }
      return { k: 'root', n, a: this.group() };
    }
    if (name === 'pi') return { k: 'pi' };
    if (name === 'infty') return { k: 'num', v: float(Infinity) };
    if (CMD_FUNCS.has(name) || LETTER_FUNCS.has(name)) return this.parseFuncTail(normalizeFn(name));
    throw new ParseError(`Unsupported “\\${name}”`);
  }

  parseFuncTail(name: string): Node {
    let power: Node | undefined;
    let base: Node | undefined;
    for (;;) {
      if (this.isOp('^')) {
        this.i++;
        const p = this.parseGroupOrToken();
        if (p === 'degree') throw new ParseError('Unexpected °');
        power = p;
      } else if (this.isOp('_')) {
        this.i++;
        const b = this.parseGroupOrToken();
        if (b === 'degree') throw new ParseError('Unexpected °');
        base = b;
      } else break;
    }
    let args: Node[];
    if (this.isOpen('(')) args = this.parseArgs();
    else {
      // \sin 30° or \ln x : implicit chain argument
      let acc = this.parsePostfix(false);
      while (this.peek() && (this.peek()!.t === 'unit' || this.peek()!.t === 'letter' || this.peek()!.t === 'num')) {
        acc = bindImplicit(acc, this.parsePostfix(true));
      }
      args = [acc];
    }
    return { k: 'call', name, args, base, power };
  }

  /** Letter run → variables / units / constants / functions. */
  parseLetterRun(prevIsValue: boolean): Node {
    const run: { v: string; s: number; e: number; sub?: string }[] = [];
    while (this.peek()?.t === 'letter') {
      const t = this.peek() as Extract<Tok, { t: 'letter' }>;
      this.i++;
      const item: { v: string; s: number; e: number; sub?: string } = { v: t.v, s: t.s, e: t.e };
      run.push(item);
      if (this.isOp('_')) {
        const [sub, j] = readSub(this.toks, this.i);
        const last = this.toks[j - 1];
        this.i = j;
        item.sub = sub;
        if (last && last.e >= 0) item.e = last.e;
        break;
      }
    }
    const letters = run.map((r) => r.v).join('');
    const subOf = (r: { sub?: string }) => (r.sub !== undefined ? '_' + r.sub : '');
    const full = letters + subOf(run[run.length - 1]);
    const nextParen = this.isOpen('(');

    if (nextParen) {
      if (this.ctx.funcs.has(full)) return { k: 'ucall', name: full, args: this.parseArgs() };
      if (LETTER_FUNCS.has(letters) && run[run.length - 1].sub === undefined) return this.parseFuncTail(normalizeFn(letters));
      // Γ(x) is the gamma function unless Γ is a user name
      if (letters === 'Γ' && run[0].sub === undefined && !this.ctx.vars.has('Γ')) return this.parseFuncTail('gamma');
    }

    const isVar = (n: string) => this.ctx.vars.has(n) || this.ctx.funcs.has(n);
    const fixable = run.every((r) => r.s >= 0);
    const chip = (a: number, b: number, kind: 'unit' | 'const', id: string, text: string) => {
      if (fixable) this.chips.push({ s: run[a].s, e: run[b].e, kind, id, text });
    };

    // Segment greedily: longest unit match not fully made of defined variables.
    const nodes: Node[] = [];
    let i = 0;
    while (i < run.length) {
      let matched = false;
      for (let j = run.length - 1; j >= i; j--) {
        const seg = run.slice(i, j + 1);
        const segName = (seg.map((r) => r.v).join('') + subOf(seg[seg.length - 1])).replace(/μ/g, 'µ');
        // inner letters with subscripts can't be part of a longer token
        if (seg.slice(0, -1).some((r) => r.sub !== undefined)) continue;
        if (seg.length === 1 && isVar(segName)) {
          nodes.push({ k: 'var', name: segName });
          matched = true;
        } else {
          const allVars = seg.every((r, idx) => isVar(r.v + (idx === seg.length - 1 ? subOf(r) : '')));
          const found = lookupUnit(segName);
          const u = found && (!this.ctx.units || this.ctx.units(found)) ? found : undefined;
          const prevVal = prevIsValue || nodes.length > 0;
          if (u && (!allVars || (prevVal && seg.length > 1))) {
            nodes.push({ k: 'unit', id: u.id });
            chip(i, j, 'unit', u.id, segName);
            matched = true;
          } else if (CONST_BY_KEY.has(segName) && !isVar(segName) && (seg.length === 1 || seg[seg.length - 1].sub !== undefined) && seg.length <= 2) {
            nodes.push({ k: 'const', key: segName });
            chip(i, j, 'const', segName, segName);
            matched = true;
          }
        }
        if (matched) {
          i = j + 1;
          break;
        }
      }
      if (matched) continue;
      const r = run[i];
      const nm = r.v + subOf(r);
      if (nm === 'e' && !isVar('e')) nodes.push({ k: 'euler' });
      else if (nm === 'π') nodes.push({ k: 'pi' });
      else nodes.push({ k: 'var', name: nm });
      i++;
    }
    let acc = nodes[0];
    for (let k = 1; k < nodes.length; k++) acc = bindImplicit(acc, nodes[k]);
    if (nextParen && acc.k === 'var' && this.ctx.funcs.has(acc.name)) return { k: 'ucall', name: acc.name, args: this.parseArgs() };
    return acc;
  }
}

function normalizeFn(n: string): string {
  const map: Record<string, string> = {
    arcsin: 'asin', arccos: 'acos', arctan: 'atan', lg: 'log', sgn: 'sign', total: 'sum', length: 'count',
    arsinh: 'asinh', arcosh: 'acosh', artanh: 'atanh',
  };
  return map[n] ?? n;
}

/** Implicit multiplication; unit factors bind to the preceding value (6 N/mm² = 6·(N/mm²)). */
function bindImplicit(acc: Node, f: Node): Node {
  if (isUnitOnly(f) && !isUnitOnly(acc)) {
    if (acc.k === 'qty') return { k: 'qty', v: acc.v, u: { k: 'bin', op: '*', a: acc.u, b: f } };
    return { k: 'qty', v: acc, u: f };
  }
  if (isUnitOnly(f) && isUnitOnly(acc)) return { k: 'bin', op: '*', a: acc, b: f };
  return { k: 'bin', op: '*', a: acc, b: f };
}
