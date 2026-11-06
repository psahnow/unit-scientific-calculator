// Row references follow their rows (D56): when rows are added, removed or moved, every #n in the
// worksheet is rewritten so it still points at the same row, as spreadsheets do. A reference to a
// deleted row becomes #0, which reports that the row was deleted rather than silently taking
// another row's value.
import type { Row } from './worksheet';

const REF = /\\#\{?\s*([0-9]+)\s*\}?/g;

export function renumberRefs(before: Row[], after: Row[]): Row[] {
  const same = before.length === after.length && before.every((r, i) => r.id === after[i].id);
  if (same) return after;
  const newNumber = new Map(after.map((r, i) => [r.id, i + 1]));
  const fix = (latex: string) =>
    latex.replace(REF, (m, d: string) => {
      const target = before[Number(d) - 1];
      if (!target) return m; // already pointed nowhere: leave it
      const n = newNumber.get(target.id);
      return n === undefined ? '\\#0' : `\\#${n}`;
    });
  let changed = false;
  const out = after.map((r) => {
    if (r.type === 'expr') {
      const latex = fix(r.latex);
      if (latex !== r.latex) {
        changed = true;
        return { ...r, latex };
      }
    } else if (r.type === 'table') {
      const columns = r.columns.map((c) => {
        const header = fix(c.header);
        const values = c.values.map((x) => fix(x));
        return header !== c.header || values.some((x, i) => x !== c.values[i]) ? { ...c, header, values } : c;
      });
      if (columns.some((c, i) => c !== r.columns[i])) {
        changed = true;
        return { ...r, columns };
      }
    }
    return r;
  });
  return changed ? out : after;
}
