/**
 * FOOTPLATE — Live steam engine diagram
 * Driver (John) + Fireman (AI) share this cab.
 * ReactFlow shows the M4D engine running in real time.
 */
import { useEffect, useState } from 'react';
import ReactFlow, {
  Background, Controls,
  Handle, Position,
} from 'reactflow';
import type { Node, Edge, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Pressure {
  gauges: {
    bars: number;
    trades: number;
    optuna_age_min: number | null;
    db_error?: string;
    checked_at: number;
  };
  updated: number;
}

// ─── Custom nodes ─────────────────────────────────────────────────────────────

function EngineNode({ data }: NodeProps) {
  const alive = data.status === 'live';
  const border = alive ? '#22c55e' : data.status === 'warn' ? '#f59e0b' : '#ef4444';
  return (
    <div style={{
      background: '#0d1117', border: `2px solid ${border}`,
      borderRadius: 10, padding: '10px 16px', minWidth: 140,
      fontFamily: "'JetBrains Mono', monospace", color: '#e6edf3',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: border }} />
      <div style={{ fontSize: 18, marginBottom: 4 }}>{data.icon}</div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: border }}>
        {data.label}
      </div>
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{data.sub}</div>
      {data.metric && (
        <div style={{ fontSize: 12, fontWeight: 700, color: border, marginTop: 4 }}>
          {data.metric}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: border }} />
    </div>
  );
}

const nodeTypes = { engine: EngineNode };

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FootplatePage() {
  const [pressure, setPressure] = useState<Pressure | null>(null);
  const [wsOk, setWsOk] = useState(false);
  const [pendingProposals, setPendingProposals] = useState(0);

  // Poll pressure + proposals
  useEffect(() => {
    const poll = async () => {
      try {
        const p = await fetch('/engine/pressure/').then(r => r.ok ? r.json() : null);
        if (p) setPressure(p);
      } catch {}
      try {
        const props = await fetch('/engine/proposals/').then(r => r.ok ? r.json() : null);
        if (props?.proposals) setPendingProposals(props.proposals.filter((x: {status:string}) => x.status === 'pending').length);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 15_000);
    return () => clearInterval(t);
  }, []);

  // WS heartbeat
  useEffect(() => {
    try {
      const ws = new WebSocket('ws://127.0.0.1:3330/v1/ws/algo');
      ws.onopen = () => setWsOk(true);
      ws.onclose = () => setWsOk(false);
      return () => ws.close();
    } catch { setWsOk(false); }
  }, []);

  const bars = pressure?.gauges.bars ?? 0;
  const trades = pressure?.gauges?.trades ?? pressure?.gauges?.trades ?? 0;
  const optunaAge = pressure?.gauges.optuna_age_min;
  const boilerPct = Math.min(100, Math.round((bars / 300) * 100));

  const nodes: Node[] = [
    {
      id: 'coal', type: 'engine', position: { x: 0, y: 120 },
      data: { icon: '🌑', label: 'BINANCE WS', sub: 'coal source', metric: 'free · public', status: wsOk ? 'live' : 'dead' },
    },
    {
      id: 'firebox', type: 'engine', position: { x: 200, y: 120 },
      data: { icon: '🔥', label: 'RUST BRIDGE', sub: ':3330', metric: wsOk ? '● connected' : '○ down', status: wsOk ? 'live' : 'dead' },
    },
    {
      id: 'boiler', type: 'engine', position: { x: 400, y: 60 },
      data: { icon: '♨️', label: 'CRYPTO WORKER', sub: 'pressure gauge', metric: `${bars} bars · ${boilerPct}%`, status: bars >= 60 ? 'live' : bars > 0 ? 'warn' : 'dead' },
    },
    {
      id: 'optuna', type: 'engine', position: { x: 400, y: 200 },
      data: { icon: '⚙️', label: 'OPTUNA', sub: 'param tuner', metric: optunaAge ? `${optunaAge}m ago` : 'not run', status: optunaAge && optunaAge < 90 ? 'live' : 'warn' },
    },
    {
      id: 'django', type: 'engine', position: { x: 620, y: 120 },
      data: { icon: '🛤️', label: 'DJANGO', sub: ':8050 · signals', metric: `${trades} sim trades`, status: trades >= 0 ? 'live' : 'dead' },
    },
    {
      id: 'fireman', type: 'engine', position: { x: 200, y: 280 },
      data: { icon: '👷', label: 'FIREMAN', sub: 'AI · hourly', metric: `${pendingProposals} proposals`, status: pendingProposals >= 0 ? 'live' : 'warn' },
    },
    {
      id: 'driver', type: 'engine', position: { x: 840, y: 120 },
      data: { icon: '🚂', label: 'DRIVER', sub: 'John · online', metric: 'at the throttle', status: 'live' },
    },
  ];

  const edges: Edge[] = [
    { id: 'e1', source: 'coal',    target: 'firebox', animated: wsOk,   style: { stroke: '#22c55e' } },
    { id: 'e2', source: 'firebox', target: 'boiler',  animated: bars>0, style: { stroke: '#f59e0b' } },
    { id: 'e3', source: 'firebox', target: 'optuna',  animated: false,  style: { stroke: '#6b7280' } },
    { id: 'e4', source: 'boiler',  target: 'django',  animated: bars>=60, style: { stroke: '#22c55e' } },
    { id: 'e5', source: 'optuna',  target: 'django',  animated: false,  style: { stroke: '#6b7280' } },
    { id: 'e6', source: 'django',  target: 'driver',  animated: true,   style: { stroke: '#60a5fa' } },
    { id: 'e7', source: 'fireman', target: 'firebox', animated: true,   style: { stroke: '#f97316', strokeDasharray: '5,5' } },
    { id: 'e8', source: 'fireman', target: 'django',  animated: false,  style: { stroke: '#6b7280', strokeDasharray: '5,5' } },
  ];

  // Pressure bar
  const pressureColor = boilerPct >= 80 ? '#22c55e' : boilerPct >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ background: '#010409', color: '#e6edf3', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=JetBrains+Mono:wght@400;700&display=swap');`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', borderBottom: '1px solid #21262d' }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>🚂 FOOTPLATE</span>
        <span style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.06em' }}>DRIVER + FIREMAN · LIVE ENGINE</span>

        {/* Steam pressure */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 20 }}>
          <span style={{ fontSize: 10, color: '#6b7280' }}>STEAM</span>
          <div style={{ width: 120, height: 6, background: '#21262d', borderRadius: 3 }}>
            <div style={{ width: `${boilerPct}%`, height: '100%', background: pressureColor, borderRadius: 3, transition: 'width 1s' }} />
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: pressureColor }}>{boilerPct}%</span>
        </div>

        {/* Gauges */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20 }}>
          {[
            { label: 'BARS', value: bars, ok: bars >= 60 },
            { label: 'TRADES', value: trades, ok: trades >= 0 },
            { label: 'PROPOSALS', value: pendingProposals, ok: true },
          ].map(g => (
            <div key={g.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{g.label}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: g.ok ? '#e6edf3' : '#ef4444' }}>{g.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ReactFlow engine diagram */}
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#21262d" gap={20} />
          <Controls style={{ background: '#0d1117', border: '1px solid #21262d', color: '#e6edf3' }} />
        </ReactFlow>
      </div>

      {/* Fireman log */}
      <div style={{ padding: '8px 20px', borderTop: '1px solid #21262d', fontSize: 10, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace" }}>
        FIREMAN fires hourly at :17 · COAL={bars} bars · PRESSURE={boilerPct}% · {pendingProposals} proposals queued
      </div>
    </div>
  );
}
