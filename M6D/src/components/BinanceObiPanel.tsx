import { useEffect, useRef } from 'react';
import type { BinanceObiSnapshot, DomSnap } from '../hooks/useBinanceObiStream';
import './BinanceObiPanel.css';

// ── Canvas layout constants ─────────────────────────────────────────────────
const N_LEVELS = 10;       // levels per side (10 ask + 10 bid = 20 total)
const HEATMAP_H = 90;      // px: DOM heatmap zone
const TRADE_H = 65;        // px: trade bubble zone
const CANVAS_H = HEATMAP_H + TRADE_H;
const PRICE_COL_W = 58;    // px: left price axis column
const SPREAD_GAP = 3;      // px: visual gap between ask/bid bands
const TRADE_WINDOW_MS = 45_000;

// ── Colour helpers ──────────────────────────────────────────────────────────
function askColor(intensity: number): string {
  // dark near zero → bright crimson near 1
  const a = 0.08 + intensity * 0.88;
  const g = Math.round(30 + intensity * 30);
  return `rgba(210,${g},${g},${a})`;
}
function bidColor(intensity: number): string {
  // dark near zero → bright teal near 1
  const a = 0.08 + intensity * 0.88;
  const g = Math.round(160 + intensity * 55);
  const b = Math.round(130 + intensity * 55);
  return `rgba(0,${g},${b},${a})`;
}

// ── Main canvas draw ────────────────────────────────────────────────────────
function drawPanel(canvas: HTMLCanvasElement, snap: BinanceObiSnapshot) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || W === 0 || H === 0) return;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#060e1a';
  ctx.fillRect(0, 0, W, H);

  const { domHistory, trades, bestBid, bestAsk } = snap;
  const chartW = W - PRICE_COL_W;
  const now = Date.now();

  // ── 1. DOM HEATMAP ────────────────────────────────────────────────────────
  const rowH = (HEATMAP_H - SPREAD_GAP) / (N_LEVELS * 2);  // height per row
  const askBandH = N_LEVELS * rowH;
  const bidTop = askBandH + SPREAD_GAP;

  // Find global max qty across visible history for normalization
  let maxQty = 1;
  for (const ds of domHistory) {
    for (const l of ds.bids) if (l.qty > maxQty) maxQty = l.qty;
    for (const l of ds.asks) if (l.qty > maxQty) maxQty = l.qty;
  }

  if (domHistory.length > 1) {
    const colW = Math.max(1, chartW / domHistory.length);

    domHistory.forEach((ds: DomSnap, colIdx: number) => {
      const x = PRICE_COL_W + colIdx * colW;

      // Ask rows: row 0 = asks[N_LEVELS-1] (furthest), row N_LEVELS-1 = asks[0] (best ask)
      for (let row = 0; row < N_LEVELS; row++) {
        const level = ds.asks[N_LEVELS - 1 - row];
        if (!level || level.qty === 0) continue;
        ctx.fillStyle = askColor(level.qty / maxQty);
        ctx.fillRect(x, row * rowH, colW + 0.5, rowH + 0.5);
      }

      // Bid rows: row 0 = bids[0] (best bid), row N_LEVELS-1 = bids[N_LEVELS-1] (furthest)
      for (let row = 0; row < N_LEVELS; row++) {
        const level = ds.bids[row];
        if (!level || level.qty === 0) continue;
        ctx.fillStyle = bidColor(level.qty / maxQty);
        ctx.fillRect(x, bidTop + row * rowH, colW + 0.5, rowH + 0.5);
      }
    });
  }

  // Spread gap divider line (mid price axis)
  const midLineY = askBandH + SPREAD_GAP / 2;
  ctx.strokeStyle = 'rgba(100,140,180,0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath(); ctx.moveTo(PRICE_COL_W, midLineY); ctx.lineTo(W, midLineY); ctx.stroke();
  ctx.setLineDash([]);

  // ── 2. Price axis (left column) ───────────────────────────────────────────
  ctx.fillStyle = '#06101c';
  ctx.fillRect(0, 0, PRICE_COL_W, HEATMAP_H);

  ctx.strokeStyle = '#0d1f3c';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PRICE_COL_W, 0); ctx.lineTo(PRICE_COL_W, HEATMAP_H); ctx.stroke();

  const lastDom = domHistory[domHistory.length - 1];
  if (lastDom && bestAsk > 0 && bestBid > 0) {
    ctx.font = '8px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';

    // Ask price labels (best ask at bottom of ask zone, furthest at top)
    for (let row = 0; row < Math.min(N_LEVELS, lastDom.asks.length); row++) {
      const level = lastDom.asks[N_LEVELS - 1 - row];
      if (!level) continue;
      const y = row * rowH + rowH / 2 + 3;
      ctx.fillStyle = `rgba(220,80,80,${0.4 + (level.qty / maxQty) * 0.5})`;
      ctx.fillText(level.price.toFixed(0), PRICE_COL_W - 2, y);
    }

    // Bid price labels
    for (let row = 0; row < Math.min(N_LEVELS, lastDom.bids.length); row++) {
      const level = lastDom.bids[row];
      if (!level) continue;
      const y = bidTop + row * rowH + rowH / 2 + 3;
      ctx.fillStyle = `rgba(0,200,160,${0.4 + (level.qty / maxQty) * 0.5})`;
      ctx.fillText(level.price.toFixed(0), PRICE_COL_W - 2, y);
    }
  }

  // Spread label in gap
  if (bestBid > 0 && bestAsk > 0) {
    const spread = (bestAsk - bestBid).toFixed(1);
    ctx.fillStyle = 'rgba(120,160,200,0.7)';
    ctx.font = '7.5px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`SPD ${spread}`, PRICE_COL_W / 2, midLineY + 3.5);
  }

  // ── 3. Heatmap → trade zone divider ──────────────────────────────────────
  ctx.strokeStyle = '#0d1f3c';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, HEATMAP_H); ctx.lineTo(W, HEATMAP_H); ctx.stroke();

  // ── 4. TRADE BUBBLE ZONE ─────────────────────────────────────────────────
  const tradeTop = HEATMAP_H;
  const tradeMidY = tradeTop + TRADE_H / 2;
  const maxTradeR = (TRADE_H / 2) - 5;

  // Center line
  ctx.strokeStyle = 'rgba(80,110,140,0.3)';
  ctx.setLineDash([2, 6]);
  ctx.beginPath(); ctx.moveTo(PRICE_COL_W + 4, tradeMidY); ctx.lineTo(W, tradeMidY); ctx.stroke();
  ctx.setLineDash([]);

  const windowStart = now - TRADE_WINDOW_MS;
  const timeX = (t: number) => PRICE_COL_W + ((t - windowStart) / TRADE_WINDOW_MS) * chartW;

  for (const trade of trades) {
    if (trade.t < windowStart) continue;
    const x = timeX(trade.t);
    if (x < PRICE_COL_W + 2 || x > W - 2) continue;

    // Log scale: 0.001 BTC → r≈3, 1 BTC → r≈13, 10 BTC → r≈17
    const r = Math.min(maxTradeR, Math.max(3, Math.log10(Math.max(0.0001, trade.qty) * 1000) * 5.5));
    const age = (now - trade.t) / TRADE_WINDOW_MS;
    const alpha = Math.max(0.07, 1 - age * 0.9);
    const yOff = trade.side === 'buy' ? -(r + 2) : (r + 2);

    ctx.beginPath();
    ctx.arc(x, tradeMidY + yOff, r, 0, Math.PI * 2);

    if (trade.side === 'buy') {
      ctx.fillStyle = `rgba(0,200,120,${alpha * 0.28})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(0,230,150,${alpha})`;
    } else {
      ctx.fillStyle = `rgba(220,50,50,${alpha * 0.28})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(250,70,70,${alpha})`;
    }
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Trade zone price axis bg
  ctx.fillStyle = '#06101c';
  ctx.fillRect(0, tradeTop, PRICE_COL_W, TRADE_H);
  ctx.strokeStyle = '#0d1f3c';
  ctx.beginPath(); ctx.moveTo(PRICE_COL_W, tradeTop); ctx.lineTo(PRICE_COL_W, tradeTop + TRADE_H); ctx.stroke();

  // BUY / SELL labels
  ctx.font = '7.5px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,200,130,0.45)';
  ctx.fillText('BUY', PRICE_COL_W / 2, tradeMidY - 8);
  ctx.fillStyle = 'rgba(220,60,60,0.45)';
  ctx.fillText('SELL', PRICE_COL_W / 2, tradeMidY + 16);
}

// ── React component ─────────────────────────────────────────────────────────
export default function BinanceObiPanel({ snap, sym }: { snap: BinanceObiSnapshot; sym: string }) {
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
      if (el.width !== w || el.height !== CANVAS_H) {
        el.width = w;
        el.height = CANVAS_H;
      }
      drawPanel(el, snapRef.current);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const { status, obiSmooth, bidDepth, askDepth, bestBid, bestAsk, trades, errorMsg } = snap;
  const obiPct = Math.round(obiSmooth * 100);
  const pressure = obiPct > 55 ? 'BUY' : obiPct < 45 ? 'SELL' : 'NEUT';
  const pressureColor = obiPct > 55 ? '#00c8a0' : obiPct < 45 ? '#e05050' : '#7090a8';
  const fmtMid = bestBid > 0 ? ((bestBid + bestAsk) / 2).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—';
  const bidBtc = bidDepth.toFixed(2);
  const askBtc = askDepth.toFixed(2);
  const recentBuys = trades.filter(t => t.side === 'buy' && Date.now() - t.t < 10_000).length;
  const recentSells = trades.filter(t => t.side === 'sell' && Date.now() - t.t < 10_000).length;

  return (
    <div className="bnb-panel">
      <div className="bnb-panel__hdr">
        <span className={`bnb-panel__dot bnb-panel__dot--${status}`}>
          {status === 'live' ? '●' : status === 'connecting' ? '◌' : '○'}
        </span>
        <span className="bnb-panel__label">BINANCE · {sym.toUpperCase()}</span>
        {status === 'live' && (
          <>
            <span className="bnb-panel__mid">{fmtMid}</span>
            <span className="bnb-panel__sep">·</span>
            <span className="bnb-panel__val" style={{ color: pressureColor }}>
              <strong>DOM {obiPct}%</strong> {pressure}
            </span>
            <span className="bnb-panel__sep">·</span>
            <span className="bnb-panel__bid">BID {bidBtc} ₿</span>
            <span className="bnb-panel__ask">ASK {askBtc} ₿</span>
            <span className="bnb-panel__sep">·</span>
            <span className="bnb-panel__buys">▲{recentBuys}</span>
            <span className="bnb-panel__sells">▼{recentSells}</span>
            <span className="bnb-panel__hint">10s</span>
          </>
        )}
        {status === 'connecting' && <span className="bnb-panel__connecting">connecting binance…</span>}
        {status === 'error' && <span className="bnb-panel__warn">{errorMsg}</span>}
      </div>
      <canvas ref={canvasRef} className="bnb-panel__canvas" />
    </div>
  );
}
