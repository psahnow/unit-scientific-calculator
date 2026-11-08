// Incremental recalculation (D65): reusing last time's answers must give exactly what a full
// recalculation gives, after any kind of edit, and must actually skip rows that can't have changed.
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row, type EvalSettings, type WorksheetResult } from '../src/engine/worksheet';
import { formatValue } from '../src/engine/format';

const r = String.raw;
const fmt = { sigFigs: 10, notation: 'auto' as const, mode: 'auto' as const };
const S: EvalSettings = { angle: 'rad', packages: [] };

/** Everything a user can see of a result, as text. */
function snapshot(rows: Row[], res: WorksheetResult): string[] {
  return rows.map((row) => {
    const v = res.rows.get(row.id);
    const info = res.infos.get(row.id) ?? '';
    if (row.type === 'table')
      return 'table ' + row.columns.map((c) => JSON.stringify(res.columns.get(c.id)?.error ?? res.columns.get(c.id)?.values?.length)).join(',');
    if (!v) return '—';
    if (v.kind === 'error') return 'error: ' + v.message + ' | ' + info;
    if (v.kind === 'func') return 'func ' + v.name + ' ' + (v.outUnit ?? '');
    if (v.kind === 'none') return 'none';
    const f = formatValue(v.value, fmt);
    return `${v.defName ?? ''}=${f.value} ${f.unit} ${v.unitError ?? ''} | ${info}`;
  });
}

const e = (id: string, latex: string, extra: Partial<Row> = {}) => ({ id, type: 'expr', latex, ...extra }) as Row;

const BASE: Row[] = [
  { id: 'f', type: 'folder', title: 'Inputs' },
  e('a', r`F=6\unit{kN}`, { parent: 'f' }),
  e('b', r`A=20\unit{mm}^{2}`, { parent: 'f', scope: 'folder' }),
  e('c', r`\sigma=\frac{F}{A}`, { parent: 'f', displayUnit: 'MPa' }),
  e('d', r`g\left(x\right)=x^{2}\cdot F`),
  e('h', r`g\left(2\right)`),
  e('i', r`\#5\cdot2`),
  e('j', r`\operatorname{ans}+1\unit{kN}`),
  e('k', r`\int_{0}^{1}x^{2}\,\mathrm{d}x`),
  e('l', '2m'),
  e('m', 'q+1'),
  {
    id: 't',
    type: 'table',
    columns: [
      { id: 'c1', header: 'x_{1}', values: ['1', '2'] },
      { id: 'c2', header: r`y_{1}=g\left(x_{1}\right)`, values: [] },
    ],
  },
  e('n', r`\operatorname{mean}\left(y_{1}\right)`),
  e('o', r`\operatorname{solve}\left(x^{2}=F/1\unit{N},x\right)`),
];

type Edit = (rows: Row[]) => Row[];
const set =
  (id: string, patch: Partial<Row>): Edit =>
  (rows) =>
    rows.map((x) => (x.id === id ? ({ ...x, ...patch } as Row) : x));
const EDITS: [string, Edit][] = [
  ['change an input', set('a', { latex: r`F=8\unit{kN}` } as Partial<Row>)],
  ['define a name that was a unit', (rows) => [...rows, e('z', 'm=5')]],
  ['define the missing q', (rows) => [e('q0', 'q=2'), ...rows]],
  ['duplicate a definition', (rows) => [...rows, e('dup', r`F=1\unit{N}`)]],
  ['change the function', set('d', { latex: r`g\left(x\right)=x\cdot F` } as Partial<Row>)],
  ['move a row (renumbers #n)', (rows) => [rows[5], ...rows.filter((_, k) => k !== 5)]],
  ['delete the row ans uses', (rows) => rows.filter((x) => x.id !== 'i')],
  ['make the row above ans empty', set('i', { latex: '' } as Partial<Row>)],
  ['change a display unit', set('c', { displayUnit: 'psi' } as Partial<Row>)],
  [
    'change a table cell',
    (rows) => rows.map((x) => (x.type === 'table' ? { ...x, columns: [{ ...x.columns[0], values: ['3', '4', '5'] }, x.columns[1]] } : x)),
  ],
  ['scope A to its folder → global', set('b', { scope: undefined } as Partial<Row>)],
  ['take F out of the folder', set('a', { parent: undefined } as Partial<Row>)],
  ['a user-defined ans', (rows) => [e('ans0', 'ans=100'), ...rows]],
  ['a loop', (rows) => [...rows, e('p1', 'P=Q'), e('p2', 'Q=P')]],
  ['break the loop', (rows) => rows.map((x) => (x.id === 'p2' ? e('p2', 'Q=3') : x))],
  ['an error upstream', set('a', { latex: r`F=6\unit{kN}+1\unit{s}` } as Partial<Row>)],
  ['fix it', set('a', { latex: r`F=6\unit{kN}` } as Partial<Row>)],
];

describe('incremental recalculation', () => {
  it('gives the same answers as a full recalculation after every kind of edit', () => {
    let rows = BASE;
    let prev = evaluateWorksheet(rows, S);
    for (const [what, edit] of EDITS) {
      rows = edit(rows);
      const inc = evaluateWorksheet(rows, S, prev);
      const full = evaluateWorksheet(rows, S);
      expect(snapshot(rows, inc), what).toEqual(snapshot(rows, full));
      prev = inc;
    }
  });

  it('settings changes start afresh', () => {
    const prev = evaluateWorksheet(BASE, S);
    const deg = evaluateWorksheet(BASE, { ...S, angle: 'deg' }, prev);
    expect(snapshot(BASE, deg)).toEqual(snapshot(BASE, evaluateWorksheet(BASE, { ...S, angle: 'deg' })));
  });

  it('rows that can’t have changed keep last time’s answer object; rows downstream of an edit don’t', () => {
    const prev = evaluateWorksheet(BASE, S);
    const rows = set('l', { latex: '3m' } as Partial<Row>)(BASE);
    const next = evaluateWorksheet(rows, S, prev);
    // the integral (k) and σ (c) don't depend on row l: same objects, not worked out again
    expect(next.rows.get('k')).toBe(prev.rows.get('k'));
    expect(next.rows.get('c')).toBe(prev.rows.get('c'));
    expect(next.rows.get('l')).not.toBe(prev.rows.get('l'));
    // changing F reaches σ, g(2), #5·2 and solve, but not the integral
    const after = evaluateWorksheet(set('a', { latex: r`F=8\unit{kN}` } as Partial<Row>)(BASE), S, prev);
    expect(after.rows.get('k')).toBe(prev.rows.get('k'));
    for (const id of ['c', 'h', 'o']) expect(after.rows.get(id), id).not.toBe(prev.rows.get(id));
  });
});
