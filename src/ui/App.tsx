import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateWorksheet } from '../engine/worksheet';
import type { FormatOptions } from '../engine/format';
import { useStore, visibleRows, type RowType } from '../state/store';
import { TopBar } from './TopBar';
import { ExpressionRow, NoteRow, FolderRow } from './rows';
import { TableRow } from './TableRow';

export function App() {
  const s = useStore();
  const { rows, settings } = s.ws;
  const result = useMemo(() => evaluateWorksheet(rows, { angle: settings.angle }), [rows, settings.angle]);
  const fmt: FormatOptions = { sigFigs: settings.sigFigs, notation: settings.notation, sciAbove: settings.sciAbove, mode: settings.exactDefault ? 'auto' : 'decimal' };
  const vars = useMemo(() => [...result.defined], [result]);

  // theme
  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // global undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? useStore.getState().redo() : useStore.getState().undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    const onCustom = (e: Event) => ((e as CustomEvent).detail === 'redo' ? useStore.getState().redo() : useStore.getState().undo());
    window.addEventListener('keydown', onKey);
    window.addEventListener('usc-undo', onCustom);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('usc-undo', onCustom);
    };
  }, []);

  const visible = visibleRows(rows);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const dragFromHandle = useRef(false);

  let n = 0;
  return (
    <div className="app">
      <TopBar />
      <div className="toolbar">
        <AddMenu />
        <button className="text-btn" onClick={() => s.setAllCollapsed(!rows.some((r) => r.type === 'folder' && r.collapsed))}>
          ⊟ {rows.some((r) => r.type === 'folder' && r.collapsed) ? 'Expand' : 'Collapse'} folders
        </button>
      </div>
      <main className="list" aria-label="Expressions">
        {visible.map((row, i) => {
          n++;
          const res = result.rows.get(row.id);
          const isErr = res?.kind === 'error';
          const childCount = row.type === 'folder' ? rows.filter((r) => r.parent === row.id).length : 0;
          return (
            <div
              key={row.id}
              className={`row type-${row.type} ${row.parent ? 'in-folder' : ''} ${s.focusId === row.id ? 'focused' : ''} ${dropId === row.id && dragId !== row.id ? 'drop-target' : ''}`}
              draggable={dragId === row.id}
              onDragStart={(e) => {
                if (!dragFromHandle.current) return e.preventDefault();
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropId(row.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== row.id) {
                  const moving = rows.find((r) => r.id === dragId);
                  if (row.type === 'folder' && moving?.type !== 'folder') {
                    const idx = rows.findIndex((r) => r.id === row.id);
                    s.moveRow(dragId, rows[idx + 1]?.id ?? null, row.id);
                  } else s.moveRow(dragId, row.id, moving?.type === 'folder' ? undefined : row.parent);
                }
                setDragId(null);
                setDropId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropId(null);
                dragFromHandle.current = false;
              }}
            >
              <div className={`gutter ${isErr ? 'err' : ''}`}>
                <span className="num">{isErr ? '⚠' : i + 1}</span>
                <span
                  className="handle"
                  title="Drag to reorder"
                  onMouseDown={() => {
                    dragFromHandle.current = true;
                    setDragId(row.id);
                  }}
                  onMouseUp={() => {
                    dragFromHandle.current = false;
                    setDragId(null);
                  }}
                >
                  ⋮⋮
                </span>
              </div>
              {row.type === 'expr' && (
                <ExpressionRow row={row} ctx={{ result: res, chips: result.chips.get(row.id), fmt, vars, number: n }} />
              )}
              {row.type === 'note' && <NoteRow row={row} />}
              {row.type === 'folder' && <FolderRow row={row} count={childCount} />}
              {row.type === 'table' && <TableRow row={row} cols={result.columns} fmt={fmt} vars={vars} />}
            </div>
          );
        })}
        <button className="add-bottom" onClick={() => s.addRow('expr', rows[rows.length - 1]?.id ?? null, { parent: undefined })}>
          + Add expression
        </button>
      </main>
      <footer className="footer">
        Type units after numbers (6N, 2 mm^2) · Tab inserts a suggestion · Backspace on a unit chip turns it back into letters
      </footer>
    </div>
  );
}

function AddMenu() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const add = (t: RowType) => {
    const st = useStore.getState();
    s.addRow(t, st.focusId ?? st.ws.rows[st.ws.rows.length - 1]?.id ?? null);
    setOpen(false);
  };
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="text-btn strong" onClick={() => setOpen(!open)} aria-haspopup="menu">
        + Add ▾
      </button>
      {open && (
        <div className="popover left" role="menu">
          <button className="menu-item" onClick={() => add('expr')}>
            𝑥 Expression
          </button>
          <button className="menu-item" onClick={() => add('note')}>
            " Note
          </button>
          <button className="menu-item" onClick={() => add('folder')}>
            📁 Folder
          </button>
          <button className="menu-item" onClick={() => add('table')}>
            ▦ Table
          </button>
        </div>
      )}
    </div>
  );
}
