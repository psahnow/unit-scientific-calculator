// Start card, guided tour coach and inline tips (D60, docs/tutorial.md).
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { WorksheetResult, Row } from '../engine/worksheet';
import { useStore } from '../state/store';
import { EXAMPLES, TOUR, isEmptySheet, type TourApi, type TourCtx, type Tip } from './tour';

/** `code` in backticks becomes something to type. */
function rich(text: string): ReactNode {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i} className="eg">{part}</code> : <Fragment key={i}>{part}</Fragment>));
}

/** On an empty worksheet: what this is, examples to try, and the tour. */
export function StartCard() {
  const s = useStore();
  if (s.tour || !isEmptySheet(s.ws.rows)) return null;
  const tryIt = (e: (typeof EXAMPLES)[number]) => {
    const st = useStore.getState();
    const last = st.ws.rows[st.ws.rows.length - 1];
    if (!last) return;
    st.updateRow(last.id, { latex: e.latex, displayUnit: e.displayUnit } as Partial<Row>);
    st.focusRow(last.id);
  };
  return (
    <section className="start-card" aria-label="Getting started">
      <h2>Every number knows its units</h2>
      <p>
        Type a value with a unit, like <code className="eg">F = 6 kN</code>, and use it in formulas. Or try one:
      </p>
      <div className="start-egs">
        {EXAMPLES.map((e) => (
          <button key={e.label} className="eg-btn" onClick={() => tryIt(e)}>
            {e.label}
          </button>
        ))}
      </div>
      <div className="start-foot">
        <button className="text-btn strong" onClick={() => s.startTour()}>
          ▶ Take the 2-minute tour
        </button>
        <span className="muted">
          Saved in this browser<span className="kbd-only"> · Ctrl / for shortcuts</span>
        </span>
      </div>
    </section>
  );
}

/** A one-time tip under the row it is about. */
export function TipLine({ tip }: { tip: Tip }) {
  const dismiss = useStore((s) => s.dismissTip);
  return (
    <div className="row-notice info tip" role="note">
      <span aria-hidden>ⓘ</span> {tip.text}{' '}
      <button className="link-btn" onClick={() => dismiss(tip.id)}>
        Got it
      </button>
    </div>
  );
}

/** A ring around the step's target, following it as the page moves. No overlay: everything stays usable. */
function Spotlight({ selector }: { selector: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      const t = selector ? (document.querySelector(selector) as HTMLElement | null) : null;
      if (el) {
        const b = t?.getBoundingClientRect();
        if (b && b.width) {
          el.style.display = 'block';
          el.style.left = `${b.left - 4}px`;
          el.style.top = `${b.top - 4}px`;
          el.style.width = `${b.width + 8}px`;
          el.style.height = `${b.height + 8}px`;
        } else el.style.display = 'none';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selector]);
  return <div ref={ref} className="tour-spot" aria-hidden />;
}

/** Steps where the user should look before moving on: no automatic advance. */
const MANUAL = new Set(['mistakes']);

export function Coach({ result, toolbox, openToolbox }: { result: WorksheetResult; toolbox: boolean; openToolbox(): void }) {
  const s = useStore();
  const tour = s.tour;
  const active = !!tour && s.ws.id === tour.wsId;
  const i = tour?.step ?? 0;
  const step = TOUR[i];
  const ctx: TourCtx = { rows: s.ws.rows, result, toolbox };
  const met = active && !!step.goal?.(ctx);
  const last = i === TOUR.length - 1;
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);

  const api: TourApi = {
    put(latex, extra) {
      const st = useStore.getState();
      const rows = st.ws.rows;
      const end = rows[rows.length - 1];
      if (end?.type === 'expr' && !end.latex.trim() && !end.parent) {
        st.updateRow(end.id, { latex, ...extra } as Partial<Row>);
        return end.id;
      }
      const id = st.addRow('expr', end?.id ?? null, { parent: undefined, latex, focus: false });
      if (extra) st.updateRow(id, extra as Partial<Row>);
      return id;
    },
    update: (id, patch) => useStore.getState().updateRow(id, patch),
    remove: (id) => useStore.getState().deleteRow(id),
    openToolbox,
  };
  const go = (n: number) => {
    step.onLeave?.(ctx, api);
    s.setTourStep(Math.max(0, Math.min(TOUR.length - 1, n)));
  };
  const showMe = () => {
    step.showMe?.(ctx, api);
    // somewhere to carry on typing
    const st = useStore.getState();
    const end = st.ws.rows[st.ws.rows.length - 1];
    if (step.id !== 'functions' && step.id !== 'convert') {
      if (end && !(end.type === 'expr' && !end.latex.trim())) st.addRow('expr', end.id, { parent: undefined });
      else if (end) st.focusRow(end.id);
    }
  };

  // done: move on once the worksheet has been still for a moment, so finishing a row feels natural
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!met || last || MANUAL.has(step.id)) return;
    const t = setTimeout(() => goRef.current(i + 1), 1400);
    return () => clearTimeout(t);
  }, [met, last, step.id, i, s.ws.rows]);

  if (!active) return null;
  return (
    <>
      <section className={`coach ${shown ? 'in' : ''}`} role="dialog" aria-label="Tour" aria-live="polite">
        <div className="coach-head">
          <span className="coach-n">
            Tour · {i + 1} of {TOUR.length}
          </span>
          <button className="icon-btn small" aria-label="End the tour" title="End the tour and go back" onClick={() => s.endTour(false)}>
            ✕
          </button>
        </div>
        <h2>{step.title}</h2>
        <p>{rich(step.body(ctx))}</p>
        <div className="coach-actions">
          {i > 0 && (
            <button className="text-btn" onClick={() => go(i - 1)}>
              ← Back
            </button>
          )}
          {step.showMe && !met && (
            <button className="text-btn" onClick={showMe}>
              Show me
            </button>
          )}
          {met && <span className="coach-done">✓ Done</span>}
          <span className="spacer" />
          {last ? (
            <>
              <button className="text-btn" onClick={() => s.endTour(true)} title="Keep the Tour worksheet in ☰ Worksheets">
                Keep this sheet
              </button>
              <button className="text-btn strong" onClick={() => s.endTour(false)}>
                Finish
              </button>
            </>
          ) : (
            <button className={`text-btn ${met ? 'strong' : ''}`} onClick={() => go(i + 1)}>
              {met ? 'Next →' : 'Skip'}
            </button>
          )}
        </div>
        <div className="coach-dots" aria-hidden>
          {TOUR.map((t, k) => (
            <span key={t.id} className={k === i ? 'on' : k < i ? 'past' : ''} />
          ))}
        </div>
      </section>
      {!met && <Spotlight selector={step.target?.(ctx) ?? null} />}
    </>
  );
}
