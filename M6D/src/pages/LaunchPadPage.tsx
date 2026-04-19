/**
 * OPT — Elon 5-Step decision engine for proposals (Launch Pad)
 * L = Launch · H = Hold · G = Kill
 * ↑↓ / j k = navigate
 * Decisions stored in localStorage, progress bar top.
 */
import { useEffect, useState, useCallback } from 'react';

type Decision = 'launch' | 'hold' | 'kill' | null;

interface Proposal {
  id: string;
  domain: string;
  risk: 'HIGH' | 'MED' | 'LOW';
  category: string;
  axis: string;
  what: string;
  why: string;
  expected_delta: string;
  effort: string;
  status: string;
  file_refs: string[];
}

const DOMAIN_COLOR: Record<string, string> = {
  SWE: '#60a5fa',
  DS: '#34d399',
  ARCH: '#f97316',
  DESIGNER: '#a78bfa',
  'DESIGNER+ARCH': '#f59e0b',
};
const RISK_COLOR = { HIGH: '#ef4444', MED: '#f59e0b', LOW: '#6b7280' };
const EFFORT_COLOR: Record<string, string> = { S: '#22c55e', M: '#f59e0b', L: '#ef4444' };
const STORAGE_KEY = 'm4d_launchpad_v1';

function loadDecisions(): Record<string, Decision> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function persistDecision(id: string, d: Decision) {
  const all = loadDecisions();
  all[id] = d;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export default function LaunchPadPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [idx, setIdx] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(loadDecisions);
  const [flash, setFlash] = useState<Decision>(null);

  useEffect(() => {
    const load = async () => {
      let data: Proposal[] | null = null;
      // Try backend first
      try {
        const r = await fetch('/engine/proposals/');
        if (r.ok) { const j = await r.json(); if (j?.proposals?.length) data = j.proposals; }
      } catch {}
      // Fallback to static public asset
      if (!data) {
        try {
          const r = await fetch('/proposals.json');
          if (r.ok) { const j = await r.json(); if (j?.proposals?.length) data = j.proposals; }
        } catch {}
      }
      if (data) setProposals(data);
    };
    load();
  }, []);

  const decide = useCallback((d: Decision) => {
    if (!proposals.length) return;
    const p = proposals[idx];
    setDecisions(prev => { const next = { ...prev, [p.id]: d }; persistDecision(p.id, d); return next; });
    setFlash(d);
    setTimeout(() => setFlash(null), 350);
    // Advance to next undecided
    setIdx(cur => {
      const next = proposals.findIndex((p2, i) => i > cur && !decisions[p2.id]);
      return next !== -1 ? next : Math.min(cur + 1, proposals.length - 1);
    });
  }, [proposals, idx, decisions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case 'ArrowUp':   case 'k': e.preventDefault(); setIdx(i => Math.max(0, i - 1)); break;
        case 'ArrowDown': case 'j': e.preventDefault(); setIdx(i => Math.min(proposals.length - 1, i + 1)); break;
        case 'l': case 'L': decide('launch'); break;
        case 'h': case 'H': decide('hold');   break;
        case 'g': case 'G': decide('kill');   break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proposals, decide]);

  const launched = Object.values(decisions).filter(d => d === 'launch').length;
  const held     = Object.values(decisions).filter(d => d === 'hold').length;
  const killed   = Object.values(decisions).filter(d => d === 'kill').length;
  const total    = proposals.length;
  const done     = launched + held + killed;

  const cur = proposals[idx];
  const flashBg =
    flash === 'launch' ? 'rgba(34,197,94,0.12)' :
    flash === 'kill'   ? 'rgba(239,68,68,0.12)' :
    flash === 'hold'   ? 'rgba(245,158,11,0.12)' : 'transparent';

  const mono = "'JetBrains Mono', 'Fira Code', monospace";
  const sans = "'IBM Plex Sans', system-ui, sans-serif";

  return (
    <div style={{ background: '#010409', color: '#e6edf3', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: mono }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=JetBrains+Mono:wght@400;700&display=swap');
        .pad-btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .pad-list-btn:hover { background: #0d1117 !important; }
        .pad-list-btn { transition: background 0.1s; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>⚡ OPT</span>
        <span style={{ fontSize: 9, color: '#6b7280', letterSpacing: '0.07em', fontFamily: sans }}>
          QUESTION → DELETE → SIMPLIFY → ACCELERATE → AUTOMATE
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, fontSize: 11 }}>
          <span style={{ color: '#22c55e' }}>✓ {launched}</span>
          <span style={{ color: '#f59e0b' }}>⏸ {held}</span>
          <span style={{ color: '#ef4444' }}>✗ {killed}</span>
          <span style={{ color: '#6b7280' }}>— {total - done} left</span>
        </div>
      </div>

      {/* ── Progress bar ───────────────────────────────────────────────── */}
      <div style={{ height: 3, background: '#21262d', flexShrink: 0 }}>
        <div style={{ height: '100%', width: total ? `${(done / total) * 100}%` : '0%', background: '#22c55e', transition: 'width 0.3s ease' }} />
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: 210, borderRight: '1px solid #21262d', overflowY: 'auto', flexShrink: 0 }}>
          {proposals.map((p, i) => {
            const dec = decisions[p.id];
            const decIcon  = dec === 'launch' ? '✓' : dec === 'kill' ? '✗' : dec === 'hold' ? '⏸' : '—';
            const decColor = dec === 'launch' ? '#22c55e' : dec === 'kill' ? '#ef4444' : dec === 'hold' ? '#f59e0b' : '#374151';
            return (
              <button
                key={p.id}
                className="pad-list-btn"
                onClick={() => setIdx(i)}
                style={{
                  width: '100%', textAlign: 'left', display: 'block',
                  background: i === idx ? '#0d1117' : 'transparent',
                  border: 'none', borderBottom: '1px solid #21262d',
                  borderLeft: i === idx ? '2px solid #60a5fa' : '2px solid transparent',
                  padding: '8px 12px', cursor: 'pointer', color: '#e6edf3',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: decColor, fontSize: 10, minWidth: 12 }}>{decIcon}</span>
                  <span style={{ fontSize: 8, color: DOMAIN_COLOR[p.domain] ?? '#6b7280', letterSpacing: '0.06em', fontWeight: 700 }}>{p.domain}</span>
                  <span style={{ fontSize: 8, color: RISK_COLOR[p.risk] ?? '#6b7280', marginLeft: 'auto' }}>{p.risk}</span>
                </div>
                <div style={{ fontSize: 10, color: i === idx ? '#e6edf3' : '#6b7280', marginTop: 3, lineHeight: 1.3 }}>
                  {p.axis.length > 38 ? p.axis.slice(0, 38) + '…' : p.axis}
                </div>
              </button>
            );
          })}
        </div>

        {/* Main card */}
        {cur ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '28px 36px', background: flashBg, transition: 'background 0.25s', overflowY: 'auto' }}>

            {/* Badges row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              {[
                { label: cur.domain,   color: DOMAIN_COLOR[cur.domain] ?? '#6b7280' },
                { label: cur.risk,     color: RISK_COLOR[cur.risk] },
                { label: cur.category, color: '#6b7280' },
                { label: `EFFORT ${cur.effort}`, color: EFFORT_COLOR[cur.effort] ?? '#6b7280' },
              ].map(b => (
                <span key={b.label} style={{ fontSize: 9, background: b.color + '22', color: b.color, padding: '2px 8px', borderRadius: 3, letterSpacing: '0.07em', fontWeight: 700 }}>
                  {b.label}
                </span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>{idx + 1} / {total}</span>
            </div>

            {/* Axis */}
            <h2 style={{ fontFamily: sans, fontSize: 22, fontWeight: 700, color: '#f0f6fc', margin: '0 0 20px', lineHeight: 1.25, letterSpacing: '-0.02em' }}>
              {cur.axis}
            </h2>

            {/* What */}
            <Section label="WHAT">
              <p style={{ fontFamily: sans, fontSize: 13, color: '#c9d1d9', lineHeight: 1.65, margin: 0 }}>{cur.what}</p>
            </Section>

            {/* Why */}
            <Section label="WHY · FILE REFS">
              <p style={{ fontFamily: sans, fontSize: 12, color: '#8b949e', lineHeight: 1.5, margin: '0 0 8px' }}>{cur.why}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cur.file_refs?.map(ref => (
                  <span key={ref} style={{ fontSize: 10, background: '#161b22', border: '1px solid #30363d', padding: '2px 8px', borderRadius: 4, color: '#60a5fa' }}>{ref}</span>
                ))}
              </div>
            </Section>

            {/* Delta */}
            <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '12px 16px', marginBottom: 28 }}>
              <div style={{ fontSize: 9, color: '#6b7280', letterSpacing: '0.07em', marginBottom: 5 }}>EXPECTED DELTA</div>
              <div style={{ fontFamily: sans, fontSize: 13, color: '#22c55e', fontWeight: 700 }}>{cur.expected_delta}</div>
            </div>

            {/* Decision buttons */}
            <div style={{ display: 'flex', gap: 12, marginTop: 'auto' }}>
              {([
                { key: 'L', label: 'LAUNCH', dec: 'launch' as Decision, color: '#22c55e', icon: '✓' },
                { key: 'H', label: 'HOLD',   dec: 'hold'   as Decision, color: '#f59e0b', icon: '⏸' },
                { key: 'G', label: 'KILL',   dec: 'kill'   as Decision, color: '#ef4444', icon: '✗' },
              ] as const).map(btn => {
                const active = decisions[cur.id] === btn.dec;
                return (
                  <button
                    key={btn.key}
                    className="pad-btn"
                    onClick={() => decide(btn.dec)}
                    style={{
                      flex: 1, padding: '14px 0', border: `2px solid ${active ? btn.color : '#21262d'}`,
                      borderRadius: 8, background: active ? btn.color + '1a' : '#0d1117',
                      color: active ? btn.color : '#6b7280', cursor: 'pointer',
                      fontSize: 12, fontWeight: 700, fontFamily: mono,
                      transition: 'all 0.15s', letterSpacing: '0.04em',
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{btn.icon}</div>
                    <div>{btn.key} · {btn.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 13 }}>
            {proposals.length === 0 ? 'Loading proposals…' : 'All proposals reviewed. Ship it.'}
          </div>
        )}
      </div>

      {/* ── Keyboard legend ─────────────────────────────────────────────── */}
      <div style={{ padding: '6px 20px', borderTop: '1px solid #21262d', display: 'flex', gap: 24, fontSize: 9, color: '#6b7280', flexShrink: 0 }}>
        {[['↑↓ / j k', 'navigate'], ['L', 'launch →'], ['H', 'hold ⏸'], ['G', 'kill ✗']].map(([k, v]) => (
          <span key={k}><span style={{ color: '#e6edf3', marginRight: 4 }}>{k}</span>{v}</span>
        ))}
        <span style={{ marginLeft: 'auto' }}>decisions saved in localStorage</span>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 9, color: '#6b7280', letterSpacing: '0.07em', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      {children}
    </div>
  );
}
