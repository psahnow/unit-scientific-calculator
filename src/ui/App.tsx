import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateWorksheet, renameDefinition, definitionScope } from '../engine/worksheet';
import { Shortcuts } from './Help';
import { Coach, StartCard, TipLine } from './Onboarding';
import { activeTip } from './tour';
import { setCurrentPackages } from '../engine/units/packages';
import type { FormatOptions } from '../engine/format';
import { useStore, visibleRows, type RowType } from '../state/store';
import { TopBar } from './TopBar';
import { ExpressionRow, NoteRow, FolderRow, HoverTip, GutterTools } from './rows';
import { TableRow } from './TableRow';
import { Toolbox, ToolboxButton } from './Toolbox';
import { RowBoundary } from './ErrorBoundary';
import { BrandMark } from './Brand';
import { VarPanel } from './VarPanel';

export function App() {
  const s = useStore();
  const { rows, settings } = s.ws;
  // autocomplete and unit dropdowns follow this worksheet's packages (D26)
  setCurrentPackages(settings.packages);
  // recalculating a big sheet (integrals, solves) can take tens of ms: let typing stay responsive and
  // recalculate just after, in the background (D38)
  const calcRows = useDeferredValue(rows);
  const result = useMemo(
    () => evaluateWorksheet(calcRows, { angle: settings.angle, packages: settings.packages, units: settings.units }),
    [calcRows, settings.angle, settings.packages, settings.units],
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
  const rowNumber = new Map(rows.map((r, k) => [r.id, k + 1]));
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

  // one inline tip at a time, never during the tour (D60)
  const tip = s.tour ? null : activeTip(calcRows, result, s.tipsSeen);
  const tipFor = (id: string) => (tip?.rowId === id ? <TipLine tip={tip} /> : undefined);

  let n = 0;
  return (
    <div className={`app ${toolbox ? 'with-toolbox' : ''}`}>
      {/* top bar and toolbar stay pinned together while the list scrolls */}
      <header className="app-head">
      <TopBar />
      <div className="toolbar">
        <AddMenu />
        {rows.some((r) => r.type === 'folder') && (
        <button className="text-btn" onClick={() => s.setAllCollapsed(!rows.some((r) => r.type === 'folder' && r.collapsed))}>
          ⊟ {rows.some((r) => r.type === 'folder' && r.collapsed) ? 'Expand' : 'Collapse'} folders
        </button>
        )}
        <ToolboxButton open={toolbox} onToggle={() => toggleToolbox(!toolbox)} />
      </div>
      <Coach result={result} toolbox={toolbox} openToolbox={() => toggleToolbox(true)} />
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
        <span className="print-date">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <div className="sheet-wrap">
      <VarPanel rows={calcRows} result={result} fmt={fmt} />
      <main className="list" aria-label="Expressions">
        {visible.map((row) => {
          // every row keeps its number, as in a spreadsheet (folded rows too): #n means this row (D56)
          const num = rowNumber.get(row.id)!;
          n = num;
          const res = result.rows.get(row.id);
          const isErr = res?.kind === 'error';
          const childCount = row.type === 'folder' ? rows.filter((r) => r.parent === row.id).length : 0;
          return (
            <div
              key={row.id}
              data-row-id={row.id}
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
              {/* the whole margin moves the row (D58), apart from its switches */}
              <div
                className={`gutter ${isErr ? 'err' : ''}`}
                title="Drag to move this row"
                onMouseDown={(e) => {
                  if ((e.target as Element).closest('.gutter-btn')) return;
                  dragFromHandle.current = true;
                  setDragId(row.id);
                }}
                onMouseUp={() => {
                  dragFromHandle.current = false;
                  setDragId(null);
                }}
              >
                {isErr ? (
                  <HoverTip text={res.message} kind="error" align="left">
                    <span className="num">⚠</span>
                  </HoverTip>
                ) : (
                  <span className="num" title={res?.kind === 'value' && !res.defName ? `Row ${num}. Type #${num} to use its answer elsewhere` : undefined}>
                    {num}
                  </span>
                )}
                {row.type === 'expr' && (
                  <GutterTools
                    row={row}
                    ctx={{ result: res, fmt, shadows: result.shadows.has(row.id) } as never}
                    folderTitle={(() => {
                      const f = row.parent ? rows.find((x) => x.id === row.parent) : undefined;
                      return f?.type === 'folder' ? f.title : undefined;
                    })()}
                  />
                )}
              </div>
              <RowBoundary resetKey={JSON.stringify(row)}>
              {row.type === 'expr' && (
                <ExpressionRow row={row} ctx={{ result: res, chips: result.chips.get(row.id), fmt, vars: varsFor(row.parent ?? null), number: n, shadows: result.shadows.has(row.id), onRename: (n: string) => doRename(row.id, n), usesFocus: usesFocus(row.id), notice: result.notices.get(row.id), info: result.infos.get(row.id), packageHint: result.packageHints.get(row.id), tip: tipFor(row.id) }} />
              )}
              {row.type === 'note' && <NoteRow row={row} />}
              {row.type === 'folder' && <FolderRow row={row} count={childCount} />}
              {row.type === 'table' && <TableRow row={row} cols={result.columns} fmt={fmt} vars={varsFor(row.parent ?? null)} tip={tipFor(row.id)} />}
              </RowBoundary>
            </div>
          );
        })}
        <StartCard />
        <button className="add-bottom" onClick={() => s.addRow('expr', rows[rows.length - 1]?.id ?? null, { parent: undefined })}>
          + Add expression
        </button>
      </main>
      </div>
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-main">
            <span className="footer-brand">
              <BrandMark className="footer-mark" />
              Dimensional<span className="footer-tag">every number knows its units</span>
            </span>
            <span className="footer-meta">
              Nothing leaves your browser · MIT license · by{' '}
              <a href="https://perrysahnow.com" target="_blank" rel="noreferrer">
                Perry Sahnow
              </a>
            </span>
          </div>
          <div className="footer-tips kbd-only">
            Type units after numbers (6N, 2 mm^2) · Tab inserts a suggestion · Backspace on a unit chip turns it back into letters · Ctrl / for shortcuts
          </div>
        </div>
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
