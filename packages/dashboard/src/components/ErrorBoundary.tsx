/**
 * Top-level error boundary for the dashboard SPA.
 *
 * Without one of these, an uncaught render exception (React Rules
 * of Hooks violation, accidental `.map` on undefined, etc.) causes
 * React to unmount the whole component tree — the browser tab goes
 * dark grey / black and the operator has no clue what happened.
 * The Admin view's `useMemo` after an early return was the
 * motivating bug (2026-06-02), but the boundary itself is generic.
 *
 * On error: render a recovery panel showing the error message + a
 * stack-trace toggle + reload + back-to-home buttons. The full
 * error also goes to the browser console for forensic capture.
 */

import React from 'react';

interface State {
  error: Error | null;
  expanded: boolean;
}

interface Props {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, expanded: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Full stack + React component stack in the console — operators
    // can copy from there if they need to file a bug.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null, expanded: false });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div style={shell}>
        <div style={card}>
          <h1 style={title}>Something went wrong</h1>
          <p style={subtitle}>
            The dashboard hit an unexpected error and stopped rendering. The
            error is logged in your browser console.
          </p>
          <pre style={errBox}>{this.state.error.message}</pre>
          {this.state.expanded && this.state.error.stack && (
            <pre style={stackBox}>{this.state.error.stack}</pre>
          )}
          <div style={btnRow}>
            <button
              type="button"
              style={btn}
              onClick={() => this.setState({ expanded: !this.state.expanded })}
            >
              {this.state.expanded ? 'hide stack' : 'show stack'}
            </button>
            <button type="button" style={btn} onClick={this.reset}>
              try again
            </button>
            <button
              type="button"
              style={primary}
              onClick={() => { window.location.href = '/app/'; }}
            >
              back to home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const shell: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-base)',
  padding: '24px',
};
const card: React.CSSProperties = {
  width: '100%',
  maxWidth: '640px',
  background: 'var(--bg-raised)',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  padding: '32px',
};
const title: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '18px',
  color: 'var(--red)',
  margin: '0 0 8px',
};
const subtitle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--text-secondary)',
  margin: '0 0 16px',
};
const errBox: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  padding: '12px',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--text-primary)',
  whiteSpace: 'pre-wrap',
  margin: '0 0 12px',
};
const stackBox: React.CSSProperties = {
  ...errBox,
  fontSize: '11px',
  color: 'var(--text-dim)',
  maxHeight: '300px',
  overflowY: 'auto',
};
const btnRow: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginTop: '8px',
};
const btn: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  padding: '8px 12px',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-strong)',
  borderRadius: '6px',
  cursor: 'pointer',
};
const primary: React.CSSProperties = {
  ...btn,
  background: 'var(--accent)',
  color: '#000',
  border: '1px solid var(--accent)',
};
