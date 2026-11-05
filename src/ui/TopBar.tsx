import { useEffect, useRef, useState } from 'react';
import { useStore, exportWorksheet, type Settings } from '../state/store';

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return { open, setOpen, ref };
}

export function TopBar() {
  const s = useStore();
  const st = s.ws.settings;
  const menu = usePopover();
  const settings = usePopover();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const doExport = () => {
    const blob = new Blob([exportWorksheet(s.ws)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${s.ws.title.replace(/[^\w\- ]+/g, '').trim() || 'worksheet'}.usc.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const set = (p: Partial<Settings>) => s.setSettings(p);

  return (
    <header className="topbar">
      <div className="pop-wrap" ref={menu.ref}>
        <button className="icon-btn big" aria-label="Worksheets" onClick={() => menu.setOpen(!menu.open)}>
          ☰
        </button>
        {menu.open && (
          <div className="popover left">
            <button className="menu-item strong" onClick={() => (s.newWorksheet(), menu.setOpen(false))}>
              + New worksheet
            </button>
            <div className="menu-sep" />
            {s.index.length === 0 && <div className="menu-empty">No saved worksheets yet</div>}
            {s.index.map((w) => (
              <div key={w.id} className={`menu-ws ${w.id === s.ws.id ? 'current' : ''}`}>
                <button className="menu-item" onClick={() => (s.openWorksheet(w.id), menu.setOpen(false))}>
                  {w.id === s.ws.id ? s.ws.title : w.title}
                  <span className="menu-date">{new Date(w.updated).toLocaleDateString()}</span>
                </button>
                <button
                  className="icon-btn danger small"
                  title="Delete worksheet"
                  onClick={() => {
                    if (confirm(`Delete “${w.title}”? This can't be undone.`)) s.deleteWorksheet(w.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <input className="title-input" value={s.ws.title} onChange={(e) => s.setTitle(e.target.value)} aria-label="Worksheet title" />
      <div className="spacer" />
      <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}>
        ↶
      </button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!s.future.length} onClick={s.redo}>
        ↷
      </button>
      <div className="seg" role="group" aria-label="Angle mode">
        <button className={st.angle === 'rad' ? 'on' : ''} onClick={() => set({ angle: 'rad' })}>
          RAD
        </button>
        <button className={st.angle === 'deg' ? 'on' : ''} onClick={() => set({ angle: 'deg' })}>
          DEG
        </button>
      </div>
      <div className="pop-wrap" ref={settings.ref}>
        <button className="icon-btn" title="Settings" onClick={() => settings.setOpen(!settings.open)}>
          ⚙
        </button>
        {settings.open && (
          <div className="popover right settings">
            <label>
              Significant figures
              <input type="number" min={1} max={16} value={st.sigFigs} onChange={(e) => set({ sigFigs: Math.min(16, Math.max(1, Number(e.target.value) || 10)) })} />
            </label>
            <label>
              Notation
              <select value={st.notation} onChange={(e) => set({ notation: e.target.value as Settings['notation'] })}>
                <option value="auto">Auto</option>
                <option value="scientific">Scientific</option>
                <option value="engineering">Engineering</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={st.exactDefault} onChange={(e) => set({ exactDefault: e.target.checked })} />
              Show exact fractions (1/3)
            </label>
            <label>
              Theme
              <select value={st.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
        )}
      </div>
      <button className="text-btn" onClick={doExport} title="Download worksheet as JSON">
        ⤓ Export
      </button>
      <button className="text-btn" onClick={() => fileRef.current?.click()} title="Open a .usc.json file">
        ⤒ Import
      </button>
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
            s.importWorksheet(await f.text());
            setImportError(null);
          } catch (err) {
            setImportError((err as Error).message);
          }
        }}
      />
      {importError && (
        <div className="toast" onClick={() => setImportError(null)}>
          Import failed: {importError}
        </div>
      )}
    </header>
  );
}
