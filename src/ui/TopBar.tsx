import { useRef, useState } from 'react';
import { useStore, exportWorksheet, type Settings } from '../state/store';
import { BrandMark, About } from './Brand';
import { SettingsMenu } from './Settings';
import { usePopover } from './usePopover';

/** ☰ Worksheets: everything about the worksheets themselves — new, file in and out, print, and the list. */
function WorksheetMenu({ onImport }: { onImport(): void }) {
  const menu = usePopover();
  const close = () => menu.setOpen(false);
  const doExport = () => {
    const ws = useStore.getState().ws;
    const blob = new Blob([exportWorksheet(ws)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ws.title.replace(/[^\w\- ]+/g, '').trim() || 'worksheet'}.dimensional.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="pop-wrap" ref={menu.ref}>
      <button className="icon-btn big" aria-label="Worksheets" aria-haspopup="menu" aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)}>
        ☰
      </button>
      {menu.open && (
        <div className="popover left" role="menu">
          <button className="menu-item strong" onClick={() => (useStore.getState().newWorksheet(), close())}>
            + New worksheet
          </button>
          <button className="menu-item" onClick={() => (doExport(), close())} title="Save a copy of this worksheet as a file">
            Export…
          </button>
          <button className="menu-item" onClick={() => (close(), onImport())} title="Open a worksheet file you exported">
            Import…
          </button>
          <button className="menu-item" onClick={() => (close(), setTimeout(() => window.print(), 50))}>
            Print / save as PDF…
          </button>
          <div className="menu-sep" />
          <WorksheetList onPick={close} />
        </div>
      )}
    </div>
  );
}

/** The saved worksheets, current one first. Only mounted while the menu is open. */
function WorksheetList({ onPick }: { onPick(): void }) {
  const index = useStore((s) => s.index);
  const cur = useStore((s) => s.ws);
  const list = index.some((w) => w.id === cur.id) ? index : [{ id: cur.id, title: cur.title, updated: cur.updated }, ...index];
  return (
    <>
      {list.map((w) => (
        <div key={w.id} className={`menu-ws ${w.id === cur.id ? 'current' : ''}`}>
          <button className="menu-item" onClick={() => (useStore.getState().openWorksheet(w.id), onPick())}>
            {w.id === cur.id ? cur.title : w.title}
            <span className="menu-date">{new Date(w.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </button>
          <button
            className="icon-btn danger small"
            title="Delete worksheet"
            aria-label={`Delete worksheet ${w.title}`}
            onClick={() => {
              if (confirm(`Delete “${w.title}”? This can't be undone.`)) useStore.getState().deleteWorksheet(w.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

/** ? Help: the tour, the shortcuts, and what this is. */
function HelpMenu({ onAbout }: { onAbout(): void }) {
  const menu = usePopover();
  const close = () => menu.setOpen(false);
  return (
    <div className="pop-wrap" ref={menu.ref}>
      <button className="icon-btn" title="Help" aria-label="Help" aria-haspopup="menu" aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)}>
        ?
      </button>
      {menu.open && (
        <div className="popover right" role="menu">
          <button className="menu-item" onClick={() => (useStore.getState().startTour(), close())}>
            Take the tour
          </button>
          <button className="menu-item kbd-only" onClick={() => (close(), window.dispatchEvent(new CustomEvent('dimensional-shortcuts')))}>
            Keyboard shortcuts <span className="menu-date">Ctrl /</span>
          </button>
          <button className="menu-item" onClick={() => (close(), onAbout())}>
            About Dimensional
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const title = useStore((s) => s.ws.title);
  const angle = useStore((s) => s.ws.settings.angle);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { setTitle, setSettings, undo, redo } = useStore.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const set = (p: Partial<Settings>) => setSettings(p);

  return (
    <header className="topbar">
      <WorksheetMenu onImport={() => fileRef.current?.click()} />
      <span className="brand" title="Dimensional: a calculator that keeps track of units">
        <BrandMark className="brand-mark" />
        <span className="brand-name">Dimensional</span>
        <span className="brand-sep" aria-hidden>
          /
        </span>
      </span>
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Worksheet title" />
      <div className="spacer" />
      <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}>
        ↶
      </button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}>
        ↷
      </button>
      <div className="seg" role="group" aria-label="Angle mode">
        <button className={angle === 'rad' ? 'on' : ''} onClick={() => set({ angle: 'rad' })}>
          RAD
        </button>
        <button className={angle === 'deg' ? 'on' : ''} onClick={() => set({ angle: 'deg' })}>
          DEG
        </button>
      </div>
      <SettingsMenu />
      <HelpMenu onAbout={() => setAbout(true)} />
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            useStore.getState().importWorksheet(await f.text());
            setImportError(null);
          } catch (err) {
            setImportError((err as Error).message);
          }
        }}
      />
      {importError && (
        <div className="toast" role="alert" onClick={() => setImportError(null)}>
          Couldn’t open that file: {importError}
        </div>
      )}
      {about && <About onClose={() => setAbout(false)} />}
    </header>
  );
}
