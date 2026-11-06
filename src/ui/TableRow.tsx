import type { Row, ColumnResult, TableColumn } from '../engine/worksheet';
import { formatQuantity, type FormatOptions } from '../engine/format';
import { formatUnit, parseUnitExpr } from '../engine/units/registry';
import { useStore, uid } from '../state/store';
import { MathInput } from './MathInput';
import { UnitButton } from './UnitDropdown';
import { RowMenu } from './rows';

type TableRowT = Extract<Row, { type: 'table' }>;

export function TableRow({ row, cols, fmt, vars }: { row: TableRowT; cols: Map<string, ColumnResult>; fmt: FormatOptions; vars: string[] }) {
  const s = useStore();
  const setCols = (columns: TableColumn[], merge?: string) => s.updateRow(row.id, { columns }, merge);
  const nRows = Math.max(
    ...row.columns.map((c) => (cols.get(c.id)?.isInput ? c.values.length : (cols.get(c.id)?.values?.length ?? 0))),
    1,
  );

  const setCell = (ci: number, ri: number, v: string) => {
    const columns = row.columns.map((c, i) => {
      if (i !== ci) return c;
      const values = [...c.values];
      while (values.length <= ri) values.push('');
      values[ri] = v;
      // keep one empty trailing row for entry
      if (values[values.length - 1] !== '') values.push('');
      return { ...c, values };
    });
    setCols(columns, `cell-${row.id}-${ci}-${ri}`);
  };

  return (
    <div className="row-body table-body">
      <div className="table-scroll">
        <table className="calc-table">
          <thead>
            <tr>
              {row.columns.map((c, ci) => {
                const res = cols.get(c.id);
                const q = res?.values?.[0];
                let autoUnit = q?.unit ?? [];
                try {
                  if (c.unit) autoUnit = res?.isInput ? parseUnitExpr(c.unit) : autoUnit;
                } catch {
                  /* bad unit */
                }
                return (
                  <th key={c.id}>
                    <div className="th-inner">
                      <MathInput
                        latex={c.header}
                        vars={vars}
                        ariaLabel={`Column ${ci + 1} header`}
                        onChange={(latex) =>
                          latex !== c.header && setCols(row.columns.map((x) => (x.id === c.id ? { ...x, header: latex } : x)), `hdr-${c.id}`)
                        }
                        onEnter={() => {}}
                        onMoveOut={() => {}}
                        onDeleteEmpty={() => {}}
                        onFocus={() => {}}
                        onBlur={() => {}}
                      />
                      <UnitButton
                        q={q}
                        autoUnit={autoUnit}
                        current={c.unit ? formatUnit(safeParse(c.unit)) : q ? formatUnit(q.unit) : ''}
                        userChosen={!!c.unit}
                        label="unit"
                        muted={!c.unit}
                        anyUnit={!!cols.get(c.id)?.isInput}
                        onPick={(u) => setCols(row.columns.map((x) => (x.id === c.id ? { ...x, unit: u } : x)))}
                      />
                      {row.columns.length > 1 && (
                        <button
                          className="icon-btn small"
                          title="Remove column"
                          onClick={() => setCols(row.columns.filter((x) => x.id !== c.id))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {res?.error && <div className="col-error" title={res.error}>⚠ {res.error}</div>}
                  </th>
                );
              })}
              <th className="add-col">
                <button
                  className="icon-btn"
                  title="Add column"
                  onClick={() => setCols([...row.columns, { id: uid(), header: nextHeader(row.columns), values: [] }])}
                >
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: nRows }, (_, ri) => (
              <tr key={ri}>
                {row.columns.map((c, ci) => {
                  const res = cols.get(c.id);
                  if (res?.isInput !== false)
                    return (
                      <td key={c.id}>
                        <input className="cell" value={c.values[ri] ?? ''} onChange={(e) => setCell(ci, ri, e.target.value)} aria-label={`Row ${ri + 1} column ${ci + 1}`} />
                      </td>
                    );
                  const q = res.values?.[ri];
                  return (
                    <td key={c.id} className="computed">
                      {q ? formatQuantity(q, fmt).value : ''}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-actions">
        <RowMenu id={row.id} />
      </div>
    </div>
  );
}

function safeParse(u: string) {
  try {
    return parseUnitExpr(u);
  } catch {
    return [];
  }
}

function nextHeader(cols: TableColumn[]): string {
  const letters = 'xyzuvwabcdpq';
  for (const l of letters) if (!cols.some((c) => c.header.startsWith(l + '_'))) return `${l}_{1}`;
  return `t_{${cols.length + 1}}`;
}
