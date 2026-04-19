import { useEffect, useRef } from 'react';
import type { ObiSnapshot } from '../hooks/useObiStream';
import './ObiLivePanel.css';

const W_WALL = 52;       // px: left column for live bid/ask wall bubbles
const TIMELINE_MS = 60_000; // show last 60s of trades on x-axis

function drawPanel(canvas: HTMLCanvasElement, snap: ObiSnapshot) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || W === 0 || H === 0) return;

  const STRIP_H = 20;   // pressure heatmap band
  const BUBBLE_H = H - STRIP_H;
  const midY = STRIP_H + BUBBLE_H / 2;
  const now = Date.now();

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#07111e';
  ctx.fillRect(0, 0, W, H);

  // ── 1. Pressure heatmap strip (top band) ────────────────────────
  const { history } = snap;
  if (history.length > 1) {
    const slotW = (W - W_WALL) / Math.min(history.length, HISTORY_SLOTS);
    const visible = history.slice(-Math.ceil((W - W_WALL) / slotW));
    visible.forEach((tick, i) => {
      const x = W_WALL + i * slotW;
      const dev = tick.ratio - 0.5; // -0.5 → +0.5
      let r: number, g: number, b: number;
      if (dev >= 0) {
        const t = dev * 2;
        r = Math.round(20 - t * 10); g = Math.round(150 + t * 70); b = Math.round(140 + t * 60);
      } else {
        const t = -dev * 2;
        r = Math.round(160 + t * 80); g = Math.round(40); b = Math.round(40);
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, slotW + 0.5, STRIP_H);
    });
  }

  // strip divider
  ctx.strokeStyle = '#0d1f3c';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, STRIP_H); ctx.lineTo(W, STRIP_H); ctx.stroke();

  // ── 2. Wall column divider ───────────────────────────────────────
  ctx.beginPath(); ctx.moveTo(W_WALL, STRIP_H); ctx.lineTo(W_WALL, H); ctx.stroke();

  // ── 3. Live bid/ask wall bubbles (left column) ──────────────────
  const { bidSize, askSize } = snap;
  const maxWall = Math.max(bidSize, askSize, 1);
  const wallR = (size: number) => Math.max(4, Math.min(W_WALL / 2 - 4, (size / maxWall) * (W_WALL / 2 - 4)));

  // Ask bubble (above mid — overhead supply)
  const askR = wallR(askSize);
  ctx.beginPath();
  ctx.arc(W_WALL / 2, midY - askR - 3, askR, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(220,60,60,${0.12 + (askSize / maxWall) * 0.45})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(240,80,80,${0.4 + (askSize / maxWall) * 0.5})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Bid bubble (below mid — support)
  const bidR = wallR(bidSize);
  ctx.beginPath();
  ctx.arc(W_WALL / 2, midY + bidR + 3, bidR, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,200,160,${0.12 + (bidSize / maxWall) * 0.45})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(0,220,180,${0.4 + (bidSize / maxWall) * 0.5})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── 4. Center price axis line ────────────────────────────────────
  ctx.strokeStyle = 'rgba(100,130,160,0.3)';
  ctx.setLineDash([3, 6]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W_WALL + 4, midY); ctx.lineTo(W, midY); ctx.stroke();
  ctx.setLineDash([]);

  // ── 5. Trade bubbles (time-scrolling) ───────────────────────────
  const windowStart = now - TIMELINE_MS;
  const timeX = (t: number) => W_WALL + ((t - windowStart) / TIMELINE_MS) * (W - W_WALL);
  const maxR = (BUBBLE_H / 2) - 6;

  for (const trade of snap.trades) {
    if (trade.t < windowStart) continue;
    const x = timeX(trade.t);
    if (x < W_WALL + 2 || x > W - 2) continue;

    // Log-scale radius so 100-share and 10k-share trades are both visible
    const r = Math.min(maxR, Math.max(3, Math.log10(Math.max(1, trade.size)) * 4.5));
    const age = (now - trade.t) / TIMELINE_MS;
    const alpha = Math.max(0.08, 1 - age * 0.88);
    const yOff = trade.side === 'buy' ? -(r + 2) : trade.side === 'sell' ? (r + 2) : 0;

    ctx.beginPath();
    ctx.arc(x, midY + yOff, r, 0, Math.PI * 2);

    if (trade.side === 'buy') {
      ctx.fillStyle = `rgba(0,200,120,${alpha * 0.3})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(0,220,140,${alpha})`;
    } else if (trade.side === 'sell') {
      ctx.fillStyle = `rgba(220,60,60,${alpha * 0.3})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(240,80,80,${alpha})`;
    } else {
      ctx.fillStyle = `rgba(100,130,160,${alpha * 0.2})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(120,150,180,${alpha * 0.5})`;
    }
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const HISTORY_SLOTS = 300;

export default function ObiLivePanel({ snap }: { snap: ObiSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rafId = 0;

    const loop = () => {
      const el = canvasRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
      drawPanel(el, snapRef.current);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const { status, obiSmooth, bidPrice, askPrice, bidSize, askSize, errorMsg } = snap;
  const obiPct = Math.round(obiSmooth * 100);
  const pressure = obiPct > 55 ? 'BUY' : obiPct < 45 ? 'SELL' : 'NEUT';
  const pressureColor = obiPct > 55 ? '#00c8a0' : obiPct < 45 ? '#e05050' : '#7090a8';
  const fmtP = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p < 10 ? p.toFixed(5) : p.toFixed(2);
  const spread = bidPrice > 0 && askPrice > 0 ? (askPrice - bidPrice).toFixed(askPrice < 10 ? 5 : 2) : null;

  return (
    <div className="obi-panel">
      <div className="obi-panel__hdr">
        <span className={`obi-panel__dot obi-panel__dot--${status}`}>
          {status === 'live' ? '●' : status === 'connecting' || status === 'auth' ? '◌' : '○'}
        </span>
        <span className="obi-panel__label">OBI</span>
        {status === 'live' && (
          <>
            <span className="obi-panel__val" style={{ color: pressureColor }}>
              {obiPct}% <strong>{pressure}</strong>
            </span>
            <span className="obi-panel__sep">·</span>
            <span className="obi-panel__bid">BID {fmtP(bidPrice)} ×{bidSize}</span>
            <span className="obi-panel__ask">ASK {fmtP(askPrice)} ×{askSize}</span>
            {spread && <span className="obi-panel__spread">SPD {spread}</span>}
            <span className="obi-panel__trades">{snap.trades.length} trades</span>
          </>
        )}
        {(status === 'connecting' || status === 'auth') && (
          <span className="obi-panel__connecting">connecting…</span>
        )}
        {status === 'unsupported' && (
          <span className="obi-panel__warn">[[[UNKNOWN]]] {errorMsg}</span>
        )}
        {status === 'error' && (
          <span className="obi-panel__warn">{errorMsg}</span>
        )}
      </div>
      <canvas ref={canvasRef} className="obi-panel__canvas" />
    </div>
  );
}
