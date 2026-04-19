import type { ServicePing } from '../hooks/useServiceHealth';

function Light({ s }: { s: ServicePing }) {
  const title = [s.hint, s.latencyMs != null ? `${s.latencyMs}ms` : '']
    .filter(Boolean)
    .join(' · ');
  let color = '#475569';
  let label = '—';
  if (s.state === 'live') {
    color = '#00e676';
    label = 'ON';
  } else if (s.state === 'dead') {
    color = '#ff1744';
    label = 'OFF';
  } else if (s.state === 'check') {
    color = '#fbbf24';
    label = '…';
  } else if (s.state === 'skip') {
    color = '#334155';
    label = 'N/A';
  }
  return (
    <div className="app-service-dash__cell" title={title || s.label}>
      <span
        className="app-service-dash__lamp"
        style={{
          background: color,
          boxShadow:
            s.state === 'live'
              ? `0 0 12px ${color}88`
              : s.state === 'dead'
                ? `0 0 10px ${color}55`
                : 'none',
        }}
        aria-hidden
      />
      <span className="app-service-dash__name">{s.label}</span>
      <span className="app-service-dash__tag">{label}</span>
    </div>
  );
}

type Props = {
  services: ServicePing[];
  /** Optional second line: council / execution summary */
  execHint?: string;
};

export default function ServiceOpsDash({ services, execHint }: Props) {
  return (
    <div className="app-service-dash" aria-label="Service health">
      <div className="app-service-dash__row">
        <span className="app-service-dash__k">OPS</span>
        {services.map((s) => (
          <Light key={s.id} s={s} />
        ))}
      </div>
      {execHint ? (
        <div className="app-service-dash__exec" role="status">
          {execHint}
        </div>
      ) : null}
    </div>
  );
}
