// Whole-worksheet evaluation: definitions, dependency resolution, display units, inheritance.
import { parseRow, peekDefinition, parseExpression, ParseError, type ParseContext } from './parser';
import type { ChipFix, ParsedRow, Node } from './ast';
import { isUnitOnly } from './ast';
import * as N from './num';
import { evaluate, type Value, type FuncDef, type Env, unifyList } from './evaluate';
import { CalcError, convertTo, fromUnit, checkConvertible, type Quantity } from './quantity';
import { parseUnitExpr, type UnitExpr } from './units/registry';
import { dimEq, DIMLESS } from './dim';
import { symbolToLatex } from './latex';
import { CONST_BY_KEY } from './units/constants.data';

const constLatex = (k: string) => CONST_BY_KEY.get(k)?.latex ?? k;
import type { DisplayMode } from './format';

export interface SliderConfig {
  min: string;
  max: string;
  step: string;
}

export interface TableColumn {
  id: string;
  header: string; // latex: "x_1" (input) or "y_1=f(x_1)" / "f(x_1)" (computed)
  unit?: string; // display/input unit for the column
  values: string[]; // input cells (plain text numbers / expressions)
}

export type Row =
  | { id: string; type: 'expr'; latex: string; parent?: string; displayUnit?: string; displayMode?: DisplayMode; slider?: SliderConfig }
  | { id: string; type: 'note'; text: string; parent?: string }
  | { id: string; type: 'folder'; title: string; collapsed?: boolean; parent?: undefined }
  | { id: string; type: 'table'; columns: TableColumn[]; parent?: string };

export type RowResult =
  | { kind: 'none' }
  | { kind: 'func'; name: string }
  | { kind: 'value'; value: Value; defName?: string; unitError?: string; autoUnit: UnitExpr; literal: boolean }
  | { kind: 'error'; message: string; defName?: string };

export interface ColumnResult {
  values?: Quantity[];
  error?: string;
  isInput: boolean;
}

export interface WorksheetResult {
  rows: Map<string, RowResult>;
  columns: Map<string, ColumnResult>;
  chips: Map<string, ChipFix[]>;
  defined: Set<string>;
}

export interface EvalSettings {
  angle: 'rad' | 'deg';
}

type DefSource =
  | { kind: 'row'; rowId: string }
  | { kind: 'col'; rowId: string; colId: string };

export function evaluateWorksheet(rows: Row[], settings: EvalSettings): WorksheetResult {
  const results = new Map<string, RowResult>();
  const colResults = new Map<string, ColumnResult>();
  const chips = new Map<string, ChipFix[]>();

  // 1. Collect definitions.
  const varDefs = new Map<string, DefSource[]>();
  const funcDefs = new Map<string, string[]>();
  const add = (m: Map<string, unknown[]>, k: string, v: unknown) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  };
  for (const r of rows) {
    if (r.type === 'expr') {
      const d = safePeek(r.latex);
      if (d?.kind === 'var') add(varDefs, d.name, { kind: 'row', rowId: r.id });
      if (d?.kind === 'func') add(funcDefs, d.name, r.id);
    } else if (r.type === 'table') {
      for (const c of r.columns) {
        const name = columnName(c.header);
        if (name) add(varDefs, name, { kind: 'col', rowId: r.id, colId: c.id });
      }
    }
  }
  const ctx: ParseContext = { vars: new Set(varDefs.keys()), funcs: new Set(funcDefs.keys()) };
  const duplicate = (name: string) => (varDefs.get(name)?.length ?? 0) + (funcDefs.get(name)?.length ?? 0) > 1;

  // 2. Parse.
  const parsed = new Map<string, ParsedRow | Error>();
  for (const r of rows) {
    if (r.type !== 'expr') continue;
    try {
      const p = parseRow(r.latex, ctx);
      parsed.set(r.id, p.row);
      if (p.chips.length) chips.set(r.id, p.chips);
    } catch (e) {
      parsed.set(r.id, e as Error);
    }
  }
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // 3. Lazy evaluation with cycle detection.
  const varCache = new Map<string, Value | Error>();
  const visiting: string[] = [];

  const env: Env = {
    angle: settings.angle,
    getVar(name) {
      const srcs = varDefs.get(name);
      if (!srcs) return undefined;
      if (duplicate(name)) throw new CalcError(`“${name}” is defined more than once`);
      const cached = varCache.get(name);
      if (cached instanceof Error) throw new CalcError(`depends on “${name}”, which has an error`);
      if (cached) return cached;
      if (visiting.includes(name)) {
        const cycle = visiting.slice(visiting.indexOf(name)).concat(name).join(' → ');
        throw new CycleError(`Circular definition: ${cycle}`);
      }
      visiting.push(name);
      try {
        const src = srcs[0];
        const v = src.kind === 'row' ? evalRowValue(src.rowId) : evalColumn(src.rowId, src.colId);
        varCache.set(name, v);
        return v;
      } catch (e) {
        if (e instanceof CycleError) throw e;
        varCache.set(name, e as Error);
        throw e;
      } finally {
        visiting.pop();
      }
    },
    getFunc(name) {
      const ids = funcDefs.get(name);
      if (!ids) return undefined;
      if (duplicate(name)) throw new CalcError(`“${name}” is defined more than once`);
      const p = parsed.get(ids[0]);
      if (!p || p instanceof Error || p.kind !== 'fdef') throw new CalcError(`“${name}” has an error`);
      return { params: p.params, body: p.expr } as FuncDef;
    },
  };

  /** Evaluate an expr row's value with its display unit applied (what dependents inherit). */
  const rowValueCache = new Map<string, { value: Value; auto: UnitExpr; unitError?: string }>();
  function evalRowFull(rowId: string) {
    const hit = rowValueCache.get(rowId);
    if (hit) return hit;
    const r = rowById.get(rowId) as Extract<Row, { type: 'expr' }>;
    const p = parsed.get(rowId)!;
    if (p instanceof Error) throw p;
    if (p.kind === 'empty' || p.kind === 'fdef') throw new CalcError('No value');
    let value = evaluate(p.expr, env);
    const auto = value.t === 'q' ? value.q.unit : (value.items[0]?.unit ?? []);
    let unitError: string | undefined;
    if (r.displayUnit) {
      try {
        const u = parseUnitExpr(r.displayUnit);
        value = applyUnit(value, u);
      } catch (e) {
        unitError = (e as Error).message;
      }
    }
    const out = { value, auto, unitError };
    rowValueCache.set(rowId, out);
    return out;
  }
  function evalRowValue(rowId: string): Value {
    return evalRowFull(rowId).value;
  }

  const colCache = new Map<string, Value>();
  function evalColumn(rowId: string, colId: string): Value {
    const key = rowId + '/' + colId;
    const hit = colCache.get(key);
    if (hit) return hit;
    const t = rowById.get(rowId) as Extract<Row, { type: 'table' }>;
    const c = t.columns.find((x) => x.id === colId)!;
    const unit = c.unit ? parseUnitExpr(c.unit) : undefined;
    let v: Value;
    if (isInputHeader(c.header)) {
      const items: Quantity[] = [];
      for (const cell of c.values) {
        if (!cell.trim()) continue;
        const n = parseExpression(cellToLatex(cell), ctx);
        const q = evaluate(n, env);
        if (q.t !== 'q') throw new CalcError('Table cells must be single values');
        const x = q.q;
        items.push(unit && dimEq(x.dim, DIMLESS) && !x.unit.length ? fromUnit(x.si, unit) : x);
      }
      v = { t: 'list', items: unifyList(items) };
    } else {
      const rhs = computedExpr(c.header);
      v = evaluate(parseExpression(rhs, ctx), env);
      if (unit) v = applyUnit(v, unit);
    }
    colCache.set(key, v);
    return v;
  }

  // 4. Produce per-row results.
  for (const r of rows) {
    if (r.type === 'expr') {
      const p = parsed.get(r.id)!;
      if (p instanceof Error) {
        results.set(r.id, { kind: 'error', message: friendly(p) });
        continue;
      }
      if (p.kind === 'empty') {
        results.set(r.id, { kind: 'none' });
        continue;
      }
      if (p.kind === 'fdef') {
        results.set(r.id, duplicate(p.name) ? { kind: 'error', message: `“${p.name}” is defined more than once`, defName: p.name } : { kind: 'func', name: p.name });
        continue;
      }
      const defName = p.kind === 'def' ? p.name : undefined;
      try {
        if (defName && duplicate(defName)) throw new CalcError(`“${defName}” is defined more than once`);
        const full = defName ? (env.getVar(defName), evalRowFull(r.id)) : evalRowFull(r.id);
        results.set(r.id, { kind: 'value', value: full.value, defName, unitError: full.unitError, autoUnit: full.auto, literal: !!defName && isLiteral(p.expr) });
      } catch (e) {
        results.set(r.id, { kind: 'error', message: friendly(e as Error), defName });
      }
    } else if (r.type === 'table') {
      for (const c of r.columns) {
        const name = columnName(c.header);
        const isInput = isInputHeader(c.header);
        try {
          const v = name ? env.getVar(name)! : evalColumn(r.id, c.id);
          colResults.set(c.id, { values: v.t === 'list' ? v.items : [v.q], isInput });
        } catch (e) {
          colResults.set(c.id, { error: friendly(e as Error), isInput });
        }
      }
    }
  }

  return { rows: results, columns: colResults, chips, defined: ctx.vars };
}

class CycleError extends CalcError {}

function applyUnit(v: Value, u: UnitExpr): Value {
  if (v.t === 'q') return { t: 'q', q: convertTo(v.q, u) };
  return { t: 'list', items: v.items.map((q) => convertTo(q, u)) };
}

export function canDisplayIn(q: Quantity, unitText: string): string | null {
  try {
    return checkConvertible(q, parseUnitExpr(unitText));
  } catch (e) {
    return (e as Error).message;
  }
}

function friendly(e: Error): string {
  if (e instanceof ParseError || e instanceof CalcError) return e.message;
  if (e instanceof EvalError || e instanceof RangeError || e instanceof SyntaxError) return e.message;
  return e.message || 'Error';
}

function safePeek(latex: string) {
  try {
    return peekDefinition(latex);
  } catch {
    return null;
  }
}

export function isInputHeader(h: string): boolean {
  const d = safePeek(h + '=0');
  return !!d && d.kind === 'var' && !h.includes('=');
}

/** Name defined by a column header ("x_1" or "y_1=…"); undefined for bare expressions. */
export function columnName(h: string): string | undefined {
  if (isInputHeader(h)) return safePeek(h + '=0')!.name;
  const d = safePeek(h);
  return d?.kind === 'var' ? d.name : undefined;
}

function computedExpr(h: string): string {
  const i = h.indexOf('=');
  return i >= 0 ? h.slice(i + 1) : h;
}

function cellToLatex(cell: string): string {
  return cell.replace(/\*/g, '\\cdot ').replace(/−/g, '-');
}

/** A plain typed value: 6, −2.5, 3·10⁵, 6 N, 2 mm², [1, 2, 3] — nothing actually computed. */
export function isLiteral(n: Node): boolean {
  const number = (x: Node): boolean => {
    if (x.k === 'num') return true;
    if (x.k === 'neg') return number(x.a);
    if (x.k === 'bin' && x.op === '*') return number(x.a) && isPow10(x.b);
    return isPow10(x);
  };
  const isPow10 = (x: Node): boolean =>
    x.k === 'bin' && x.op === '^' && x.a.k === 'num' && N.cmp(x.a.v, N.exact(10n)) === 0 && (x.b.k === 'num' || (x.b.k === 'neg' && x.b.a.k === 'num'));
  if (n.k === 'list') return n.items.every(isLiteral);
  if (n.k === 'neg') return isLiteral(n.a);
  if (n.k === 'qty') return number(n.v) && isUnitOnly(n.u);
  // 3·(10⁵ MPa): the unit binds to the power of ten
  if (n.k === 'bin' && n.op === '*' && number(n.a) && n.b.k === 'qty') return isPow10(n.b.v) && isUnitOnly(n.b.u);
  return number(n);
}

/** Apply chip fixes (bare unit letters → \unit{…}) to a row's LaTeX. */
export function applyChips(latex: string, chips: ChipFix[]): string {
  let out = latex;
  for (const c of [...chips].sort((a, b) => b.s - a.s)) {
    const inner = symbolToLatex(c.id);
    out = out.slice(0, c.s) + (c.kind === 'unit' ? `\\unit{${inner}}` : `\\const{${constLatex(c.id)}}`) + out.slice(c.e);
  }
  return out;
}
