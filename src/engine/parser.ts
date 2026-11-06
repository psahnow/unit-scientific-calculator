// LaTeX (MathLive) → AST. Resolves letter runs into variables, units, constants (DESIGN.md §4).
import type { Availability } from './units/packages';
import { packagesOf, PACKAGE_BY_ID } from './units/packages';
import { tokenize, type Tok } from './latex';
import type { Node, ParsedRow, ChipFix, Cond, CmpOp } from './ast';
import { isUnitOnly } from './ast';
import { parseDecimal, float } from './num';
import { lookupUnit } from './units/registry';
import { CONST_BY_KEY } from './units/constants.data';

export class ParseError extends Error {
  /** Package units recognised before the error (see ParseResult.blocked). */
  blocked?: string[];
}

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

const CMP_OPS = new Set(['<', '>', '≤', '≥', '=', '≠']);

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const NAMES: Record<string, string> = { '*': '×', '/': '÷', '^': 'power', '_': 'subscript' };

/** A plain-language message for a token that can't go where it is (D28). */
function unexpected(t: Tok): string {
  if (t.t === 'close') {
    return t.v === '}'
      ? 'Something is empty or extra here: fill in or delete the empty box (a power, fraction part or bracket)'
      : `There's an extra “${t.v}”, or a “${CLOSERS[t.v] ?? '('}” is missing before it`;
  }
  if (t.t === 'op') {
    switch (t.v) {
      case '=':
        return 'Only one “=” per row: it gives a name to a value, like x = 5';
      case ':':
        return '“:” only goes inside a piecewise, like {x < 0: −x, x}';
      case ',':
        return 'Commas separate list items [1, 2] or function inputs f(1, 2)';
      case '→':
        return '“→” only goes under a limit, like lim x→0';
      case '<':
      case '>':
      case '≤':
      case '≥':
      case '≠':
        return `Comparisons like “${t.v}” only go inside a piecewise, like {x ${t.v} 3: …}`;
      case '^':
        return 'A power needs something to raise: put a value before it';
      case '!':
        return 'Factorial “!” needs a value before it, like 5!';
      default:
        return `“${NAMES[t.v] ?? t.v}” needs a value on both sides`;
    }
  }
  if (t.t === 'num' && t.v === '.') return 'A lone “.” needs digits, like 0.5';
  if (t.t === 'open' && t.v === '|') return 'An absolute value |…| is missing its closing bar';
  return `“${'v' in t ? t.v : '?'}” can't go here`;
}

const INCOMPLETE = "Something's missing: finish the expression";


export interface ParseResult {
  row: ParsedRow;
  chips: ChipFix[];
  /** Units typed as letters that exist but are in a package that is off (longest first). */
  blocked: string[];
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
  const blockedOut: string[] = [];
  try {
    return parseRowInner(latex, ctx, blockedOut);
  } catch (e) {
    if (e instanceof ParseError) e.blocked = blockedOut;
    throw e;
  }
}

function parseRowInner(latex: string, ctx: ParseContext, blocked: string[]): ParseResult {
  const toks = tokenize(latex);
  const chips: ChipFix[] = [];
  if (!toks.length) return { row: { kind: 'empty' }, chips, blocked };
  const eq = topLevelEq(toks);
  if (eq >= 0) {
    const lhs = parseLhs(toks.slice(0, eq));
    if (!lhs) throw new ParseError('To define something, put a single name before “=”, like x = 5, F_1 = 2 N or f(x) = x²');
    const rhsToks = toks.slice(eq + 1);
    if (!rhsToks.length) throw new ParseError('Nothing after “=” yet');
    const local: ParseContext =
      lhs.kind === 'func' ? { ...ctx, vars: new Set([...ctx.vars, ...lhs.params]) } : ctx;
    const p = new Parser(rhsToks, local, chips, blocked);
    const expr = p.parseAll();
    return {
      row: lhs.kind === 'func' ? { kind: 'fdef', name: lhs.name, params: lhs.params, expr } : { kind: 'def', name: lhs.name, expr },
      chips,
      blocked,
    };
  }
  const p = new Parser(toks, ctx, chips, blocked);
  return { row: { kind: 'expr', expr: p.parseAll() }, chips, blocked };
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
    private blocked: string[] = [],
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
    if (!this.isClose(v)) {
      const t = this.peek();
      if (!t) throw new ParseError(v === '}' ? INCOMPLETE : `A “${v}” is missing: close the bracket`);
      throw new ParseError(t.t === 'close' ? unexpected(t) : `A “${v}” is missing before “${'v' in t ? t.v : '?'}”`);
    }
    this.i++;
  }

  parseAll(): Node {
    const n = this.parseExpr();
    if (this.i < this.toks.length) {
      const t = this.toks[this.i];
      throw new ParseError(unexpected(t));
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
      if (this.emptyScript()) continue;
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

  /** Skip an empty ^{} or _{} left behind after deleting a power or subscript. */
  emptyScript(): boolean {
    if ((this.isOp('^') || this.isOp('_')) && this.isOpen('{', 1) && this.peek(2)?.t === 'close' && (this.peek(2) as { v: string }).v === '}') {
      this.i += 3;
      return true;
    }
    return false;
  }

  /** ^{…} or ^x ; returns 'degree' for ^{\circ}. */
  parseGroupOrToken(): Node | 'degree' {
    const t = this.peek();
    if (!t) throw new ParseError('The power is empty: type one, or delete the power');
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
      if (t.v.length > 1 && !/[eE]/.test(t.v)) {
        this.toks.splice(this.i, 1, { ...t, v: t.v[0] }, { ...t, v: t.v.slice(1) });
      }
      this.i++;
      return { k: 'num', v: parseDecimal(t.v[0]) };
    }
    return this.parsePrimary(false);
  }

  group(): Node {
    if (!this.isOpen('{')) {
      // LaTeX without braces takes one character: MathLive writes 2/5 as \frac25
      const t = this.peek();
      if (t?.t === 'num' && t.v.length > 1) {
        this.toks.splice(this.i, 1, { ...t, v: t.v[0], e: t.s + 1 }, { ...t, v: t.v.slice(1), s: t.s + 1 });
      }
      if (t?.t === 'num') {
        this.i++;
        return { k: 'num', v: parseDecimal((this.toks[this.i - 1] as { v: string }).v) };
      }
      return this.parsePostfix(false);
    }
    this.i++;
    if (this.isClose('}')) throw new ParseError('There’s an empty box (part of a fraction or root): fill it in or delete it');
    const e = this.parseExpr();
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
    if (!t) throw new ParseError(INCOMPLETE);
    switch (t.t) {
      case 'num': {
        this.i++;
        if (t.v === '.') throw new ParseError(unexpected(t));
        return { k: 'num', v: parseDecimal(t.v) };
      }
      case 'unit': {
        this.i++;
        const u = lookupUnit(t.v);
        if (!u) throw new ParseError(`“${t.v}” isn't a unit this calculator knows`);
        return { k: 'unit', id: u.id };
      }
      case 'const': {
        this.i++;
        if (!CONST_BY_KEY.has(t.v)) throw new ParseError(`“${t.v}” isn't a constant this calculator knows`);
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
        if (t.v === '{') return this.piecewiseAhead() ? this.parsePiecewise() : this.group();
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
    throw new ParseError(unexpected(t));
  }

  parseCommand(): Node {
    const t = this.peek() as Extract<Tok, { t: 'cmd' }>;
    this.i++;
    const name = t.v;
    if (name === 'int') return this.parseIntegral();
    if (name === 'lim') return this.parseLimit();
    if ((name === 'sum' || name === 'prod') && (this.isOp('_') || this.isOp('^'))) return this.parseSeries(name);
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const d = this.tryDerivative();
      if (d) return d;
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
    throw new ParseError(`“\\${name}” isn't supported`);
  }

  parseFuncTail(name: string): Node {
    let power: Node | undefined;
    let base: Node | undefined;
    for (;;) {
      if (this.emptyScript()) continue;
      if (this.isOp('^')) {
        this.i++;
        const p = this.parseGroupOrToken();
        if (p === 'degree') throw new ParseError('A degree sign can’t be a power of a function');
        power = p;
      } else if (this.isOp('_')) {
        this.i++;
        const b = this.parseGroupOrToken();
        if (b === 'degree') throw new ParseError('A degree sign can’t go here');
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


  // ── calculus & piecewise (D27) ──────────────────────────────────────────────

  /** Tokens inside a {…} group starting at the current '{'; moves past the '}'. */
  takeGroup(): Tok[] {
    if (!this.isOpen('{')) {
      const t = this.peek();
      if (!t) throw new ParseError(INCOMPLETE);
      this.i++;
      return [t];
    }
    const start = this.i + 1;
    let depth = 0;
    for (let j = this.i; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === 'open' && t.v !== '|') depth++;
      else if (t.t === 'close' && t.v !== '|') {
        depth--;
        if (depth === 0) {
          this.i = j + 1;
          return this.toks.slice(start, j);
        }
      }
    }
    throw new ParseError(INCOMPLETE);
  }

  /** Parse a token slice as a whole expression, with the same names (plus `bound`). */
  sub(toks: Tok[], bound?: string): Node {
    if (!toks.length) throw new ParseError(INCOMPLETE);
    const ctx = bound ? { ...this.ctx, vars: new Set([...this.ctx.vars, bound]) } : this.ctx;
    return new Parser(toks, ctx, this.chips, this.blocked).parseAll();
  }

  /** Parse with `v` treated as a variable (so x, t, s… aren't read as units). */
  withVar<T>(v: string, fn: () => T): T {
    const saved = this.ctx;
    this.ctx = { ...saved, vars: new Set([...saved.vars, v]) };
    try {
      return fn();
    } finally {
      this.ctx = saved;
    }
  }

  /** A variable name at the start of a token slice: x, θ, x_1. Returns [name, tokens used]. */
  static varName(toks: Tok[], at = 0): [string, number] | null {
    const t = toks[at];
    if (t?.t !== 'letter') return null;
    if (toks[at + 1]?.t === 'op' && (toks[at + 1] as { v: string }).v === '_') {
      const [s, j] = readSub(toks, at + 1);
      return [t.v + '_' + s, j - at];
    }
    return [t.v, 1];
  }

  /** ∫_a^b f(x) dx */
  parseIntegral(): Node {
    let lo: Tok[] | undefined;
    let hi: Tok[] | undefined;
    for (let k = 0; k < 2; k++) {
      if (this.isOp('_')) {
        this.i++;
        lo = this.takeGroup();
      } else if (this.isOp('^')) {
        this.i++;
        hi = this.takeGroup();
      }
    }
    if (!lo || !lo.length || !hi || !hi.length)
      throw new ParseError('This integral needs both limits: type the start below the ∫ and the end above it (only definite integrals are supported)');
    // find the differential "dx" that ends the integrand
    let depth = 0;
    for (let j = this.i; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === 'open' && t.v !== '|') depth++;
      else if (t.t === 'close' && t.v !== '|') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && t.t === 'letter' && t.v === 'd') {
        const vn = Parser.varName(this.toks, j + 1);
        if (!vn) continue;
        const after = this.toks[j + 1 + vn[1]];
        if (after && (after.t === 'letter' || after.t === 'num' || (after.t === 'open' && after.v !== '|'))) continue;
        const [v] = vn;
        const bodyToks = this.toks.slice(this.i, j);
        const body: Node = bodyToks.length ? this.sub(bodyToks, v) : { k: 'num', v: parseDecimal('1') };
        this.i = j + 1 + vn[1];
        return { k: 'integral', v, lo: this.sub(lo), hi: this.sub(hi), body };
      }
    }
    throw new ParseError('End the integral with “d” and its variable, like dx, after the expression');
  }

  /** d/dx or d²/dx² written as \frac{d}{dx}; returns null if this \frac isn't a derivative. */
  tryDerivative(): Node | null {
    const save = this.i;
    if (!this.isOpen('{')) return null;
    const num = this.takeGroup();
    if (!this.isOpen('{')) {
      this.i = save;
      return null;
    }
    const den = this.takeGroup();
    const isD = (t?: Tok) => t?.t === 'letter' && t.v === 'd';
    const power = (toks: Tok[], at: number): number | null => {
      if (at === toks.length) return 1;
      if (toks[at]?.t !== 'op' || (toks[at] as { v: string }).v !== '^') return null;
      const rest = toks.slice(at + 1).filter((t) => !(t.t === 'open' && t.v === '{') && !(t.t === 'close' && t.v === '}'));
      return rest.length === 1 && rest[0].t === 'num' && rest[0].v === '2' ? 2 : null;
    };
    const vn = isD(den[0]) ? Parser.varName(den, 1) : null;
    const order = isD(num[0]) ? power(num, 1) : null;
    const dOrder = vn ? power(den, 1 + vn[1]) : null;
    if (!vn || !order || order !== dOrder) {
      this.i = save;
      return null;
    }
    const v = vn[0];
    if (!this.startsPrimary()) throw new ParseError(`d/d${v} needs an expression after it`);
    const body = this.withVar(v, () => this.parseTerm());
    return { k: 'deriv', v, order: order as 1 | 2, body };
  }

  /** \lim_{x \to a} f(x), with optional a^+ / a^- */
  parseLimit(): Node {
    if (!this.isOp('_')) throw new ParseError('Under “lim”, write the variable and where it goes, like x → 0');
    this.i++;
    const g = this.takeGroup();
    const vn = Parser.varName(g);
    if (!vn || g[vn[1]]?.t !== 'op' || (g[vn[1]] as { v: string }).v !== '→')
      throw new ParseError('Under “lim”, write the variable and where it goes, like x → 0');
    if (g.length === vn[1] + 1) throw new ParseError('Under “lim”, say where the variable goes, like x → 0');
    let target = g.slice(vn[1] + 1);
    let dir: '+' | '-' | undefined;
    const plain = target.filter((t) => !(t.t === 'open' && t.v === '{') && !(t.t === 'close' && t.v === '}'));
    const n = plain.length;
    if (n >= 3 && plain[n - 2].t === 'op' && (plain[n - 2] as { v: string }).v === '^' && plain[n - 1].t === 'op' && '+-'.includes((plain[n - 1] as { v: string }).v)) {
      dir = (plain[n - 1] as { v: string }).v as '+' | '-';
      const caret = target.findIndex((t) => t === plain[n - 2]);
      target = target.slice(0, caret);
    }
    const to = this.sub(target);
    const v = vn[0];
    if (!this.startsPrimary()) throw new ParseError('“lim” needs an expression after it');
    const body = this.withVar(v, () => this.parseTerm());
    return { k: 'limit', v, to, dir, body };
  }

  /** \sum_{n=1}^{10} or \prod_{n=1}^{10} */
  parseSeries(op: 'sum' | 'prod'): Node {
    let lo: Tok[] | undefined;
    let hi: Tok[] | undefined;
    for (let k = 0; k < 2; k++) {
      if (this.isOp('_')) {
        this.i++;
        lo = this.takeGroup();
      } else if (this.isOp('^')) {
        this.i++;
        hi = this.takeGroup();
      }
    }
    const sym = op === 'sum' ? 'Σ' : 'Π';
    const what = op === 'sum' ? 'add up' : 'multiply';
    if (!lo || !lo.length) throw new ParseError(`${sym} needs a start below it, like n = 1`);
    if (!hi || !hi.length) throw new ParseError(`${sym} needs an end value: type it above the ${sym}`);
    const vn = Parser.varName(lo);
    if (!vn || lo[vn[1]]?.t !== 'op' || (lo[vn[1]] as { v: string }).v !== '=')
      throw new ParseError(`Below the ${sym}, write the counter and where it starts, like n = 1`);
    if (lo.length === vn[1] + 1) throw new ParseError(`Below the ${sym}, say where ${vn[0]} starts, like ${vn[0]} = 1`);
    if (!this.startsPrimary()) throw new ParseError(`${sym} needs something to ${what}: type it after the ${sym}`);
    const v = vn[0];
    const from = this.sub(lo.slice(vn[1] + 1));
    const to = this.sub(hi);
    const body = this.withVar(v, () => this.parseTerm());
    return { k: 'series', op, v, lo: from, hi: to, body };
  }

  isCmp(): boolean {
    const t = this.peek();
    return t?.t === 'op' && CMP_OPS.has(t.v);
  }

  /** Is the '{' at the cursor a piecewise { cond: value, … }? */
  piecewiseAhead(): boolean {
    let depth = 0;
    for (let j = this.i; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === 'open' && t.v !== '|') depth++;
      else if (t.t === 'close' && t.v !== '|') {
        depth--;
        if (depth === 0) return false;
      } else if (depth === 1 && t.t === 'op' && (t.v === ':' || CMP_OPS.has(t.v))) return true;
    }
    return false;
  }

  /** { x < 0: −x, x ≥ 0: x } or { x < 0: −x, x } (last item without a condition is the "else") */
  parsePiecewise(): Node {
    this.i++; // '{'
    const branches: { cond?: Cond; value: Node }[] = [];
    for (;;) {
      const first = this.parseExpr();
      if (this.isCmp()) {
        const cond: Cond = { items: [first], ops: [] };
        while (this.isCmp()) {
          cond.ops.push((this.peek() as { v: string }).v as CmpOp);
          this.i++;
          cond.items.push(this.parseExpr());
        }
        let value: Node = { k: 'num', v: parseDecimal('1') };
        if (this.isOp(':')) {
          this.i++;
          value = this.parseExpr();
        }
        branches.push({ cond, value });
      } else {
        if (this.isOp(':')) throw new ParseError('A condition needs a comparison, like x < 3');
        branches.push({ value: first });
        if (this.isOp(',')) throw new ParseError('The value without a condition (the “otherwise” value) must come last');
      }
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      this.expectClose('}');
      return { k: 'piecewise', branches };
    }
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
          if (found && !u && !this.blocked.includes(found.id)) this.blocked.push(found.id);
          // "2slug" with Mechanical off: say so instead of reading s·L·µg (D31)
          // (a word whose letters each stand alone, like VA → V·A, may still be read letter by letter)
          const lettersStandAlone = () =>
            seg.every((r) => isVar(r.v) || (() => { const l = lookupUnit(r.v); return !!l && (!this.ctx.units || this.ctx.units(l)); })());
          if (found && !u && i === 0 && j === run.length - 1 && seg.length > 1 && !allVars && !lettersStandAlone()) {
            const pk = packagesOf(found).map((id) => PACKAGE_BY_ID.get(id)?.name ?? id);
            throw Object.assign(new ParseError(`“${segName}” is a unit from ${pk.join(' / ')}, which is off for this worksheet`), { blocked: [...this.blocked] });
          }
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
