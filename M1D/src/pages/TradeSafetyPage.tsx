export default function TradeSafetyPage() {
  return (
    <div
      style={{
        minHeight: 'calc(100dvh - 96px)',
        background: '#050a10',
        color: '#c8dae8',
        padding: 12,
        display: 'grid',
        gap: 10,
      }}
    >
      <section style={{ border: '1px solid #16394d', background: '#061019', padding: 14 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#f59e0b' }}>SAFETY🛡️</div>
        <h2 style={{ margin: '6px 0 4px', fontSize: 24 }}>Auto Algo Health + Guardrails</h2>
        <p style={{ margin: 0, color: '#7aa0b4', fontSize: 12 }}>
          Dedicated safety surface for kill-switch, heartbeat, service health, and risk throttles.
        </p>
      </section>
      <section style={{ border: '1px solid #16394d', background: '#061019', padding: 14 }}>
        <div style={{ color: '#22c55e', fontSize: 18 }}>SYSTEM HEALTH: LIVE</div>
        <div style={{ color: '#7aa0b4', fontSize: 12, marginTop: 6 }}>
          API, WS, and execution safety checks will be wired here next.
        </div>
      </section>
    </div>
  );
}
