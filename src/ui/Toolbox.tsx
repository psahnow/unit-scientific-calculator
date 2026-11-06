// The function toolbox (DESIGN.md §3.5): a keypad-style drawer that inserts functions at the caret.
import { useEffect, useRef, useState } from 'react';
import { insertIntoMath } from './MathInput';
import { useStore } from '../state/store';
import { GROUPS } from './toolbox.data';

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
  const group = GROUPS.find((g) => g.id === tab) ?? GROUPS[0];

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
        {GROUPS.map((g) => (
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
          </button>
        ))}
      </div>
    </section>
  );
}
