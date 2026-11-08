// The guided tour and the one-time inline tips (D60, docs/tutorial.md). Pure: every rule reads the
// worksheet and its evaluation, so each one is unit-tested against real results.
import type { Row, RowResult, WorksheetResult } from '../engine/worksheet';
import { dimEq, dim, type Dim } from '../engine/dim';
import { toNumber } from '../engine/num';

export interface TourCtx {
  rows: Row[];
  result: WorksheetResult;
  toolbox: boolean;
}

/** What a step's "Show me" may do to the worksheet. */
export interface TourApi {
  /** Put this LaTeX in the last row if it is empty, else in a new row at the end. Returns its id. */
  put(latex: string, extra?: Partial<Extract<Row, { type: 'expr' }>>): string;
  update(id: string, patch: Partial<Row>): void;
  remove(id: string): void;
  openToolbox(): void;
}

export interface TourStep {
  id: string;
  title: string;
  /** Short text; `code` in backticks is shown as something to type. */
  body(ctx: TourCtx): string;
  goal?(ctx: TourCtx): boolean;
  /** CSS selector of what to spotlight, if anything. */
  target?(ctx: TourCtx): string | null;
  showMe?(ctx: TourCtx, api: TourApi): void;
  /** Tidy up when moving past this step. */
  onLeave?(ctx: TourCtx, api: TourApi): void;
}

const r = String.raw;
const FORCE = dim({ L: 1, M: 1, T: -2 });
const AREA = dim({ L: 2 });
const PRESSURE = dim({ L: -1, M: 1, T: -2 });

const qOf = (res: RowResult | undefined) => (res?.kind === 'value' && res.value.t === 'q' ? res.value.q : undefined);
const exprRows = (ctx: TourCtx) => ctx.rows.filter((x): x is Extract<Row, { type: 'expr' }> => x.type === 'expr');
const rowWith = (ctx: TourCtx, pred: (res: RowResult | undefined, row: Extract<Row, { type: 'expr' }>) => boolean) =>
  exprRows(ctx).find((x) => pred(ctx.result.rows.get(x.id), x));
const defines = (ctx: TourCtx, name: string, d: Dim) =>
  rowWith(ctx, (res) => res?.kind === 'value' && res.defName === name && !!qOf(res) && dimEq(qOf(res)!.dim, d));
/** An answer row (no name) whose value is a pressure: F / A. */
const pressureRow = (ctx: TourCtx) => rowWith(ctx, (res) => res?.kind === 'value' && !res.defName && !!qOf(res) && dimEq(qOf(res)!.dim, PRESSURE));
const mismatchRow = (ctx: TourCtx) => rowWith(ctx, (res) => res?.kind === 'error' && /^Can't add/.test(res.message));
const lastEmpty = (ctx: TourCtx) => {
  const last = ctx.rows[ctx.rows.length - 1];
  return last?.type === 'expr' && !last.latex.trim() ? last.id : null;
};
const at = (id: string | null | undefined, inner = '') => (id ? `[data-row-id="${id}"]${inner ? ' ' + inner : ''}` : null);
export const rowNumberOf = (rows: Row[], id: string) => rows.findIndex((x) => x.id === id) + 1;

export const TOUR: TourStep[] = [
  {
    id: 'units',
    title: 'Numbers carry units',
    body: () =>
      'Type `F = 6 kN`. As you type the unit, a suggestion appears: press Tab (or just keep typing) and it becomes a unit chip.',
    goal: (c) => !!defines(c, 'F', FORCE),
    target: (c) => at(lastEmpty(c)) ?? at(rowWith(c, (_, x) => /^F\s*=/.test(x.latex))?.id),
    showMe: (_, api) => api.put(r`F=6\unit{kN}`),
  },
  {
    id: 'derived',
    title: 'Units do the arithmetic',
    body: () => 'Press Enter for a new row and add `A = 20 mm^2`, then a row with just `F / A`. The answer comes out in the units you used: kN/mm².',
    goal: (c) => !!defines(c, 'A', AREA) && !!pressureRow(c),
    target: (c) => at(lastEmpty(c)),
    showMe: (c, api) => {
      if (!defines(c, 'A', AREA)) api.put(r`A=20\unit{mm}^{2}`);
      if (!pressureRow(c)) api.put(r`\frac{F}{A}`);
    },
  },
  {
    id: 'convert',
    title: 'Show it your way',
    body: () =>
      'Click the unit beside the answer to F / A and pick MPa. Only the display changes: the value underneath stays exact, and other rows keep their own units.',
    goal: (c) => !!pressureRow(c)?.displayUnit,
    target: (c) => at(pressureRow(c)?.id, '.row-result .unit-chip'),
    showMe: (c, api) => {
      const p = pressureRow(c);
      if (p) api.update(p.id, { displayUnit: 'MPa' });
    },
  },
  {
    id: 'mistakes',
    title: 'Mistakes are caught',
    body: () => 'Try `F + A`. You can’t add a force to an area, so you get ⚠ instead of a wrong number. Hover the ⚠ in the margin to read why.',
    goal: (c) => !!mismatchRow(c),
    target: (c) => at(mismatchRow(c)?.id, '.gutter') ?? at(lastEmpty(c)),
    showMe: (_, api) => api.put('F+A'),
    // no ⚠ left hanging around for the rest of the tour
    onLeave: (c, api) => {
      const e = mismatchRow(c);
      if (e) api.remove(e.id);
    },
  },
  {
    id: 'live',
    title: 'Change one, update all',
    body: () => 'Change F to `8 kN`. Every row that uses F follows at once.',
    goal: (c) => {
      const f = rowWith(c, (res) => res?.kind === 'value' && res.defName === 'F');
      const q = f && qOf(c.result.rows.get(f.id));
      return !!q && dimEq(q.dim, FORCE) && Math.abs(toNumber(q.si) - 6000) > 1e-9;
    },
    target: (c) => at(rowWith(c, (res) => res?.kind === 'value' && res.defName === 'F')?.id),
    showMe: (c, api) => {
      const f = rowWith(c, (res) => res?.kind === 'value' && res.defName === 'F');
      if (f) api.update(f.id, { latex: r`F=8\unit{kN}` } as Partial<Row>);
    },
  },
  {
    id: 'ref',
    title: 'Reuse an answer',
    body: (c) => {
      const p = pressureRow(c);
      const n = p ? rowNumberOf(c.rows, p.id) : 3;
      return `Every row has a number in the margin. Type \`#${n} * 2\` to use row ${n}’s answer. If the row moves, #${n} follows it.`;
    },
    goal: (c) => !!rowWith(c, (res, x) => /\\#/.test(x.latex) && res?.kind === 'value'),
    target: (c) => at(lastEmpty(c)),
    showMe: (c, api) => {
      const p = pressureRow(c);
      api.put(r`\#${p ? rowNumberOf(c.rows, p.id) : 3}\cdot2`);
    },
  },
  {
    id: 'functions',
    title: 'Functions and constants',
    body: () =>
      'Open ƒ(x) Functions: trig, logs, calculus, solve and roots, and physical constants like g and c. Click one to insert it at the caret.',
    goal: (c) => c.toolbox,
    target: () => '[aria-controls="toolbox"]',
    showMe: (_, api) => api.openToolbox(),
  },
  {
    id: 'done',
    title: 'That’s the tour',
    body: () =>
      '+ Add makes notes, folders and tables. ⚙ turns on more unit packages and defines your own units. Ctrl / lists shortcuts. Worksheets are saved in this browser: Export keeps a copy.',
  },
];

// ── Inline tips ──────────────────────────────────────────────────────────────

export interface Tip {
  id: string;
  rowId: string;
  text: string;
}

export const TIP_TEXT: Record<string, string> = {
  unit: 'Click the unit to see this answer in another one. Only the display changes; the value stays exact.',
  func: 'Use it like f(2 m). To check an input’s unit, give it a type: f(l: m) takes any length and converts it to metres.',
  folder: 'Names defined in a folder work everywhere. Click 🌐 in the margin to keep one inside its folder.',
  table: 'Name a column y₁ = f(x₁) to calculate it from another column. A column’s unit button sets its unit.',
  ref: 'Every row has a number: #n uses row n’s answer, like #2 · 3. It follows the row if you move it.',
};

/** The one tip to show now: the first row, in worksheet order, that needs a tip not yet dismissed. */
export function activeTip(rows: Row[], result: WorksheetResult, seen: readonly string[]): Tip | null {
  const want = (id: string) => !seen.includes(id);
  for (const [i, row] of rows.entries()) {
    const res = result.rows.get(row.id);
    if (row.type === 'expr') {
      if (want('unit') && res?.kind === 'value' && qOf(res)?.unit.length) return { id: 'unit', rowId: row.id, text: TIP_TEXT.unit };
      if (want('func') && res?.kind === 'func') return { id: 'func', rowId: row.id, text: TIP_TEXT.func };
      if (want('folder') && row.parent && res?.kind === 'value' && res.defName) return { id: 'folder', rowId: row.id, text: TIP_TEXT.folder };
      if (want('ref') && i >= 2 && res?.kind === 'value' && !res.defName && !/\\#/.test(row.latex)) return { id: 'ref', rowId: row.id, text: TIP_TEXT.ref };
    } else if (row.type === 'table' && want('table')) return { id: 'table', rowId: row.id, text: TIP_TEXT.table };
  }
  return null;
}

/** An empty worksheet: only empty expression rows. The start card shows. */
export const isEmptySheet = (rows: Row[]) => rows.every((x) => x.type === 'expr' && !x.latex.trim());

/** Start-card examples: LaTeX as a row would hold it, and how it reads. */
export const EXAMPLES: { label: string; latex: string; displayUnit?: string }[] = [
  { label: 'F = 6 kN', latex: r`F=6\unit{kN}` },
  { label: '6 kN / 20 mm²', latex: r`\frac{6\unit{kN}}{20\unit{mm}^{2}}` },
  { label: '3 ft + 1 m', latex: r`3\unit{ft}+1\unit{m}` },
  { label: '100 km/h in m/s', latex: r`100\unit{km}/\unit{h}`, displayUnit: 'm/s' },
];
