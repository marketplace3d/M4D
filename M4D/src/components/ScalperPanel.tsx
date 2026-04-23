/**
 * ScalperPanel — Order Flow Scalper (Binance free public WebSocket)
 * Renders FIRST into FX page as a collapsible panel.
 *
 * Data sources (no API key):
 *   wss://stream.binance.com:9443/ws/btcusdt@aggTrade    — live trades
 *   wss://stream.binance.com:9443/ws/btcusdt@depth20@100ms — order book
 *   https://api.binance.com/api/v3/klines?...            — seed 1m bars
 *
 * Visuals:
 *   • 1m candlestick chart  (lightweight-charts v5)
 *   • VWAP line             (session, resets midnight UTC)
 *   • Order-flow bubbles    (canvas overlay — BUY=green, SELL=red, size=log(qty))
 *   • DOM depth heatmap     (sidebar — top-10 bids/asks)
 *   • Delta bar             (10s rolling: aggressive buys − sells)
 *   • Signal chip           (ABSORPTION | MOMENTUM)
 */

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts';

// ── types ─────────────────────────────────────────────────────────────────────
interface Bubble  { price: number; ts: number; qty: number; side: 'BUY' | 'SELL' }
interface DepthLv { price: number; qty: number }
type Signal = 'ABSORPTION' | 'MOMENTUM' | null
type WsStatus = 'off' | 'connecting' | 'live'

// ── constants ─────────────────────────────────────────────────────────────────
const BUBBLE_MIN_QTY = 0.3   // BTC — filter retail noise
const BUBBLE_FADE_MS = 18_000
const DELTA_WIN_MS   = 10_000
const CHART_H        = 268 // px

// ── colours ───────────────────────────────────────────────────────────────────
const C = {
  bg:       'transparent',
  panel:    '#050b14',
  border:   '#0f1e2d',
  grid:     '#080f1a',
  fg:       '#8aa8bc',
  accent:   '#38bdf8',
  bull:     '#22c55e',
  bear:     '#ef4444',
  bullMid:  'rgba(34,197,94,',
  bearMid:  'rgba(239,68,68,',
  // VWAP colours — exact match to boomChartBuild
  vwapBull: 'rgba(74,222,128,0.9)',
  vwapBear: 'rgba(248,113,113,0.88)',
  abs:      '#a78bfa',
  mom:      '#22d3ee',
} as const;

export default function ScalperPanel() {
  const [open,      setOpen]      = useState(true);
  const [wsStatus,  setWsStatus]  = useState<WsStatus>('off');
  const [delta,     setDelta]     = useState(0);
  const [signal,    setSignal]    = useState<Signal>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [depth,     setDepth]     = useState<{ bids: DepthLv[]; asks: DepthLv[] }>({ bids: [], asks: [] });

  // chart refs
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapSerRef   = useRef<ISeriesApi<'Line'> | null>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  // streaming state refs (avoid stale closures + skip re-renders)
  const bubblesRef  = useRef<Bubble[]>([]);
  const deltaQRef   = useRef<{ qty: number; side: 'BUY' | 'SELL'; ts: number }[]>([]);
  const curBarRef   = useRef<CandlestickData<UTCTimestamp> | null>(null);
  const vwapAccRef  = useRef<{ cumTP: number; cumVol: number; day: number }>({ cumTP: 0, cumVol: 0, day: -1 });
  const rafRef      = useRef<number>(0);
  const signalRef   = useRef<Signal>(null);
  const vwapColRef  = useRef<string>(C.vwapBull);

  // ── chart: init on open, destroy on close ────────────────────────────────
  useEffect(() => {
    if (!open || !containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: C.bg },
        textColor: C.fg,
        fontFamily: "'Share Tech Mono','Courier New',monospace",
        fontSize: 10,
      },
      grid:         { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border },
      timeScale:    { borderColor: C.border, timeVisible: true, secondsVisible: false },
      crosshair:    { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth,
      height: CHART_H,
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: C.bull, downColor: C.bear,
      borderVisible: false,
      wickUpColor: C.bull, wickDownColor: C.bear,
    });
    candleRef.current = candle;

    const vwap = chart.addSeries(LineSeries, {
      color: C.vwapBull,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    vwapSerRef.current = vwap;

    // ── seed 200 × 1m klines from Binance REST ────────────────────────────
    void (async () => {
      try {
        const res  = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=200');
        const raw  = await res.json() as [number, string, string, string, string, string][];
        const now  = new Date();
        const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
        let cumTP = 0, cumVol = 0;
        const bars:    CandlestickData<UTCTimestamp>[] = [];
        const vwapPts: LineData<UTCTimestamp>[]         = [];

        for (const k of raw) {
          const t = Math.floor(k[0] / 1000) as UTCTimestamp;
          const o = +k[1], h = +k[2], l = +k[3], c = +k[4], v = +k[5];
          bars.push({ time: t, open: o, high: h, low: l, close: c });
          if (t >= dayStart) { const tp = (h + l + c) / 3; cumTP += tp * v; cumVol += v; }
          if (cumVol > 0) vwapPts.push({ time: t, value: cumTP / cumVol });
        }

        vwapAccRef.current = { cumTP, cumVol, day: dayStart };
        candle.setData(bars);
        if (vwapPts.length) {
          vwap.setData(vwapPts);
          // set initial VWAP colour based on last close vs last VWAP
          const lastClose = +raw[raw.length - 1]![4];
          const lastVwap  = vwapPts[vwapPts.length - 1]!.value;
          const initCol   = lastClose >= lastVwap ? C.vwapBull : C.vwapBear;
          vwapColRef.current = initCol;
          vwap.applyOptions({ color: initCol });
        }
        chart.timeScale().scrollToRealTime();

        const last = raw[raw.length - 1];
        if (last) {
          const t = Math.floor(last[0] / 1000) as UTCTimestamp;
          curBarRef.current = { time: t, open: +last[1], high: +last[2], low: +last[3], close: +last[4] };
          setLastPrice(+last[4]);
        }
      } catch (e) { console.warn('[Scalper] seed error', e); }
    })();

    // ── size canvas to match container ────────────────────────────────────
    const syncCanvas = (w: number, h: number) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const dpr = devicePixelRatio || 1;
      cv.width  = w * dpr;
      cv.height = h * dpr;
      cv.style.width  = `${w}px`;
      cv.style.height = `${h}px`;
    };
    syncCanvas(containerRef.current.clientWidth, CHART_H);

    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      if (!e) return;
      const w = e.contentRect.width;
      chart.applyOptions({ width: w });
      syncCanvas(w, CHART_H);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current   = null;
      candleRef.current  = null;
      vwapSerRef.current = null;
    };
  }, [open]);

  // ── WebSocket connections ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setWsStatus('connecting');

    // ── aggTrade — live trades → candle, VWAP, bubbles, delta ─────────────
    const wsAgg = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');

    wsAgg.onopen  = () => setWsStatus('live');
    wsAgg.onerror = () => setWsStatus('off');
    wsAgg.onclose = () => setWsStatus('off');

    wsAgg.onmessage = (evt) => {
      const d = JSON.parse(evt.data as string) as { T: number; p: string; q: string; m: boolean };
      const price   = +d.p;
      const qty     = +d.q;
      const side    = d.m ? 'SELL' : 'BUY' as const;  // buyer is maker → aggressive SELL
      const nowMs   = d.T;
      const barTime = Math.floor(nowMs / 60_000) * 60 as UTCTimestamp;

      setLastPrice(price);

      // candle update
      if (candleRef.current) {
        const prev = curBarRef.current;
        const bar: CandlestickData<UTCTimestamp> = (prev && prev.time === barTime) ? {
          time: barTime, open: prev.open,
          high: Math.max(prev.high, price),
          low:  Math.min(prev.low,  price),
          close: price,
        } : { time: barTime, open: price, high: price, low: price, close: price };
        curBarRef.current = bar;
        candleRef.current.update(bar);
      }

      // VWAP update + dynamic green/red colour
      const acc = vwapAccRef.current;
      acc.cumTP  += price * qty;
      acc.cumVol += qty;
      if (acc.cumVol > 0 && vwapSerRef.current) {
        const vwapVal = acc.cumTP / acc.cumVol;
        const vwapCol = price >= vwapVal ? C.vwapBull : C.vwapBear;
        if (vwapCol !== vwapColRef.current) {
          vwapColRef.current = vwapCol;
          vwapSerRef.current.applyOptions({ color: vwapCol });
        }
        vwapSerRef.current.update({ time: barTime, value: vwapVal });
      }

      // bubbles
      if (qty >= BUBBLE_MIN_QTY) bubblesRef.current.push({ price, ts: nowMs, qty, side });

      // delta rolling window
      const cutoff = nowMs - DELTA_WIN_MS;
      deltaQRef.current = deltaQRef.current.filter(t => t.ts > cutoff);
      deltaQRef.current.push({ qty, side, ts: nowMs });

      const d10 = deltaQRef.current.reduce((s, t) => s + (t.side === 'BUY' ? t.qty : -t.qty), 0);
      setDelta(d10);

      // signal detection
      const buys  = deltaQRef.current.filter(t => t.side === 'BUY').reduce((s, t) => s + t.qty, 0);
      const sells = deltaQRef.current.filter(t => t.side === 'SELL').reduce((s, t) => s + t.qty, 0);
      const total = buys + sells;
      let sig: Signal = null;
      if (total > 5) {
        if (sells > buys * 2 && d10 > 0)  sig = 'ABSORPTION';  // selling absorbed, delta flipping
        else if (buys > sells * 2 && qty > 2) sig = 'MOMENTUM'; // whale aggressive buy
      }
      if (sig !== signalRef.current) { signalRef.current = sig; setSignal(sig); }
    };

    // ── depth20 — order book snapshot ─────────────────────────────────────
    const wsDepth = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@depth20@100ms');
    wsDepth.onmessage = (evt) => {
      const d = JSON.parse(evt.data as string) as { bids: [string,string][]; asks: [string,string][] };
      setDepth({
        bids: d.bids.slice(0, 10).map(([p, q]) => ({ price: +p, qty: +q })),
        asks: d.asks.slice(0, 10).map(([p, q]) => ({ price: +p, qty: +q })),
      });
    };

    return () => {
      wsAgg.close();
      wsDepth.close();
      setWsStatus('off');
    };
  }, [open]);

  // ── canvas RAF bubble paint ───────────────────────────────────────────────
  useEffect(() => {
    const paint = () => {
      rafRef.current = requestAnimationFrame(paint);
      const cv  = canvasRef.current;
      const ch  = chartRef.current;
      const cs  = candleRef.current;
      if (!cv || !ch || !cs) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;

      const dpr = devicePixelRatio || 1;
      ctx.clearRect(0, 0, cv.width, cv.height);

      const now = Date.now();
      bubblesRef.current = bubblesRef.current.filter(b => now - b.ts < BUBBLE_FADE_MS);

      for (const b of bubblesRef.current) {
        const ts = Math.floor(b.ts / 60_000) * 60 as UTCTimestamp;
        const x  = ch.timeScale().timeToCoordinate(ts);
        const y  = cs.priceToCoordinate(b.price);
        if (x === null || y === null) continue;

        const age    = (now - b.ts) / BUBBLE_FADE_MS;
        const alpha  = Math.max(0, 1 - age);
        const radius = Math.max(3, Math.log1p(b.qty) * 14) * dpr;

        ctx.beginPath();
        ctx.arc(x * dpr, y * dpr, radius, 0, Math.PI * 2);
        ctx.fillStyle   = b.side === 'BUY' ? `${C.bullMid}${(alpha * 0.4).toFixed(2)})` : `${C.bearMid}${(alpha * 0.4).toFixed(2)})`;
        ctx.fill();
        ctx.strokeStyle = b.side === 'BUY' ? `${C.bullMid}${(alpha * 0.85).toFixed(2)})` : `${C.bearMid}${(alpha * 0.85).toFixed(2)})`;
        ctx.lineWidth   = 1.5 * dpr;
        ctx.stroke();
      }
    };
    rafRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── derived display values ────────────────────────────────────────────────
  const fmtPrice  = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.toFixed(4);
  const deltaBull = delta > 0;
  const deltaAbs  = Math.abs(delta);
  const maxQty    = Math.max(...depth.bids.map(b => b.qty), ...depth.asks.map(a => a.qty), 0.01);

  // depth sidebar rows — asks reversed so best ask is nearest spread
  const askRows  = [...depth.asks].reverse();
  const bidRows  = depth.bids;
  const bestAsk  = depth.asks[0]?.price;
  const bestBid  = depth.bids[0]?.price;
  const spread   = bestAsk && bestBid ? (bestAsk - bestBid).toFixed(1) : '—';

  // status dot colour
  const dotColor = wsStatus === 'live' ? C.bull : wsStatus === 'connecting' ? '#f59e0b' : '#334155';

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, fontFamily: "'Share Tech Mono','Courier New',monospace" }}>

      {/* ── header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px', height: 32, borderBottom: `1px solid ${C.border}`,
        background: 'rgba(0,0,0,0.25)',
      }}>
        {/* status dot */}
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />

        {/* label */}
        <span style={{ fontSize: 11, fontWeight: 700, color: '#dce6f0', letterSpacing: '0.12em' }}>SCALPER</span>
        <span style={{ fontSize: 10, color: C.fg }}>BTC/USDT · 1m</span>

        {/* live price */}
        {lastPrice !== null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, marginLeft: 4 }}>
            ${fmtPrice(lastPrice)}
          </span>
        )}

        {/* spacer */}
        <div style={{ flex: 1 }} />

        {/* delta chip */}
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
          background: deltaBull ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          color: deltaBull ? C.bull : C.bear,
          border: `1px solid ${deltaBull ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          minWidth: 80, textAlign: 'center' as const,
        }}>
          Δ {deltaBull ? '+' : ''}{delta.toFixed(2)} BTC
        </span>

        {/* signal chip */}
        {signal && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
            background: signal === 'ABSORPTION' ? 'rgba(167,139,250,0.15)' : 'rgba(34,211,238,0.15)',
            color: signal === 'ABSORPTION' ? C.abs : C.mom,
            border: `1px solid ${signal === 'ABSORPTION' ? 'rgba(167,139,250,0.35)' : 'rgba(34,211,238,0.35)'}`,
            letterSpacing: '0.08em',
          }}>
            {signal}
          </span>
        )}

        {/* spread */}
        <span style={{ fontSize: 9, color: '#415065' }}>SPD {spread}</span>

        {/* collapse toggle */}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: C.fg, fontSize: 11, padding: '2px 4px', lineHeight: 1,
          }}
          title={open ? 'Collapse scalper' : 'Expand scalper'}
        >
          {open ? '▴' : '▾'}
        </button>
      </div>

      {/* ── body (chart + depth sidebar) ── */}
      {open && (
        <>
          <div style={{ display: 'flex', minHeight: 0 }}>

            {/* chart + canvas overlay */}
            <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0, height: CHART_H }}>
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute', inset: 0,
                  pointerEvents: 'none', zIndex: 100,
                }}
              />
            </div>

            {/* depth heatmap sidebar */}
            <div style={{
              width: 128, flexShrink: 0,
              background: 'rgba(0,0,0,0.3)',
              borderLeft: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column',
              fontSize: 9, fontFamily: 'inherit', overflow: 'hidden',
            }}>
              {/* ASKS header */}
              <div style={{ padding: '3px 6px', color: C.bear, fontSize: 8, letterSpacing: '0.1em', borderBottom: `1px solid ${C.border}`, opacity: 0.7 }}>
                ASK ×10
              </div>
              {/* ask rows (reversed — best ask closest to spread) */}
              {askRows.map((a, i) => {
                const pct = (a.qty / maxQty) * 100;
                return (
                  <div key={i} style={{ position: 'relative', padding: '1px 6px', display: 'flex', justifyContent: 'space-between', overflow: 'hidden', borderLeft: '2px solid rgba(239,68,68,0.35)' }}>
                    <span style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${pct}%`, background: 'rgba(239,68,68,0.28)', zIndex: 0,
                    }} />
                    <span style={{ position: 'relative', color: '#c8dae8', zIndex: 1 }}>{a.price.toFixed(0)}</span>
                    <span style={{ position: 'relative', color: '#ff6b6b', zIndex: 1, fontWeight: 600 }}>{a.qty.toFixed(1)}</span>
                  </div>
                );
              })}

              {/* spread divider */}
              <div style={{
                padding: '2px 6px', textAlign: 'center' as const,
                borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
                color: '#38bdf8', fontSize: 8, letterSpacing: '0.08em',
                background: 'rgba(56,189,248,0.05)',
              }}>
                SPD {spread}
              </div>

              {/* bid rows */}
              {bidRows.map((b, i) => {
                const pct = (b.qty / maxQty) * 100;
                return (
                  <div key={i} style={{ position: 'relative', padding: '1px 6px', display: 'flex', justifyContent: 'space-between', overflow: 'hidden', borderLeft: '2px solid rgba(34,197,94,0.35)' }}>
                    <span style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${pct}%`, background: 'rgba(34,197,94,0.28)', zIndex: 0,
                    }} />
                    <span style={{ position: 'relative', color: '#c8dae8', zIndex: 1 }}>{b.price.toFixed(0)}</span>
                    <span style={{ position: 'relative', color: '#4ade80', zIndex: 1, fontWeight: 600 }}>{b.qty.toFixed(1)}</span>
                  </div>
                );
              })}

              {/* BID footer */}
              <div style={{ marginTop: 'auto', padding: '3px 6px', color: C.bull, fontSize: 8, letterSpacing: '0.1em', borderTop: `1px solid ${C.border}`, opacity: 0.7 }}>
                BID ×10
              </div>
            </div>
          </div>

          {/* ── delta bar ── */}
          <div style={{
            height: 28, display: 'flex', alignItems: 'center',
            padding: '0 10px', gap: 8,
            background: 'rgba(0,0,0,0.2)', borderTop: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 9, color: '#415065', letterSpacing: '0.08em', flexShrink: 0 }}>DELTA 10s</span>
            {/* track */}
            <div style={{
              flex: 1, height: 6, background: '#0a1520',
              borderRadius: 3, overflow: 'hidden', position: 'relative',
            }}>
              {/* center line */}
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#1e3045' }} />
              {/* fill */}
              <div style={{
                position: 'absolute',
                top: 0, bottom: 0,
                left:  deltaBull ? '50%' : `calc(50% - ${Math.min(50, (deltaAbs / 10) * 50)}%)`,
                width: `${Math.min(50, (deltaAbs / 10) * 50)}%`,
                background: deltaBull
                  ? 'linear-gradient(90deg, rgba(34,197,94,0.4) 0%, rgba(34,197,94,0.8) 100%)'
                  : 'linear-gradient(270deg, rgba(239,68,68,0.4) 0%, rgba(239,68,68,0.8) 100%)',
                borderRadius: 3,
                transition: 'width 0.15s ease, left 0.15s ease',
              }} />
            </div>
            {/* numeric */}
            <span style={{ fontSize: 9, color: deltaBull ? C.bull : C.bear, minWidth: 60, textAlign: 'right' as const, flexShrink: 0 }}>
              {deltaBull ? '+' : ''}{delta.toFixed(3)} Δ
            </span>
          </div>
        </>
      )}
    </div>
  );
}
