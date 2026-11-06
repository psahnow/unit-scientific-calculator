// Whole-worksheet evaluation: definitions, dependency resolution, display units, inheritance.
import { parseRow, peekDefinition, parseExpression, ParseError, type ParseContext, type NameRef } from './parser';
import type { ChipFix, ParsedRow, Node } from './ast';
import { isUnitOnly } from './ast';
import * as N from './num';
import { evaluate, collectNotes, inferUnit, unitQuantity, declaredUnit, type Value, type Env, unifyList } from './evaluate';
import { CalcError, convertTo, fromUnit, checkConvertible, kelvinAsAbsolute, kelvinNote, type Quantity } from './quantity';
import { parseUnitExpr, getUnit, lookupUnit, setCustomUnits, formatUnit, type UnitExpr, type CustomUnitInput } from './units/registry';
import { availability, packagesOf, offPackageMessage } from './units/packages';
import { dimEq, DIMLESS } from './dim';
import { symbolToLatex, latexToSymbol, tokenize } from './latex';
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
  | {
      id: string;
      type: 'expr';
      latex: string;
      parent?: string;
      displayUnit?: string;
      displayMode?: DisplayMode;
      slider?: SliderConfig;
      /** 'folder': the definition is only visible inside its folder (D24). Default: global. */
      scope?: 'folder';
    }
  | { id: string; type: 'note'; text: string; parent?: string }
  | { id: string; type: 'folder'; title: string; collapsed?: boolean; parent?: undefined }
  | { id: string; type: 'table'; columns: TableColumn[]; parent?: string };

export type RowResult =
  | { kind: 'none' }
  // outUnit (D53): the unit the function gives, when it doesn't depend on the inputs ('' = a plain number)
  | { kind: 'func'; name: string; outUnit?: string }
  | { kind: 'value'; value: Value; defName?: string; unitError?: string; unitNote?: string; autoUnit: UnitExpr; literal: boolean }
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
  /** Every name defined anywhere. */
  defined: Set<string>;
  /** Names visible from a scope: a folder id, or null for top level. */
  varsIn(scope: string | null): string[];
  /** Folder-scoped definition rows that shadow a global of the same name. */
  shadows: Set<string>;
  /** Per-row warnings, e.g. a bare “F” read as farad because F is only defined in another folder. */
  notices: Map<string, string>;
  /** Per-row information (not a problem), e.g. how an ambiguous unit was read. */
  infos: Map<string, string>;
  /** Where each row uses row-defined names (for "used by" and rename, D37). */
  refs: Map<string, NameRef[]>;
  /** Where each definition row writes its name. */
  defSpans: Map<string, { s: number; e: number }>;
  /** Which definition a name means from a row: 'global' or a folder id; null if undefined there. */
  resolves(rowId: string, name: string): string | null;
  /** One message per custom unit that couldn't be defined (undefined when fine). */
  customUnitErrors: (string | undefined)[];
  /** Rows using a unit chip from a package that is off: the packages that would provide it. */
  packageHints: Map<string, { unit: string; packages: string[]; typed?: boolean }>;
}

export interface EvalSettings {
  angle: 'rad' | 'deg';
  /** Enabled unit packages (D26). Omitted: every unit is available. */
  packages?: readonly string[];
  /** Worksheet-defined units (D34), e.g. { symbol: 'bag', definition: '25 kg' }. */
  units?: readonly CustomUnitInput[];
}

type DefSource =
  | { kind: 'row'; rowId: string }
  | { kind: 'col'; rowId: string; colId: string };

type Scope = string | null;

/** Definitions visible at one level: the global level, or one folder's local level. */
interface Level {
  vars: Map<string, DefSource[]>;
  funcs: Map<string, string[]>;
}

const newLevel = (): Level => ({ vars: new Map(), funcs: new Map() });
function push<T>(m: Map<string, T[]>, k: string, v: T) {
  if (!m.has(k)) m.set(k, []);
  m.get(k)!.push(v);
}
const srcKey = (s: DefSource) => (s.kind === 'row' ? s.rowId : s.rowId + '/' + s.colId);

/** The folder a definition row is scoped to (D24), or null if it is global. */
export function definitionScope(r: Row): Scope {
  return r.type === 'expr' && r.scope === 'folder' && r.parent ? r.parent : null;
}

export function evaluateWorksheet(rows: Row[], settings: EvalSettings): WorksheetResult {
  const customUnitErrors = setCustomUnits(settings.units ?? []);
  const results = new Map<string, RowResult>();
  const colResults = new Map<string, ColumnResult>();
  const chips = new Map<string, ChipFix[]>();
  const rowById = new Map(rows.map((r) => [r.id, r]));
  /** Where a row's own expression is evaluated (lexical scope): its folder, if any. */
  const scopeOf = (rowId: string): Scope => rowById.get(rowId)?.parent ?? null;

  // 1. Collect definitions into the global level or a folder's local level.
  const global = newLevel();
  const locals = new Map<string, Level>();
  const levelFor = (scope: Scope) => {
    if (scope === null) return global;
    if (!locals.has(scope)) locals.set(scope, newLevel());
    return locals.get(scope)!;
  };
  for (const r of rows) {
    if (r.type === 'expr') {
      const d = safePeek(r.latex);
      const lv = levelFor(definitionScope(r));
      if (d?.kind === 'var') push<DefSource>(lv.vars, d.name, { kind: 'row', rowId: r.id });
      if (d?.kind === 'func') push(lv.funcs, d.name, r.id);
    } else if (r.type === 'table') {
      for (const c of r.columns) {
        const name = columnName(c.header);
        if (name) push<DefSource>(global.vars, name, { kind: 'col', rowId: r.id, colId: c.id });
      }
    }
  }
  const duplicateIn = (lv: Level, name: string) => (lv.vars.get(name)?.length ?? 0) + (lv.funcs.get(name)?.length ?? 0) > 1;
  const dupMessage = (lv: Level, name: string) => `“${name}” is defined more than once${lv === global ? '' : ' in this folder'}`;
  /** The level that answers `name` when looked up from `scope`: the folder's own, else global. */
  const levelOf = (scope: Scope, name: string): Level => {
    const lv = scope !== null ? locals.get(scope) : undefined;
    return lv && (lv.vars.has(name) || lv.funcs.has(name)) ? lv : global;
  };

  const unitsOn = availability(settings.packages);
  const ctxCache = new Map<Scope, ParseContext>();
  const ctxFor = (scope: Scope): ParseContext => {
    let c = ctxCache.get(scope);
    if (!c) {
      const lv = scope !== null ? locals.get(scope) : undefined;
      c = {
        vars: new Set([...global.vars.keys(), ...(lv?.vars.keys() ?? [])]),
        funcs: new Set([...global.funcs.keys(), ...(lv?.funcs.keys() ?? [])]),
        units: unitsOn,
      };
      ctxCache.set(scope, c);
    }
    return c;
  };

  // 2. Parse each row with the names visible from its folder.
  const blockedUnits = new Map<string, string[]>();
  const refsByRow = new Map<string, NameRef[]>();
  const defSpans = new Map<string, { s: number; e: number }>();
  const parsed = new Map<string, ParsedRow | Error>();
  for (const r of rows) {
    if (r.type !== 'expr') continue;
    try {
      const p = parseRow(r.latex, ctxFor(r.parent ?? null));
      parsed.set(r.id, p.row);
      if (p.chips.length) chips.set(r.id, p.chips);
      if (p.blocked.length) blockedUnits.set(r.id, p.blocked);
      refsByRow.set(r.id, p.refs);
      if (p.defSpan) defSpans.set(r.id, p.defSpan);
    } catch (e) {
      parsed.set(r.id, e as Error);
      const b = (e as ParseError).blocked;
      if (b?.length) blockedUnits.set(r.id, b);
    }
  }

  // 2b. A bare letter run read as a unit/constant that is also a folder-only name elsewhere is
  //     probably a reference that can't see that folder: warn, and don't auto-chip it, so the
  //     reading stays open until the user picks the chip on purpose (D24).
  const notices = new Map<string, string>();
  const infos = new Map<string, string>();
  const folderTitle = (id: string) => {
    const f = rowById.get(id);
    if (f?.type !== 'folder') return 'another folder';
    const title = f.title || 'Untitled folder';
    // two folders with the same name: say which one by its row number
    const same = rows.filter((x) => x.type === 'folder' && (x.title || 'Untitled folder') === title);
    return same.length > 1 ? `${title} (row ${rows.indexOf(f) + 1})` : title;
  };
  const folderList = (ids: string[]) => [...new Set(ids.map((h) => `“${folderTitle(h)}”`))].join(', ');
  // "3m" with a variable m: a number right before a name reads like a quantity, so say the name wins
  // (D59). Other uses of a name that is also a unit (σ = F/A) are left alone: there it reads as a name.
  for (const r of rows) {
    if (r.type !== 'expr' || !r.latex) continue;
    const toks = tokenize(r.latex);
    const vars = ctxFor(r.parent ?? null).vars;
    for (let k = 0; k + 1 < toks.length; k++) {
      const [t, nx, after] = [toks[k], toks[k + 1], toks[k + 2]];
      if (t.t !== 'num' || nx.t !== 'letter' || after?.t === 'letter' || (after?.t === 'op' && after.v === '_')) continue;
      const u = lookupUnit(nx.v);
      if (!u || !vars.has(nx.v) || (settings.packages && !availability(settings.packages)(u))) continue;
      infos.set(r.id, `In ${t.v}${nx.v}, ${nx.v} is your variable ${nx.v}, not the unit ${u.name} (${u.id}). To mean ${u.name}, pick it from the suggestions as you type.`);
      break;
    }
  }
  for (const r of rows) {
    const fixes = chips.get(r.id);
    if (r.type !== 'expr' || !fixes) continue;
    // bare "lb" falls back to pound-mass (D20): say so on the row
    if (fixes.some((c) => c.id === 'lbm' && (c.text === 'lb' || c.text === 'lbs')))
      infos.set(r.id, '“lb” is read as pound-mass (lbm). For pound-force, use lbf.');
    const here = r.parent ?? null;
    const kept: ChipFix[] = [];
    for (const c of fixes) {
      const homes = c.text ? [...locals.entries()].filter(([fid, lv]) => fid !== here && lv.vars.has(c.text!)).map(([fid]) => fid) : [];
      if (!homes.length) {
        kept.push(c);
        continue;
      }
      // an error, not a quiet fallback to a unit (L → litre): the number would be silently wrong
      const meaning = c.kind === 'unit' ? `the unit ${getUnit(c.id).name} (${c.id})` : `the constant ${c.text}`;
      const where = folderList(homes);
      parsed.set(
        r.id,
        new ParseError(
          `${c.text} is only defined inside ${where}. Make it global, or move this row into that folder. ` +
            `If you meant ${meaning}, pick it from the suggestions as you type.`,
        ),
      );
    }
    if (kept.length) chips.set(r.id, kept);
    else chips.delete(r.id);
  }

  // 2c. Unit chips from a package that is off still work, but say which package they need.
  const packageHints = new Map<string, { unit: string; packages: string[]; typed?: boolean }>();
  if (settings.packages)
    for (const r of rows) {
      if (r.type !== 'expr') continue;
      for (const m of r.latex.matchAll(/\\unit\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
        const u = lookupUnit(latexToSymbol(m[1]));
        if (u && !unitsOn(u)) {
          packageHints.set(r.id, { unit: u.id, packages: packagesOf(u) });
          break;
        }
      }
    }

  // 3. Lazy evaluation with cycle detection, cached per definition.
  const varCache = new Map<string, Value | Error>();
  const visiting: { key: string; name: string }[] = [];

  function valueOf(name: string, src: DefSource): Value {
    const key = srcKey(src);
    const cached = varCache.get(key);
    if (cached instanceof Error) throw new CalcError(`depends on “${name}”, which has an error`);
    if (cached) return cached;
    const at = visiting.findIndex((v) => v.key === key);
    if (at >= 0) {
      const cycle = visiting.slice(at).map((v) => v.name).concat(name).join(' → ');
      throw new CycleError(`Circular definition: ${cycle}`);
    }
    visiting.push({ key, name });
    try {
      const v = src.kind === 'row' ? evalRowValue(src.rowId) : evalColumn(src.rowId, src.colId);
      varCache.set(key, v);
      return v;
    } catch (e) {
      if (e instanceof CycleError) throw e;
      varCache.set(key, e as Error);
      throw e;
    } finally {
      visiting.pop();
    }
  }

  /**
   * #n (D56): the answer of row n (numbered over every row, as in the margin). Only a plain
   * calculation row has one; a row that defines a name is used by that name instead.
   */
  function rowRef(n: number): Value {
    const r = rows[n - 1];
    if (!r) throw new CalcError(n === 0 ? 'The row this referred to (#) was deleted' : `There’s no row ${n}`);
    if (r.type !== 'expr') throw new CalcError(`Row ${n} is a ${r.type === 'note' ? 'note' : r.type === 'folder' ? 'folder' : 'table'}, so #${n} has no value`);
    const p = parsed.get(r.id);
    if (!p || p instanceof Error) throw new CalcError(`Row ${n} has an error`);
    if (p.kind === 'def') throw new CalcError(`Row ${n} defines ${p.name}: use ${p.name} rather than #${n}`);
    if (p.kind === 'fdef') throw new CalcError(`Row ${n} defines the function ${p.name}`);
    if (p.kind === 'empty') throw new CalcError(`Row ${n} is empty`);
    try {
      return valueOf('#' + n, { kind: 'row', rowId: r.id });
    } catch (e) {
      if (e instanceof CycleError) throw e;
      throw new CalcError(`Row ${n} has an error`);
    }
  }

  const envCache = new Map<Scope, Env>();
  function envFor(scope: Scope): Env {
    const hit = envCache.get(scope);
    if (hit) return hit;
    const env: Env = {
      angle: settings.angle,
      getVar(name) {
        if (name.startsWith('#')) return rowRef(Number(name.slice(1)));
        const lv = levelOf(scope, name);
        const srcs = lv.vars.get(name);
        if (!srcs) return undefined;
        if (duplicateIn(lv, name)) throw new CalcError(dupMessage(lv, name));
        return valueOf(name, srcs[0]);
      },
      getFunc(name) {
        const lv = levelOf(scope, name);
        const ids = lv.funcs.get(name);
        if (!ids) return undefined;
        if (duplicateIn(lv, name)) throw new CalcError(dupMessage(lv, name));
        const p = parsed.get(ids[0]);
        if (!p || p instanceof Error || p.kind !== 'fdef') throw new CalcError(`“${name}” has an error`);
        return { params: p.params, paramUnits: p.paramUnits, body: p.expr, env: envFor(scopeOf(ids[0])) };
      },
    };
    envCache.set(scope, env);
    return env;
  }

  /** The row's scope, plus `ans` = the answer of the nearest row above that has one (D33). */
  function rowEnv(rowId: string): Env {
    const scope = scopeOf(rowId);
    const base = envFor(scope);
    if (levelOf(scope, 'ans').vars.has('ans')) return base; // a user-defined ans wins
    return {
      ...base,
      getVar(name) {
        if (name !== 'ans') return base.getVar(name);
        for (let k = rows.findIndex((x) => x.id === rowId) - 1; k >= 0; k--) {
          const prev = rows[k];
          if (prev.type !== 'expr') continue;
          const pp = parsed.get(prev.id);
          if (!pp || (!(pp instanceof Error) && (pp.kind === 'empty' || pp.kind === 'fdef'))) continue;
          try {
            return evalRowValue(prev.id);
          } catch {
            throw new CalcError('“ans” is the answer of the row above, and that row has an error');
          }
        }
        throw new CalcError('“ans” is the answer of the row above, but no row above has one yet');
      },
    };
  }

  /**
   * The unit a function gives (D53), by dimensional analysis of its body. Inputs with a declared
   * unit use it. An untyped input only matters if its unit reaches the result: the analysis is run
   * with two unrelated stand-in dimensions for the untyped inputs, and if both agree (x/x·1 m → m)
   * they don't matter. If they disagree, or one fails (x + 1 m needs x to be a length), there's
   * nothing to show until the input is typed (D54).
   */
  function outputUnit(p: Extract<ParsedRow, { kind: 'fdef' }>, rowId: string): string | undefined {
    if (!p.params.length) return undefined;
    try {
      const env = rowEnv(rowId);
      const typed = new Map<string, Quantity>();
      p.params.forEach((name, k) => {
        const un = p.paramUnits?.[k];
        if (un) typed.set(name, unitQuantity(declaredUnit(un, env)));
      });
      const untyped = p.params.filter((name) => !typed.has(name));
      const STAND_INS: UnitExpr[] = [
        [{ id: 'A', power: 1 }, { id: 'cd', power: 2 }],
        [{ id: 'mol', power: 1 }, { id: 'cd', power: -3 }],
      ];
      const runs = (untyped.length ? STAND_INS : [[]]).map((stand) => {
        const known = new Map(typed);
        for (const name of untyped) known.set(name, unitQuantity(stand));
        return inferUnit(p.expr, env, known);
      });
      if (runs.some((q) => !q) || runs.some((q) => !dimEq(q!.dim, runs[0]!.dim) || formatUnit(q!.unit) !== formatUnit(runs[0]!.unit))) return undefined;
      return formatUnit(runs[0]!.unit);
    } catch {
      return undefined;
    }
  }

  /** Evaluate an expr row's value with its display unit applied (what dependents inherit). */
  const rowValueCache = new Map<string, { value: Value; auto: UnitExpr; unitError?: string; unitNote?: string }>();
  const rowNotes = new Map<string, string>();
  function evalRowFull(rowId: string) {
    const hit = rowValueCache.get(rowId);
    if (hit) return hit;
    const r = rowById.get(rowId) as Extract<Row, { type: 'expr' }>;
    const p = parsed.get(rowId)!;
    if (p instanceof Error) throw p;
    if (p.kind === 'empty' || p.kind === 'fdef') throw new CalcError('No value');
    const run = collectNotes(() => evaluate(p.expr, rowEnv(rowId)));
    let value = run.value;
    if (run.notes.length) rowNotes.set(rowId, run.notes.join(' '));
    const auto = value.t === 'q' ? value.q.unit : (value.items[0]?.unit ?? []);
    let unitError: string | undefined;
    let unitNote: string | undefined;
    if (r.displayUnit) {
      try {
        const u = parseUnitExpr(r.displayUnit);
        // a display unit from a package that is off is refused, like typing it would be (D59)
        const off = offPackageMessage(u, getUnit, availability(settings.packages));
        if (off) throw new CalcError(off);
        const first = value.t === 'q' ? value.q : value.items[0];
        if (first && kelvinAsAbsolute(first, u)) unitNote = kelvinNote(u);
        value = applyUnit(value, u);
      } catch (e) {
        unitError = (e as Error).message;
      }
    }
    const out = { value, auto, unitError, unitNote };
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
    const scope = t.parent ?? null;
    const env = envFor(scope);
    const ctx = ctxFor(scope);
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
  const shadows = new Set<string>();
  const isGlobalName = (name: string) => global.vars.has(name) || global.funcs.has(name);
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
      const own = levelFor(definitionScope(r));
      if (p.kind === 'fdef') {
        if (own !== global && isGlobalName(p.name)) shadows.add(r.id);
        results.set(r.id, duplicateIn(own, p.name) ? { kind: 'error', message: dupMessage(own, p.name), defName: p.name } : { kind: 'func', name: p.name, outUnit: outputUnit(p, r.id) });
        continue;
      }
      const defName = p.kind === 'def' ? p.name : undefined;
      if (defName && own !== global && isGlobalName(defName)) shadows.add(r.id);
      try {
        if (defName && duplicateIn(own, defName)) throw new CalcError(dupMessage(own, defName));
        if (defName) valueOf(defName, { kind: 'row', rowId: r.id });
        const full = evalRowFull(r.id);
        results.set(r.id, { kind: 'value', value: full.value, defName, unitError: full.unitError, unitNote: full.unitNote, autoUnit: full.auto, literal: !!defName && isLiteral(p.expr) });
      } catch (e) {
        results.set(r.id, { kind: 'error', message: friendly(e as Error), defName });
      }
    } else if (r.type === 'table') {
      for (const c of r.columns) {
        const name = columnName(c.header);
        const isInput = isInputHeader(c.header);
        try {
          if (name && duplicateIn(global, name)) throw new CalcError(dupMessage(global, name));
          const v = name ? valueOf(name, { kind: 'col', rowId: r.id, colId: c.id }) : evalColumn(r.id, c.id);
          colResults.set(c.id, { values: v.t === 'list' ? v.items : [v.q], isInput });
        } catch (e) {
          colResults.set(c.id, { error: friendly(e as Error), isInput });
        }
      }
    }
  }

  // 5. Explain the two most confusing "isn't defined" cases (D29).
  for (const r of rows) {
    if (r.type !== 'expr') continue;
    const res = results.get(r.id);
    // a name that exists, but only inside another folder
    const m = res?.kind === 'error' ? /^“(.+)” isn't defined yet/.exec(res.message) : null;
    if (m && res?.kind === 'error') {
      const homes = [...locals.entries()].filter(([fid, lv]) => fid !== (r.parent ?? null) && lv.vars.has(m[1])).map(([fid]) => fid);
      if (homes.length) {
        results.set(r.id, { ...res, message: `“${m[1]}” is only defined inside ${folderList(homes)}: make it global, or move this row into that folder` });
        continue;
      }
    }
    // a unit typed as letters whose package is off
    const blocked = blockedUnits.get(r.id);
    if (blocked && !packageHints.has(r.id)) {
      const u = getUnit(blocked[0]);
      packageHints.set(r.id, { unit: u.id, packages: packagesOf(u), typed: true });
      // "2Torr" fails as T·o·r·r: say it's a unit that is switched off instead
      if (res?.kind === 'error' && u.id.length > 1 && /isn't defined yet/.test(res.message))
        results.set(r.id, { ...res, message: `“${u.id}” is a unit from a package that is off for this worksheet` });
    }
  }

  // DEG mode changes what bare numbers in trig mean: say so on the rows it affects (D37)
  if (settings.angle === 'deg')
    for (const r of rows) {
      const p = parsed.get(r.id);
      if (!p || p instanceof Error || p.kind === 'empty' || infos.has(r.id)) continue;
      if (degreeSensitive(p.expr)) infos.set(r.id, 'DEG mode: plain numbers in trig functions are degrees, and inverse trig answers in degrees. Switch to RAD at the top for radians.');
    }

  const defined = new Set<string>([...global.vars.keys(), ...[...locals.values()].flatMap((l) => [...l.vars.keys()])]);
  for (const [id, n] of rowNotes) infos.set(id, infos.has(id) ? `${infos.get(id)} ${n}` : n);
  return {
    rows: results, columns: colResults, chips, defined, varsIn: (scope) => [...ctxFor(scope).vars], shadows, notices, infos, packageHints, customUnitErrors,
    refs: refsByRow,
    defSpans,
    resolves(rowId, name) {
      const scope = rowById.get(rowId)?.parent ?? null;
      const lv = levelOf(scope, name);
      if (!lv.vars.has(name) && !lv.funcs.has(name)) return null;
      return lv === global ? 'global' : scope;
    },
  };
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

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
const INV_TRIG = new Set(['asin', 'acos', 'atan', 'arcsec', 'arccsc', 'arccot', 'atan2']);
const hasUnit = (n: Node): boolean =>
  n.k === 'unit' || Object.values(n).some((v) => (Array.isArray(v) ? v.some((x) => x && typeof x === 'object' && 'k' in x && hasUnit(x)) : v && typeof v === 'object' && 'k' in v && hasUnit(v as Node)));
/** Whether the RAD/DEG mode changes this expression's value: trig of something without an angle unit, or inverse trig. */
function degreeSensitive(n: Node): boolean {
  if (n.k === 'call' && ((TRIG.has(n.name) && !hasUnit(n.args[0])) || INV_TRIG.has(n.name))) return true;
  return Object.values(n).some((v) =>
    Array.isArray(v) ? v.some((x) => x && typeof x === 'object' && 'k' in x && degreeSensitive(x)) : v && typeof v === 'object' && 'k' in v && degreeSensitive(v as Node),
  );
}

/**
 * Rename a defined name everywhere it means that definition (D37). Returns the new rows, or an
 * explanation when the new name can't be used.
 */
export function renameDefinition(rows: Row[], result: WorksheetResult, defRowId: string, newName: string): Row[] | string {
  const def = rows.find((r) => r.id === defRowId);
  const span = result.defSpans.get(defRowId);
  if (!def || def.type !== 'expr' || !span) return 'Only a row that defines a name can be renamed';
  const oldName = latexToSymbol(def.latex.slice(span.s, span.e)).replace(/_\{?([^}]*)\}?/, '_$1');
  const name = newName.trim().replace(/\s+/g, '');
  if (!/^[A-Za-zα-ωΑ-Ω](_[A-Za-z0-9]+)?$/.test(name)) return 'A name is one letter, optionally with a subscript, like F, σ or F_1';
  if (name === oldName) return 'That is already its name';
  if (result.defined.has(name)) return `“${name}” is already defined in this worksheet`;
  const level = definitionScope(def) ?? 'global';
  const newLatex = (() => {
    const [b, sub] = name.split('_');
    const g = symbolToLatex(b);
    return sub ? `${g}_{${sub}}` : g;
  })();
  return rows.map((r) => {
    if (r.type !== 'expr') return r;
    const spans = (result.refs.get(r.id) ?? []).filter((x) => x.name === oldName && result.resolves(r.id, oldName) === level);
    if (r.id === defRowId) spans.push({ ...span, name: oldName });
    if (!spans.length) return r;
    let latex = r.latex;
    for (const x of [...spans].sort((a, b) => b.s - a.s)) latex = latex.slice(0, x.s) + newLatex + latex.slice(x.e);
    return { ...r, latex };
  });
}
