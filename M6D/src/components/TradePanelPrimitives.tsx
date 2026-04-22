import type { ReactNode } from 'react';

type BaseProps = {
  title: string;
  hint?: string;
  children: ReactNode;
};

export function ContextPanel({ title, hint, children }: BaseProps) {
  return (
    <section className="mission-council__social-alpha" aria-label={title} style={{ margin: 0 }}>
      <header className="mission-council__social-alpha-head">
        <span className="mission-council__social-alpha-k">{title}</span>
        {hint ? <span className="mission-council__social-alpha-hint">{hint}</span> : null}
      </header>
      <div className="mission-council__social-alpha-frame" style={{ height: 'auto', minHeight: 0, padding: 10, gap: 8 }}>
        {children}
      </div>
    </section>
  );
}

export function ActionPanel({ title, hint, children }: BaseProps) {
  return <ContextPanel title={title} hint={hint}>{children}</ContextPanel>;
}

export function SafetyPanel({ title, hint, children }: BaseProps) {
  return <ContextPanel title={title} hint={hint}>{children}</ContextPanel>;
}

export function StatusPanel({ title, hint, children }: BaseProps) {
  return <ContextPanel title={title} hint={hint}>{children}</ContextPanel>;
}
