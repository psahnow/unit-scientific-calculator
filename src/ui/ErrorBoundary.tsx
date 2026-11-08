// Crash safety (D32): a crash in one row shows a note in that row; a crash elsewhere shows a
// recovery screen that can still export the saved worksheet, instead of a blank page.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Export the last saved copy straight from browser storage (works even if the app state is broken). */
function exportSaved() {
  try {
    const id = localStorage.getItem('usc:current');
    const raw = id ? localStorage.getItem(`usc:ws:${id}`) : null;
    if (!raw) return alert('No saved worksheet was found in this browser.');
    const title = (JSON.parse(raw).title as string | undefined)?.replace(/[^\w\- ]+/g, '').trim() || 'worksheet';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    a.download = `${title}.dimensional.json`;
    a.click();
  } catch {
    alert('Couldn’t read this browser’s storage.');
  }
}

export class AppBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dimensional crashed', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>Dimensional ran into a problem. Your worksheet is still saved in this browser.</p>
          <div className="crash-actions">
            <button className="text-btn strong" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="text-btn" onClick={exportSaved}>
              ⤓ Export the saved worksheet
            </button>
          </div>
          <details>
            <summary>Error details</summary>
            <pre>{String(this.state.error?.stack ?? this.state.error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}

export class RowBoundary extends Component<{ children: ReactNode; resetKey: string }, State & { key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { key: string; error: Error | null }) {
    // editing the row (undo, or a change elsewhere) gives it another chance
    return p.resetKey !== s.key ? { key: p.resetKey, error: null } : null;
  }
  componentDidCatch(error: Error) {
    console.error('Row failed to display', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="row-body">
        <div className="result error">⚠ This row couldn’t be shown ({this.state.error.message}). Undo the last change, or delete the row.</div>
      </div>
    );
  }
}
