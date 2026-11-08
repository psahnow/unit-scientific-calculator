// The function toolbox (DESIGN.md §3.5): a keypad-style drawer that inserts functions at the caret.
import { useEffect, useRef, useState } from 'react';
import { insertIntoMath } from './MathInput';
import { useStore } from '../state/store';
import { GROUPS } from './toolbox.data';
import { UNITS } from '../engine/units/units.data';
import { expandedUnits, getUnit } from '../engine/units/registry';
import { isUnitOn, packagesOf, PACKAGE_BY_ID } from '../engine/units/packages';
import { symbolToLatex } from '../engine/latex';

export function ToolboxButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button className={`text-btn ${open ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onToggle} aria-expanded={open} aria-controls="toolbox" aria-label="Functions toolbox" title="Functions toolbox">
      <span className="tb-f">ƒ</span>(x) Functions
    </button>
  );
}

export function Toolbox({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem('usc:toolbox-tab') ?? 'trig';
    } catch {
      return 'trig';
    }
  });
  const pick = (id: string) => {
    setTab(id);
    try {
      localStorage.setItem('usc:toolbox-tab', id);
    } catch {
      /* per-viewer convenience only */
    }
  };
  // the Vectors and Complex tabs only when the worksheet has them on (D63); √−1 in its own letter
  const vectors = useStore((st) => !!st.ws.settings.vectors && !st.ws.settings.imaginary);
  const imag = useStore((st) => st.ws.settings.imaginary);
  const visible = GROUPS.filter((g) => !g.needs || (g.needs === 'vectors' ? vectors : !!imag)).map((g) =>
    g.id === 'complex' && imag === 'j'
      ? { ...g, keys: g.keys.map((k) => ({ ...k, label: k.label.replace(/i$/, 'j'), insert: k.insert.replace(/i$/, 'j') })) }
      : g,
  );
  const group = visible.find((g) => g.id === tab) ?? visible[0];

  // keep the page's bottom padding equal to the drawer, so it never hides the last rows
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--toolbox-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--toolbox-h');
    };
  }, []);

  const insert = (latex: string) => {
    if (insertIntoMath(latex)) return;
    // no expression has been edited yet: start a new one at the end and insert there
    const st = useStore.getState();
    st.addRow('expr', st.ws.rows[st.ws.rows.length - 1]?.id ?? null, { parent: undefined });
    insertIntoMath(latex, { pending: true });
  };

  return (
    <section id="toolbox" className="toolbox" aria-label="Functions" ref={ref}>
      <div className="tb-tabs" role="tablist">
        {visible.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={g.id === group.id}
            className={g.id === group.id ? 'on' : ''}
            // keep the caret in the expression being edited
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(g.id)}
          >
            {g.label}
          </button>
        ))}
        <span className="spacer" />
        <button className="icon-btn" title="Close functions" aria-label="Close functions" onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
          ✕
        </button>
      </div>
      {group.browser === 'units' ? (
        <UnitsBrowser insert={insert} />
      ) : (
      <div className="tb-keys" role="tabpanel">
        {group.keys.map((k) => (
          <button
            key={k.label}
            className={`tb-key ${k.wide ? 'wide' : ''}`}
            title={k.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(k.insert)}
          >
            {k.label}
            {k.sub && <sub>{k.sub}</sub>}
          </button>
        ))}
      </div>
      )}
    </section>
  );
}

/** Every unit, grouped by kind, with search; units from packages that are off are shown dimmed (D35). */
function UnitsBrowser({ insert }: { insert(latex: string): void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  useStore((st) => st.ws.settings.packages); // re-render when packages change
  const lq = q.trim().toLowerCase();
  const match = (u: (typeof UNITS)[number]) =>
    !lq || u.id.toLowerCase().includes(lq) || u.name.toLowerCase().includes(lq) || u.aliases.some((a) => a.toLowerCase().includes(lq));
  const groups = new Map<string, typeof UNITS>();
  let hidden = 0;
  // the catalogue (plus kg); when searching, also prefixed forms like mm, kN, MPa
  const source = lq ? expandedUnits() : [getUnit('kg'), ...UNITS];
  for (const u of source) {
    if (!match(u)) continue;
    if (!all && !isUnitOn(u)) {
      hidden++;
      continue;
    }
    if (!groups.has(u.category)) groups.set(u.category, []);
    groups.get(u.category)!.push(u);
  }
  return (
    <div className="tb-units" role="tabpanel">
      <div className="tb-units-bar">
        <input className="unit-search" placeholder="Search units, like pascal or psi" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search units" />
        <label className="tb-units-all">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show units from unit sets that are off
          {!all && hidden > 0 && <span className="muted"> ({hidden} hidden)</span>}
        </label>
      </div>
      <div className="tb-units-list">
        {[...groups.entries()].map(([cat, us]) => (
          <div key={cat} className="tb-unit-group">
            <div className="unit-group-label">{cat}</div>
            <div className="tb-unit-chips">
              {us.map((u) => {
                const on = isUnitOn(u);
                const pk = packagesOf(u).map((id) => PACKAGE_BY_ID.get(id)?.name ?? id);
                return (
                  <button
                    key={u.id}
                    className={`tb-unit ${on ? '' : 'off'}`}
                    title={`${u.name}${pk.length ? ` (${pk.join(' / ')}${on ? '' : ', turned off for this worksheet'})` : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(`\\unit{${symbolToLatex(u.id)}}`)}
                  >
                    <span className="sym">{u.id}</span>
                    <span className="nm">{u.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.size === 0 && <div className="muted tb-units-empty">No units match “{q}”.</div>}
      </div>
    </div>
  );
}
