import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateWorksheet, renameDefinition, definitionScope } from '../engine/worksheet';
import { Shortcuts, Welcome } from './Help';
import { setCurrentPackages } from '../engine/units/packages';
import type { FormatOptions } from '../engine/format';
import { useStore, visibleRows, type RowType } from '../state/store';
import { TopBar } from './TopBar';
import { ExpressionRow, NoteRow, FolderRow } from './rows';
import { TableRow } from './TableRow';
import { Toolbox, ToolboxButton } from './Toolbox';
import { RowBoundary } from './ErrorBoundary';

export function App() {
  const s = useStore();
  const { rows, settings } = s.ws;
  // autocomplete and unit dropdowns follow this worksheet's packages (D26)
  setCurrentPackages(settings.packages);
  const result = useMemo(
    () => evaluateWorksheet(rows, { angle: settings.angle, packages: settings.packages, units: settings.units }),
    [rows, settings.angle, settings.packages, settings.units],
  );
  const fmt: FormatOptions = { sigFigs: settings.sigFigs, notation: settings.notation, sciAbove: settings.sciAbove, mode: settings.exactDefault ? 'auto' : 'decimal' };
  // names visible from each folder (folder-scoped definitions only count inside their folder)
  const varsFor = useMemo(() => {
    const cache = new Map<string | null, string[]>();
    return (scope: string | null) => {
      if (!cache.has(scope)) cache.set(scope, result.varsIn(scope));
      return cache.get(scope)!;
    };
  }, [result]);

  // theme
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', s.theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(el).getPropertyValue('--bg').trim());
  }, [s.theme]);

  // global undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      // Ctrl+/ shortcuts, Ctrl+. functions drawer: from anywhere (D37)
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShortcuts((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        setToolboxRef.current(!toolboxRef.current);
        return;
      }
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

  // "used by": while a definition row is focused, mark the rows that use its name (D37)
  const focusRes = s.focusId ? result.rows.get(s.focusId) : undefined;
  const focusName = focusRes?.kind === 'value' || focusRes?.kind === 'error' ? focusRes.defName : focusRes?.kind === 'func' ? focusRes.name : undefined;
  const focusRow = s.focusId ? rows.find((r) => r.id === s.focusId) : undefined;
  const focusLevel = focusRow ? (definitionScope(focusRow) ?? 'global') : null;
  const usesFocus = (id: string) =>
    !!focusName && id !== s.focusId && !!result.refs.get(id)?.some((x) => x.name === focusName) && result.resolves(id, focusName) === focusLevel;
  const doRename = (id: string, name: string) => {
    const out = renameDefinition(rows, result, id, name);
    if (typeof out === 'string') return out;
    s.setRows(out);
    return undefined;
  };

  const visible = visibleRows(rows);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const dragFromHandle = useRef(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [toolbox, setToolbox] = useState(() => {
    try {
      return localStorage.getItem('usc:toolbox') === '1';
    } catch {
      return false;
    }
  });
  const toolboxRef = useRef(toolbox);
  toolboxRef.current = toolbox;
  const setToolboxRef = useRef((v: boolean) => toggleToolbox(v));
  setToolboxRef.current = (v: boolean) => toggleToolbox(v);
  const toggleToolbox = (v: boolean) => {
    setToolbox(v);
    try {
      localStorage.setItem('usc:toolbox', v ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };

  let n = 0;
  return (
    <div className={`app ${toolbox ? 'with-toolbox' : ''}`}>
      {/* top bar and toolbar stay pinned together while the list scrolls */}
      <header className="app-head">
      <TopBar />
      <div className="toolbar">
        <AddMenu />
        <button className="text-btn" onClick={() => s.setAllCollapsed(!rows.some((r) => r.type === 'folder' && r.collapsed))}>
          ⊟ {rows.some((r) => r.type === 'folder' && r.collapsed) ? 'Expand' : 'Collapse'} folders
        </button>
        <ToolboxButton open={toolbox} onToggle={() => toggleToolbox(!toolbox)} />
      </div>
      </header>
      {s.storageError && (
        <div className="storage-banner" role="alert">
          ⚠ {s.storageError}
        </div>
      )}
      {/* only on paper: a calc-sheet heading (D36) */}
      <div className="print-head" aria-hidden>
        <span className="print-brand">Dimensional</span>
        <span className="print-title">{s.ws.title}</span>
        <span className="print-date">{new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <Welcome />
      <main className="list" aria-label="Expressions">
        {visible.map((row, i) => {
          n++;
          const res = result.rows.get(row.id);
          const isErr = res?.kind === 'error';
          const childCount = row.type === 'folder' ? rows.filter((r) => r.parent === row.id).length : 0;
          return (
            <div
              key={row.id}
              className={`row type-${row.type} ${usesFocus(row.id) ? 'uses-focus' : ''} ${row.type === 'expr' && !row.latex.trim() ? 'is-empty' : ''} ${row.parent ? 'in-folder' : ''} ${s.focusId === row.id ? 'focused' : ''} ${dropId === row.id && dragId !== row.id ? 'drop-target' : ''}`}
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
              <RowBoundary resetKey={JSON.stringify(row)}>
              {row.type === 'expr' && (
                <ExpressionRow row={row} ctx={{ result: res, chips: result.chips.get(row.id), fmt, vars: varsFor(row.parent ?? null), number: n, shadows: result.shadows.has(row.id), onRename: (n: string) => doRename(row.id, n), usesFocus: usesFocus(row.id), notice: result.notices.get(row.id), info: result.infos.get(row.id), packageHint: result.packageHints.get(row.id) }} />
              )}
              {row.type === 'note' && <NoteRow row={row} />}
              {row.type === 'folder' && <FolderRow row={row} count={childCount} />}
              {row.type === 'table' && <TableRow row={row} cols={result.columns} fmt={fmt} vars={varsFor(row.parent ?? null)} />}
              </RowBoundary>
            </div>
          );
        })}
        <button className="add-bottom" onClick={() => s.addRow('expr', rows[rows.length - 1]?.id ?? null, { parent: undefined })}>
          + Add expression
        </button>
      </main>
      <footer className="footer">
        <span>Type units after numbers (6N, 2 mm^2) · Tab inserts a suggestion · Backspace on a unit chip turns it back into letters</span>
        <span>
          Dimensional · by <a href="https://perrysahnow.com" target="_blank" rel="noreferrer">Perry Sahnow</a>
        </span>
      </footer>
      {toolbox && <Toolbox onClose={() => toggleToolbox(false)} />}
      {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
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
