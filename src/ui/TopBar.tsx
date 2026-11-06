import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, exportWorksheet, type Settings, type Theme } from '../state/store';
import { PACKAGES } from '../engine/units/packages';
import { setCustomUnits } from '../engine/units/registry';
import { BrandMark, About } from './Brand';

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
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
  const [about, setAbout] = useState(false);
  const customErrors = useMemo(() => setCustomUnits(st.units ?? []), [st.units]);

  const doExport = () => {
    const blob = new Blob([exportWorksheet(s.ws)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${s.ws.title.replace(/[^\w\- ]+/g, '').trim() || 'worksheet'}.dimensional.json`;
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
            <button className="menu-item" onClick={() => (menu.setOpen(false), setTimeout(() => window.print(), 50))}>
              Print / save as PDF…
            </button>
            <button
              className="menu-item"
              onClick={() => (menu.setOpen(false), window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true })))}
            >
              Keyboard shortcuts <span className="menu-date">Ctrl /</span>
            </button>
            <button className="menu-item" onClick={() => (setAbout(true), menu.setOpen(false))}>
              About Dimensional
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
      <span className="brand" title="Dimensional: a unit-aware engineering calculator">
        <BrandMark className="brand-mark" />
        <span className="brand-name">Dimensional</span>
        <span className="brand-sep" aria-hidden>/</span>
      </span>
      <input className="title-input" value={s.ws.title} onChange={(e) => s.setTitle(e.target.value)} aria-label="Worksheet title" />
      <div className="spacer" />
      <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!s.past.length} onClick={s.undo}>
        ↶
      </button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!s.future.length} onClick={s.redo}>
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
        <button
          className="icon-btn"
          title={s.theme === 'dark' ? 'Light paper' : 'Dark (graphite) paper'}
          aria-label="Switch light or dark"
          onClick={() => s.setTheme(s.theme === 'dark' ? 'light' : 'dark')}
        >
          {s.theme === 'dark' ? '☀' : '☾'}
        </button>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => settings.setOpen(!settings.open)}>
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
            <label title="With Auto notation, large values switch to scientific notation (6.43×10⁶) from this size up">
              Scientific notation from
              <select value={st.sciAbove} disabled={st.notation !== 'auto'} onChange={(e) => set({ sciAbove: Number(e.target.value) })}>
                <option value={3}>10³</option>
                <option value={4}>10⁴</option>
                <option value={5}>10⁵</option>
                <option value={6}>10⁶</option>
                <option value={9}>10⁹</option>
                <option value={12}>10¹² (default)</option>
                <option value={21}>Never</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={st.exactDefault} onChange={(e) => set({ exactDefault: e.target.checked })} />
              Show exact fractions (1/3)
            </label>
            <fieldset className="packages">
              <legend>Unit packages</legend>
              <p className="pk-help">Everyday SI and US units are always on. Turn on extra units for this worksheet:</p>
              {PACKAGES.map((p) => (
                <label key={p.id} className="check pk" title={p.description}>
                  <input
                    type="checkbox"
                    checked={st.packages.includes(p.id)}
                    onChange={(e) =>
                      set({ packages: e.target.checked ? [...st.packages, p.id] : st.packages.filter((x) => x !== p.id) })
                    }
                  />
                  <span>
                    {p.name}
                    <small>{p.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="packages custom-units">
              <legend>Custom units</legend>
              <p className="pk-help">Define your own units for this worksheet, like bag = 25 kg or ksf = kip/ft^2.</p>
              {(st.units ?? []).map((u, i) => (
                <div key={i} className="cu-row">
                  <input
                    className="cu-sym"
                    value={u.symbol}
                    placeholder="bag"
                    aria-label={`Custom unit ${i + 1} symbol`}
                    onChange={(e) => set({ units: st.units.map((x, j) => (j === i ? { ...x, symbol: e.target.value } : x)) })}
                  />
                  <span>=</span>
                  <input
                    className="cu-def"
                    value={u.definition}
                    placeholder="25 kg"
                    aria-label={`Custom unit ${i + 1} size`}
                    onChange={(e) => set({ units: st.units.map((x, j) => (j === i ? { ...x, definition: e.target.value } : x)) })}
                  />
                  <button className="icon-btn danger small" aria-label="Remove custom unit" onClick={() => set({ units: st.units.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                  {customErrors[i] && <span className="cu-err">{customErrors[i]}</span>}
                </div>
              ))}
              <button className="text-btn" onClick={() => set({ units: [...(st.units ?? []), { symbol: '', definition: '' }] })}>
                + Add a unit
              </button>
            </fieldset>
            <label>
              Theme
              <select value={s.theme} onChange={(e) => s.setTheme(e.target.value as Theme)}>
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
      <button className="text-btn" onClick={() => fileRef.current?.click()} title="Open a Dimensional worksheet (.dimensional.json, or an older .usc.json)">
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
      {about && <About onClose={() => setAbout(false)} />}
    </header>
  );
}
