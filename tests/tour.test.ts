// The guided tour and inline tips (D60): every goal is checked against real evaluations, and
// "Show me" alone completes every step.
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { TOUR, activeTip, isEmptySheet, EXAMPLES, type TourApi, type TourCtx } from '../src/ui/tour';

const r = String.raw;
const ev = (rows: Row[]) => evaluateWorksheet(rows, { angle: 'rad', packages: [] });
const e = (id: string, latex: string, extra: Partial<Row> = {}): Row => ({ id, type: 'expr', latex, ...extra }) as Row;

/** A worksheet in memory with the same "Show me" powers the app gives the tour. */
function sheet(start: Row[] = [e('r0', '')]) {
  let rows = [...start];
  let toolbox = false;
  let n = 1;
  const api: TourApi = {
    put(latex, extra) {
      const end = rows[rows.length - 1];
      if (end?.type === 'expr' && !end.latex.trim()) {
        rows = rows.map((x) => (x === end ? ({ ...x, latex, ...extra } as Row) : x));
        return end.id;
      }
      const id = 'n' + n++;
      rows = [...rows, { id, type: 'expr', latex, ...extra } as Row];
      return id;
    },
    update: (id, patch) => (rows = rows.map((x) => (x.id === id ? ({ ...x, ...patch } as Row) : x))),
    remove: (id) => (rows = rows.filter((x) => x.id !== id)),
    openToolbox: () => (toolbox = true),
  };
  const ctx = (): TourCtx => ({ rows, result: ev(rows), toolbox });
  return { api, ctx, rows: () => rows };
}

describe('tour', () => {
  it('Show me completes every step, in order, and leaves a worksheet with no errors', () => {
    const w = sheet();
    for (const step of TOUR) {
      if (!step.goal) continue;
      expect(step.goal(w.ctx()), `${step.id} before`).toBe(false);
      step.showMe!(w.ctx(), w.api);
      expect(step.goal(w.ctx()), `${step.id} after Show me`).toBe(true);
      step.onLeave?.(w.ctx(), w.api);
    }
    const res = ev(w.rows());
    expect([...res.rows.values()].filter((x) => x.kind === 'error')).toEqual([]);
    expect(w.rows().map((x) => (x.type === 'expr' ? x.latex : x.type))).toEqual([r`F=8\unit{kN}`, r`A=20\unit{mm}^{2}`, r`\frac{F}{A}`, r`\#3\cdot2`]);
  });

  it('goals read what the user typed, in their own way', () => {
    const goal = (id: string, rows: Row[], toolbox = false) => TOUR.find((s) => s.id === id)!.goal!({ rows, result: ev(rows), toolbox });
    expect(goal('units', [e('a', 'F=6kN')])).toBe(true); // letters, no chip yet
    expect(goal('units', [e('a', r`F=6000\unit{N}`)])).toBe(true);
    expect(goal('units', [e('a', r`F=6\unit{m}`)])).toBe(false); // not a force
    expect(goal('units', [e('a', r`G=6\unit{kN}`)])).toBe(false);
    const base = [e('a', r`F=6\unit{kN}`), e('b', r`A=20\unit{mm}^{2}`)];
    expect(goal('derived', base)).toBe(false);
    expect(goal('derived', [...base, e('c', r`\frac{F}{A}`)])).toBe(true);
    expect(goal('derived', [...base, e('c', r`\sigma=\frac{F}{A}`)])).toBe(false); // a named row isn't the answer row
    expect(goal('convert', [...base, e('c', r`\frac{F}{A}`, { displayUnit: 'psi' } as Partial<Row>)])).toBe(true);
    expect(goal('mistakes', [...base, e('c', 'F+A')])).toBe(true);
    expect(goal('mistakes', [...base, e('c', 'F+Q')])).toBe(false); // an unknown name isn't a unit mismatch
    expect(goal('live', [e('a', r`F=6\unit{kN}`)])).toBe(false);
    expect(goal('live', [e('a', r`F=6000\unit{N}`)])).toBe(false); // the same force
    expect(goal('live', [e('a', r`F=8\unit{kN}`)])).toBe(true);
    expect(goal('ref', [e('a', '5'), e('b', r`\#1\cdot2`)])).toBe(true);
    expect(goal('ref', [e('a', '5'), e('b', r`\#9\cdot2`)])).toBe(false); // no such row
    expect(goal('functions', [], true)).toBe(true);
  });

  it('the reuse step names the row the answer is really in', () => {
    const rows = [e('x', '1'), e('a', r`F=6\unit{kN}`), e('b', r`A=20\unit{mm}^{2}`), e('y', '2'), e('c', r`\frac{F}{A}`)];
    expect(TOUR.find((s) => s.id === 'ref')!.body({ rows, result: ev(rows), toolbox: false })).toContain('`#5 * 2`');
  });
});

describe('start card and tips', () => {
  it('the start card shows only on an empty sheet', () => {
    expect(isEmptySheet([e('a', '')])).toBe(true);
    expect(isEmptySheet([e('a', ' '), e('b', '')])).toBe(true);
    expect(isEmptySheet([e('a', '1')])).toBe(false);
    expect(isEmptySheet([{ id: 'n', type: 'note', text: '' }])).toBe(false);
  });

  it('every example evaluates', () => {
    for (const x of EXAMPLES) {
      const v = ev([e('a', x.latex, { displayUnit: x.displayUnit } as Partial<Row>)]).rows.get('a')!;
      expect(v.kind, x.label).toBe('value');
      if (v.kind === 'value') expect(v.unitError, x.label).toBeUndefined();
    }
  });

  it('one tip at a time, the first in worksheet order, until each is dismissed', () => {
    const rows: Row[] = [
      { id: 'f', type: 'folder', title: 'Inputs' },
      e('a', r`L=2\unit{m}`, { parent: 'f' } as Partial<Row>),
      e('b', r`g\left(x\right)=x^{2}`),
      e('c', '3'),
      { id: 't', type: 'table', columns: [{ id: 'c1', header: 'x_{1}', values: ['1'] }] },
    ];
    const res = ev(rows);
    const seen: string[] = [];
    const order: string[] = [];
    for (let tip = activeTip(rows, res, seen); tip; tip = activeTip(rows, res, seen)) {
      order.push(`${tip.id}@${tip.rowId}`);
      seen.push(tip.id);
    }
    expect(order).toEqual(['unit@a', 'folder@a', 'func@b', 'ref@c', 'table@t']);
  });

  it('no #n tip on a short sheet, or on a row that already uses one', () => {
    expect(activeTip([e('a', '1'), e('b', '2')], ev([e('a', '1'), e('b', '2')]), [])).toBeNull();
    const rows = [e('a', '1'), e('b', '2'), e('c', r`\#1+1`)];
    expect(activeTip(rows, ev(rows), [])).toBeNull();
  });
});
